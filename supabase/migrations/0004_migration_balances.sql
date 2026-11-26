-- =====================================================================
-- מעבר נקי מארבוקס: יתרות שממתינות למתאמנת
--
-- ליאור מזינה מראש את היתרות מארבוקס (שם, אימייל או טלפון, כניסות, תוקף).
-- כשהמתאמנת מאושרת, היתרה נקשרת אליה אוטומטית רק לפי אימייל, כי אימייל של
-- גוגל מאומת. טלפון כל אחת יכולה להקליד, ולכן התאמה לפי טלפון רק מוצעת
-- לליאור במסך הניהול, והיא מאשרת בלחיצה.
-- =====================================================================

-- טלפון בצורה אחידה: ספרות בלבד, 972 בהתחלה הופך ל-0
create function norm_phone(p text) returns text
language sql immutable as $$
  select case
    when p is null then null
    when regexp_replace(p, '\D', '', 'g') ~ '^972' then '0' || substr(regexp_replace(p, '\D', '', 'g'), 4)
    else nullif(regexp_replace(p, '\D', '', 'g'), '')
  end;
$$;

create table imported_balances (
  id             uuid primary key default gen_random_uuid(),
  full_name      text        not null check (length(trim(full_name)) >= 2),
  email          text        check (email is null or email = lower(email)),
  phone          text,
  title          text        not null default 'יתרה מארבוקס',
  mode           attend_mode not null default 'studio',
  entries_left   int         not null check (entries_left > 0 and entries_left <= 100),
  valid_until    date        not null,
  note           text,
  created_at     timestamptz not null default now(),
  claimed_by     uuid        references profiles (id) on delete set null,
  claimed_at     timestamptz,
  entitlement_id uuid        references entitlements (id) on delete set null,
  check (email is not null or phone is not null)
);
create index on imported_balances (email) where claimed_by is null;
create index on imported_balances (norm_phone(phone)) where claimed_by is null;

alter table imported_balances enable row level security;
create policy balances_admin on imported_balances for all to authenticated using (is_admin()) with check (is_admin());

-- שיוך יתרה אחת למתאמנת (פנימי)
create function claim_balance_internal(p_balance uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b   imported_balances;
  v_ent uuid;
  v_today date := (now() at time zone (select timezone from settings))::date;
begin
  select * into v_b from imported_balances where id = p_balance for update;
  if not found then
    raise exception 'balance_not_found';
  end if;
  if v_b.claimed_by is not null then
    raise exception 'balance_already_claimed';
  end if;
  insert into entitlements (user_id, title, mode, entries_total, entries_left, valid_from, valid_until)
  values (p_user, v_b.title, v_b.mode, v_b.entries_left, v_b.entries_left, least(v_today, v_b.valid_until), v_b.valid_until)
  returning id into v_ent;
  update imported_balances set claimed_by = p_user, claimed_at = now(), entitlement_id = v_ent where id = p_balance;
  insert into audit_log (actor, action, target_id, details)
  values (auth.uid(), 'claim_balance', p_user,
          jsonb_build_object('balance', p_balance, 'entries', v_b.entries_left, 'valid_until', v_b.valid_until));
  return v_ent;
end;
$$;

-- שיוך אוטומטי לפי אימייל מאומת בלבד (פנימי)
create function auto_claim_balances(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_p     profiles;
  v_id    uuid;
  v_count int := 0;
begin
  select * into v_p from profiles where id = p_user and status = 'active' and role = 'trainee';
  if not found then
    return 0;
  end if;
  -- רק אימייל שאומת (גוגל, או אישור במייל)
  if not exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null) then
    return 0;
  end if;
  for v_id in
    select id from imported_balances
    where claimed_by is null
      and v_p.email is not null and email = lower(v_p.email)
    order by valid_until
  loop
    perform claim_balance_internal(v_id, p_user);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- כשמתאמנת מאושרת, בודקים אם מחכה לה יתרה
create function profiles_claim_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and new.role = 'trainee' and old.status is distinct from 'active' then
    perform auto_claim_balances(new.id);
  end if;
  return new;
end;
$$;

create trigger profiles_claim_balances
  after update on profiles
  for each row execute function profiles_claim_trigger();

-- ---------------------------------------------------------------------
-- פעולות ניהול
-- ---------------------------------------------------------------------

-- הזנת רשימת יתרות (מודבקת מאקסל או מהמחברת)
-- p_rows: [{"full_name","email","phone","entries_left","valid_until","mode","note"}]
create function admin_import_balances(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row      jsonb;
  v_inserted int := 0;
  v_claimed  int := 0;
  v_user     uuid;
begin
  perform require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'bad_rows';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    insert into imported_balances (full_name, email, phone, entries_left, valid_until, mode, note)
    values (
      trim(v_row ->> 'full_name'),
      nullif(lower(trim(coalesce(v_row ->> 'email', ''))), ''),
      nullif(trim(coalesce(v_row ->> 'phone', '')), ''),
      (v_row ->> 'entries_left')::int,
      (v_row ->> 'valid_until')::date,
      coalesce((v_row ->> 'mode')::attend_mode, 'studio'),
      nullif(trim(coalesce(v_row ->> 'note', '')), '')
    );
    v_inserted := v_inserted + 1;
  end loop;
  -- מתאמנות שכבר פעילות באפליקציה מקבלות את היתרה מיד
  for v_user in select id from profiles where status = 'active' and role = 'trainee' loop
    v_claimed := v_claimed + auto_claim_balances(v_user);
  end loop;
  perform log_action('import_balances', null, jsonb_build_object('inserted', v_inserted, 'claimed', v_claimed));
  return jsonb_build_object('inserted', v_inserted, 'claimed', v_claimed);
end;
$$;

create function admin_claim_balance(p_balance uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if not exists (select 1 from profiles where id = p_user and role = 'trainee') then
    raise exception 'user_not_found';
  end if;
  perform claim_balance_internal(p_balance, p_user);
end;
$$;

create function admin_delete_balance(p_balance uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  delete from imported_balances where id = p_balance and claimed_by is null;
  if not found then
    raise exception 'balance_already_claimed';
  end if;
  perform log_action('delete_balance', p_balance, null);
end;
$$;

revoke execute on function claim_balance_internal(uuid, uuid), auto_claim_balances(uuid), profiles_claim_trigger()
  from public, anon, authenticated;
revoke execute on function admin_import_balances(jsonb), admin_claim_balance(uuid, uuid), admin_delete_balance(uuid)
  from public, anon;
grant execute on function admin_import_balances(jsonb), admin_claim_balance(uuid, uuid), admin_delete_balance(uuid)
  to authenticated;
grant execute on function norm_phone(text) to authenticated;
