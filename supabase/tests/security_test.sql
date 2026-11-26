-- בדיקות אבטחה וחוקי הרשמה. רצות על Postgres מקומי עם supabase_shim.sql.
\set ON_ERROR_STOP on
\set QUIET on

create schema t;
grant usage on schema t to anon, authenticated;

create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'ok: %', p_label;
end $$;

create function t.fails(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL (no error): %', p_label;
exception when others then
  if sqlerrm like 'FAIL (no error)%' then raise; end if;
  if position(p_fragment in sqlerrm) = 0 then
    raise exception 'FAIL: % (got: %)', p_label, sqlerrm;
  end if;
  raise notice 'ok: % [%]', p_label, sqlerrm;
end $$;

create function t.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id::text, false);
$$;
grant execute on all functions in schema t to anon, authenticated;

-- משתמשות: ליאור (מנהלת), דנה, מיכל
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'lior@example.com', '{"full_name":"ליאור"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'dana@example.com', '{"name":"דנה"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'michal@users.yoga.invalid', '{"full_name":"מיכל"}');
update profiles set role = 'admin', status = 'active' where id = '00000000-0000-0000-0000-00000000000a';

select t.ok((select full_name from profiles where id = '00000000-0000-0000-0000-0000000000d1') = 'דנה',
            'פרופיל נוצר אוטומטית עם השם מגוגל');
select t.ok((select email from profiles where id = '00000000-0000-0000-0000-0000000000a2') is null,
            'כתובת פנימית של שם משתמש לא נשמרת כאימייל');

-- מועדי ביטול
select t.ok(compute_cancel_deadline('2026-12-07 09:30+02') = '2026-12-06 20:00+02', 'שיעור בוקר: ביטול עד 20:00 בערב שלפני');
select t.ok(compute_cancel_deadline('2026-12-06 18:30+02') = '2026-12-06 15:30+02', 'שיעור ערב: ביטול עד 3 שעות לפני');
select t.ok(compute_cancel_deadline('2026-07-06 09:30+03') = '2026-07-05 20:00+03', 'שעון קיץ מחושב נכון');

-- ===== אורחת לא מחוברת =====
set role anon;
select t.fails('select * from profiles', 'permission denied', 'אורחת לא רואה פרופילים');
select t.fails('select * from get_schedule(now(), now() + interval ''7 days'')', 'permission denied', 'אורחת לא רואה לוח שיעורים');
reset role;

-- ===== דנה, ממתינה לאישור =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.ok((select count(*) from profiles) = 1, 'מתאמנת רואה רק את הפרופיל שלה');
update profiles set role = 'admin', status = 'active', full_name = 'דנה כהן' where id = auth.uid();
select t.ok((select role = 'trainee' and status = 'pending' and full_name = 'דנה כהן' from profiles),
            'מתאמנת לא יכולה לשדרג את עצמה, אבל יכולה לעדכן שם');
select t.fails('select admin_set_member_status(''00000000-0000-0000-0000-0000000000d1'', ''active'')', 'admin_only',
               'מתאמנת לא יכולה לאשר את עצמה');
select t.ok((select count(*) from get_schedule(now(), now() + interval '30 days')) = 0, 'ממתינה לאישור לא רואה שיעורים');
select t.fails('insert into entitlements (user_id, title, mode, valid_from, valid_until) values (auth.uid(), ''x'', ''studio'', current_date, current_date)',
               'row-level security', 'מתאמנת לא יכולה ליצור לעצמה כרטיסייה');
select t.fails('select use_entry(gen_random_uuid())', 'permission denied', 'פונקציות פנימיות חסומות למתאמנות');
reset role;

-- ===== ליאור מאשרת ובונה שיעורים =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
select admin_set_member_status('00000000-0000-0000-0000-0000000000d1', 'active');
select admin_set_member_status('00000000-0000-0000-0000-0000000000a2', 'active');
select t.ok((select count(*) from profiles) = 3, 'מנהלת רואה את כל המתאמנות');

