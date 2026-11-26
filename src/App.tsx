import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type Session } from "./lib/api";
import { errorMessage } from "./lib/errors";
import type { Profile } from "./lib/types";
import { CalendarIcon, ListIcon, Loading, TicketIcon, ToastProvider } from "./components/ui";
import { Login } from "./screens/Login";
import { ChangePassword } from "./screens/ChangePassword";
import { Pending } from "./screens/Pending";
import { HealthForm } from "./screens/HealthForm";
import { Schedule } from "./screens/Schedule";
import { MyClasses } from "./screens/MyClasses";
import { MyCard } from "./screens/MyCard";

type Tab = "schedule" | "mine" | "card";
const TABS: { id: Tab; label: string; Icon: () => ReactElement }[] = [
  { id: "schedule", label: "לוח שיעורים", Icon: CalendarIcon },
  { id: "mine", label: "השיעורים שלי", Icon: ListIcon },
  { id: "card", label: "הכרטיסייה", Icon: TicketIcon },
];

export function App() {
  return (
    <ToastProvider>
      <a className="skip-link" href="#main">דילוג לתוכן</a>
      <Gate />
    </ToastProvider>
  );
}

function Gate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hasHealth, setHasHealth] = useState<boolean | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSession().then(setSession);
    return api.onAuthChange(setSession);
  }, []);

  const loadProfile = useCallback(async () => {
    setError(null);
    try {
      const [p, h] = await Promise.all([api.getMyProfile(), api.hasHealthDeclaration()]);
      setProfile(p);
      setHasHealth(h);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (session) loadProfile();
    else {
      setProfile(null);
      setHasHealth(null);
    }
  }, [session, loadProfile]);

  if (session === undefined) return <Loading />;
  if (!session) return <Login />;
  if (error)
    return (
      <main id="main" className="page page--plain">
        <p className="notice notice--error" role="alert">{error}</p>
        <button type="button" className="btn btn--primary btn--block" onClick={loadProfile}>ניסיון נוסף</button>
      </main>
    );
  if (!profile || hasHealth === null) return <Loading />;
  if (profile.must_change_password) return <ChangePassword onDone={loadProfile} />;
  if (showHealth || (profile.status === "active" && !hasHealth))
    return <HealthForm profile={profile} onDone={() => { setShowHealth(false); loadProfile(); }} />;
  if (profile.status !== "active") return <Pending profile={profile} hasHealth={hasHealth} onFillHealth={() => setShowHealth(true)} />;
  return <Main profile={profile} onProfileSaved={loadProfile} />;
}

function Main({ profile, onProfileSaved }: { profile: Profile; onProfileSaved: () => void }) {
  const [tab, setTab] = useState<Tab>("schedule");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const t = TABS.find((x) => x.id === tab)!;
    document.title = `${t.label} · יוגה עם ליאור`;
    window.scrollTo(0, 0);
  }, [tab]);

  return (
    <>
      {tab === "schedule" && <Schedule onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === "mine" && <MyClasses refreshKey={refreshKey} />}
      {tab === "card" && <MyCard profile={profile} refreshKey={refreshKey} onProfileSaved={onProfileSaved} />}
      <nav className="tabbar" aria-label="ניווט ראשי">
        <ul>
          {TABS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
                <Icon />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
