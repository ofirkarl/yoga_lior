-- =====================================================================
-- ניהול: מנהלת אוטומטית בכניסה ראשונה, חדר בקרה, ויצירת שיעורים אוטומטית
-- =====================================================================

-- ---------------------------------------------------------------------
-- רשימת אימיילים שמקבלים הרשאת מנהלת בכניסה הראשונה עם גוגל
-- אין לה מדיניות RLS בכלל: רק פונקציות של המערכת ניגשות אליה
-- ---------------------------------------------------------------------
create table admin_allowlist (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now()
);
alter table admin_allowlist enable row level security;
revoke all on admin_allowlist from anon, authenticated;

-- הפרופיל נוצר כמו קודם. אם זו כניסה עם גוגל, האימייל אומת על ידי גוגל,
-- והוא ברשימה, המשתמשת הופכת למנהלת מאושרת. הרשמה עם סיסמה לא מקבלת את זה
-- לעולם, כדי שאף אחד לא יוכל "לתפוס" את הכתובת של ליאור.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean;
begin
  v_admin := coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google'
             and new.email_confirmed_at is not null
             and exists (select 1 from admin_allowlist where email = lower(new.email));

  insert into profiles (id, full_name, email, role, status, approved_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    case when new.email like '%@users.yoga.invalid' then null else new.email end,
    case when v_admin then 'admin'::user_role else 'trainee'::user_role end,
    case when v_admin then 'active'::user_status else 'pending'::user_status end,
    case when v_admin then now() end
  );
  if v_admin then
    insert into audit_log (actor, action, target_id, details)
    values (new.id, 'auto_admin', new.id, jsonb_build_object('email', lower(new.email)));
  end if;
  return new;
end;
$$;

-- גיבוי: אם גוגל מאשר את האימייל רק אחרי יצירת המשתמש, ההרשאה ניתנת ברגע האישור
create function handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google'
     and exists (select 1 from admin_allowlist where email = lower(new.email)) then
    update profiles set role = 'admin', status = 'active', approved_at = coalesce(approved_at, now())
    where id = new.id and role = 'trainee';
    if found then
      insert into audit_log (actor, action, target_id, details)
      values (new.id, 'auto_admin', new.id, jsonb_build_object('email', lower(new.email)));
    end if;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function handle_user_confirmed();