insert into products (name, kind, mode, price_ils, entries, validity_days, once_per_user)
values ('כרטיסייה 5', 'punch', 'studio', 375, 5, 42, false),
       ('ניסיון', 'trial', 'studio', 60, 1, 7, true),
       ('זום 4', 'punch', 'zoom', 140, 4, 60, false);

insert into class_sessions (title, starts_at, duration_min, min_participants, max_participants, zoom_enabled, cancel_deadline)
values ('רמה 1', date_trunc('day', now()) + interval '3 days 16 hours 30 minutes', 75, 1, 1, true, now()),
       ('ערב מאוחר', date_trunc('day', now()) + interval '2 days 16 hours 30 minutes', 75, 3, 8, false, now()),
       ('רחוק', now() + interval '40 days', 75, 3, 8, false, now());
insert into session_private (session_id, zoom_url)
select id, 'https://zoom.us/j/123' from class_sessions where title = 'רמה 1';
reset role;

-- שיעור שמועד הביטול שלו כבר עבר
update class_sessions set cancel_deadline = now() - interval '1 minute' where title = 'ערב מאוחר';

-- ===== דנה מאושרת =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.ok((select count(*) from get_schedule(now(), now() + interval '60 days')) = 3, 'מתאמנת מאושרת רואה את הלוח');
select t.fails('select book_class((select id from class_sessions where title = ''רמה 1''))', 'health_declaration_required',
               'אי אפשר להירשם בלי הצהרת בריאות');
select t.ok(not has_health_declaration(), 'לפני מילוי: אין הצהרה');
select submit_health_declaration('{"q1": false}', 'דנה כהן');
select t.ok(has_health_declaration(), 'אחרי מילוי: המתאמנת יודעת שמילאה');
select t.ok((select count(*) from health_declarations) = 0, 'מתאמנת לא יכולה לקרוא הצהרות בריאות, גם לא שלה');
select t.fails('select book_class((select id from class_sessions where title = ''רמה 1''))', 'no_entitlement',
               'אי אפשר להירשם בלי כרטיסייה');
select t.fails('select book_class((select id from class_sessions where title = ''רחוק''))', 'too_early',
               'אי אפשר להירשם יותר מחודש מראש');
select t.ok((select count(*) from session_private) = 0, 'קישור זום מוסתר ממי שלא נרשמה לזום');
reset role;

-- ליאור רושמת תשלום במזומן לדנה ולמיכל
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
select admin_record_payment('00000000-0000-0000-0000-0000000000d1', (select id from products where name = 'כרטיסייה 5'), 'cash', 375);
select admin_record_payment('00000000-0000-0000-0000-0000000000a2', (select id from products where name = 'כרטיסייה 5'), 'paybox', 375);
select admin_record_payment('00000000-0000-0000-0000-0000000000d1', (select id from products where name = 'ניסיון'), 'cash', 60);
select t.fails('select admin_record_payment(''00000000-0000-0000-0000-0000000000d1'', (select id from products where name = ''ניסיון''), ''cash'', 60)',
               'product_once_per_user', 'שיעור ניסיון פעם אחת בלבד');
select t.fails('select admin_record_payment(''00000000-0000-0000-0000-0000000000d1'', (select id from products where name = ''ניסיון''), ''grow'', 60)',
               'grow_payments_are_automatic', 'תשלום Grow לא נרשם ידנית');
reset role;

