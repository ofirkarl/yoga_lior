// זיהוי מכשיר ודפדפן, לצורך הדרכת ההתקנה למסך הבית.

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // אייפד חדש מציג את עצמו כמק, אבל עם מסך מגע
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** האם האפליקציה פתוחה מהאייקון במסך הבית (ולא בתוך דפדפן) */
export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type IosBrowser = "safari" | "chrome" | "inapp" | "other";

/** באיזה דפדפן האייפון פתח את הקישור. בדפדפנים שבתוך אפליקציות אחרות אין "הוספה למסך הבית". */
export function iosBrowser(): IosBrowser {
  const ua = navigator.userAgent;
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|Snapchat|LinkedInApp/i.test(ua)) return "inapp";
  if (/CriOS/.test(ua)) return "chrome";
  if (/FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)) return "other";
  if (/Safari/.test(ua)) return "safari";
  return "inapp";
}

// באנדרואיד, כרום מאפשר להציג חלון התקנה משלנו. האירוע מגיע מוקדם, אז שומרים אותו.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function listenForInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((l) => l());
  });
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export function onInstallPromptChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const p = deferredPrompt;
  deferredPrompt = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  listeners.forEach((l) => l());
  return outcome === "accepted";
}
