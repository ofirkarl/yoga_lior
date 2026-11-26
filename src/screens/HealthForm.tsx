import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import type { HealthAnswers, Profile } from "../lib/types";
import { Field } from "../components/ui";

// השאלות מהטופס הקיים של ליאור. תעודת זהות לא נאספת כאן בכוונה: היא לא נחוצה להרשמה לשיעור,
// ועדיף לא להחזיק מידע רגיש שאין בו צורך.
const REQUIRED_TEXT: { key: keyof HealthAnswers; label: string }[] = [
  { key: "back_joint_pain", label: "יש כאבי גב או מפרקים?" },
  { key: "health_issue", label: "יש בעיה בריאותית כלשהי?" },
  { key: "regular_medication", label: "יש תרופות שנלקחות באופן קבוע?" },
  { key: "surgery", label: "היה הליך כירורגי בעבר?" },
];
const OPTIONAL_TEXT: { key: keyof HealthAnswers; label: string }[] = [
  { key: "menstrual_irregularity", label: "אי סדירות במחזור הוסת? (לא חובה)" },
  { key: "gynecological_issue", label: "בעיה גניקולוגית? (לא חובה)" },
  { key: "anything_else", label: "האם יש משהו אחר שעליי לדעת? (לא חובה)" },
];

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

export function HealthForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [first, last] = splitName(profile.full_name);
  const [a, setA] = useState<HealthAnswers>({
    first_name: first,
    last_name: last,
    birth_date: "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    practiced_before: "",
    practice_details: "",
    back_joint_pain: "",
    health_issue: "",
    regular_medication: "",
    surgery: "",
    menstrual_irregularity: "",
    gynecological_issue: "",
    anything_else: "",
    declaration_accepted: false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof HealthAnswers, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const set = <K extends keyof HealthAnswers>(k: K, v: HealthAnswers[K]) => {
    setA((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate(): boolean {
    const e: typeof errors = {};
    if (!a.first_name.trim()) e.first_name = "צריך למלא שם פרטי";
    if (!a.last_name.trim()) e.last_name = "צריך למלא שם משפחה";
    if (!a.birth_date) e.birth_date = "צריך למלא תאריך לידה";
    if (!/^\+?[0-9\s-]{9,15}$/.test(a.phone)) e.phone = "צריך מספר טלפון, למשל 050-1234567";
    if (a.email && !/^\S+@\S+\.\S+$/.test(a.email)) e.email = "כתובת האימייל לא נראית שלמה";
    if (!a.practiced_before) e.practiced_before = "צריך לבחור כן או לא";
    for (const q of REQUIRED_TEXT) if (!String(a[q.key]).trim()) e[q.key] = "אם לא, אפשר פשוט לכתוב ״לא״";
    if (!a.declaration_accepted) e.declaration_accepted = "צריך לאשר את ההצהרה כדי להמשיך";
    setErrors(e);
    const firstBad = Object.keys(e)[0];
    if (firstBad) document.getElementById(`hf-${firstBad}`)?.focus();
    return !firstBad;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.submitHealthDeclaration(a, `${a.first_name.trim()} ${a.last_name.trim()}`);
      onDone();
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const text = (key: keyof HealthAnswers, label: string, opts: { type?: string; multiline?: boolean; ltr?: boolean; auto?: string } = {}) => (
    <div className="field">
      <label htmlFor={`hf-${key}`}>{label}</label>
      {opts.multiline ? (
        <textarea
          id={`hf-${key}`}
          className="textarea"
          value={String(a[key])}
          onChange={(e) => set(key, e.target.value as never)}
          aria-invalid={!!errors[key] || undefined}
          aria-describedby={errors[key] ? `hf-${key}-err` : undefined}
        />
      ) : (
        <input
          id={`hf-${key}`}
          className={`input${opts.ltr ? " input--ltr" : ""}`}
          type={opts.type ?? "text"}
          autoComplete={opts.auto}
          value={String(a[key])}
          onChange={(e) => set(key, e.target.value as never)}
          aria-invalid={!!errors[key] || undefined}
          aria-describedby={errors[key] ? `hf-${key}-err` : undefined}
        />
      )}
      {errors[key] && <p className="error" id={`hf-${key}-err`}>{errors[key]}</p>}
    </div>
  );

  return (
    <main id="main" className="page page--plain">
      <div className="page-header">
        <h1>הצהרת בריאות</h1>
        <p>פעם אחת, לפני השיעור הראשון. רק ליאור רואה את התשובות.</p>
      </div>

      <form onSubmit={submit} className="stack" noValidate>
        <h2>פרטים אישיים</h2>
        {text("first_name", "שם פרטי", { auto: "given-name" })}
        {text("last_name", "שם משפחה", { auto: "family-name" })}
        {text("birth_date", "תאריך לידה", { type: "date", auto: "bday" })}
        {text("phone", "טלפון", { type: "tel", ltr: true, auto: "tel" })}
        {text("email", "אימייל (לא חובה)", { type: "email", ltr: true, auto: "email" })}

        <h2>תרגול ובריאות</h2>
        <fieldset className="field" aria-describedby={errors.practiced_before ? "hf-practiced_before-err" : undefined}>
          <legend>האם תרגלת יוגה בעבר?</legend>
          <div className="choice-row">
            {(["yes", "no"] as const).map((v, i) => (
              <label className="choice" key={v}>
                <input
                  id={i === 0 ? "hf-practiced_before" : undefined}
                  type="radio"
                  name="practiced_before"
                  checked={a.practiced_before === v}
                  onChange={() => set("practiced_before", v)}
                />
                {v === "yes" ? "כן" : "לא"}
              </label>
            ))}
          </div>
          {errors.practiced_before && <p className="error" id="hf-practiced_before-err">{errors.practiced_before}</p>}
        </fieldset>
        {a.practiced_before === "yes" && text("practice_details", "איזה סוג יוגה, וכמה שנים?", { multiline: true })}

        <p className="hint" style={{ color: "var(--muted)" }}>אם כן, כדאי לפרט. אם לא, אפשר פשוט לכתוב ״לא״.</p>
        {REQUIRED_TEXT.map((q) => <div key={q.key}>{text(q.key, q.label, { multiline: true })}</div>)}
        {OPTIONAL_TEXT.map((q) => <div key={q.key}>{text(q.key, q.label, { multiline: true })}</div>)}

        <div className="card">
          <label className="checkbox-line">
            <input
              id="hf-declaration_accepted"
              type="checkbox"
              checked={a.declaration_accepted}
              onChange={(e) => set("declaration_accepted", e.target.checked)}
              aria-describedby={errors.declaration_accepted ? "hf-declaration_accepted-err" : undefined}
            />
            <span>
              הנני מצהיר/ה בזאת שכל הפרטים שמסרתי נכונים וכי אשמע לנהלי השיעור ולבקשות המורה. כמו כן, אם יחול שינוי
              במצב בריאותי אעדכן את המורה לפני השיעור בו אשתתף. ידוע לי כי יוגה אינה מהווה תחליף לייעוץ ו/או טיפול
              רפואי או פסיכולוגי וכי תוצאות התרגול הינן על אחריותי הבלעדית.
            </span>
          </label>
          {errors.declaration_accepted && <p className="error" id="hf-declaration_accepted-err">{errors.declaration_accepted}</p>}
        </div>

        {failure && <p className="notice notice--error" role="alert">{failure}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "בשליחה…" : "שליחת ההצהרה"}
        </button>
      </form>
    </main>
  );
}
