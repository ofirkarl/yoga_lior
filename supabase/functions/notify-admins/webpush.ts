// Web Push בלי ספריות חיצוניות, רק WebCrypto.
// הצפנה לפי RFC 8291 (aes128gcm) וזיהוי השרת לפי RFC 8292 (VAPID).
// עובד ב-Deno (Edge Functions) וב-Bun (בדיקות).

export interface PushSubscription {
  endpoint: string;
  p256dh: string; // מפתח ציבורי של הדפדפן, base64url, 65 בתים
  auth: string; // סוד אימות של הדפדפן, base64url, 16 בתים
}

export interface Vapid {
  publicKey: string; // base64url, 65 בתים (נקודה לא דחוסה)
  privateJwk: JsonWebKey; // מפתח פרטי P-256 בפורמט JWK
  subject: string; // mailto: או https:
}

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** מצפין הודעה עבור מנוי אחד. מחזיר את גוף הבקשה המוכן לשליחה. */
export async function encryptPayload(
  sub: Pick<PushSubscription, "p256dh" | "auth">,
  plaintext: Uint8Array,
  // לבדיקות בלבד: מפתח ו-salt קבועים
  fixed?: { keyPair: CryptoKeyPair; salt: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("bad_subscription_keys");

  const asKeys = fixed?.keyPair ??
    (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // רשומה אחת ואחרונה: התוכן ואחריו המפריד 0x02
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = 4096;
  if (cipher.length + 86 > rs) throw new Error("payload_too_large");
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** חתימת VAPID (JWT מסוג ES256) עבור שרת ההתראות של המנוי. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...vapid.privateJwk, key_ops: ["sign"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto מחזיר r||s באורך 64 בתים, שזה בדיוק הפורמט של JWS
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

export interface SendResult {
  endpoint: string;
  status: number;
  /** המנוי כבר לא קיים (הסירו הרשאה, החליפו מכשיר) ואפשר למחוק אותו */
  gone: boolean;
}

export async function sendPush(
  sub: PushSubscription,
  payload: unknown,
  vapid: Vapid,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {},
): Promise<SendResult> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl ?? 86400),
    Urgency: opts.urgency ?? "high",
  };
  if (opts.topic) headers.Topic = opts.topic;
  const res = await fetch(sub.endpoint, { method: "POST", headers, body });
  await res.body?.cancel();
  return { endpoint: sub.endpoint, status: res.status, gone: res.status === 404 || res.status === 410 };
}
