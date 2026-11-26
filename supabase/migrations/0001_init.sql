-- =====================================================================
-- יוגה עם ליאור – סכמת בסיס הנתונים
--
-- עקרונות אבטחה:
--   * Row Level Security על כל טבלה. מתאמנת רואה רק את השורות שלה.
--   * כל פעולה שמשנה כרטיסייה או הרשמה עוברת דרך פונקציה שבודקת הרשאות
--     ומבצעת את כל השינוי בבת אחת. אין למתאמנות הרשאת כתיבה ישירה
--     לטבלאות הרשמות, כרטיסיות ותשלומים.
--   * קישורי זום נשמרים בטבלה נפרדת ונחשפים רק למי שנרשמה לזום.
--   * הצהרות בריאות: המתאמנת כותבת, רק המנהלת קוראת.
--   * פרטי אשראי לא נשמרים כאן לעולם. התשלום מתבצע אצל Grow.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- סוגים
-- ---------------------------------------------------------------------
create type user_role          as enum ('trainee', 'admin');
create type user_status        as enum ('pending', 'active', 'blocked');
create type attend_mode        as enum ('studio', 'zoom');
create type product_kind       as enum ('trial', 'single', 'punch', 'membership');
create type entitlement_status as enum ('active', 'used_up', 'expired', 'cancelled');
create type payment_method     as enum ('grow', 'cash', 'paybox', 'bit', 'transfer', 'other');
create type session_kind       as enum ('regular', 'workshop', 'private');
create type session_status     as enum ('scheduled', 'cancelled');
create type booking_status     as enum ('booked', 'waitlist', 'cancelled', 'late_cancel', 'attended', 'no_show');

-- ---------------------------------------------------------------------
-- הגדרות הסטודיו (שורה אחת)
-- ---------------------------------------------------------------------
create table settings (
  id                    boolean primary key default true check (id),
  timezone              text    not null default 'Asia/Jerusalem',
  -- שיעור שמתחיל לפני השעה הזו נחשב שיעור בוקר
  morning_cutoff        time    not null default '12:00',
  -- שיעור בוקר: ביטול חינם עד השעה הזו בערב שלפני
  morning_cancel_time   time    not null default '20:00',
  -- שיעור ערב: ביטול חינם עד כך וכך שעות לפני
  evening_cancel_hours  int     not null default 3 check (evening_cancel_hours between 0 and 72),
  booking_window_days   int     not null default 30 check (booking_window_days between 1 and 365),
  default_min           int     not null default 3,
  default_max           int     not null default 8,
  -- כמה שעות לפני מועד הביטול לשלוח תזכורת כשחסרות נרשמות
  reminder_hours_before int     not null default 4
);
insert into settings default values;

-- ---------------------------------------------------------------------
-- פרופילים
-- ---------------------------------------------------------------------
create table profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  full_name            text        not null default '',
  phone                text,
  email                text,
  username             text unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  role                 user_role   not null default 'trainee',
  status               user_status not null default 'pending',
  must_change_password boolean     not null default false,
  created_at           timestamptz not null default now(),
  approved_at          timestamptz
);

-- ---------------------------------------------------------------------
-- פונקציות עזר להרשאות
-- ---------------------------------------------------------------------
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- מתאמנת פעילה: אושרה, לא חסומה, והחליפה סיסמה זמנית אם קיבלה כזו
create function is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and status = 'active' and not must_change_password
  );
$$;

-- יצירת פרופיל אוטומטית לכל משתמש חדש (גוגל או שם משתמש)
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    -- כתובת פנימית של משתמשי שם-משתמש לא נשמרת כאימייל
    case when new.email like '%@users.yoga.invalid' then null else new.email end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- מתאמנת יכולה לעדכן רק שם וטלפון. תפקיד, סטטוס ושם משתמש נעולים.
create function protect_profile_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not is_admin() then
    new.id                   := old.id;
    new.email                := old.email;
    new.username             := old.username;
    new.role                 := old.role;
    new.status               := old.status;
    new.must_change_password := old.must_change_password;
    new.created_at           := old.created_at;
    new.approved_at          := old.approved_at;
  end if;
  return new;
end;
$$;

create trigger profiles_protect
  before update on profiles
  for each row execute function protect_profile_fields();

-- ---------------------------------------------------------------------
-- הצהרות בריאות
-- ---------------------------------------------------------------------
create table health_declarations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null references profiles (id) on delete cascade,
  answers        jsonb       not null,
  signature_name text        not null check (length(trim(signature_name)) >= 2),
  form_version   text        not null default 'v1',
  signed_at      timestamptz not null default now()
);
create index on health_declarations (user_id);

