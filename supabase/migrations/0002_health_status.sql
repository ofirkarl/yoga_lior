-- המתאמנת לא יכולה לקרוא את ההצהרה שלה, אבל צריכה לדעת אם כבר מילאה אותה
create function has_health_declaration() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from health_declarations where user_id = auth.uid());
$$;
revoke execute on function has_health_declaration() from public, anon;
grant execute on function has_health_declaration() to authenticated;
