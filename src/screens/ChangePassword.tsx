import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { Field, PasswordInput } from "../components/ui";

export function ChangePassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (pw.length < 8 || pw !== pw2) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(pw);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="page page--plain">
      <div className="page-header">
        <h1>בחירת סיסמה אישית</h1>
        <p>הסיסמה שקיבלת מליאור היא זמנית. כדאי לבחור סיסמה אישית שרק לך ידועה.</p>
      </div>
      <form onSubmit={submit} className="stack" noValidate>
        <Field
          label="סיסמה חדשה"
          hint="8 תווים לפחות. משפט קצר שקל לזכור עובד מצוין."
          error={tooShort && touched ? "הסיסמה קצרה מ-8 תווים" : null}
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput id={id} value={pw} onChange={setPw} autoComplete="new-password" describedBy={describedBy} invalid={invalid} />
          )}
        </Field>
        <Field label="הסיסמה החדשה שוב" error={mismatch && touched ? "שתי הסיסמאות לא זהות" : null}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput id={id} value={pw2} onChange={setPw2} autoComplete="new-password" describedBy={describedBy} invalid={invalid} />
          )}
        </Field>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "בשמירה…" : "שמירת הסיסמה"}
        </button>
      </form>
      <button type="button" className="btn btn--ghost btn--block" style={{ marginTop: "1rem" }} onClick={() => api.signOut()}>
        יציאה
      </button>
    </main>
  );
}
