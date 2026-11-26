-- =====================================================================
-- רשימת המתנה לפי תור, כפי שליאור ביקשה
--
-- כשמתפנה מקום:
--   1. מי שסימנה "הכניסו אותי אוטומטית" נכנסת מיד (לפי סדר ההצטרפות).
--   2. אחרת הראשונה בתור מקבלת הצעה: המקום שמור לה עד שעה, ולא יאוחר
--      מחצי שעה לפני השיעור. היא מאשרת או מוותרת. לא ענתה: התור עובר הלאה.
--   3. בחצי השעה האחרונה לפני השיעור, או כשכל התור כבר קיבל הזדמנות, אין
--      שמירת מקום: כל מי שברשימה מקבלת הודעה, והראשונה שמאשרת מקבלת את המקום.
-- מקום שמור נספר כתפוס, כדי שאף אחת אחרת לא תתפוס אותו בינתיים.
-- משימה מתוזמנת בודקת כל שתי דקות הצעות שפג תוקפן.
-- =====================================================================

alter table bookings
  add column offered_at       timestamptz,
  add column offer_expires_at timestamptz,
  add column offer_open       boolean not null default false;

create index bookings_offers on bookings (session_id) where status = 'waitlist';

-- כמה מקומות בסטודיו תפוסים, כולל מקומות ששמורים להצעה פתוחה בתור
create function studio_taken(p_session uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from bookings
  where session_id = p_session and mode = 'studio'
    and (status in ('booked', 'attended')
         or (status = 'waitlist' and not offer_open and offer_expires_at > now()));
$$;

-- ---------------------------------------------------------------------
-- הרשמה: מקום שמור להצעה נחשב תפוס
-- ---------------------------------------------------------------------
create or replace function book_class(p_session uuid, p_mode attend_mode default 'studio', p_auto_enroll boolean default false)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_set   settings;
  v_s     class_sessions;
  v_day   date;
  v_ent   entitlements;
  v_b     bookings;
begin
  if v_uid is null or not is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from health_declarations where user_id = v_uid) then
    raise exception 'health_declaration_required';
  end if;

  select * into v_set from settings;
  select * into v_s from class_sessions where id = p_session for update;
  if not found or v_s.status <> 'scheduled' or v_s.kind = 'private' then
    raise exception 'session_unavailable';
  end if;
  if v_s.starts_at <= now() then
    raise exception 'session_started';
  end if;
  if v_s.starts_at > now() + make_interval(days => v_set.booking_window_days) then
    raise exception 'too_early';
  end if;
  if p_mode = 'zoom' and not v_s.zoom_enabled then
    raise exception 'zoom_unavailable';
  end if;
  if exists (
    select 1 from bookings
    where session_id = p_session and user_id = v_uid
      and status in ('booked', 'waitlist', 'attended', 'no_show', 'late_cancel')
  ) then
    raise exception 'already_booked';
  end if;

  v_day := (v_s.starts_at at time zone v_set.timezone)::date;
  v_ent := pick_entitlement(v_uid, p_mode, v_day);
  if v_ent.id is null then
    raise exception 'no_entitlement';
  end if;

  if p_mode = 'studio' and studio_taken(p_session) >= v_s.max_participants then
    insert into bookings (session_id, user_id, mode, status, auto_enroll)
    values (p_session, v_uid, p_mode, 'waitlist', p_auto_enroll)
    returning * into v_b;
    return v_b;
  end if;

  perform use_entry(v_ent.id);
  insert into bookings (session_id, user_id, mode, entitlement_id, status)
  values (p_session, v_uid, p_mode, v_ent.id, 'booked')
  returning * into v_b;
  return v_b;
end;
$$;

