// גרסת הדגמה של שכבת הנתונים, לתצוגה מקדימה ובדיקות בלי Supabase.
// בוחרים מצב בכתובת: ?s=login | password | pending | health | main
import type { AttendMode, Entitlement, HealthAnswers, MyBooking, Profile, ScheduleItem } from "../src/lib/types";

export type Session = { user: { id: string } };

const scenario = new URLSearchParams(location.search).get("s") ?? "main";
const DAY = 86_400_000;

let session: Session | null = scenario === "login" ? null : { user: { id: "u1" } };
const listeners = new Set<(s: Session | null) => void>();
const emit = () => listeners.forEach((l) => l(session));

const profile: Profile = {
  id: "u1",
  full_name: "דנה כהן",
  phone: "0501234567",
  email: "dana@example.com",
  username: null,
  role: "trainee",
  status: scenario === "pending" ? "pending" : "active",
  must_change_password: scenario === "password",
};
let health = scenario !== "health" && scenario !== "pending";

function at(daysFromNow: number, hh: number, mm: number): Date {
  const d = new Date(Date.now() + daysFromNow * DAY);
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return new Date(`${key}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+02:00`);
}
function deadline(s: Date): string {
  const hh = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }).format(s));
  if (hh < 12) {
    const prev = new Date(s.getTime() - DAY);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(prev);
    return new Date(`${key}T20:00:00+02:00`).toISOString();
  }
  return new Date(s.getTime() - 3 * 3600_000).toISOString();
}

const templates: [string, number, number, number][] = [
  ["רמה 1", 0, 18, 30], ["מתחילים", 1, 9, 30], ["רמה 2", 2, 18, 30],
  ["תרגול רך", 4, 7, 30], ["רמה 1", 4, 9, 0], ["כל הרמות", 5, 9, 30],
];

const sessions: ScheduleItem[] = [];
for (let d = 0; d < 35; d++) {
  const date = new Date(Date.now() + d * DAY);
  const wd = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date)}T12:00:00Z`).getUTCDay();
  for (const [title, w, hh, mm] of templates) {
    if (w !== wd) continue;
    const s = at(d, hh, mm);
    if (s.getTime() < Date.now()) continue;
    const i = sessions.length;
    sessions.push({
      session_id: `s${i}`, title, kind: "regular", starts_at: s.toISOString(), duration_min: 75,
      status: i === 3 ? "cancelled" : "scheduled", min_participants: 3, max_participants: 8, zoom_enabled: true,
      cancel_deadline: deadline(s),
      booked_studio: [5, 2, 8, 0, 6, 1][i % 6], booked_zoom: [1, 0, 1, 0, 0, 0][i % 6],
      waitlist_count: i % 6 === 2 ? 1 : 0, my_booking_id: null, my_status: null, my_mode: null,
    });
  }
}
// הדגמה: הרשמה לשיעור הראשון, וזום בשיעור החמישי
const mark = (i: number, mode: AttendMode) => {
  const s = sessions[i];
  if (!s) return;
  s.my_booking_id = `b${i}`; s.my_status = "booked"; s.my_mode = mode;
  if (mode === "studio") s.booked_studio++; else s.booked_zoom++;
};
mark(0, "studio");
mark(4, "zoom");

const ents: Entitlement[] = [
  { id: "e1", title: "כרטיסייה 10 כניסות – 6 שבועות", mode: "studio", entries_total: 10, entries_left: 3,
    valid_from: "2026-10-20", valid_until: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), status: "active" },
  { id: "e2", title: "כרטיסיית זום 4 כניסות", mode: "zoom", entries_total: 4, entries_left: 3,
    valid_from: "2026-11-01", valid_until: new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10), status: "active" },
  { id: "e0", title: "שיעור ניסיון", mode: "studio", entries_total: 1, entries_left: 0,
    valid_from: "2026-10-10", valid_until: "2026-10-16", status: "used_up" },
];

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export const api = {
  async getSession() { await wait(50); return session; },
  onAuthChange(cb: (s: Session | null) => void) { listeners.add(cb); return () => listeners.delete(cb); },
  async signInWithGoogle() { await wait(); session = { user: { id: "u1" } }; emit(); },
  async signInWithUsername(u: string, p: string) {
    await wait();
    if (u !== "dana" || p !== "yoga1234") throw new Error("Invalid login credentials");
    session = { user: { id: "u1" } }; emit();
  },
  async signOut() { session = null; emit(); },
  async changePassword(pw: string) { await wait(); if (pw.length < 8) throw new Error("weak"); profile.must_change_password = false; },
  async getMyProfile() { await wait(); return { ...profile }; },
  async updateMyProfile(f: { full_name: string; phone: string | null }) { await wait(); Object.assign(profile, f); },
  async hasHealthDeclaration() { return health; },
  async submitHealthDeclaration(_a: HealthAnswers, _s: string) { await wait(); health = true; },
  async getSchedule(from: Date, to: Date) {
    await wait();
    return sessions.filter((s) => new Date(s.starts_at) >= from && new Date(s.starts_at) < to).map((s) => ({ ...s }));
  },
  async bookClass(id: string, mode: AttendMode) {
    await wait();
    const s = sessions.find((x) => x.session_id === id)!;
    const full = mode === "studio" && s.booked_studio >= s.max_participants;
    s.my_booking_id = `b-${id}`; s.my_mode = mode; s.my_status = full ? "waitlist" : "booked";
    if (!full) { if (mode === "studio") s.booked_studio++; else s.booked_zoom++; }
    return { status: s.my_status };
  },
  async cancelBooking(bid: string) {
    await wait();
    const s = sessions.find((x) => x.my_booking_id === bid)!;
    const refunded = s.my_status === "booked" && new Date(s.cancel_deadline).getTime() > Date.now();
    if (s.my_status === "booked") { if (s.my_mode === "studio") s.booked_studio--; else s.booked_zoom--; }
    s.my_booking_id = null; s.my_status = null; s.my_mode = null;
    return { new_status: "cancelled", refunded };
  },
  async getMyEntitlements() { await wait(); return ents.map((e) => ({ ...e })); },
  async getMyUpcomingBookings(): Promise<MyBooking[]> {
    await wait();
    return sessions.filter((s) => s.my_status === "booked" || s.my_status === "waitlist").map((s) => ({
      id: s.my_booking_id!, status: s.my_status!, mode: s.my_mode!,
      session: { id: s.session_id, title: s.title, starts_at: s.starts_at, duration_min: s.duration_min, cancel_deadline: s.cancel_deadline, status: s.status },
    }));
  },
  async getZoomLink() { return "https://zoom.us/j/000"; },
};
export type Api = typeof api;
