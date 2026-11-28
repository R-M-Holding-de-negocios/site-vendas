-- 0006: o servidor confere o plano e a forma de pagamento, não só a tela.
-- Antes, chamando a API direto, dava para: usar cupom de loja fora do Pro (check_coupon),
-- gravar carrinho abandonado e contatos em loja sem o recurso, e criar pedido sem forma de pagamento.

-- can() passa a conhecer os recursos usados abaixo (mesmos níveis de src/lib/plans.ts).
create or replace function private.can(p_plan text, p_feature text) returns boolean
language sql immutable as $$
  select array_position(array['vitrine', 'loja', 'pro'], p_plan)
    >= array_position(array['vitrine', 'loja', 'pro'],
      case p_feature
        when 'saved_orders' then 'loja'
        when 'checkout' then 'loja'
        when 'free_shipping_bar' then 'loja'
        when 'stock_alert' then 'loja'
        when 'coupons' then 'pro'
        when 'qty_discount' then 'pro'
        when 'abandoned_carts' then 'pro'
        when 'lead_popup' then 'pro'
        else 'vitrine'
      end)
$$;

-- Loja no ar e com o recurso no plano.
create or replace function private.store_can(p_store_id uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.stores s
    where s.id = p_store_id and private.store_is_public(s.id) and private.can(s.plan, p_feature))
$$;
revoke all on function private.store_can(uuid, text) from public;
grant execute on function private.store_can(uuid, text) to anon, authenticated;

create or replace function public.check_coupon(a jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(c) from public.coupons c
  where c.store_id::text = a ->> 'store_id' and c.code = upper(private.js_trim(a ->> 'code')) and c.active
    and private.store_can(c.store_id, 'coupons')
  limit 1
$$;

create or replace function public.save_checkout(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if (a ->> 'store_id') is null or not private.store_can((a ->> 'store_id')::uuid, 'abandoned_carts') then
    raise exception 'Recurso indisponível nesta loja.';
  end if;
  if coalesce(a ->> 'id', '') <> '' then
    update public.checkouts set
      customer = coalesce(a -> 'customer', '{}'::jsonb),
      items = coalesce(a -> 'items', '[]'::jsonb),
      total_cents = coalesce(private.num(a -> 'total_cents'), 0)::int,
      updated_at = now()
    where id::text = a ->> 'id' and store_id::text = a ->> 'store_id' and order_id is null
    returning id into v_id;
    if v_id is not null then return jsonb_build_object('id', v_id); end if;
  end if;
  insert into public.checkouts (store_id, session_id, customer, items, total_cents, order_id, contacted_at, updated_at)
  values ((a ->> 'store_id')::uuid, coalesce(a ->> 'session_id', ''), coalesce(a -> 'customer', '{}'::jsonb),
          coalesce(a -> 'items', '[]'::jsonb), coalesce(private.num(a -> 'total_cents'), 0)::int, null, null, now())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Contatos e avisos de "chegou" só em loja com o recurso.
drop policy if exists leads_public_insert on public.leads;
create policy leads_public_insert on public.leads for insert to anon, authenticated
  with check (private.store_can(store_id, 'lead_popup'));
drop policy if exists stock_alerts_public_insert on public.stock_alerts;
create policy stock_alerts_public_insert on public.stock_alerts for insert to anon, authenticated
  with check (private.store_can(store_id, 'stock_alert') and notified = false);

-- Todo pedido precisa de uma forma de pagamento válida (place_order só validava quando vinha uma).
create or replace function private.require_payment_method() returns trigger
language plpgsql as $$
begin
  if coalesce(new.payment ->> 'method', '') not in ('pix', 'mercadopago', 'cash', 'card_on_delivery', 'whatsapp') then
    raise exception 'Escolha a forma de pagamento.';
  end if;
  return new;
end $$;
drop trigger if exists orders_require_payment on public.orders;
create trigger orders_require_payment before insert on public.orders
  for each row execute function private.require_payment_method();
