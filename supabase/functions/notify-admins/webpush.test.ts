import { describe, expect, test } from "bun:test";
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from "./webpush";

const enc = new TextEncoder();

async function importEcPair(pubB64: string, privB64: string, alg: "ECDH" | "ECDSA") {
  const pub = b64urlDecode(pubB64);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: privB64, ext: true,
  };
  const usages = alg === "ECDH" ? ["deriveBits"] : ["sign"];
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: alg, namedCurve: "P-256" }, true, usages as KeyUsage[]);
  const publicKey = await crypto.subtle.importKey("raw", pub, { name: alg, namedCurve: "P-256" }, true, alg === "ECDH" ? [] : ["verify"]);
  return { privateKey, publicKey } as CryptoKeyPair;
}

/** פענוח כמו שהדפדפן עושה, כדי לבדוק הלוך-חזור */
async function decrypt(body: Uint8Array, uaPair: CryptoKeyPair, uaPublic: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPair.privateKey, 256));
  const h = async (s: Uint8Array, k: Uint8Array, i: Uint8Array, n: number) => {
    const key = await crypto.subtle.importKey("raw", k, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info: i }, key, n * 8));
  };
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await h(auth, ecdh, info, 32);
  const cek = await h(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await h(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("RFC 8291 נספח A", () => {
  test("מפיק בדיוק את וקטור הבדיקה", async () => {
    const asPair = await importEcPair(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
      "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      "ECDH",
    );
    const body = await encryptPayload(
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      enc.encode("When I grow up, I want to be a watermelon"),
      { keyPair: asPair, salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw") },
    );
    expect(b64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });
});

describe("הלוך-חזור", () => {
  test("הדפדפן מפענח את מה שהשרת הצפין, כולל עברית", async () => {
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const msg = JSON.stringify({ title: "בקשת הצטרפות חדשה", body: "מיכל לוי" });
    const body = await encryptPayload({ p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) }, enc.encode(msg));
    expect(await decrypt(body, ua, uaPublic, auth)).toBe(msg);
  });

  test("דוחה מפתחות באורך שגוי", async () => {
    await expect(encryptPayload({ p256dh: "AAAA", auth: "AAAA" }, enc.encode("x"))).rejects.toThrow("bad_subscription_keys");
  });
});

describe("VAPID", () => {
  test("JWT חתום שאפשר לאמת עם המפתח הציבורי", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicKey = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const now = 1_800_000_000_000;
    const h = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { publicKey, privateJwk, subject: "mailto:x@example.com" }, now);
    const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    expect(m[4]).toBe(publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.exp).toBe(now / 1000 + 12 * 3600);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64urlDecode(m[3]), enc.encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
  });
});
