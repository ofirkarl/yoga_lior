-- זמני רשימת ההמתנה כהגדרה שליאור משנה בעצמה, במקום ערכים קבועים בקוד.
--   offer_hold_minutes: כמה זמן מקום שהתפנה שמור לבאה בתור (ברירת מחדל: שעה)
--   offer_open_minutes: כמה זמן לפני השיעור עוברים להודעה לכולן (ברירת מחדל: חצי שעה)

alter table settings
  add column offer_hold_minutes int not null default 60 check (offer_hold_minutes between 5 and 240),
  add column offer_open_minutes int not null default 30 check (offer_open_minutes between 0 and 180);

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
  v_open_at := v_s.starts_at - make_interval(mins => v_set.offer_open_minutes);

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
            offer_expires_at = least(now() + make_interval(mins => v_set.offer_hold_minutes), v_open_at),
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