-- ===== דנה נרשמת =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select book_class((select id from class_sessions where title = 'רמה 1'));
select t.ok((select entries_left from entitlements where title = 'ניסיון') = 0, 'ההרשמה השתמשה בכרטיסייה שתוקפה נגמר ראשון');
select t.ok((select status = 'used_up' from entitlements where title = 'ניסיון'), 'כרטיסייה שנגמרה מסומנת כמנוצלת');
select t.fails('select book_class((select id from class_sessions where title = ''רמה 1''))', 'already_booked', 'אין הרשמה כפולה');
select t.fails('select book_class((select id from class_sessions where title = ''רמה 1''), ''zoom'')', 'already_booked', 'אין הרשמה כפולה גם לזום');
select t.ok((select booked_studio from get_schedule(now(), now() + interval '30 days') where title = 'רמה 1') = 1, 'הלוח מציג מספר נרשמות');
reset role;

-- ===== מיכל: השיעור מלא (מקסימום 1) =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select submit_health_declaration('{"q1": false}', 'מיכל לוי');
select t.ok((select status from book_class((select id from class_sessions where title = 'רמה 1'))) = 'waitlist', 'שיעור מלא: נכנסים לרשימת המתנה');
select t.ok((select entries_left from entitlements) = 5, 'רשימת המתנה לא מורידה ניקוב');
select t.ok((select count(*) from bookings) = 1, 'מתאמנת רואה רק את ההרשמות שלה');
reset role;

-- ===== דנה מבטלת בזמן: ניקוב חוזר, מיכל עולה מרשימת ההמתנה =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.ok((select refunded from cancel_booking((select id from bookings where status = 'booked'))), 'ביטול בזמן מחזיר ניקוב');
select t.ok((select entries_left from entitlements where title = 'ניסיון') = 1, 'הניקוב חזר לכרטיסייה');
select t.fails('select cancel_booking((select id from bookings limit 1))', 'cannot_cancel', 'אי אפשר לבטל פעמיים');
reset role;

set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.ok((select status from bookings) = 'booked', 'הראשונה ברשימת ההמתנה עלתה אוטומטית');
select t.ok((select entries_left from entitlements) = 4, 'ומהכרטיסייה שלה ירד ניקוב');
select t.fails('select cancel_booking((select id from bookings b where b.user_id <> auth.uid() limit 1))', 'not_allowed',
               'אי אפשר לבטל הרשמה של מישהי אחרת');
reset role;

-- ===== ביטול מאוחר: לא מחזיר ניקוב =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select book_class((select id from class_sessions where title = 'ערב מאוחר'));
select t.ok((select not refunded and new_status = 'late_cancel'
             from cancel_booking((select id from bookings where status = 'booked'))), 'ביטול מאוחר לא מחזיר ניקוב');

-- ===== זום =====
reset role;
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
select admin_record_payment('00000000-0000-0000-0000-0000000000d1', (select id from products where name = 'זום 4'), 'bit', 140);
reset role;

set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.ok((select status from book_class((select id from class_sessions where title = 'רמה 1'), 'zoom')) = 'booked',
            'הרשמה לזום עם כרטיסיית זום, גם כשהסטודיו מלא');
select t.ok((select entries_left from entitlements where title = 'זום 4') = 3, 'ניקוב ירד מכרטיסיית הזום');
select t.ok((select zoom_url from session_private) = 'https://zoom.us/j/123', 'נרשמת לזום רואה את הקישור');
reset role;

set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.ok((select count(*) from session_private) = 0, 'נרשמת לסטודיו לא רואה את קישור הזום');
reset role;

-- ===== מינימום משתתפים וביטול שיעור =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
update class_sessions set cancel_deadline = now() + interval '2 hours', min_participants = 3, max_participants = 8
where title = 'רמה 1';
select t.ok((select count(*) from sessions_below_minimum(24) where title = 'רמה 1') = 1, 'שיעור עם פחות מ-3 נרשמות מסומן');
select t.ok((select count(*) from health_declarations) = 2, 'מנהלת רואה הצהרות בריאות');
select t.ok(admin_cancel_session((select id from class_sessions where title = 'רמה 1'), 'אין מספיק נרשמות') = 2,
            'ביטול שיעור מבטל את כל ההרשמות');