-- ---------------------------------------------------------------------
-- מוצרים
-- ---------------------------------------------------------------------
create table products (
  id             uuid primary key default gen_random_uuid(),
  name           text           not null,
  kind           product_kind   not null,
  mode           attend_mode    not null default 'studio',
  price_ils      numeric(10, 2) not null check (price_ils >= 0),
  entries        int            check (entries is null or entries > 0), -- null = ללא הגבלה
  validity_days  int            not null check (validity_days > 0),
  once_per_user  boolean        not null default false,
  active         boolean        not null default true,
  sort_order     int            not null default 0,
  created_at     timestamptz    not null default now()
);

-- ---------------------------------------------------------------------
-- תשלומים וכרטיסיות
-- ---------------------------------------------------------------------
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid           not null references profiles (id) on delete restrict,
  product_id          uuid           references products (id),
  amount_ils          numeric(10, 2) not null check (amount_ils >= 0),
  method              payment_method not null,
  grow_transaction_id text unique,
  grow_asmachta       text,
  note                text,
  recorded_by         uuid           references profiles (id),
  created_at          timestamptz    not null default now()
);
create index on payments (user_id);

create table entitlements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid               not null references profiles (id) on delete cascade,
  product_id    uuid               references products (id),
  payment_id    uuid               references payments (id),
  title         text               not null,
  mode          attend_mode        not null,
  entries_total int,
  entries_left  int                check (entries_left is null or entries_left >= 0),
  valid_from    date               not null,
  valid_until   date               not null,
  status        entitlement_status not null default 'active',
  created_at    timestamptz        not null default now(),
  check (valid_until >= valid_from)
);
create index on entitlements (user_id, status);

-- ---------------------------------------------------------------------
-- שיעורים
-- ---------------------------------------------------------------------
create table class_templates (
  id               uuid primary key default gen_random_uuid(),
  title            text    not null,
  weekday          int     not null check (weekday between 0 and 6), -- 0 = ראשון
  start_time       time    not null,
  duration_min     int     not null default 75 check (duration_min > 0),
  min_participants int     not null default 3,
  max_participants int     not null default 8,
  zoom_enabled     boolean not null default true,
  active           boolean not null default true,
  check (max_participants >= min_participants and min_participants >= 0)
);

create table class_sessions (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid           references class_templates (id) on delete set null,
  title            text           not null,
  kind             session_kind   not null default 'regular',
  starts_at        timestamptz    not null,
  duration_min     int            not null check (duration_min > 0),
  min_participants int            not null,
  max_participants int            not null,
  zoom_enabled     boolean        not null default false,
  cancel_deadline  timestamptz    not null,
  status           session_status not null default 'scheduled',
  cancel_reason    text,
  reminder_sent_at timestamptz,
  created_at       timestamptz    not null default now(),
  unique (template_id, starts_at),
  check (max_participants >= min_participants and min_participants >= 0)
);
create index on class_sessions (starts_at);

-- קישור זום בטבלה נפרדת, כדי שלא ייחשף בלוח השיעורים
create table session_private (
  session_id uuid primary key references class_sessions (id) on delete cascade,
  zoom_url   text check (zoom_url is null or zoom_url ~ '^https://')
);

create table bookings (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid           not null references class_sessions (id) on delete cascade,
  user_id        uuid           not null references profiles (id) on delete cascade,
  mode           attend_mode    not null,
  entitlement_id uuid           references entitlements (id),
  status         booking_status not null,
  created_at     timestamptz    not null default now(),
  updated_at     timestamptz    not null default now()
);
-- הרשמה פעילה אחת לכל מתאמנת בכל שיעור
create unique index bookings_one_active
  on bookings (session_id, user_id)
  where status in ('booked', 'waitlist', 'attended', 'no_show', 'late_cancel');
create index on bookings (user_id);

-- ---------------------------------------------------------------------
-- יומן פעולות ניהול
-- ---------------------------------------------------------------------
create table audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid,
  action     text        not null,
  target_id  uuid,
  details    jsonb,
  created_at timestamptz not null default now()
);

