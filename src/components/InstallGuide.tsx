// הדרכת התקנה למסך הבית. באייפון זה תנאי להתראות, ולכן מוצג כבר במסך הכניסה.
import { useEffect, useState } from "react";
import {
  canPromptInstall, iosBrowser, isAndroid, isIos, isStandalone, onInstallPromptChange, promptInstall,
} from "../lib/platform";
import { Sheet } from "./ui";

const DISMISS_KEY = "yoga.installGuide.dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
function writeDismissed(v: boolean) {
  try {
    if (v) localStorage.setItem(DISMISS_KEY, "1");
    else localStorage.removeItem(DISMISS_KEY);
  } catch { /* דפדפן בלי אחסון: פשוט לא זוכרים */ }
}

// אייקונים בסגנון של iOS, כדי שיהיה קל לזהות את הכפתור על המסך
const ShareGlyph = () => (
  <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const DotsGlyph = () => (
  <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="6" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="18" cy="12" r="1.8" fill="currentColor" />
  </svg>
);
const AddGlyph = () => (
  <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** השלבים עצמם, לפי הדפדפן שבו הקישור נפתח */
export function InstallSteps() {
  if (isIos()) {
    const b = iosBrowser();
    if (b === "inapp" || b === "other")
      return (
        <ol className="install-steps">
          <li>
            הקישור נפתח בתוך אפליקציה אחרת, ומשם אי אפשר להתקין.
            לחצי על <DotsGlyph /> או על <ShareGlyph /> ובחרי <strong>"פתיחה בספארי"</strong>.
          </li>
          <li>בספארי, חזרי למסך הזה וההוראות יתעדכנו.</li>
        </ol>
      );
    if (b === "chrome")
      return (
        <ol className="install-steps">
          <li>לחצי על <ShareGlyph /> <strong>שיתוף</strong> בשורת הכתובת למעלה.</li>
          <li>בחרי <AddGlyph /> <strong>"הוספה למסך הבית"</strong> ואז <strong>"הוספה"</strong>.</li>
          <li>פתחי את <strong>יוגה עם ליאור</strong> מהאייקון החדש והתחברי משם.</li>
        </ol>
      );
    return (
      <ol className="install-steps">
        <li>
          לחצי על <ShareGlyph /> <strong>שיתוף</strong> בסרגל של ספארי.
          <span className="install-note">לא רואה אותו? לחצי קודם על <DotsGlyph /> ליד שורת הכתובת.</span>
        </li>
        <li>גללי מטה ובחרי <AddGlyph /> <strong>"הוספה למסך הבית"</strong>.</li>
        <li>אם יש מתג לפתיחה כאפליקציה, השאירי אותו דלוק. לחצי <strong>"הוספה"</strong>.</li>
        <li>פתחי את <strong>יוגה עם ליאור</strong> מהאייקון החדש במסך הבית, והתחברי משם.</li>
      </ol>
    );
  }
  return (
    <ol className="install-steps">
      <li>לחצי על <DotsGlyph /> בפינה של הדפדפן.</li>
      <li>בחרי <strong>"הוספה למסך הבית"</strong> או <strong>"התקנת אפליקציה"</strong>.</li>
      <li>פתחי את <strong>יוגה עם ליאור</strong> מהאייקון החדש.</li>
    </ol>
  );
}

function useInstallPrompt(): boolean {
  const [can, setCan] = useState(canPromptInstall);
  useEffect(() => onInstallPromptChange(() => setCan(canPromptInstall())), []);
  return can;
}

/** כרטיס במסך הכניסה: באייפון מסביר איך מתקינים, באנדרואיד מציע התקנה בלחיצה */
export function InstallCard() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const androidPrompt = useInstallPrompt();

  if (isStandalone()) return null;

  if (isIos()) {
    if (dismissed)
      return (
        <p className="hint" style={{ marginTop: 0 }}>
          <button type="button" className="link-btn" onClick={() => { writeDismissed(false); setDismissed(false); }}>
            איך מוסיפים את האפליקציה למסך הבית?
          </button>
        </p>
      );
    return (
      <section className="card install-card" aria-labelledby="install-title">
        <h2 id="install-title">קודם מוסיפים למסך הבית</h2>
        <p>
          כך האפליקציה תיפתח כמו כל אפליקציה אחרת, ותוכל לשלוח לך תזכורות והודעות על שיעורים.
          לוקח חצי דקה.
        </p>
        <InstallSteps />
        <p className="install-note">
          חשוב: באייפון, כניסה שעשית בספארי לא עוברת לאפליקציה שבמסך הבית. לכן כדאי להתקין קודם ולהתחבר מהאייקון.
        </p>
        <button type="button" className="btn btn--ghost btn--block" onClick={() => { writeDismissed(true); setDismissed(true); }}>
          להמשיך בדפדפן בינתיים
        </button>
      </section>
    );
  }

  if (isAndroid() && androidPrompt)
    return (
      <section className="card install-card" aria-labelledby="install-title">
        <h2 id="install-title">התקנת האפליקציה</h2>
        <p>אייקון במסך הבית, פתיחה בלחיצה אחת, והתראות על שיעורים.</p>
        <button type="button" className="btn btn--primary btn--block" onClick={() => promptInstall()}>
          התקנה למסך הבית
        </button>
      </section>
    );

  return null;
}

/** כפתור קטן שפותח את ההוראות. למסכים שאחרי הכניסה (הכרטיסייה שלי, חדר הבקרה). */
export function InstallHelpButton({ label = "הוספת האפליקציה למסך הבית" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const androidPrompt = useInstallPrompt();
  if (isStandalone()) return null;
  if (!isIos() && !isAndroid()) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={() => (androidPrompt ? promptInstall() : setOpen(true))}
      >
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="הוספה למסך הבית">
        <InstallSteps />
        <button type="button" className="btn btn--primary btn--block" onClick={() => setOpen(false)}>הבנתי</button>
      </Sheet>
    </>
  );
}
