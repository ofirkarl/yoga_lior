// גרסת הדגמה של שכבת הנתונים, לתצוגה מקדימה ובדיקות בלי Supabase.
// בוחרים מצב בכתובת: ?s=login | password | pending | health | main
import type { ImportedBalance, AdminSession, AttendMode, Dashboard, Entitlement, HealthAnswers, Member, MyBooking, Product, Profile, ScheduleItem } from "../src/lib/types";

export type Session = { user: { id: string } };

const scenario = location.hash.slice(1) || new URLSearchParams(location.search).get("s") || "main";
const DAY = 86_400_000;

let session: Session | null = scenario === "login" ? null : { user: { id: "u1" } };
const listeners = new Set<(s: Session | null) => void>();
const emit = () => listeners.forEach((l) => l(session));

const profile: Profile = {
  id: "u1",
  full_name: scenario === "admin" ? "ליאור הררי" : "דנה כהן",
  phone: "0501234567",
  email: "dana@example.com",
  username: null,
  role: scenario === "admin" ? "admin" : "trainee",
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
      held_studio: 0, my_offer_expires_at: null, my_offer_open: false,
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
// הדגמה: שיעור מלא שהתפנה בו מקום, שמור לדנה לשעה
{
  const full = sessions.find((s, i) => i > 4 && s.status === "scheduled" && s.booked_studio >= s.max_participants);
  if (full) {
    full.my_booking_id = `b-offer`; full.my_status = "waitlist"; full.my_mode = "studio";
    full.booked_studio--; full.held_studio = 1;
    full.my_offer_expires_at = new Date(Date.now() + 52 * 60_000).toISOString();
  }
}

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
  async bookClass(id: string, mode: AttendMode, _auto = false) {
    await wait();
    const s = sessions.find((x) => x.session_id === id)!;
    const full = mode === "studio" && s.booked_studio + s.held_studio >= s.max_participants;
    s.my_booking_id = `b-${id}`; s.my_mode = mode; s.my_status = full ? "waitlist" : "booked";
    if (!full) { if (mode === "studio") s.booked_studio++; else s.booked_zoom++; }
    return { status: s.my_status };
  },
  async cancelBooking(bid: string) {
    await wait();
    const s = sessions.find((x) => x.my_booking_id === bid)!;
    const refunded = s.my_status === "booked" && new Date(s.cancel_deadline).getTime() > Date.now();
    if (s.my_status === "booked") { if (s.my_mode === "studio") s.booked_studio--; else s.booked_zoom--; }
    if (s.my_offer_expires_at) { s.held_studio--; s.my_offer_expires_at = null; }
    s.my_booking_id = null; s.my_status = null; s.my_mode = null;
    return { new_status: "cancelled", refunded };
  },
  async getWaitlistTiming() { await wait(); return { hold: 60, open: 30 }; },
  async setWaitlistTiming() { await wait(); },
  async acceptOffer(bid: string) {
    await wait();
    const s = sessions.find((x) => x.my_booking_id === bid)!;
    s.held_studio--; s.booked_studio++; s.my_status = "booked"; s.my_offer_expires_at = null;
  },
  async declineOffer(bid: string) {
    await wait();
    const s = sessions.find((x) => x.my_booking_id === bid)!;
    s.held_studio--; s.my_status = null; s.my_booking_id = null; s.my_mode = null; s.my_offer_expires_at = null;
  },
  async getMyEntitlements() { await wait(); return ents.map((e) => ({ ...e })); },
  async getMyUpcomingBookings(): Promise<MyBooking[]> {
    await wait();
    return sessions.filter((s) => s.my_status === "booked" || s.my_status === "waitlist").map((s) => ({
      id: s.my_booking_id!, status: s.my_status!, mode: s.my_mode!,
      offer_expires_at: s.my_offer_expires_at, offer_open: s.my_offer_open,
      session: { id: s.session_id, title: s.title, starts_at: s.starts_at, duration_min: s.duration_min, cancel_deadline: s.cancel_deadline, status: s.status },
    }));
  },
  async getZoomLink() { return "https://zoom.us/j/000"; },

  /* ---------- ניהול ---------- */
  async getDashboard(): Promise<Dashboard> {
    await wait();
    const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const up = sessions.filter((x) => new Date(x.starts_at).getTime() < Date.now() + 7 * DAY);
    return {
      generated_at: new Date().toISOString(),
      kpis: { active_members: 15, pending_members: members.filter((m) => m.status === "pending").length, active_cards: 13,
              revenue_month: 4865, visits_month: 61, classes_week: up.length },
      revenue_months: [["2026-06", 3150], ["2026-07", 2800], ["2026-08", 1950], ["2026-09", 3900], ["2026-10", 5200], ["2026-11", 4865]]
        .map(([month, total]) => ({ month: month as string, total: total as number })),
      revenue_by_method: [{ method: "grow", total: 2850 }, { method: "paybox", total: 1300 }, { method: "cash", total: 715 }],
      upcoming: up.map((x) => ({ session_id: x.session_id, title: x.title, starts_at: x.starts_at, status: x.status,
        cancel_deadline: x.cancel_deadline, min: x.min_participants, max: x.max_participants,
        studio: x.booked_studio, zoom: x.booked_zoom, waitlist: x.waitlist_count })),
      pending: members.filter((m) => m.status === "pending").map((m) => ({ id: m.id, full_name: m.full_name, email: m.email,
        phone: m.phone, created_at: m.created_at, has_health: true })),
      expiring: [
        { entitlement_id: "x1", user_id: "m1", full_name: "דנה כהן", phone: "0501234567", title: "כרטיסייה 10 כניסות – 6 שבועות", entries_left: 3, valid_until: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10) },
        { entitlement_id: "x2", user_id: "m2", full_name: "מיכל לוי", phone: "0527654321", title: "כרטיסייה 5 כניסות – 12 שבועות", entries_left: 1, valid_until: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10) },
      ],
      activity: [
        { kind: "booked", at: ago(4), who: "רונית אברהם", what: "רמה 1", when: sessions[1]?.starts_at ?? ago(0), mode: "studio" },
        { kind: "payment", at: ago(38), who: "מיכל לוי", what: "כרטיסייה 5 כניסות – 12 שבועות", amount: 425, method: "grow" },
        { kind: "cancelled", at: ago(95), who: "שירה גולן", what: "מתחילים", when: sessions[2]?.starts_at ?? ago(0) },
        { kind: "joined", at: ago(180), who: "נועה פרץ" },
        { kind: "late_cancel", at: ago(60 * 26), who: "יעל מזרחי", what: "תרגול רך", when: ago(60 * 20) },
        { kind: "waitlist", at: ago(60 * 30), who: "דנה כהן", what: "רמה 2", when: sessions[3]?.starts_at ?? ago(0), mode: "studio" },
      ],
    };
  },
  async listMembers(): Promise<Member[]> { await wait(); return members.map((m) => ({ ...m })); },
  async setMemberStatus(id: string, st: "pending" | "active" | "blocked") { await wait(); const m = members.find((x) => x.id === id); if (m) m.status = st; },
  async listProducts(): Promise<Product[]> { return products; },
  async recordPayment(_p: unknown) { await wait(); },
  async adjustEntitlement() { await wait(); },
  async getHealthDeclaration() {
    return { signed_at: "2026-10-12T09:00:00Z", answers: { first_name: "דנה", last_name: "כהן", birth_date: "1988-04-02", phone: "0501234567",
      email: "dana@example.com", practiced_before: "yes" as const, practice_details: "ויניאסה, שנתיים", back_joint_pain: "כאבים קלים בגב התחתון",
      health_issue: "לא", regular_medication: "לא", surgery: "לא", menstrual_irregularity: "", gynecological_issue: "", anything_else: "", declaration_accepted: true } };
  },
  async getAdminSessions(): Promise<AdminSession[]> {
    await wait();
    const names = ["דנה כהן", "מיכל לוי", "רונית אברהם", "שירה גולן", "יעל מזרחי", "נועה פרץ", "תמר שלו", "אורית בן דוד", "הילה כץ"];
    const past: ScheduleItem = { ...sessions[0], session_id: "past", title: "רמה 2", starts_at: new Date(Date.now() - DAY).toISOString(), booked_studio: 4, booked_zoom: 0, my_status: null };
    return [past, ...sessions.slice(0, 8)].map((x, i) => ({
      id: x.session_id, title: x.title, starts_at: x.starts_at, duration_min: 75, status: x.status, cancel_reason: x.status === "cancelled" ? "ליאור בחופש" : null,
      min_participants: 3, max_participants: 8, cancel_deadline: x.cancel_deadline,
      bookings: Array.from({ length: x.booked_studio + x.booked_zoom + x.waitlist_count }, (_, j) => ({
        id: `${x.session_id}-${j}`, created_at: new Date(Date.now() - j * 3600_000).toISOString(),
        status: (j >= x.booked_studio + x.booked_zoom ? "waitlist" : i === 0 && j === 1 ? "attended" : "booked") as "booked",
        mode: (j >= x.booked_studio && j < x.booked_studio + x.booked_zoom ? "zoom" : "studio") as AttendMode,
        profile: { id: `m${j}`, full_name: names[j % names.length], phone: null },
      })),
    }));
  },
  async cancelSession() { await wait(); return 3; },
  async markAttendance() { await wait(); },
  async generateSessions() { await wait(); return 0; },
  async createUsernameUser(p: { username: string }) { await wait(); return { username: p.username, temp_password: "Kp7rQx9mTa3w" }; },
  async listBalances(): Promise<ImportedBalance[]> { await wait(); return balances.map((b) => ({ ...b })); },
  async importBalances(rows: { full_name: string; email: string | null; phone: string | null; entries_left: number; valid_until: string }[]) {
    await wait();
    rows.forEach((r, i) => balances.push({ id: `nb${Date.now()}${i}`, created_at: new Date().toISOString(), claimed_by: null, claimed_at: null, ...r }));
    return { inserted: rows.length, claimed: 0 };
  },
  async claimBalance(id: string, user: string) { await wait(); const b = balances.find((x) => x.id === id); if (b) { b.claimed_by = user; b.claimed_at = new Date().toISOString(); } },
  async deleteBalance(id: string) { await wait(); const i = balances.findIndex((x) => x.id === id); if (i >= 0) balances.splice(i, 1); },
  async resetPassword() { await wait(); return { temp_password: "Hm4tNb8vYc2s" }; },
  async savePushSubscription() { await wait(); },
  async deletePushSubscription() { await wait(); },
  async sendTestPush() { await wait(); return { sent: 1, devices: 1 }; },
  async backupStatus() { await wait(); return { last_at: null }; },
  async getBackupToken() { await wait(); return "demo0000000000000000000000000000demo0000000000000000000000000000"; },
  async rotateBackupToken() { await wait(); return "demo1111111111111111111111111111demo1111111111111111111111111111"; },
};

