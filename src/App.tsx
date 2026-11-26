import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type Session } from "./lib/api";
import { errorMessage } from "./lib/errors";
import { registerServiceWorker } from "./lib/push";
import type { Profile } from "./lib/types";
import { AskProvider, CalendarIcon, GaugeIcon, ListIcon, Loading, PeopleIcon, TicketIcon, ToastProvider } from "./components/ui";
import { Login } from "./screens/Login";
import { ChangePassword } from "./screens/ChangePassword";
import { Pending } from "./screens/Pending";
import { HealthForm } from "./screens/HealthForm";
import { Schedule } from "./screens/Schedule";
import { MyClasses } from "./screens/MyClasses";
import { MyCard } from "./screens/MyCard";
import { ControlRoom, type AdminTab } from "./admin/ControlRoom";
import { Members } from "./admin/Members";
import { Classes } from "./admin/Classes";

type Tab = "schedule" | "mine" | "card";
const TABS: { id: Tab; label: string; Icon: () => ReactElement }[] = [
  { id: "schedule", label: "לוח שיעורים", Icon: CalendarIcon },
  { id: "mine", label: "השיעורים שלי", Icon: ListIcon },
  { id: "card", label: "הכרטיסייה", Icon: TicketIcon },
];

export function App() {
  return (
    <ToastProvider>
      <AskProvider>
      <a className="skip-link" href="#main">דילוג לתוכן</a>
      <Gate />
      </AskProvider>
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
  if (profile.role === "admin" && profile.status === "active") return <AdminMain profile={profile} />;
  if (showHealth || (profile.status === "active" && !hasHealth))
    return <HealthForm profile={profile} onDone={() => { setShowHealth(false); loadProfile(); }} />;
  if (profile.status !== "active") return <Pending profile={profile} hasHealth={hasHealth} onFillHealth={() => setShowHealth(true)} />;
  return <Main profile={profile} onProfileSaved={loadProfile} />;
}

/** לשונית פתיחה מהקישור (לחיצה על התראה על מקום שהתפנה מובילה ל-?tab=mine) */
function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  return TABS.some((x) => x.id === t) ? (t as Tab) : "schedule";
}

function Main({ profile, onProfileSaved }: { profile: Profile; onProfileSaved: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
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

const ADMIN_TABS: { id: AdminTab; label: string; Icon: () => ReactElement }[] = [
  { id: "room", label: "חדר בקרה", Icon: GaugeIcon },
  { id: "members", label: "מתאמנות", Icon: PeopleIcon },
  { id: "classes", label: "שיעורים", Icon: CalendarIcon },
];

/** לשונית פתיחה מהקישור (למשל לחיצה על התראה מובילה ל-?tab=members) */
function initialAdminTab(): AdminTab {
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  return ADMIN_TABS.some((x) => x.id === t) ? (t as AdminTab) : "room";
}

function AdminMain({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<AdminTab>(initialAdminTab);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    const t = ADMIN_TABS.find((x) => x.id === tab)!;
    document.title = `${t.label} · יוגה עם ליאור`;
    window.scrollTo(0, 0);
  }, [tab]);

  return (
    <>
      {tab === "room" && <ControlRoom name={profile.full_name} go={setTab} />}
      {tab === "members" && <Members />}
      {tab === "classes" && <Classes />}
      <nav className="tabbar" aria-label="ניווט ניהול">
        <ul>
          {ADMIN_TABS.map(({ id, label, Icon }) => (
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
