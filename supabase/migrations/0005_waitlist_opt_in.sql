-- =====================================================================
-- רשימת המתנה: כניסה אוטומטית רק למי שביקשה
--
-- ליאור לא רוצה שמתאמנות ייכנסו לשיעור בלי לדעת (ובמיוחד אחרי מועד הביטול).
-- מי שמצטרפת לרשימה יכולה לסמן "הכניסו אותי אוטומטית". מי שלא סימנה תקבל
-- בהמשך הודעה עם שעה להירשם, לפי התור (ייבנה יחד עם מערכת ההודעות).
-- =====================================================================

alter table bookings add column auto_enroll boolean not null default false;

drop function book_class(uuid, attend_mode);

create function book_class(p_session uuid, p_mode attend_mode default 'studio', p_auto_enroll boolean default false)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_set   settings;
  v_s     class_sessions;
  v_day   date;
  v_ent   entitlements;
  v_taken int;
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

  if p_mode = 'studio' then
    select count(*) into v_taken from bookings
    where session_id = p_session and mode = 'studio' and status in ('booked', 'attended');
    if v_taken >= v_s.max_participants then
      insert into bookings (session_id, user_id, mode, status, auto_enroll)
      values (p_session, v_uid, p_mode, 'waitlist', p_auto_enroll)
      returning * into v_b;
      return v_b;
    end if;
  end if;

  perform use_entry(v_ent.id);
  insert into bookings (session_id, user_id, mode, entitlement_id, status)
  values (p_session, v_uid, p_mode, v_ent.id, 'booked')
  returning * into v_b;
  return v_b;
end;
$$;

-- העלאה אוטומטית רק של מי שסימנה כניסה אוטומטית, לפי התור
create or replace function promote_waitlist(p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_set   settings;
  v_s     class_sessions;
  v_taken int;
  v_w     bookings;
  v_ent   entitlements;
begin
  select * into v_set from settings;
  select * into v_s from class_sessions where id = p_session for update;
  if v_s.status <> 'scheduled' or v_s.starts_at <= now() then
    return null;
  end if;
  select count(*) into v_taken from bookings
  where session_id = p_session and mode = 'studio' and status in ('booked', 'attended');
  if v_taken >= v_s.max_participants then
    return null;
  end if;

  for v_w in
    select * from bookings
    where session_id = p_session and status = 'waitlist' and auto_enroll
    order by created_at
    for update
  loop
    v_ent := pick_entitlement(v_w.user_id, 'studio', (v_s.starts_at at time zone v_set.timezone)::date);
    if v_ent.id is not null then
      perform use_entry(v_ent.id);
      update bookings set status = 'booked', entitlement_id = v_ent.id, updated_at = now()
      where id = v_w.id;
      return v_w.id;
    end if;
  end loop;
  return null;
end;
$$;

revoke execute on function book_class(uuid, attend_mode, boolean) from public, anon;
grant execute on function book_class(uuid, attend_mode, boolean) to authenticated;
revoke execute on function promote_waitlist(uuid) from public, anon, authenticated;
