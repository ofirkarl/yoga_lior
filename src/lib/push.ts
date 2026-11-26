// התראות Push במכשיר הנוכחי: בדיקת תמיכה, הפעלה וכיבוי.
import { api } from "../lib/api";

/** המפתח הציבורי של השרת (VAPID). ציבורי מעצם הגדרתו, הפרטי שמור ב-Vault בלבד. */
const VAPID_PUBLIC_KEY = "BE_-YB6iSDVXIYc80ihP56pvRdjDZxlk0ffpTCEToy1pc2JDsbavRUhhrUWHq9Vz97S9e3ll0uMiXkin5fDh4wI";

export type PushState =
  | "unsupported" // הדפדפן לא תומך
  | "needs-install" // אייפון: צריך קודם להוסיף למסך הבית
  | "denied" // ההרשאה נחסמה בהגדרות
  | "off"
  | "on";

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** רישום ה-service worker. בטוח לקרוא כמה פעמים. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register("/sw.js").catch(() => null);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function save(sub: PushSubscription): Promise<void> {
  const j = sub.toJSON();
  await api.savePushSubscription(j.endpoint!, j.keys!.p256dh, j.keys!.auth, navigator.userAgent);
}

export async function getPushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await currentSubscription();
  if (sub && Notification.permission === "granted") {
    // מוודא שהשרת מכיר את המכשיר הזה תחת המשתמשת הנוכחית
    save(sub).catch(() => {});
    return "on";
  }
  return "off";
}

/** חייב להיקרא מתוך לחיצה של המשתמשת (דרישה של אייפון). */
export async function enablePush(): Promise<PushState> {
  // בקשת ההרשאה קודם, לפני כל await אחר, כדי שהדפדפן יזהה שהיא באה מלחיצה
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  await save(sub);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await api.deletePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
  return "off";
}