create function log_action(p_action text, p_target uuid, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (actor, action, target_id, details)
  values (auth.uid(), p_action, p_target, p_details);
$$;

-- ---------------------------------------------------------------------
-- מועד ביטול: בוקר עד 20:00 בערב שלפני, ערב עד 3 שעות לפני
-- ---------------------------------------------------------------------
create function compute_cancel_deadline(p_starts timestamptz) returns timestamptz
language sql stable set search_path = public as $$
  select case
    when (p_starts at time zone s.timezone)::time < s.morning_cutoff
      then (((p_starts at time zone s.timezone)::date - 1) + s.morning_cancel_time) at time zone s.timezone
    else p_starts - make_interval(hours => s.evening_cancel_hours)
  end
  from settings s;
$$;

create function set_cancel_deadline() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at then
    new.cancel_deadline := compute_cancel_deadline(new.starts_at);
  end if;
  return new;
end;
$$;

create trigger class_sessions_deadline
  before insert or update on class_sessions
  for each row execute function set_cancel_deadline();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table settings            enable row level security;
alter table profiles            enable row level security;
alter table health_declarations enable row level security;
alter table products            enable row level security;
alter table payments            enable row level security;
alter table entitlements        enable row level security;
alter table class_templates     enable row level security;
alter table class_sessions      enable row level security;
alter table session_private     enable row level security;
alter table bookings            enable row level security;
alter table audit_log           enable row level security;

-- הגדרות
create policy settings_read  on settings for select to authenticated using (true);
create policy settings_admin on settings for update to authenticated using (is_admin()) with check (is_admin());

-- פרופילים
create policy profiles_read   on profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());

-- הצהרות בריאות: כתיבה עצמית, קריאה למנהלת בלבד
create policy health_insert on health_declarations for insert to authenticated with check (user_id = auth.uid());
create policy health_admin  on health_declarations for select to authenticated using (is_admin());

-- מוצרים
create policy products_read  on products for select to authenticated using (active or is_admin());
create policy products_admin on products for all    to authenticated using (is_admin()) with check (is_admin());

-- תשלומים וכרטיסיות: קריאה עצמית, כתיבה רק דרך פונקציות
create policy payments_read     on payments     for select to authenticated using (user_id = auth.uid() or is_admin());
create policy entitlements_read on entitlements for select to authenticated using (user_id = auth.uid() or is_admin());

-- תבניות: מנהלת בלבד
create policy templates_admin on class_templates for all to authenticated using (is_admin()) with check (is_admin());

-- שיעורים: כל מתאמנת פעילה רואה את הלוח, רק המנהלת עורכת
create policy sessions_read  on class_sessions for select to authenticated using (is_active_member() or is_admin());
create policy sessions_admin on class_sessions for all    to authenticated using (is_admin()) with check (is_admin());

-- קישור זום: מנהלת, או מי שרשומה לזום באותו שיעור
create policy private_read on session_private for select to authenticated using (
  is_admin() or exists (
    select 1 from bookings b
    where b.session_id = session_private.session_id
      and b.user_id = auth.uid() and b.mode = 'zoom' and b.status = 'booked'
  )
);
create policy private_admin on session_private for all to authenticated using (is_admin()) with check (is_admin());

-- הרשמות: קריאה עצמית, כתיבה רק דרך פונקציות
create policy bookings_read on bookings for select to authenticated using (user_id = auth.uid() or is_admin());

-- יומן: מנהלת בלבד
create policy audit_admin on audit_log for select to authenticated using (is_admin());

-- אורחים לא מחוברים לא רואים כלום
revoke all on all tables in schema public from anon;

-- =====================================================================
-- פונקציות: צד המתאמנת
-- =====================================================================

-- בחירת כרטיסייה מתאימה לשיעור: הכרטיסייה שתוקפה נגמר ראשונה
create function pick_entitlement(p_user uuid, p_mode attend_mode, p_day date)
returns entitlements
language sql stable security definer set search_path = public as $$
  select * from entitlements
  where user_id = p_user and status = 'active' and mode = p_mode
    and valid_from <= p_day and valid_until >= p_day
    and (entries_left is null or entries_left > 0)
  order by valid_until, created_at
  limit 1;
$$;

create function use_entry(p_ent uuid) returns void
language sql security definer set search_path = public as $$
  update entitlements
  set entries_left = case when entries_left is null then null else entries_left - 1 end,
      status = case when entries_left = 1 then 'used_up'::entitlement_status else status end
  where id = p_ent;
$$;

create function refund_entry(p_ent uuid) returns void
language sql security definer set search_path = public as $$
  update entitlements
  set entries_left = case when entries_left is null then null else entries_left + 1 end,
      status = case when status = 'used_up' then 'active'::entitlement_status else status end
  where id = p_ent;
$$;