const products: Product[] = [
  { id: "p1", name: "שיעור ניסיון", kind: "trial", mode: "studio", price_ils: 60, entries: 1, validity_days: 7, active: true },
  { id: "p2", name: "שיעור בודד", kind: "single", mode: "studio", price_ils: 90, entries: 1, validity_days: 7, active: true },
  { id: "p3", name: "כרטיסייה 5 כניסות – 6 שבועות", kind: "punch", mode: "studio", price_ils: 375, entries: 5, validity_days: 42, active: true },
  { id: "p5", name: "כרטיסייה 10 כניסות – 6 שבועות", kind: "punch", mode: "studio", price_ils: 650, entries: 10, validity_days: 42, active: true },
];

const mk = (id: string, full_name: string, status: "pending" | "active", cards: Entitlement[] = []): Member => ({
  id, full_name, status, phone: "050-0000000", email: `${id}@example.com`, username: null, role: "trainee",
  must_change_password: false, created_at: new Date(Date.now() - 3 * DAY).toISOString(), entitlements: cards,
});
const card = (left: number, days: number): Entitlement => ({ id: `c${left}${days}`, title: "כרטיסייה 10 כניסות – 6 שבועות", mode: "studio",
  entries_total: 10, entries_left: left, valid_from: "2026-11-01", valid_until: new Date(Date.now() + days * DAY).toISOString().slice(0, 10), status: "active" });
const members: Member[] = [
  mk("m7", "נועה פרץ", "pending"), mk("m8", "קרן אלון", "pending"),
  mk("m1", "דנה כהן", "active", [card(3, 5)]), mk("m2", "מיכל לוי", "active", [card(1, 30)]),
  mk("m3", "רונית אברהם", "active", [card(7, 25)]), mk("m4", "שירה גולן", "active", []),
];
const balances: ImportedBalance[] = [
  { id: "ib1", full_name: "רונית אברהם", email: null, phone: "050-0000000", entries_left: 4, valid_until: "2027-01-20", created_at: "", claimed_by: null, claimed_at: null },
  { id: "ib2", full_name: "גלית שמעוני", email: "galit@example.com", phone: null, entries_left: 7, valid_until: "2027-02-10", created_at: "", claimed_by: null, claimed_at: null },
];
export type Api = typeof api;

