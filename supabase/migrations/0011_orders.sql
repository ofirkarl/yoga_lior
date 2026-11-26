-- =====================================================================
-- רכישה מתוך האפליקציה, מוכנה לחיבור ל-Grow
--
-- מתאמן בוחר מוצר ← נפתחת הזמנה "ממתינה לתשלום".
--   * היום: ליאור מקבלת התראה, גובה (ביט, פייבוקס, מזומן…) ומאשרת בלחיצה.
--   * אחרי החיבור ל-Grow: ההזמנה תקבל קישור לדף תשלום, ואישור התשלום
--     מ-Grow (webhook) יסגור אותה ויפתח את הכרטיסייה לבד.
-- בכל מקרה, הכרטיסייה נפתחת רק כשתשלום נרשם, אף פעם לא בהזמנה עצמה.
-- =====================================================================

create type order_status as enum ('pending', 'paid', 'cancelled');

create table orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid           not null references profiles (id) on delete restrict,
  product_id     uuid           not null references products (id),
  title          text           not null,
  amount_ils     numeric(10, 2) not null check (amount_ils >= 0),
  status         order_status   not null default 'pending',
  payment_url    text           check (payment_url is null or payment_url ~ '^https://'),
  provider_ref   text           unique,
  payment_id     uuid           references payments (id),
  entitlement_id uuid           references entitlements (id),
  created_at     timestamptz    not null default now(),
  paid_at        timestamptz,
  cancelled_at   timestamptz
);
create index on orders (user_id, created_at desc);
create index on orders (status) where status = 'pending';

alter table orders enable row level security;
create policy orders_read on orders for select to authenticated using (user_id = auth.uid() or is_admin());
revoke all on orders from anon, authenticated;
grant select on orders to authenticated;

-- טלפון הסטודיו לוואטסאפ, לתיאום תשלום כל עוד אין סליקה מחוברת
alter table settings add column contact_phone text check (contact_phone is null or contact_phone ~ '^\+?[0-9]{9,15}$');

-- ---------------------------------------------------------------------
-- הקטלוג למתאמן: המוצרים הפעילים, ומה זמין לו
-- ---------------------------------------------------------------------
create function shop_products()
returns table (id uuid, name text, kind product_kind, mode attend_mode, price_ils numeric, entries int,
               validity_days int, available boolean, pending_order uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.kind, p.mode, p.price_ils, p.entries, p.validity_days,
         not (p.once_per_user and exists (select 1 from entitlements e where e.user_id = auth.uid() and e.product_id = p.id)),
         (select o.id from orders o where o.user_id = auth.uid() and o.product_id = p.id and o.status = 'pending'
          order by o.created_at desc limit 1)
  from products p
  where p.active and is_active_member()
  order by p.sort_order, p.price_ils;
$$;

-- ---------------------------------------------------------------------
-- פתיחת הזמנה וביטולה
-- ---------------------------------------------------------------------
create function create_order(p_product uuid) returns orders
language plpgsql security definer set search_path = public as $$
declare
  v_p products;
  v_o orders;
begin
  if auth.uid() is null or not is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_p from products where id = p_product and active;
  if not found then raise exception 'product_unavailable'; end if;
  if v_p.once_per_user and exists (select 1 from entitlements where user_id = auth.uid() and product_id = p_product) then
    raise exception 'once_per_user';
  end if;
  -- הזמנה פתוחה לאותו מוצר: מחזירים אותה במקום לפתוח עוד אחת
  select * into v_o from orders where user_id = auth.uid() and product_id = p_product and status = 'pending'
  order by created_at desc limit 1;
  if found then return v_o; end if;
  if (select count(*) from orders where user_id = auth.uid() and status = 'pending') >= 3 then
    raise exception 'too_many_pending_orders';
  end if;

  insert into orders (user_id, product_id, title, amount_ils)
  values (auth.uid(), p_product, v_p.name, v_p.price_ils)
  returning * into v_o;
  return v_o;
end;
$$;

create function cancel_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'cancelled', cancelled_at = now()
  where id = p_order and status = 'pending' and (user_id = auth.uid() or is_admin());
  if not found then raise exception 'order_not_pending'; end if;
  if is_admin() then perform log_action('cancel_order', p_order, '{}'); end if;
end;
$$;

-- ---------------------------------------------------------------------
-- סגירת הזמנה כששולמה. פנימי: נקרא מהאישור הידני, ובעתיד מ-Grow.
-- ---------------------------------------------------------------------
create function complete_order_internal(p_order uuid, p_method payment_method, p_recorded_by uuid,
                                        p_grow_txn text default null, p_grow_asmachta text default null)
returns orders
language plpgsql security definer set search_path = public as $$
declare
  v_o   orders;
  v_pay uuid;
  v_e   entitlements;
begin
  select * into v_o from orders where id = p_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_o.status = 'paid' then return v_o; end if;  -- אישור כפול מ-Grow לא פותח כרטיסייה פעמיים
  if v_o.status <> 'pending' then raise exception 'order_not_pending'; end if;

  insert into payments (user_id, product_id, amount_ils, method, grow_transaction_id, grow_asmachta, note, recorded_by)
  values (v_o.user_id, v_o.product_id, v_o.amount_ils, p_method, p_grow_txn, p_grow_asmachta, 'הזמנה מהאפליקציה', p_recorded_by)
  returning id into v_pay;
  v_e := grant_product(v_o.user_id, v_o.product_id, v_pay, (now() at time zone (select timezone from settings))::date);

  update orders set status = 'paid', paid_at = now(), payment_id = v_pay, entitlement_id = v_e.id
  where id = p_order returning * into v_o;
  return v_o;
end;
$$;

create function admin_confirm_order(p_order uuid, p_method payment_method) returns orders
language plpgsql security definer set search_path = public as $$
declare
  v_o orders;
begin
  perform require_admin();
  if p_method = 'grow' then raise exception 'grow_payments_are_automatic'; end if;
  v_o := complete_order_internal(p_order, p_method, auth.uid());
  perform log_action('confirm_order', p_order, jsonb_build_object('method', p_method, 'amount', v_o.amount_ils));
  return v_o;
end;
$$;

create function admin_pending_orders()
returns table (id uuid, user_id uuid, full_name text, phone text, title text, amount_ils numeric, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return query
    select o.id, o.user_id, p.full_name, p.phone, o.title, o.amount_ils, o.created_at
    from orders o join profiles p on p.id = o.user_id
    where o.status = 'pending'
    order by o.created_at;
end;
$$;

-- התראה לליאור על כל הזמנה חדשה
create function orders_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_admins_internal('new_order', jsonb_build_object('order_id', new.id));
  return new;
end;
$$;
create trigger orders_notify after insert on orders for each row execute function orders_notify();

revoke execute on function shop_products(), create_order(uuid), cancel_order(uuid),
  complete_order_internal(uuid, payment_method, uuid, text, text), admin_confirm_order(uuid, payment_method),
  admin_pending_orders(), orders_notify()
  from public, anon, authenticated;
grant execute on function shop_products(), create_order(uuid), cancel_order(uuid),
  admin_confirm_order(uuid, payment_method), admin_pending_orders() to authenticated;
grant execute on function complete_order_internal(uuid, payment_method, uuid, text, text) to service_role;
