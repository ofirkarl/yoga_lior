// שכבת הנתונים. כל פנייה ל-Supabase עוברת מכאן, כדי שהמסכים לא יכירו את פרטי השרת.
// ההרשאות נאכפות בבסיס הנתונים (RLS ופונקציות), לא כאן.
import { createClient, type Session } from "@supabase/supabase-js";
import type {
  AdminSession, AttendMode, ImportedBalance, Dashboard, Entitlement, HealthAnswers, Member, MyBooking, PaymentMethod, Product, Profile, ScheduleItem, UserStatus,
} from "./types";

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

  async bookClass(sessionId: string, mode: AttendMode, autoEnroll = false): Promise<{ status: string }> {
    return must(await supabase.rpc("book_class", { p_session: sessionId, p_mode: mode, p_auto_enroll: autoEnroll })) as { status: string };
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

  /* ---------- ניהול (כל פעולה נבדקת שוב בבסיס הנתונים) ---------- */

  async getDashboard(): Promise<Dashboard> {
    return must(await supabase.rpc("admin_dashboard")) as Dashboard;
  },

  async listMembers(): Promise<Member[]> {
    return must(
      await supabase
        .from("profiles")
        .select("id, full_name, phone, email, username, role, status, must_change_password, created_at, entitlements(id, title, mode, entries_total, entries_left, valid_from, valid_until, status)")
        .eq("role", "trainee")
        .order("full_name"),
    ) as Member[];
  },

  async setMemberStatus(userId: string, status: UserStatus): Promise<void> {
    must(await supabase.rpc("admin_set_member_status", { p_user: userId, p_status: status }));
  },

  async listProducts(): Promise<Product[]> {
    return must(
      await supabase.from("products").select("id, name, kind, mode, price_ils, entries, validity_days, active").eq("active", true).order("sort_order"),
    ) as Product[];
  },

  async recordPayment(p: { userId: string; productId: string; method: PaymentMethod; amount: number; note?: string }): Promise<void> {
    must(
      await supabase.rpc("admin_record_payment", {
        p_user: p.userId, p_product: p.productId, p_method: p.method, p_amount: p.amount, p_note: p.note ?? null,
      }),
    );
  },

  async adjustEntitlement(entId: string, entriesAdd: number, validUntil: string | null, reason: string): Promise<void> {
    must(
      await supabase.rpc("admin_adjust_entitlement", {
        p_ent: entId, p_entries_add: entriesAdd, p_valid_until: validUntil, p_reason: reason,
      }),
    );
  },

  async getHealthDeclaration(userId: string): Promise<{ answers: HealthAnswers; signed_at: string } | null> {
    return must(
      await supabase.from("health_declarations").select("answers, signed_at").eq("user_id", userId)
        .order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    ) as { answers: HealthAnswers; signed_at: string } | null;
  },

  async getAdminSessions(from: Date, to: Date): Promise<AdminSession[]> {
    return must(
      await supabase
        .from("class_sessions")
        .select("id, title, starts_at, duration_min, status, cancel_reason, min_participants, max_participants, cancel_deadline, bookings(id, status, mode, created_at, profile:profiles(id, full_name, phone))")
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at"),
    ) as unknown as AdminSession[];
  },

  async cancelSession(sessionId: string, reason: string): Promise<number> {
    return must(await supabase.rpc("admin_cancel_session", { p_session: sessionId, p_reason: reason })) as number;
  },

  async markAttendance(bookingId: string, attended: boolean): Promise<void> {
    must(await supabase.rpc("admin_mark_attendance", { p_booking: bookingId, p_attended: attended }));
  },

  async generateSessions(from: string, to: string): Promise<number> {
    return must(await supabase.rpc("admin_generate_sessions", { p_from: from, p_to: to })) as number;
  },

  async createUsernameUser(p: { username: string; full_name: string; phone: string }): Promise<{ username: string; temp_password: string }> {
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "create", ...p } });
    if (error) throw await functionError(error);
    return data as { username: string; temp_password: string };
  },

  async listBalances(): Promise<ImportedBalance[]> {
    return must(
      await supabase.from("imported_balances")
        .select("id, full_name, email, phone, entries_left, valid_until, created_at, claimed_by, claimed_at")
        .order("claimed_at", { ascending: true, nullsFirst: true }).order("full_name"),
    ) as ImportedBalance[];
  },

  async importBalances(rows: { full_name: string; email: string | null; phone: string | null; entries_left: number; valid_until: string }[]):
    Promise<{ inserted: number; claimed: number }> {
    return must(await supabase.rpc("admin_import_balances", { p_rows: rows })) as { inserted: number; claimed: number };
  },

  async claimBalance(balanceId: string, userId: string): Promise<void> {
    must(await supabase.rpc("admin_claim_balance", { p_balance: balanceId, p_user: userId }));
  },

  async deleteBalance(balanceId: string): Promise<void> {
    must(await supabase.rpc("admin_delete_balance", { p_balance: balanceId }));
  },

  async savePushSubscription(endpoint: string, p256dh: string, auth: string, userAgent: string): Promise<void> {
    must(await supabase.rpc("save_push_subscription", {
      p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: userAgent,
    }));
  },

  async deletePushSubscription(endpoint: string): Promise<void> {
    must(await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint }));
  },

  /** שולחת התראת בדיקה למכשירים של המנהלת המחוברת */
  async sendTestPush(): Promise<{ sent: number; devices?: number }> {
    const { data, error } = await supabase.functions.invoke("notify-admins", { body: { event: "test" } });
    if (error) throw await functionError(error);
    return data as { sent: number; devices?: number };
  },

  async backupStatus(): Promise<{ last_at: string | null }> {
    return must(await supabase.rpc("admin_backup_status")) as { last_at: string | null };
  },

  async getBackupToken(): Promise<string> {
    return must(await supabase.rpc("admin_get_backup_token")) as string;
  },

  async rotateBackupToken(): Promise<string> {
    return must(await supabase.rpc("admin_rotate_backup_token")) as string;
  },

  async resetPassword(userId: string): Promise<{ temp_password: string }> {
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "reset_password", user_id: userId } });
    if (error) throw await functionError(error);
    return data as { temp_password: string };
  },
};

/** מחלץ את קוד השגיאה שהפונקציה בשרת החזירה */
async function functionError(error: unknown): Promise<Error> {
  try {
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? await ctx.json() : null;
    if (body?.error) return new Error(body.error);
  } catch {
    /* ignore */
  }
  return error instanceof Error ? error : new Error(String(error));
}

export type Api = typeof api;