-- לוח שיעורים: מספרי נרשמות בלבד, בלי שמות של אחרות
create function get_schedule(p_from timestamptz, p_to timestamptz)
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
  my_mode          attend_mode
)
language sql stable security definer set search_path = public as $$
  select
    s.id, s.title, s.kind, s.starts_at, s.duration_min, s.status,
    s.min_participants, s.max_participants, s.zoom_enabled, s.cancel_deadline,
    (select count(*)::int from bookings b where b.session_id = s.id and b.mode = 'studio' and b.status in ('booked', 'attended')),
    (select count(*)::int from bookings b where b.session_id = s.id and b.mode = 'zoom'   and b.status in ('booked', 'attended')),
    (select count(*)::int from bookings b where b.session_id = s.id and b.status = 'waitlist'),
    mine.id, mine.status, mine.mode
  from class_sessions s
  left join lateral (
    select b.id, b.status, b.mode from bookings b
    where b.session_id = s.id and b.user_id = auth.uid()
      and b.status in ('booked', 'waitlist', 'attended', 'no_show', 'late_cancel')
    limit 1
  ) mine on true
  where (is_active_member() or is_admin())
    and s.starts_at >= p_from and s.starts_at < p_to
    and s.kind <> 'private'
  order by s.starts_at;
$$;

create function book_class(p_session uuid, p_mode attend_mode default 'studio')
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
      insert into bookings (session_id, user_id, mode, status)
      values (p_session, v_uid, p_mode, 'waitlist')
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

-- העלאת הראשונה ברשימת ההמתנה שיש לה כרטיסייה מתאימה
create function promote_waitlist(p_session uuid) returns uuid
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
    where session_id = p_session and status = 'waitlist'
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

-- ביטול: בזמן מחזיר ניקוב, מאוחר לא מחזיר
create function cancel_booking(p_booking uuid)
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

  update bookings set status = v_new, updated_at = now() where id = p_booking;
  if v_b.status = 'booked' and v_b.mode = 'studio' then
    perform promote_waitlist(v_b.session_id);
  end if;
  if is_admin() and v_b.user_id <> auth.uid() then
    perform log_action('cancel_booking', p_booking, jsonb_build_object('refunded', v_refund));
  end if;

  return query select v_new, v_refund;
end;
$$;

create function submit_health_declaration(p_answers jsonb, p_signature text, p_version text default 'v1')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into health_declarations (user_id, answers, signature_name, form_version)
  values (auth.uid(), p_answers, p_signature, p_version)
  returning id into v_id;
  return v_id;
end;
$$;

create function mark_password_changed() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid();
$$;

-- =====================================================================
-- פונקציות: צד הניהול
-- =====================================================================

create function require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
end;
$$;

create function admin_set_member_status(p_user uuid, p_status user_status) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update profiles
  set status = p_status,
      approved_at = case when p_status = 'active' and approved_at is null then now() else approved_at end
  where id = p_user;
  perform log_action('set_member_status', p_user, jsonb_build_object('status', p_status));
end;
$$;

-- הענקת מוצר (פנימי): משמש גם לתשלום ידני וגם ל-Grow
create function grant_product(p_user uuid, p_product uuid, p_payment uuid, p_start date)
returns entitlements
language plpgsql security definer set search_path = public as $$
declare
  v_p products;
  v_e entitlements;
begin
  select * into v_p from products where id = p_product;
  if not found then
    raise exception 'product_not_found';
  end if;
  if v_p.once_per_user and exists (
    select 1 from entitlements where user_id = p_user and product_id = p_product
  ) then
    raise exception 'product_once_per_user';
  end if;
  insert into entitlements (user_id, product_id, payment_id, title, mode,
                            entries_total, entries_left, valid_from, valid_until)
  values (p_user, p_product, p_payment, v_p.name, v_p.mode,
          v_p.entries, v_p.entries, p_start, p_start + v_p.validity_days - 1)
  returning * into v_e;
  return v_e;
end;
$$;
revoke all on function grant_product(uuid, uuid, uuid, date) from public;

create function admin_record_payment(
  p_user    uuid,
  p_product uuid,
  p_method  payment_method,
  p_amount  numeric,
  p_note    text default null,
  p_start   date default null
) returns entitlements
language plpgsql security definer set search_path = public as $$
declare
  v_pay uuid;
  v_e   entitlements;
begin
  perform require_admin();
  if p_method = 'grow' then
    raise exception 'grow_payments_are_automatic';
  end if;
  insert into payments (user_id, product_id, amount_ils, method, note, recorded_by)
  values (p_user, p_product, p_amount, p_method, p_note, auth.uid())
  returning id into v_pay;
  v_e := grant_product(p_user, p_product, v_pay,
                       coalesce(p_start, (now() at time zone (select timezone from settings))::date));
  perform log_action('record_payment', v_e.id,
                     jsonb_build_object('method', p_method, 'amount', p_amount, 'payment', v_pay));
  return v_e;
end;
$$;

