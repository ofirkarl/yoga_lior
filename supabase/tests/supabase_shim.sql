-- מדמה את הסביבה של Supabase כדי להריץ את הסכמה ואת הבדיקות על Postgres רגיל.
-- לא נשלח ל-Supabase האמיתי.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data  jsonb not null default '{}',
  email_confirmed_at timestamptz
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth   to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ברירות המחדל של Supabase: הרשאות רחבות, ו-RLS מגביל
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Vault ו-pg_net, בגרסה מינימלית: הסודות נשמרים בגלוי, ובקשות HTTP רק נרשמות בטבלה
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id
$$;
revoke all on schema vault from public;

create schema net;
create table net.requests (id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                              headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.requests (url, headers, body) values (url, headers, body) returning id
$$;
revoke all on schema net from public;
