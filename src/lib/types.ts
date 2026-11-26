export type AttendMode = "studio" | "zoom";
export type BookingStatus = "booked" | "waitlist" | "cancelled" | "late_cancel" | "attended" | "no_show";
export type UserStatus = "pending" | "active" | "blocked";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  role: "trainee" | "admin";
  status: UserStatus;
  must_change_password: boolean;
}

export interface ScheduleItem {
  session_id: string;
  title: string;
  kind: "regular" | "workshop" | "private";
  starts_at: string;
  duration_min: number;
  status: "scheduled" | "cancelled";
  min_participants: number;
  max_participants: number;
  zoom_enabled: boolean;
  cancel_deadline: string;
  booked_studio: number;
  booked_zoom: number;
  waitlist_count: number;
  my_booking_id: string | null;
  my_status: BookingStatus | null;
  my_mode: AttendMode | null;
  /** מקומות ששמורים כרגע להצעה בתור. נחשבים תפוסים */
  held_studio: number;
  /** הצעה פעילה אליי ממקום שהתפנה */
  my_offer_expires_at: string | null;
  my_offer_open: boolean;
}

export interface Entitlement {
  id: string;
  title: string;
  mode: AttendMode;
  entries_total: number | null;
  entries_left: number | null;
  valid_from: string;
  valid_until: string;
  status: "active" | "used_up" | "expired" | "cancelled";
}

export interface ShopProduct {
  id: string;
  name: string;
  kind: "trial" | "single" | "punch" | "membership";
  mode: AttendMode;
  price_ils: number;
  entries: number | null;
  validity_days: number;
  available: boolean;
  pending_order: string | null;
}

export interface Order {
  id: string;
  title: string;
  amount_ils: number;
  status: "pending" | "paid" | "cancelled";
  payment_url: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface PendingOrder {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  title: string;
  amount_ils: number;
  created_at: string;
}

export interface MyBooking {
  id: string;
  status: BookingStatus;
  mode: AttendMode;
  offer_expires_at: string | null;
  offer_open: boolean;
  session: {
    id: string;
    title: string;
    starts_at: string;
    duration_min: number;
    cancel_deadline: string;
    status: "scheduled" | "cancelled";
  };
}

/** תשובות הצהרת הבריאות, לפי הטופס של ליאור */
export interface HealthAnswers {
  first_name: string;
  last_name: string;
  birth_date: string;
  phone: string;
  email: string;
  practiced_before: "yes" | "no" | "";
  practice_details: string;
  back_joint_pain: string;
  health_issue: string;
  regular_medication: string;
  surgery: string;
  menstrual_irregularity: string;
  gynecological_issue: string;
  anything_else: string;
  declaration_accepted: boolean;
}

/* ---------- ניהול ---------- */
export type PaymentMethod = "grow" | "cash" | "paybox" | "bit" | "transfer" | "other";

export interface Product {
  id: string;
  name: string;
  kind: "trial" | "single" | "punch" | "membership";
  mode: AttendMode;
  price_ils: number;
  entries: number | null;
  validity_days: number;
  active: boolean;
}

export interface DashboardSession {
  session_id: string;
  title: string;
  starts_at: string;
  status: "scheduled" | "cancelled";
  cancel_deadline: string;
  min: number;
  max: number;
  studio: number;
  zoom: number;
  waitlist: number;
}

export type ActivityItem =
  | { kind: "booked" | "waitlist"; at: string; who: string; what: string; when: string; mode: AttendMode }
  | { kind: "cancelled" | "late_cancel"; at: string; who: string; what: string; when: string }
  | { kind: "payment"; at: string; who: string; what: string; amount: number; method: PaymentMethod }
  | { kind: "joined"; at: string; who: string };

export interface Dashboard {
  generated_at: string;
  kpis: {
    active_members: number;
    pending_members: number;
    active_cards: number;
    revenue_month: number;
    visits_month: number;
    classes_week: number;
  };
  revenue_months: { month: string; total: number }[];
  revenue_by_method: { method: PaymentMethod; total: number }[];
  upcoming: DashboardSession[];
  pending: { id: string; full_name: string; email: string | null; phone: string | null; created_at: string; has_health: boolean }[];
  expiring: { entitlement_id: string; user_id: string; full_name: string; phone: string | null; title: string; entries_left: number | null; valid_until: string }[];
  activity: ActivityItem[];
}

export interface Member extends Profile {
  created_at: string;
  entitlements: Entitlement[];
}

export interface AdminSession {
  id: string;
  title: string;
  starts_at: string;
  duration_min: number;
  status: "scheduled" | "cancelled";
  cancel_reason: string | null;
  min_participants: number;
  max_participants: number;
  cancel_deadline: string;
  bookings: {
    id: string;
    status: BookingStatus;
    mode: AttendMode;
    created_at: string;
    profile: { id: string; full_name: string; phone: string | null };
  }[];
}

export interface ImportedBalance {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  entries_left: number;
  valid_until: string;
  created_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
}
