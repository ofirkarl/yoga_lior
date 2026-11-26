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

export interface MyBooking {
  id: string;
  status: BookingStatus;
  mode: AttendMode;
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
