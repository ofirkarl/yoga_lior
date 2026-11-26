-- גיבוי שבועי לגוגל דרייב של ליאור.
--
-- סקריפט קטן ב-Google Apps Script, שרץ בחשבון של ליאור, פונה פעם בשבוע לפונקציה
-- backup-export עם מפתח גיבוי, ושומר את הקובץ בתיקייה בדרייב שלה.
-- כך הגיבוי נשמר אצלה, בלי שהאפליקציה תצטרך גישה לדרייב.
--
-- המפתח שמור ב-Vault. רק מנהלת פעילה יכולה לראות אותו (כדי להעתיק לסקריפט) או להחליף אותו.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'backup_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'backup_token', 'מפתח לגיבוי השבועי (Apps Script)');
  end if;
end $$;

-- לשימוש הפונקציה בשרת בלבד
create function get_backup_token() returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'backup_token';
$$;

create function admin_get_backup_token() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  insert into audit_log (actor, action) values (auth.uid(), 'backup_token_viewed');
  return (select decrypted_secret from vault.decrypted_secrets where name = 'backup_token');
end;
$$;

-- החלפת מפתח: הסקריפט הישן מפסיק לעבוד מיד
create function admin_rotate_backup_token() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_new text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  perform vault.update_secret((select id from vault.secrets where name = 'backup_token'), v_new);
  insert into audit_log (actor, action) values (auth.uid(), 'backup_token_rotated');
  return v_new;
end;
$$;

create function admin_backup_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin_only'; end if;
  return jsonb_build_object(
    'last_at', (select max(created_at) from audit_log where action = 'backup_export'),
    'count_30d', (select count(*) from audit_log where action = 'backup_export' and created_at > now() - interval '30 days')
  );
end;
$$;

revoke execute on function get_backup_token(), admin_get_backup_token(), admin_rotate_backup_token(), admin_backup_status()
  from public, anon, authenticated;
grant execute on function admin_get_backup_token(), admin_rotate_backup_token(), admin_backup_status() to authenticated;
grant execute on function get_backup_token() to service_role;
