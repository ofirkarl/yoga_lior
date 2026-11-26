-- התראות Push לטלפון.
-- שלב ראשון: ליאור (וכל מנהלת פעילה) מקבלת התראה כשמישהי חדשה נרשמת וממתינה לאישור.
--
-- הזרימה:
--   1. המנהלת מפעילה התראות באפליקציה. הדפדפן יוצר "מנוי" והוא נשמר כאן.
--   2. הרשמה חדשה יוצרת פרופיל ממתין. הטריגר שולח בקשה אסינכרונית (pg_net)
--      לפונקציה notify-admins, עם סוד משותף ששמור ב-Vault.
--   3. הפונקציה מצפינה ושולחת התראה לכל מנויי המנהלות.
-- כשל בשליחה לעולם לא מכשיל את ההרשמה עצמה.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- מנויים
-- ---------------------------------------------------------------------
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh       text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth         text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_agent   text check (length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
-- כל משתמשת רואה רק את המנויים שלה. כתיבה רק דרך הפונקציות למטה.
create policy push_own_select on push_subscriptions for select to authenticated using (user_id = auth.uid());
revoke all on push_subscriptions from anon, authenticated;
grant select on push_subscriptions to authenticated;

-- שמירת מנוי של המכשיר הנוכחי. אם אותו מכשיר היה רשום על משתמשת אחרת, הוא עובר אליי.
create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;

create function delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- סודות: נוצרים ב-Vault ונקראים רק על ידי service_role (הפונקציה בשרת)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'notify_secret',
      'סוד משותף בין הטריגר לפונקציה notify-admins'
    );
  end if;
end $$;
-- את המפתח הפרטי של VAPID מוסיפים ידנית ל-Vault בשם 'vapid' (JSON עם publicKey ו-privateJwk).
-- הוא לא נשמר במאגר הקוד.

create function get_push_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'notify_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret'),
    'vapid',         (select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'vapid')
  );
$$;

-- ---------------------------------------------------------------------
-- הטריגר: הרשמה חדשה שממתינה לאישור
-- ---------------------------------------------------------------------
create function notify_admins_internal(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url     := 'https://bkfccrwkhookobbvrabo.supabase.co/functions/v1/notify-admins',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body    := jsonb_build_object('event', p_event) || p_payload,
    timeout_milliseconds := 5000
  );
exception when others then
  -- התראה שנכשלה לא מפילה את מה שקרה בפועל
  raise warning 'notify_admins failed: %', sqlerrm;
end;
$$;

create function profiles_notify_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- רק הרשמה עצמית מאומתת (גוגל). משתמשות שליאור יוצרת, ואימיילים שלא אומתו, לא מייצרים התראה.
  if new.status = 'pending' and exists (
    select 1 from auth.users u
    where u.id = new.id and u.email_confirmed_at is not null and u.email not like '%@users.yoga.invalid'
  ) then
    perform notify_admins_internal('new_signup', jsonb_build_object('user_id', new.id));
  end if;
  return new;
end;
$$;

create trigger profiles_notify_signup after insert on profiles
  for each row execute function profiles_notify_signup();

-- ---------------------------------------------------------------------
-- הרשאות
-- ---------------------------------------------------------------------
revoke execute on function save_push_subscription(text, text, text, text), delete_push_subscription(text),
  get_push_config(), notify_admins_internal(text, jsonb), profiles_notify_signup()
  from public, anon, authenticated;
grant execute on function save_push_subscription(text, text, text, text), delete_push_subscription(text) to authenticated;
grant execute on function get_push_config() to service_role;