-- תיקון ידני: הוספה או הורדה של כניסות, שינוי תוקף. מחייב סיבה.
create function admin_adjust_entitlement(
  p_ent         uuid,
  p_entries_add int  default 0,
  p_valid_until date default null,
  p_reason      text default null
) returns entitlements
language plpgsql security definer set search_path = public as $$
declare
  v_e entitlements;
begin
  perform require_admin();
  if p_reason is null or length(trim(p_reason)) < 2 then
    raise exception 'reason_required';
  end if;
  update entitlements
  set entries_left = case when entries_left is null then null else greatest(entries_left + p_entries_add, 0) end,
      valid_until  = coalesce(p_valid_until, valid_until)
  where id = p_ent
  returning * into v_e;
  update entitlements
  set status = case
        when entries_left = 0 then 'used_up'::entitlement_status
        when status = 'used_up' and entries_left > 0 then 'active'::entitlement_status
        else status end
  where id = p_ent
  returning * into v_e;
  perform log_action('adjust_entitlement', p_ent,
                     jsonb_build_object('entries_add', p_entries_add, 'valid_until', p_valid_until, 'reason', p_reason));
  return v_e;
end;
$$;

-- ביטול שיעור: כל הנרשמות מקבלות ניקוב בחזרה
create function admin_cancel_session(p_session uuid, p_reason text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_b     bookings;
  v_count int := 0;
begin
  perform require_admin();
  update class_sessions set status = 'cancelled', cancel_reason = p_reason
  where id = p_session and status = 'scheduled';
  if not found then
    raise exception 'session_unavailable';
  end if;
  for v_b in
    select * from bookings
    where session_id = p_session and status in ('booked', 'waitlist', 'late_cancel')
    for update
  loop
    if v_b.entitlement_id is not null and v_b.status in ('booked', 'late_cancel') then
      perform refund_entry(v_b.entitlement_id);
    end if;
    update bookings set status = 'cancelled', updated_at = now() where id = v_b.id;
    v_count := v_count + 1;
  end loop;
  perform log_action('cancel_session', p_session, jsonb_build_object('reason', p_reason, 'affected', v_count));
  return v_count;
end;
$$;

create function admin_mark_attendance(p_booking uuid, p_attended boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update bookings
  set status = case when p_attended then 'attended'::booking_status else 'no_show'::booking_status end,
      updated_at = now()
  where id = p_booking and status in ('booked', 'attended', 'no_show');
  if not found then
    raise exception 'booking_not_found';
  end if;
end;
$$;

-- יצירת שיעורים מתוך המערכת השבועית לטווח תאריכים
create function admin_generate_sessions(p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_tz    text := (select timezone from settings);
  v_day   date;
  v_t     class_templates;
  v_count int := 0;
begin
  perform require_admin();
  if p_to < p_from or p_to - p_from > 120 then
    raise exception 'bad_range';
  end if;
  v_day := p_from;
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

-- שיעורים שקרובים למועד הבדיקה וחסרות בהם נרשמות
create function sessions_below_minimum(p_hours_ahead int default 24)
returns table (session_id uuid, title text, starts_at timestamptz, cancel_deadline timestamptz,
               booked int, min_participants int)
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.starts_at, s.cancel_deadline,
         (select count(*)::int from bookings b where b.session_id = s.id and b.status = 'booked'),
         s.min_participants
  from class_sessions s
  where s.status = 'scheduled' and s.kind <> 'private'
    and s.cancel_deadline between now() and now() + make_interval(hours => p_hours_ahead)
    and (select count(*) from bookings b where b.session_id = s.id and b.status = 'booked') < s.min_participants
    and (is_admin() or current_user <> 'authenticated')
  order by s.cancel_deadline;
$$;

-- =====================================================================
-- הרשאות הרצה
-- =====================================================================
revoke execute on all functions in schema public from public, anon, authenticated;
-- פונקציות שיתווספו בעתיד לא יהיו פתוחות אוטומטית
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
grant execute on function
  is_admin(), is_active_member(),
  compute_cancel_deadline(timestamptz),
  get_schedule(timestamptz, timestamptz),
  book_class(uuid, attend_mode),
  cancel_booking(uuid),
  submit_health_declaration(jsonb, text, text),
  mark_password_changed(),
  admin_set_member_status(uuid, user_status),
  admin_record_payment(uuid, uuid, payment_method, numeric, text, date),
  admin_adjust_entitlement(uuid, int, date, text),
  admin_cancel_session(uuid, text),
  admin_mark_attendance(uuid, boolean),
  admin_generate_sessions(date, date),
  sessions_below_minimum(int)
to authenticated;
