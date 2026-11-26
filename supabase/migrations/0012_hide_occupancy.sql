-- =====================================================================
-- תפוסת השיעור גלויה רק למנהלת.
-- מתאמנים מקבלים רק "אפשר להירשם" או "מלא": בלי מספר נרשמים, בלי מספר
-- ממתינים ובלי מינימום. החתימה של הפונקציה נשארת, כדי שאפליקציה פתוחה
-- בגרסה קודמת תמשיך לעבוד; רק הערכים מוסתרים.
--   booked_studio: 0, או max_participants כשהשיעור מלא
--   booked_zoom, waitlist_count, held_studio, min_participants: 0
-- =====================================================================
create or replace function get_schedule_v2(p_from timestamptz, p_to timestamptz)
returns table (
  session_id       uuid,
  title            text,
  kind             session_kind,
  starts_at        timestamptz,
  duration_min     int,
  status           session_status,
  min_participants int,
  max_participants int,
  zoom_enabled     boolean,
  cancel_deadline  timestamptz,
  booked_studio    int,
  booked_zoom      int,
  waitlist_count   int,
  my_booking_id    uuid,
  my_status        booking_status,
  my_mode          attend_mode,
  held_studio      int,
  my_offer_expires_at timestamptz,
  my_offer_open    boolean
)
language sql stable security definer set search_path = public as $$
  select
    s.id, s.title, s.kind, s.starts_at, s.duration_min, s.status,
    case when adm.yes then s.min_participants else 0 end,
    s.max_participants, s.zoom_enabled, s.cancel_deadline,
    case when adm.yes then c.studio
         when c.studio + c.held >= s.max_participants then s.max_participants
         else 0 end,
    case when adm.yes then c.zoom else 0 end,
    case when adm.yes then c.waiting else 0 end,
    mine.id, mine.status, mine.mode,
    case when adm.yes then c.held else 0 end,
    case when mine.offer_expires_at > now() then mine.offer_expires_at end,
    coalesce(mine.offer_open, false)
  from class_sessions s
  cross join (select is_admin() as yes) adm
  cross join lateral (
    select
      count(*) filter (where b.mode = 'studio' and b.status in ('booked', 'attended'))::int as studio,
      count(*) filter (where b.mode = 'zoom'   and b.status in ('booked', 'attended'))::int as zoom,
      count(*) filter (where b.status = 'waitlist')::int as waiting,
      count(*) filter (where b.status = 'waitlist' and not b.offer_open and b.offer_expires_at > now())::int as held
    from bookings b where b.session_id = s.id
  ) c
  left join lateral (
    select b.id, b.status, b.mode, b.offer_expires_at, b.offer_open from bookings b
    where b.session_id = s.id and b.user_id = auth.uid()
      and b.status in ('booked', 'waitlist', 'attended', 'no_show', 'late_cancel')
    limit 1
  ) mine on true
  where (is_active_member() or adm.yes)
    and s.starts_at >= p_from and s.starts_at < p_to
    and s.kind <> 'private'
  order by s.starts_at;
$$;
