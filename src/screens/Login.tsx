import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { Field, GoogleIcon, PasswordInput } from "../components/ui";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    setError(null);
    setBusy("google");
    try {
      await api.signInWithGoogle();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("password");
    try {
      await api.signInWithUsername(username, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main id="main" className="page page--plain">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        <p className="brand-name">יוגה עם ליאור</p>
      </div>

      <h1>כניסה</h1>
      <p>כאן נרשמים לשיעורים ורואים כמה כניסות נשארו בכרטיסייה.</p>

      <button type="button" className="btn btn--google btn--block" onClick={google} disabled={busy !== null}>
        <GoogleIcon />
        {busy === "google" ? "מעבר לגוגל…" : "כניסה עם חשבון Google"}
      </button>

      <div className="divider">או עם שם משתמש</div>

      <form onSubmit={submit} className="stack" noValidate>
        <Field label="שם משתמש">
          {({ id }) => (
            <input
              id={id}
              className="input input--ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              required
            />
          )}
        </Field>
        <Field label="סיסמה">
          {({ id }) => (
            <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" />
          )}
        </Field>

        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy !== null || !username.trim() || !password}
        >
          {busy === "password" ? "רגע…" : "כניסה"}
        </button>
      </form>

      <p className="hint" style={{ marginTop: "1.5rem", color: "var(--muted)" }}>
        אין לך חשבון Google ועוד לא קיבלת שם משתמש? ליאור תשלח לך פרטי כניסה.
      </p>

      <p className="hint" style={{ marginTop: "1rem" }}>
        <a href="/home.html">על האפליקציה</a> · <a href="/privacy.html">מדיניות פרטיות</a>
      </p>
    </main>
  );
}