select t.ok((select entries_left from entitlements where title = 'זום 4') = 4, 'ביטול שיעור מחזיר ניקוב לזום');
select t.ok((select entries_left from entitlements e join profiles p on p.id = e.user_id
             where p.full_name = 'מיכל') = 5, 'ביטול שיעור מחזיר ניקוב לסטודיו');
select t.ok((select count(*) from audit_log where action = 'cancel_session') = 1, 'הביטול נרשם ביומן');
select t.fails('select admin_adjust_entitlement((select id from entitlements limit 1), 2)', 'reason_required',
               'תיקון ידני מחייב סיבה');
reset role;

set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.ok((select count(*) from audit_log) = 0, 'מתאמנת לא רואה את יומן הפעולות');
reset role;

-- ===== יצירת שיעורים מהמערכת השבועית =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.ok(admin_generate_sessions(current_date, current_date + 13) = 12, 'שבועיים של מערכת = 12 שיעורים');
select t.ok(admin_generate_sessions(current_date, current_date + 13) = 0, 'הרצה חוזרת לא יוצרת כפילויות');
select t.ok((select bool_and(to_char(cancel_deadline at time zone 'Asia/Jerusalem', 'HH24:MI') = '20:00')
             from class_sessions where title = 'מתחילים'), 'שיעור מתחילים (בוקר) נסגר לביטול ב-20:00 בערב שלפני');
reset role;
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.fails('select admin_generate_sessions(current_date, current_date + 6)', 'admin_only', 'מתאמנת לא יכולה ליצור שיעורים');
reset role;

-- ===== חדר בקרה =====
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000000a');
select t.ok((admin_dashboard() -> 'kpis' ->> 'active_members')::int = 2, 'חדר בקרה: 2 מתאמנות פעילות');
select t.ok((admin_dashboard() -> 'kpis' ->> 'revenue_month')::numeric = 950, 'חדר בקרה: הכנסות החודש');
select t.ok(jsonb_array_length(admin_dashboard() -> 'revenue_months') = 6, 'חדר בקרה: הכנסות של 6 חודשים');
select t.ok(jsonb_array_length(admin_dashboard() -> 'activity') > 0, 'חדר בקרה: יש פעילות אחרונה');
reset role;
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.fails('select admin_dashboard()', 'admin_only', 'מתאמנת לא רואה את חדר הבקרה');
select t.fails('select * from admin_allowlist', 'permission denied', 'מתאמנת לא רואה את רשימת המנהלות');
select t.fails('select generate_sessions_internal(current_date, current_date)', 'permission denied', 'יצירת שיעורים פנימית חסומה');
reset role;

-- ===== מנהלת אוטומטית בכניסה ראשונה =====
insert into admin_allowlist (email) values ('lior.real@gmail.com');
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'Lior.Real@gmail.com', '{"full_name":"ליאור"}', '{"provider":"email"}', null);
select t.ok((select role = 'trainee' and status = 'pending' from profiles where id = '00000000-0000-0000-0000-0000000000f1'),
            'הרשמה עם סיסמה לכתובת של ליאור לא נותנת הרשאת מנהלת');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f2', 'Lior.Real@gmail.com', '{"full_name":"ליאור"}', '{"provider":"google"}', null);
select t.ok((select role = 'trainee' from profiles where id = '00000000-0000-0000-0000-0000000000f2'), 'לפני אישור אימייל: עדיין לא מנהלת');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
select t.ok((select role = 'admin' and status = 'active' from profiles where id = '00000000-0000-0000-0000-0000000000f2'),
            'כניסה ראשונה עם גוגל: ליאור מנהלת מאושרת');
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f3', 'someone@gmail.com', '{}', '{"provider":"google"}', now());
select t.ok((select role = 'trainee' and status = 'pending' from profiles where id = '00000000-0000-0000-0000-0000000000f3'),
            'כניסה עם גוגל של מישהי אחרת: מתאמנת ממתינה');

\echo 'כל הבדיקות עברו'