-- ---------------------------------------------------------------------
-- יצירת שיעורים: פנימית (לתזמון יומי) ודרך המנהלת
-- ---------------------------------------------------------------------
create function generate_sessions_internal(p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_tz    text := (select timezone from settings);
  v_day   date := p_from;
  v_t     class_templates;
  v_count int := 0;
begin
  if p_to < p_from or p_to - p_from > 120 then
    raise exception 'bad_range';
  end if;
  while v_day <= p_to loop
    for v_t in
      select * from class_templates where active and weekday = extract(dow from v_day)::int
    loop
      insert into class_sessions (template_id, title, starts_at, duration_min,
                                  min_participants, max_participants, zoom_enabled, cancel_deadline)
      values (v_t.id, v_t.title, (v_day + v_t.start_time) at time zone v_tz, v_t.duration_min,
              v_t.min_participants, v_t.max_participants, v_t.zoom_enabled, now())
      on conflict (template_id, starts_at) do nothing;
      if found then
        v_count := v_count + 1;
      end if;
    end loop;
    v_day := v_day + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function admin_generate_sessions(p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  return generate_sessions_internal(p_from, p_to);
end;
$$;

-- פתיחת שיעורים לחודש הקרוב: כל יום ב-03:00 שעון ישראל (01:00 UTC)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'yoga-generate-sessions',
      '0 1 * * *',
      $job$select public.generate_sessions_internal(
              (now() at time zone 'Asia/Jerusalem')::date,
              (now() at time zone 'Asia/Jerusalem')::date + 35)$job$
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- חדר בקרה: תמונת מצב של הסטודיו בקריאה אחת
-- ---------------------------------------------------------------------
create function admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz          text := (select timezone from settings);
  v_today       date := (now() at time zone v_tz)::date;
  v_month_start timestamptz := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  v_result      jsonb;
begin
  perform require_admin();

  select jsonb_build_object(
    'generated_at', now(),

    'kpis', jsonb_build_object(
      'active_members',   (select count(*) from profiles where status = 'active' and role = 'trainee'),
      'pending_members',  (select count(*) from profiles where status = 'pending'),
      'active_cards',     (select count(*) from entitlements where status = 'active' and valid_until >= v_today),
      'revenue_month',    coalesce((select sum(amount_ils) from payments where created_at >= v_month_start), 0),
      'visits_month',     (select count(*) from bookings b join class_sessions s on s.id = b.session_id
                           where s.starts_at >= v_month_start and s.starts_at < now()
                             and b.status in ('booked', 'attended')),
      'classes_week',     (select count(*) from class_sessions
                           where status = 'scheduled' and starts_at between now() and now() + interval '7 days')
    ),

    -- הכנסות לפי חודש, חצי שנה אחורה (כולל חודשים בלי הכנסה)
    'revenue_months', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'total', coalesce(t.total, 0)) order by m), '[]')
      from generate_series(date_trunc('month', v_today::timestamp) - interval '5 months',
                           date_trunc('month', v_today::timestamp), interval '1 month') m
      left join (
        select date_trunc('month', created_at at time zone v_tz) mm, sum(amount_ils) total
        from payments group by 1
      ) t on t.mm = m
    ),

    'revenue_by_method', (
      select coalesce(jsonb_agg(jsonb_build_object('method', method, 'total', total) order by total desc), '[]')
      from (select method, sum(amount_ils) total from payments where created_at >= v_month_start group by method) x
    ),

    -- השבוע הקרוב: תפוסה מול מינימום ומקסימום
    'upcoming', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'status', s.status,
        'cancel_deadline', s.cancel_deadline,
        'min', s.min_participants, 'max', s.max_participants,
        'studio', (select count(*) from bookings b where b.session_id = s.id and b.mode = 'studio' and b.status in ('booked', 'attended')),
        'zoom',   (select count(*) from bookings b where b.session_id = s.id and b.mode = 'zoom'   and b.status in ('booked', 'attended')),
        'waitlist', (select count(*) from bookings b where b.session_id = s.id and b.status = 'waitlist')
      ) order by s.starts_at), '[]')
      from class_sessions s
      where s.starts_at between now() and now() + interval '7 days' and s.kind <> 'private'
    ),

    -- מתעניינים: ממתינות לאישור
    'pending', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'created_at', p.created_at,
        'has_health', exists (select 1 from health_declarations h where h.user_id = p.id)
      ) order by p.created_at desc), '[]')
      from profiles p where p.status = 'pending'
    ),

    -- כרטיסיות שעומדות להיגמר (כניסה אחרונה או שבוע תוקף)
    'expiring', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'entitlement_id', e.id, 'user_id', e.user_id, 'full_name', p.full_name, 'phone', p.phone,
        'title', e.title, 'entries_left', e.entries_left, 'valid_until', e.valid_until
      ) order by e.valid_until), '[]')
      from entitlements e join profiles p on p.id = e.user_id
      where e.status = 'active' and e.valid_until >= v_today
        and (e.valid_until <= v_today + 7 or e.entries_left <= 1)
    ),

    -- פעילות אחרונה
    'activity', (
      select coalesce(jsonb_agg(a order by (a ->> 'at') desc), '[]')
      from (
        select x as a from (
          select jsonb_build_object('kind', case when b.status = 'waitlist' then 'waitlist' else 'booked' end,
                                    'at', b.created_at, 'who', p.full_name, 'what', s.title, 'when', s.starts_at, 'mode', b.mode) x,
                 b.created_at at_
          from bookings b join profiles p on p.id = b.user_id join class_sessions s on s.id = b.session_id
          union all
          select jsonb_build_object('kind', b.status::text, 'at', b.updated_at, 'who', p.full_name, 'what', s.title, 'when', s.starts_at),
                 b.updated_at
          from bookings b join profiles p on p.id = b.user_id join class_sessions s on s.id = b.session_id
          where b.status in ('cancelled', 'late_cancel')
          union all
          select jsonb_build_object('kind', 'payment', 'at', pay.created_at, 'who', p.full_name,
                                    'what', coalesce(pr.name, ''), 'amount', pay.amount_ils, 'method', pay.method),
                 pay.created_at
          from payments pay join profiles p on p.id = pay.user_id left join products pr on pr.id = pay.product_id
          union all
          select jsonb_build_object('kind', 'joined', 'at', p.created_at, 'who', p.full_name), p.created_at
          from profiles p where p.role = 'trainee'
        ) u
        order by at_ desc
        limit 25
      ) z
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function generate_sessions_internal(date, date) from public, anon, authenticated;
revoke execute on function handle_user_confirmed() from public, anon, authenticated;
revoke execute on function admin_dashboard() from public, anon;
grant execute on function admin_dashboard() to authenticated;
grant execute on function admin_generate_sessions(date, date) to authenticated;