-- ---------------------------------------------------------------------
-- מילוי מקומות פנויים מרשימת ההמתנה
-- ---------------------------------------------------------------------
create or replace function promote_waitlist(p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_set     settings;
  v_s       class_sessions;
  v_day     date;
  v_w       bookings;
  v_ent     entitlements;
  v_open_at timestamptz;
  v_first   uuid;
  v_found   boolean;
begin
  select * into v_set from settings;
  select * into v_s from class_sessions where id = p_session for update;
  if not found or v_s.status <> 'scheduled' or v_s.starts_at <= now() then
    return null;
  end if;
  v_day := (v_s.starts_at at time zone v_set.timezone)::date;
  v_open_at := v_s.starts_at - interval '30 minutes';

  while studio_taken(p_session) < v_s.max_participants loop
    v_found := false;

    -- 1. כניסה אוטומטית למי שביקשה
    for v_w in
      select * from bookings
      where session_id = p_session and status = 'waitlist' and auto_enroll
        and (offer_open or coalesce(offer_expires_at, '-infinity') <= now())
      order by created_at
      for update
    loop
      v_ent := pick_entitlement(v_w.user_id, 'studio', v_day);
      if v_ent.id is not null then
        perform use_entry(v_ent.id);
        update bookings
        set status = 'booked', entitlement_id = v_ent.id, offer_expires_at = null, offer_open = false, updated_at = now()
        where id = v_w.id;
        v_first := coalesce(v_first, v_w.id);
        v_found := true;
        exit;
      end if;
    end loop;
    continue when v_found;

    -- 2. הצעה לפי התור, למי שעוד לא קיבלה הצעה ויש לה כרטיסייה מתאימה
    if now() < v_open_at then
    for v_w in
      select * from bookings
      where session_id = p_session and status = 'waitlist' and offered_at is null
      order by created_at
      for update
    loop
      v_ent := pick_entitlement(v_w.user_id, 'studio', v_day);
      if v_ent.id is not null then
        update bookings
        set offered_at = now(),
            offer_expires_at = least(now() + interval '1 hour', v_open_at),
            offer_open = false,
            updated_at = now()
        where id = v_w.id;
        v_found := true;
        exit;
      end if;
    end loop;
    end if;
    continue when v_found;

    -- 3. חצי שעה לפני השיעור, או שכל התור כבר קיבל הצעה: הודעה לכל הרשימה,
    --    בלי שמירת מקום. הראשונה שמאשרת מקבלת.
    update bookings
    set offered_at = now(), offer_expires_at = v_s.starts_at, offer_open = true, updated_at = now()
    where session_id = p_session and status = 'waitlist'
      and coalesce(offer_expires_at, '-infinity') <= now();
    return v_first;
  end loop;
  return v_first;
end;
$$;

-- ---------------------------------------------------------------------
-- המתאמנת עונה להצעה
-- ---------------------------------------------------------------------
create function accept_offer(p_booking uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_set settings;
  v_b   bookings;
  v_s   class_sessions;
  v_ent entitlements;
begin
  select * into v_set from settings;
  select * into v_b from bookings where id = p_booking for update;
  if not found or v_b.user_id <> auth.uid() or not is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_s from class_sessions where id = v_b.session_id for update;
  if v_b.status <> 'waitlist' or v_b.offer_expires_at is null or v_b.offer_expires_at <= now() then
    raise exception 'offer_expired';
  end if;
  if v_s.status <> 'scheduled' or v_s.starts_at <= now() then
    raise exception 'session_started';
  end if;
  -- בהצעה פתוחה (חצי שעה לפני) המקום לא שמור: צריך לבדוק שעוד פנוי
  if v_b.offer_open and studio_taken(v_s.id) >= v_s.max_participants then
    raise exception 'spot_taken';
  end if;
  v_ent := pick_entitlement(v_b.user_id, 'studio', (v_s.starts_at at time zone v_set.timezone)::date);
  if v_ent.id is null then
    raise exception 'no_entitlement';
  end if;

  perform use_entry(v_ent.id);
  update bookings
  set status = 'booked', entitlement_id = v_ent.id, offer_expires_at = null, offer_open = false, updated_at = now()
  where id = p_booking
  returning * into v_b;

  -- אחרי שהמקום האחרון נתפס, ההצעות הפתוחות של האחרות כבר לא רלוונטיות
  if studio_taken(v_s.id) >= v_s.max_participants then
    update bookings set offer_expires_at = now(), updated_at = now()
    where session_id = v_s.id and status = 'waitlist' and offer_open;
  end if;
  return v_b;
end;
$$;

-- ויתור: יוצאת מרשימת ההמתנה והתור עובר הלאה מיד
create function decline_offer(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b bookings;
begin
  select * into v_b from bookings where id = p_booking for update;
  if not found or v_b.user_id <> auth.uid() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_b.status <> 'waitlist' then
    raise exception 'cannot_cancel';
  end if;
  update bookings set status = 'cancelled', offer_expires_at = null, updated_at = now() where id = p_booking;
  perform promote_waitlist(v_b.session_id);
end;
$$;

-- יציאה מרשימת ההמתנה כשהמקום שמור לה משחררת אותו לבאה בתור
create or replace function cancel_booking(p_booking uuid)
returns table (new_status booking_status, refunded boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_b      bookings;
  v_s      class_sessions;
  v_refund boolean := false;
  v_new    booking_status;
begin
  select * into v_b from bookings where id = p_booking for update;
  if not found or (v_b.user_id <> auth.uid() and not is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_s from class_sessions where id = v_b.session_id;

  if v_b.status = 'waitlist' then
    v_new := 'cancelled';
  elsif v_b.status = 'booked' then
    if v_s.starts_at <= now() then
      raise exception 'session_started';
    end if;
    if now() <= v_s.cancel_deadline or is_admin() then
      v_new := 'cancelled';
      v_refund := true;
      perform refund_entry(v_b.entitlement_id);
    else
      v_new := 'late_cancel';
    end if;
  else
    raise exception 'cannot_cancel';
  end if;

  update bookings set status = v_new, offer_expires_at = null, updated_at = now() where id = p_booking;
  if (v_b.status = 'booked' and v_b.mode = 'studio')
     or (v_b.status = 'waitlist' and v_b.offer_expires_at > now() and not v_b.offer_open) then
    perform promote_waitlist(v_b.session_id);
  end if;
  if is_admin() and v_b.user_id <> auth.uid() then
    perform log_action('cancel_booking', p_booking, jsonb_build_object('refunded', v_refund));
  end if;

  return query select v_new, v_refund;
end;
$$;

-- ---------------------------------------------------------------------
-- משימה מתוזמנת: הצעות שפג תוקפן, ומעבר להודעה פתוחה חצי שעה לפני
-- ---------------------------------------------------------------------
create function process_waitlists() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n  int := 0;
begin
  for v_id in
    select distinct b.session_id
    from bookings b join class_sessions s on s.id = b.session_id
    where b.status = 'waitlist' and s.status = 'scheduled'
      and s.starts_at > now() and s.starts_at < now() + interval '35 days'
  loop
    perform promote_waitlist(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('yoga-process-waitlists', '*/2 * * * *', 'select process_waitlists()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- הודעה למתאמנת כשמגיעה אליה הצעה
-- ---------------------------------------------------------------------
create function bookings_notify_offer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'waitlist' and new.offered_at is not null
     and new.offered_at is distinct from old.offered_at and new.offer_expires_at > now() then
    perform notify_admins_internal('waitlist_offer', jsonb_build_object('booking_id', new.id));
  end if;
  return new;
end;
$$;
create trigger bookings_notify_offer after update of offered_at on bookings
  for each row execute function bookings_notify_offer();

-- ---------------------------------------------------------------------
-- מערכת השיעורים: מקומות שמורים נספרים כתפוסים, וכל אחת רואה את ההצעה שלה.
-- גרסה חדשה לצד הישנה, כדי שאפליקציה פתוחה בגרסה הקודמת תמשיך לעבוד.
-- ---------------------------------------------------------------------
create function get_schedule_v2(p_from timestamptz, p_to timestamptz)
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
    s.min_participants, s.max_participants, s.zoom_enabled, s.cancel_deadline,
    (select count(*)::int from bookings b where b.session_id = s.id and b.mode = 'studio' and b.status in ('booked', 'attended')),
    (select count(*)::int from bookings b where b.session_id = s.id and b.mode = 'zoom'   and b.status in ('booked', 'attended')),
    (select count(*)::int from bookings b where b.session_id = s.id and b.status = 'waitlist'),
    mine.id, mine.status, mine.mode,
    (select count(*)::int from bookings b where b.session_id = s.id and b.status = 'waitlist'
       and not b.offer_open and b.offer_expires_at > now()),
    case when mine.offer_expires_at > now() then mine.offer_expires_at end,
    coalesce(mine.offer_open, false)
  from class_sessions s
  left join lateral (
    select b.id, b.status, b.mode, b.offer_expires_at, b.offer_open from bookings b
    where b.session_id = s.id and b.user_id = auth.uid()
      and b.status in ('booked', 'waitlist', 'attended', 'no_show', 'late_cancel')
    limit 1
  ) mine on true
  where (is_active_member() or is_admin())
    and s.starts_at >= p_from and s.starts_at < p_to
    and s.kind <> 'private'
  order by s.starts_at;
$$;

-- הגרסה הישנה: מקום שמור מוצג כתפוס גם שם
create or replace function get_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, title text, kind session_kind, starts_at timestamptz, duration_min int, status session_status,
  min_participants int, max_participants int, zoom_enabled boolean, cancel_deadline timestamptz,
  booked_studio int, booked_zoom int, waitlist_count int, my_booking_id uuid, my_status booking_status, my_mode attend_mode
)
language sql stable security definer set search_path = public as $$
  select g.session_id, g.title, g.kind, g.starts_at, g.duration_min, g.status, g.min_participants, g.max_participants,
         g.zoom_enabled, g.cancel_deadline, g.booked_studio + g.held_studio, g.booked_zoom, g.waitlist_count,
         g.my_booking_id, g.my_status, g.my_mode
  from get_schedule_v2(p_from, p_to) g;
$$;

revoke execute on function get_schedule_v2(timestamptz, timestamptz), accept_offer(uuid), decline_offer(uuid),
  studio_taken(uuid), process_waitlists(), bookings_notify_offer()
  from public, anon, authenticated;
grant execute on function get_schedule_v2(timestamptz, timestamptz), accept_offer(uuid), decline_offer(uuid) to authenticated;
