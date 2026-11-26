// שכבת הנתונים. כל פנייה ל-Supabase עוברת מכאן, כדי שהמסכים לא יכירו את פרטי השרת.
// ההרשאות נאכפות בבסיס הנתונים (RLS ופונקציות), לא כאן.
import { createClient, type Session } from "@supabase/supabase-js";
import type { AttendMode, Entitlement, HealthAnswers, MyBooking, Profile, ScheduleItem } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

const USERNAME_DOMAIN = "users.yoga.invalid";

function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export type { Session };

export const api = {
  async getSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  onAuthChange(cb: (session: Session | null) => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  },

  async signInWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  },

  async signInWithUsername(username: string, password: string): Promise<void> {
    const u = username.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: `${u}@${USERNAME_DOMAIN}`, password });
    if (error) throw error;
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  },

  async changePassword(newPassword: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    must(await supabase.rpc("mark_password_changed"));
  },

  async getMyProfile(): Promise<Profile | null> {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    return must(
      await supabase
        .from("profiles")
        .select("id, full_name, phone, email, username, role, status, must_change_password")
        .eq("id", u.user.id)
        .single(),
    ) as Profile;
  },

  async updateMyProfile(fields: { full_name: string; phone: string | null }): Promise<void> {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("not_allowed");
    must(await supabase.from("profiles").update(fields).eq("id", u.user.id));
  },

  async hasHealthDeclaration(): Promise<boolean> {
    return must(await supabase.rpc("has_health_declaration")) as boolean;
  },

  async submitHealthDeclaration(answers: HealthAnswers, signature: string): Promise<void> {
    must(await supabase.rpc("submit_health_declaration", { p_answers: answers, p_signature: signature, p_version: "v1" }));
  },

  async getSchedule(from: Date, to: Date): Promise<ScheduleItem[]> {
    return must(
      await supabase.rpc("get_schedule", { p_from: from.toISOString(), p_to: to.toISOString() }),
    ) as ScheduleItem[];
  },

  async bookClass(sessionId: string, mode: AttendMode): Promise<{ status: string }> {
    return must(await supabase.rpc("book_class", { p_session: sessionId, p_mode: mode })) as { status: string };
  },

  async cancelBooking(bookingId: string): Promise<{ new_status: string; refunded: boolean }> {
    const rows = must(await supabase.rpc("cancel_booking", { p_booking: bookingId })) as {
      new_status: string;
      refunded: boolean;
    }[];
    return rows[0];
  },

  async getMyEntitlements(): Promise<Entitlement[]> {
    return must(
      await supabase
        .from("entitlements")
        .select("id, title, mode, entries_total, entries_left, valid_from, valid_until, status")
        .order("valid_until", { ascending: false }),
    ) as Entitlement[];
  },

  async getMyUpcomingBookings(): Promise<MyBooking[]> {
    const rows = must(
      await supabase
        .from("bookings")
        .select("id, status, mode, session:class_sessions!inner(id, title, starts_at, duration_min, cancel_deadline, status)")
        .in("status", ["booked", "waitlist"])
        .gte("session.starts_at", new Date().toISOString()),
    ) as unknown as MyBooking[];
    return rows.sort((a, b) => a.session.starts_at.localeCompare(b.session.starts_at));
  },

  async getZoomLink(sessionId: string): Promise<string | null> {
    const row = must(
      await supabase.from("session_private").select("zoom_url").eq("session_id", sessionId).maybeSingle(),
    ) as { zoom_url: string | null } | null;
    return row?.zoom_url ?? null;
  },
};

export type Api = typeof api;
