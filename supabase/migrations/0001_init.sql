-- Vitrine: esquema do banco, regras de segurança e funções do servidor.
--
-- Rode este arquivo inteiro, de cima para baixo, no SQL Editor de um projeto
-- Supabase novo. Ele segue o contrato de src/lib/types.ts e src/lib/db.ts e
-- repete as regras do modo demonstração (src/lib/demo-rpc.ts e src/lib/pricing.ts).
-- Os testes em tests/sql conferem as duas implementações.

-- =====================================================================
-- Schema interno (não exposto pela API)
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- =====================================================================
-- Tabelas
-- =====================================================================

create table public.plans (
  id text primary key check (id in ('vitrine', 'loja', 'pro')),
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  fee_percent numeric not null default 0 check (fee_percent >= 0 and fee_percent <= 100)
);

insert into public.plans (id, name, price_cents, fee_percent) values
  ('vitrine', 'Vitrine', 3900, 0),
  ('loja', 'Loja', 4900, 2),
  ('pro', 'Pro', 9900, 1);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  slug text not null unique,
  name text not null default '',
  whatsapp text not null default '',
  description text not null default '',
  logo_url text not null default '',
  plan text not null default 'pro' references public.plans (id),
  status text not null default 'trial' check (status in ('trial', 'active', 'overdue', 'suspended', 'closed')),
  trial_ends_at timestamptz,
  paid_until timestamptz,
  settings jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  theme_draft jsonb,
  theme_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- Igual a validSlug() em src/lib/demo-rpc.ts
  constraint stores_slug_valid check (
    slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'
    and slug not in ('entrar', 'painel', 'admin', 'api', 'loja', 'lojas', 'planos', 'ajuda', 'demo', 'assets', 'static')
  )
);

create table public.store_admin_notes (
  store_id uuid primary key references public.stores (id) on delete cascade,
  notes text not null default ''
);

create table public.store_secrets (
  store_id uuid not null references public.stores (id) on delete cascade,
  provider text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (store_id, provider)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid,
  admin_email text not null default '',
  store_id uuid, -- sem chave estrangeira: o histórico continua depois que a loja é apagada
  action text not null,
  created_at timestamptz not null default now()
);
create index audit_log_store_idx on public.audit_log (store_id, created_at desc);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null default '',
  position integer not null default 0,
  image_url text not null default '',
  seo jsonb not null default '{"title": "", "description": ""}'::jsonb
);
create index categories_store_idx on public.categories (store_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null default '',
  description text not null default '',
  price_cents integer not null default 0 check (price_cents >= 0),
  promo_price_cents integer check (promo_price_cents >= 0),
  promo_ends_at timestamptz,
  images text[] not null default '{}',
  category_ids text[] not null default '{}',
  available boolean not null default true,
  featured boolean not null default false,
  position integer not null default 0,
  cost_cents integer,
  sku text not null default '',
  track_stock boolean not null default false,
  stock integer not null default 0,
  weight_g integer not null default 0,
  height_cm integer not null default 0,
  width_cm integer not null default 0,
  length_cm integer not null default 0,
  options jsonb not null default '[]'::jsonb,
  qty_discounts jsonb not null default '[]'::jsonb,
  video_url text not null default '',
  seo jsonb not null default '{"title": "", "description": ""}'::jsonb,
  blocked boolean not null default false,
  sold_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index products_store_idx on public.products (store_id);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  values jsonb not null default '{}'::jsonb,
  price_cents integer check (price_cents >= 0),
  stock integer not null default 0,
  sku text not null default '',
  image text not null default '',
  available boolean not null default true
);
create index variants_product_idx on public.variants (product_id);
create index variants_store_idx on public.variants (store_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  tags text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index customers_store_phone_idx on public.customers (store_id, phone);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  number integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled', 'refunded')),
  token text not null,
  customer_id uuid references public.customers (id) on delete set null,
  customer jsonb not null default '{}'::jsonb,
  shipping jsonb not null default '{}'::jsonb,
  payment jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  shipping_cents integer not null default 0,
  total_cents integer not null default 0,
  platform_fee_cents integer not null default 0,
  coupon_code text not null default '',
  notes text not null default '',
  internal_notes text not null default '',
  tracking_code text not null default '',
  source jsonb,
  history jsonb not null default '[]'::jsonb,
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (store_id, number)
);
create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_pending_idx on public.orders (created_at) where status = 'pending';

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  code text not null,
  type text not null default 'percent' check (type in ('percent', 'fixed', 'free_shipping')),
  value integer not null default 0 check (value >= 0),
  min_order_cents integer not null default 0,
  max_uses integer,
  uses integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, code)
);

create table public.contents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  kind text not null default 'page' check (kind in ('page', 'post')),
  slug text not null default '',
  title text not null default '',
  body text not null default '',
  cover_url text not null default '',
  product_ids text[] not null default '{}',
  show_in_menu boolean not null default false,
  position integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published')),
  publish_at timestamptz not null default now(),
  seo jsonb not null default '{"title": "", "description": ""}'::jsonb,
  created_at timestamptz not null default now()
);
create index contents_store_idx on public.contents (store_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  session_id text not null default '',
  type text not null check (type in ('visit', 'product_view', 'add_to_cart', 'remove_from_cart', 'search', 'checkout_start', 'order_placed', 'content_view')),
  product_id uuid references public.products (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_store_created_idx on public.events (store_id, created_at desc);

create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  session_id text not null default '',
  customer jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  total_cents integer not null default 0,
  order_id uuid references public.orders (id) on delete set null,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checkouts_store_idx on public.checkouts (store_id, updated_at desc);

create table public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.variants (id) on delete set null,
  contact text not null check (length(contact) between 1 and 120),
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index stock_alerts_store_idx on public.stock_alerts (store_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  contact text not null check (length(contact) between 1 and 120),
  created_at timestamptz not null default now()
);
create index leads_store_idx on public.leads (store_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  name text not null default '',
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);
create index reviews_product_idx on public.reviews (product_id);
create index reviews_store_idx on public.reviews (store_id);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);
create index media_store_idx on public.media (store_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  plan text not null references public.plans (id),
  amount_cents integer not null default 0,
  months integer not null default 1,
  method text not null default '',
  note text not null default '',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index invoices_store_idx on public.invoices (store_id);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Funções auxiliares
-- =====================================================================

-- Admin da plataforma: está em platform_admins E entrou com verificação em duas etapas.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- A loja pertence a quem está logado.
create function private.owns_store(p_store uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.stores where id = p_store and owner_id = auth.uid())
$$;

-- A loja existe e está no ar (pode receber visitas, contatos e avisos).
create function private.store_is_public(p_store uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.stores where id = p_store and status not in ('suspended', 'closed'))
$$;

-- String.prototype.trim() do JavaScript.
create function private.js_trim(s text) returns text
language sql immutable as $$
  select regexp_replace(coalesce(s, ''), '^[\s ﻿  -     　]+|[\s ﻿  -     　]+$', '', 'g')
$$;

create function private.only_digits(s text) returns text
language sql immutable as $$
  select regexp_replace(coalesce(s, ''), '\D', '', 'g')
$$;

-- new Date().toISOString()
create function private.iso(t timestamptz) returns text
language sql immutable as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- brl() de src/lib/util.ts: "R$ 1.234,56" (com espaço não separável, como o Intl).
create function private.brl(cents bigint) returns text
language sql immutable as $$
  select case when cents < 0 then '-' else '' end || 'R$' || chr(160)
    || regexp_replace((abs(cents) / 100)::text, '(\d)(?=(\d{3})+$)', '\1.', 'g')
    || ',' || lpad((abs(cents) % 100)::text, 2, '0')
$$;

-- Número JSON (ou texto numérico) -> numeric; qualquer outra coisa -> null.
create function private.num(j jsonb) returns numeric
language sql immutable as $$
  select case
    when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric
    when jsonb_typeof(j) = 'string' and btrim(j #>> '{}') ~ '^-?\d+(\.\d+)?$' then btrim(j #>> '{}')::numeric
    else null
  end
$$;

-- Valor "verdadeiro" no sentido do JavaScript para os campos booleanos/texto das configurações.
create function private.truthy(j jsonb) returns boolean
language sql immutable as $$
  select case jsonb_typeof(j)
    when 'boolean' then (j #>> '{}')::boolean
    when 'string' then (j #>> '{}') <> ''
    when 'number' then (j #>> '{}')::numeric <> 0
    when 'object' then true
    when 'array' then true
    else false
  end
$$;

-- can() de src/lib/plans.ts, só para os recursos que importam no servidor.
create function private.can(p_plan text, p_feature text) returns boolean
language sql immutable as $$
  select array_position(array['vitrine', 'loja', 'pro'], p_plan)
    >= array_position(array['vitrine', 'loja', 'pro'],
      case p_feature
        when 'saved_orders' then 'loja'
        when 'checkout' then 'loja'
        when 'free_shipping_bar' then 'loja'
        when 'coupons' then 'pro'
        when 'qty_discount' then 'pro'
        else 'vitrine'
      end)
$$;

-- openState() de src/lib/hours.ts (horário de Brasília).
create function private.open_state(p_hours jsonb, p_now timestamptz default now()) returns jsonb
language plpgsql stable as $$
declare
  v_local timestamp := p_now at time zone 'America/Sao_Paulo';
  v_day int := extract(dow from v_local)::int;
  v_time text := to_char(v_local, 'HH24:MI');
  v_today jsonb;
  v_h jsonb;
  v_d int;
  v_when text;
  v_names text[] := array['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
begin
  if private.truthy(p_hours -> 'paused') then
    return jsonb_build_object('open', false, 'message', 'A loja está pausada no momento.');
  end if;
  if not private.truthy(p_hours -> 'enabled') then
    return jsonb_build_object('open', true, 'message', '');
  end if;
  v_today := p_hours -> 'days' -> v_day;
  if private.truthy(v_today -> 'open')
     and v_time collate "C" >= (v_today ->> 'from') collate "C"
     and v_time collate "C" < (v_today ->> 'to') collate "C" then
    return jsonb_build_object('open', true, 'message', '');
  end if;
  for i in 0..6 loop
    v_d := (v_day + i) % 7;
    v_h := p_hours -> 'days' -> v_d;
    continue when not private.truthy(v_h -> 'open');
    continue when i = 0 and v_time collate "C" >= (v_h ->> 'from') collate "C";
    v_when := case i when 0 then 'hoje' when 1 then 'amanhã' else v_names[v_d + 1] end;
    return jsonb_build_object('open', false, 'message', format('Estamos fechados agora. Abrimos %s às %s.', v_when, v_h ->> 'from'));
  end loop;
  return jsonb_build_object('open', false, 'message', 'Estamos fechados agora.');
end $$;

-- shippingOptions() de src/lib/pricing.ts
create function private.shipping_options(p_plan text, p_settings jsonb) returns jsonb
language plpgsql immutable as $$
declare
  d jsonb := p_settings -> 'delivery';
  out jsonb := '[]'::jsonb;
begin
  if not private.can(p_plan, 'checkout') then return out; end if;
  if private.truthy(d #> '{pickup,enabled}') then
    out := out || jsonb_build_object('method', 'pickup', 'label', 'Retirar na loja');
  end if;
  if private.truthy(d #> '{zones,enabled}') and jsonb_typeof(d #> '{zones,items}') = 'array'
     and jsonb_array_length(d #> '{zones,items}') > 0 then
    out := out || jsonb_build_object('method', 'zone', 'label', 'Entrega no meu bairro', 'zones', d #> '{zones,items}');
  end if;
  if private.truthy(d #> '{fixed,enabled}') then
    out := out || jsonb_build_object('method', 'fixed',
      'label', coalesce(nullif(d #>> '{fixed,label}', ''), 'Entrega'),
      'fee_cents', coalesce(private.num(d #> '{fixed,fee_cents}'), 0));
  end if;
  if private.truthy(d #> '{arrange,enabled}') then
    out := out || jsonb_build_object('method', 'arrange', 'label', 'Combinar a entrega pelo WhatsApp');
  end if;
  return out;
end $$;

-- paymentOptions() de src/lib/pricing.ts. Mercado Pago só vale se a loja conectou a conta (p_mp_connected).
create function private.payment_options(p_plan text, p_settings jsonb, p_mp_connected boolean) returns text[]
language plpgsql immutable as $$
declare
  p jsonb := p_settings -> 'payments';
  out text[] := '{}';
begin
  if not private.can(p_plan, 'checkout') then return array['whatsapp']; end if;
  if private.truthy(p #> '{pix,enabled}') and private.truthy(p #> '{pix,key}') then out := out || 'pix'::text; end if;
  if private.truthy(p #> '{mercadopago,enabled}') and p_mp_connected then out := out || 'mercadopago'::text; end if;
  if private.truthy(p #> '{cash,enabled}') then out := out || 'cash'::text; end if;
  if private.truthy(p #> '{card_on_delivery,enabled}') then out := out || 'card_on_delivery'::text; end if;
  if private.truthy(p #> '{whatsapp,enabled}') or cardinality(out) = 0 then out := out || 'whatsapp'::text; end if;
  return out;
end $$;

-- couponProblem() de src/lib/pricing.ts
create function private.coupon_problem(c jsonb, p_subtotal bigint, p_now timestamptz) returns text
language plpgsql stable as $$
begin
  if c is null or jsonb_typeof(c) <> 'object' or not private.truthy(c -> 'active') then return 'Cupom inválido.'; end if;
  if (c ->> 'starts_at') is not null and (c ->> 'starts_at')::timestamptz > p_now then return 'Este cupom ainda não está valendo.'; end if;
  if (c ->> 'ends_at') is not null and (c ->> 'ends_at')::timestamptz <= p_now then return 'Este cupom expirou.'; end if;
  if (c ->> 'max_uses') is not null and (c ->> 'uses')::numeric >= (c ->> 'max_uses')::numeric then
    return 'Este cupom já foi usado o máximo de vezes.';
  end if;
  if p_subtotal < coalesce((c ->> 'min_order_cents')::numeric, 0) then
    return format('Este cupom vale para compras a partir de %s.', private.brl((c ->> 'min_order_cents')::bigint));
  end if;
  return '';
end $$;

-- variantLabel(): Object.values(v.values).join(' / '). A ordem é a das chaves do jsonb,
-- a mesma que o navegador vê ao ler a variação do banco.
create function private.variant_label(v jsonb) returns text
language sql immutable as $$
  select case when v is null then '' else (
    select coalesce(string_agg(k.value, ' / ' order by k.ord), '')
    from jsonb_each_text(coalesce(v -> 'values', '{}')) with ordinality as k (key, value, ord)
  ) end
$$;

-- quote() de src/lib/pricing.ts. Recebe as linhas do banco em jsonb e devolve o mesmo formato de Quote.
create function private.quote(
  p_plan text,
  p_settings jsonb,
  p_lines jsonb,
  p_products jsonb,
  p_variants jsonb,
  p_shipping jsonb,
  p_payment text,
  p_coupon jsonb,
  p_fee_percent numeric,
  p_now timestamptz,
  p_mp_connected boolean
) returns jsonb
language plpgsql stable as $$
declare
  v_errors text[] := '{}';
  v_items jsonb := '[]'::jsonb;
  v_pro boolean := private.can(p_plan, 'qty_discount');
  v_used jsonb := '{}'::jsonb;
  v_line jsonb;
  p jsonb;
  v jsonb;
  v_key text;
  v_qty numeric;
  v_stock numeric;
  v_base numeric;
  v_off numeric;
  v_unit bigint;
  v_subtotal bigint := 0;
  v_coupon_discount bigint := 0;
  v_coupon_free boolean := false;
  v_coupon_error text := '';
  v_after bigint;
  v_shipping bigint := 0;
  v_label text := '';
  v_threshold bigint;
  v_reached boolean;
  v_opt jsonb;
  v_zone jsonb;
  v_paid_delivery boolean;
  v_free boolean;
  v_pix bigint := 0;
  v_total bigint;
  v_min bigint := coalesce(private.num(p_settings -> 'min_order_cents'), 0);
  v_method text := p_shipping ->> 'method';
begin
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    p := (select x from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) x where x ->> 'id' = v_line ->> 'product_id' limit 1);
    if p is null or not private.truthy(p -> 'available') or private.truthy(p -> 'blocked') then
      v_errors := v_errors || format('%s não está mais disponível.', coalesce(p ->> 'name', 'Um produto'));
      continue;
    end if;
    v := null;
    if coalesce(v_line ->> 'variant_id', '') <> '' then
      v := (select x from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) x
            where x ->> 'id' = v_line ->> 'variant_id' and x ->> 'product_id' = p ->> 'id' limit 1);
    end if;
    if jsonb_array_length(coalesce(p -> 'options', '[]')) > 0 and v is null then
      v_errors := v_errors || format('Escolha as opções de %s.', p ->> 'name');
      continue;
    end if;
    if v is not null and not private.truthy(v -> 'available') then
      v_errors := v_errors || format('%s (%s) não está mais disponível.', p ->> 'name', private.variant_label(v));
      continue;
    end if;
    v_qty := floor(private.num(v_line -> 'qty'));
    if v_qty is null or v_qty < 1 then
      v_errors := v_errors || format('Quantidade inválida para %s.', p ->> 'name');
      continue;
    end if;
    -- Estoque disponível, descontando o que outras linhas do mesmo carrinho já pegaram.
    v_key := (p ->> 'id') || ':' || coalesce(v ->> 'id', '');
    if private.truthy(p -> 'track_stock') then
      v_stock := (case when v is not null then v ->> 'stock' else p ->> 'stock' end)::numeric
        - coalesce((v_used ->> v_key)::numeric, 0);
      if v_qty > v_stock then
        v_errors := v_errors || case when v_stock <= 0 then format('%s esgotou.', p ->> 'name')
          else format('Só restam %s unidades de %s.', v_stock, p ->> 'name') end;
        continue;
      end if;
    end if;
    v_used := v_used || jsonb_build_object(v_key, coalesce((v_used ->> v_key)::numeric, 0) + v_qty);

    if v is not null and (v ->> 'price_cents') is not null then
      v_base := (v ->> 'price_cents')::numeric;
    elsif (p ->> 'promo_price_cents') is not null
          and ((p ->> 'promo_ends_at') is null or (p ->> 'promo_ends_at')::timestamptz > p_now) then
      v_base := (p ->> 'promo_price_cents')::numeric;
    else
      v_base := (p ->> 'price_cents')::numeric;
    end if;
    v_off := 0;
    if v_pro then
      select coalesce(max(private.num(t -> 'percent')), 0) into v_off
      from jsonb_array_elements(coalesce(p -> 'qty_discounts', '[]')) t
      where v_qty >= private.num(t -> 'min_qty') and private.num(t -> 'percent') > 0;
    end if;
    v_unit := (v_base - floor(v_base * v_off / 100))::bigint;
    v_items := v_items || jsonb_build_object(
      'product_id', p ->> 'id',
      'variant_id', v ->> 'id',
      'name', p ->> 'name',
      'variant_label', private.variant_label(v),
      'list_price_cents', coalesce((v ->> 'price_cents')::bigint, (p ->> 'price_cents')::bigint),
      'unit_price_cents', v_unit,
      'cost_cents', (p ->> 'cost_cents')::bigint,
      'qty', v_qty::bigint,
      'image', coalesce(nullif(v ->> 'image', ''), nullif(p -> 'images' ->> 0, ''), '')
    );
    v_subtotal := v_subtotal + v_unit * v_qty::bigint;
  end loop;

  -- Cupom
  if p_coupon is not null and jsonb_typeof(p_coupon) = 'object' and private.can(p_plan, 'coupons') then
    v_coupon_error := private.coupon_problem(p_coupon, v_subtotal, p_now);
    if v_coupon_error = '' then
      if p_coupon ->> 'type' = 'percent' then
        v_coupon_discount := floor(v_subtotal * least((p_coupon ->> 'value')::numeric, 100) / 100)::bigint;
      elsif p_coupon ->> 'type' = 'fixed' then
        v_coupon_discount := least((p_coupon ->> 'value')::bigint, v_subtotal);
      else
        v_coupon_free := true;
      end if;
    end if;
  end if;
  v_after := v_subtotal - v_coupon_discount;

  -- Entrega
  v_threshold := case when private.can(p_plan, 'free_shipping_bar')
    then coalesce(private.num(p_settings -> 'free_shipping_above_cents'), 0)::bigint else 0 end;
  v_reached := v_threshold > 0 and v_after >= v_threshold;
  if p_shipping is not null and jsonb_typeof(p_shipping) = 'object' then
    v_opt := (select o from jsonb_array_elements(private.shipping_options(p_plan, p_settings)) o
              where o ->> 'method' = v_method limit 1);
    if v_opt is null then
      v_errors := v_errors || 'Forma de entrega indisponível.'::text;
    elsif v_opt ->> 'method' = 'zone' then
      v_zone := (select z from jsonb_array_elements(v_opt -> 'zones') z where z ->> 'name' = p_shipping ->> 'zone' limit 1);
      if v_zone is null then
        v_errors := v_errors || 'Escolha o bairro de entrega.'::text;
      else
        v_shipping := coalesce(private.num(v_zone -> 'fee_cents'), 0)::bigint;
        v_label := 'Entrega em ' || (v_zone ->> 'name');
      end if;
    elsif v_opt ->> 'method' = 'fixed' then
      v_shipping := coalesce(private.num(v_opt -> 'fee_cents'), 0)::bigint;
      v_label := v_opt ->> 'label';
    else
      v_label := v_opt ->> 'label';
    end if;
  end if;
  v_paid_delivery := coalesce(v_method in ('zone', 'fixed'), false);
  v_free := v_paid_delivery and (v_coupon_free or v_reached);
  if v_free then v_shipping := 0; end if;

  -- Pagamento
  if p_payment is not null then
    if not (p_payment = any (private.payment_options(p_plan, p_settings, p_mp_connected))) then
      v_errors := v_errors || 'Forma de pagamento indisponível.'::text;
    elsif p_payment = 'pix' then
      v_pix := floor(v_after * coalesce(private.num(p_settings #> '{payments,pix,discount_percent}'), 0) / 100)::bigint;
    end if;
  end if;

  if jsonb_array_length(v_items) > 0 and v_subtotal < v_min then
    v_errors := v_errors || format('O pedido mínimo é de %s.', private.brl(v_min));
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    v_errors := v_errors || 'O carrinho está vazio.'::text;
  end if;

  v_total := greatest(0, v_after - v_pix + v_shipping);
  return jsonb_build_object(
    'items', v_items,
    'subtotal_cents', v_subtotal,
    'coupon_discount_cents', v_coupon_discount,
    'pix_discount_cents', v_pix,
    'discount_cents', v_coupon_discount + v_pix,
    'shipping_cents', v_shipping,
    'shipping_label', v_label,
    'total_cents', v_total,
    'platform_fee_cents', case when p_payment = 'mercadopago' then round(v_total * p_fee_percent / 100)::bigint else 0 end,
    'free_shipping', v_free,
    'free_shipping_missing_cents', case when v_threshold > 0 and not v_reached then v_threshold - v_after else 0 end,
    'coupon_error', v_coupon_error,
    'errors', to_jsonb(v_errors)
  );
end $$;

-- "Entre na sua conta." / "Você não tem permissão para fazer isso." como ownStore() do modo demonstração.
create function private.assert_owner(p_store uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if not exists (select 1 from public.stores where id = p_store and (owner_id = auth.uid() or public.is_admin())) then
    raise exception 'Você não tem permissão para fazer isso.';
  end if;
end $$;

create function private.assert_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito ao admin.'; end if;
end $$;

create function private.audit(p_store uuid, p_action text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (admin_id, admin_email, store_id, action)
  values (
    auth.uid(),
    coalesce((select email from auth.users where id = auth.uid()), auth.jwt() ->> 'email', ''),
    p_store,
    p_action
  );
end $$;

-- Devolve ao estoque os itens de um pedido cancelado ou estornado.
create function private.restock(p_store uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare it jsonb;
begin
  for it in select value from jsonb_array_elements(coalesce(p_items, '[]')) loop
    continue when not exists (
      select 1 from public.products where id::text = it ->> 'product_id' and store_id = p_store and track_stock);
    if coalesce(it ->> 'variant_id', '') <> '' then
      update public.variants set stock = stock + (it ->> 'qty')::int
      where id::text = it ->> 'variant_id' and store_id = p_store;
    else
      update public.products set stock = stock + (it ->> 'qty')::int
      where id::text = it ->> 'product_id' and store_id = p_store;
    end if;
  end loop;
end $$;

-- Texto aleatório do link de acompanhamento (mesmo alfabeto de randomToken()).
create function private.random_token(len int default 24) returns text
language plpgsql volatile as $$
declare
  alphabet text := 'abcdefghijkmnpqrstuvwxyz23456789';
  bytes bytea := '';
  out text := '';
begin
  while length(bytes) < len loop
    bytes := bytes || uuid_send(gen_random_uuid());
  end loop;
  for i in 0..len - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return out;
end $$;

-- =====================================================================
-- Gatilhos de proteção
-- =====================================================================

-- Só o admin bloqueia/desbloqueia produtos; "vendidos" só muda pelos pedidos.
-- SECURITY INVOKER de propósito: current_user é o papel da requisição (anon/authenticated).
create function private.protect_product_columns() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if not public.is_admin() then new.blocked := false; end if;
      new.sold_count := 0;
    else
      if not public.is_admin() then new.blocked := old.blocked; end if;
      new.sold_count := old.sold_count;
    end if;
  end if;
  return new;
end $$;

create trigger products_protect before insert or update on public.products
for each row execute function private.protect_product_columns();

-- =====================================================================
-- Permissões das tabelas
-- =====================================================================

alter table public.plans enable row level security;
alter table public.platform_admins enable row level security;
alter table public.stores enable row level security;
alter table public.store_admin_notes enable row level security;
alter table public.store_secrets enable row level security;
alter table public.audit_log enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.coupons enable row level security;
alter table public.contents enable row level security;
alter table public.events enable row level security;
alter table public.checkouts enable row level security;
alter table public.stock_alerts enable row level security;
alter table public.leads enable row level security;
alter table public.reviews enable row level security;
alter table public.media enable row level security;
alter table public.invoices enable row level security;
alter table public.announcements enable row level security;

-- O Supabase libera tudo por padrão; começamos do zero e damos só o necessário.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.plans to anon, authenticated;
grant update (name, price_cents, fee_percent) on public.plans to authenticated;

grant select on public.stores to anon, authenticated;
grant update (slug, name, whatsapp, description, logo_url, settings, theme, theme_draft, theme_history)
  on public.stores to authenticated;
grant delete on public.stores to authenticated; -- só o admin (política abaixo)

grant select, insert, update, delete on public.store_admin_notes to authenticated; -- só o admin
grant select on public.audit_log to authenticated; -- só o admin

grant select on public.categories, public.products, public.variants, public.contents, public.reviews to anon;
grant select, insert, update, delete on
  public.categories, public.products, public.variants, public.contents,
  public.customers, public.coupons, public.media, public.stock_alerts, public.leads,
  public.invoices, public.announcements
  to authenticated;

grant select, delete on public.reviews to authenticated;
grant update (approved) on public.reviews to authenticated;

grant select, delete on public.orders to authenticated;
grant update (internal_notes, tracking_code) on public.orders to authenticated;

grant select, delete on public.checkouts to authenticated;
grant update (contacted_at) on public.checkouts to authenticated;

grant insert on public.events, public.stock_alerts, public.leads to anon;
grant select, insert, delete on public.events to authenticated;

-- ---------- Políticas ----------

-- plans
create policy plans_read on public.plans for select to anon, authenticated using (true);
create policy plans_admin on public.plans for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- stores
create policy stores_public_read on public.stores for select to anon, authenticated
  using (status not in ('suspended', 'closed'));
create policy stores_owner_read on public.stores for select to authenticated
  using (owner_id = (select auth.uid()));
create policy stores_owner_update on public.stores for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy stores_admin on public.stores for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- só admin
create policy store_admin_notes_admin on public.store_admin_notes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy audit_log_admin on public.audit_log for select to authenticated using ((select public.is_admin()));
-- platform_admins e store_secrets: sem políticas (só funções do servidor e service role).

-- Tabelas da loja com CRUD completo do lojista
do $$
declare t text;
begin
  foreach t in array array['categories', 'products', 'variants', 'customers', 'coupons', 'contents', 'stock_alerts', 'leads', 'media'] loop
    execute format(
      'create policy %1$s_owner on public.%1$s for all to authenticated using (private.owns_store(store_id)) with check (private.owns_store(store_id))', t);
    execute format(
      'create policy %1$s_admin on public.%1$s for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

-- Leitura pública da vitrine (só lojas no ar)
create policy categories_public on public.categories for select to anon, authenticated
  using (private.store_is_public(store_id));
create policy products_public on public.products for select to anon, authenticated
  using (not blocked and private.store_is_public(store_id));
create policy variants_public on public.variants for select to anon, authenticated
  using (private.store_is_public(store_id)
    and exists (select 1 from public.products p where p.id = product_id and not p.blocked));
create policy contents_public on public.contents for select to anon, authenticated
  using (status = 'published' and publish_at <= now() and private.store_is_public(store_id));

-- Envios do público
create policy stock_alerts_public_insert on public.stock_alerts for insert to anon, authenticated
  with check (private.store_is_public(store_id) and notified = false);
create policy leads_public_insert on public.leads for insert to anon, authenticated
  with check (private.store_is_public(store_id));

-- events
create policy events_public_insert on public.events for insert to anon, authenticated
  with check (private.store_is_public(store_id));
create policy events_owner_read on public.events for select to authenticated using (private.owns_store(store_id));
create policy events_admin on public.events for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- reviews
create policy reviews_public on public.reviews for select to anon, authenticated
  using (approved and private.store_is_public(store_id));
create policy reviews_owner_read on public.reviews for select to authenticated using (private.owns_store(store_id));
create policy reviews_owner_update on public.reviews for update to authenticated
  using (private.owns_store(store_id)) with check (private.owns_store(store_id));
create policy reviews_owner_delete on public.reviews for delete to authenticated using (private.owns_store(store_id));
create policy reviews_admin on public.reviews for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- orders (situação só muda por set_order_status)
create policy orders_owner_read on public.orders for select to authenticated using (private.owns_store(store_id));
create policy orders_owner_update on public.orders for update to authenticated
  using (private.owns_store(store_id)) with check (private.owns_store(store_id));
create policy orders_admin on public.orders for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- checkouts (carrinhos abandonados)
create policy checkouts_owner_read on public.checkouts for select to authenticated using (private.owns_store(store_id));
create policy checkouts_owner_update on public.checkouts for update to authenticated
  using (private.owns_store(store_id)) with check (private.owns_store(store_id));
create policy checkouts_admin on public.checkouts for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- invoices
create policy invoices_owner_read on public.invoices for select to authenticated using (private.owns_store(store_id));
create policy invoices_admin on public.invoices for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- announcements
create policy announcements_read on public.announcements for select to authenticated using (true);
create policy announcements_admin on public.announcements for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- =====================================================================
-- Funções do servidor (rpc). Todas recebem um único argumento "a" jsonb.
-- =====================================================================

create function public.is_admin(a jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(public.is_admin())
$$;

create function public.create_store(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_slug text := coalesce(a ->> 'slug', '');
  r public.stores;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if exists (select 1 from public.stores where owner_id = auth.uid()) then raise exception 'Você já tem uma loja.'; end if;
  if not (v_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'
          and v_slug not in ('entrar', 'painel', 'admin', 'api', 'loja', 'lojas', 'planos', 'ajuda', 'demo', 'assets', 'static')) then
    raise exception 'Escolha outro endereço: use de 3 a 40 letras, números ou hífens.';
  end if;
  if exists (select 1 from public.stores where slug = v_slug) then
    raise exception 'Esse endereço já está em uso. Escolha outro.';
  end if;
  insert into public.stores (owner_id, slug, name, whatsapp, description, logo_url, plan, status, trial_ends_at, paid_until,
                             settings, theme, theme_draft, theme_history)
  values (auth.uid(), v_slug, private.js_trim(a ->> 'name'), coalesce(a ->> 'whatsapp', ''), '', '', 'pro', 'trial',
          now() + interval '14 days', null,
          coalesce(a -> 'settings', '{}'::jsonb), coalesce(a -> 'theme', '{}'::jsonb), null, '[]'::jsonb)
  returning * into r;
  return to_jsonb(r);
end $$;

create function public.place_order(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_store public.stores;
  v_manual boolean := private.truthy(a -> 'manual');
  v_paid boolean;
  v_open jsonb;
  v_name text := private.js_trim(a #>> '{customer,name}');
  v_phone text := private.only_digits(a #>> '{customer,phone}');
  v_email text := private.js_trim(a #>> '{customer,email}');
  v_method text := a #>> '{shipping,method}';
  v_needs_address boolean;
  v_code text := upper(private.js_trim(a ->> 'coupon'));
  v_coupon public.coupons;
  v_coupon_json jsonb;
  v_fee numeric;
  v_mp boolean;
  v_products jsonb;
  v_variants jsonb;
  v_ids text[];
  q jsonb;
  v_errors text[];
  v_customer public.customers;
  it jsonb;
  v_number int;
  v_status text;
  v_now timestamptz := now();
  v_order public.orders;
begin
  select * into v_store from public.stores where id::text = a ->> 'store_id' for update;
  if not found or v_store.status in ('suspended', 'closed') then
    raise exception 'Esta loja não está recebendo pedidos.';
  end if;
  if v_manual then perform private.assert_owner(v_store.id); end if;
  if not private.can(v_store.plan, 'saved_orders') then raise exception 'Esta loja recebe pedidos pelo WhatsApp.'; end if;
  if not v_manual then
    v_open := private.open_state(v_store.settings -> 'hours', v_now);
    if private.truthy(v_store.settings #> '{hours,paused}')
       or (not (v_open ->> 'open')::boolean and v_store.settings #>> '{hours,outside}' = 'block') then
      raise exception '%', v_open ->> 'message';
    end if;
  end if;
  if v_name = '' or length(v_phone) < 10 then raise exception 'Informe seu nome e WhatsApp com DDD.'; end if;
  v_needs_address := coalesce(v_method in ('zone', 'fixed'), false);
  if v_needs_address and (coalesce(a #>> '{shipping,address,street}', '') = '' or coalesce(a #>> '{shipping,address,number}', '') = '') then
    raise exception 'Informe o endereço de entrega.';
  end if;

  -- Cupom (só no plano Pro; em outros planos o código é ignorado)
  if v_code <> '' and private.can(v_store.plan, 'coupons') then
    select * into v_coupon from public.coupons
    where store_id = v_store.id and code = v_code and active for update;
    if not found then raise exception 'Cupom inválido.'; end if;
    v_coupon_json := to_jsonb(v_coupon);
  end if;

  select fee_percent into v_fee from public.plans where id = v_store.plan;
  v_mp := exists (select 1 from public.store_secrets where store_id = v_store.id and provider = 'mercadopago');

  -- Preços e estoque vêm do banco, travados até o fim do pedido.
  v_ids := array(select l ->> 'product_id' from jsonb_array_elements(coalesce(a -> 'lines', '[]'::jsonb)) l);
  perform 1 from public.products where store_id = v_store.id and id::text = any (v_ids) order by id for update;
  perform 1 from public.variants where store_id = v_store.id and product_id::text = any (v_ids) order by id for update;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]') into v_products
  from public.products p where p.store_id = v_store.id and p.id::text = any (v_ids);
  select coalesce(jsonb_agg(to_jsonb(v)), '[]') into v_variants
  from public.variants v where v.store_id = v_store.id and v.product_id::text = any (v_ids);

  q := private.quote(
    v_store.plan, v_store.settings, coalesce(a -> 'lines', '[]'::jsonb), v_products, v_variants,
    jsonb_build_object('method', v_method, 'zone', a #>> '{shipping,zone}'),
    a #>> '{payment,method}', v_coupon_json, v_fee, v_now, v_mp);

  v_errors := array(
    select e from jsonb_array_elements_text(q -> 'errors') with ordinality as x (e, n)
    where not (v_manual and e like 'O pedido mínimo%') order by n);
  if cardinality(v_errors) > 0 then raise exception '%', v_errors[1]; end if;
  if v_coupon_json is not null and q ->> 'coupon_error' <> '' then raise exception '%', q ->> 'coupon_error'; end if;

  -- Cliente: um por telefone em cada loja.
  select * into v_customer from public.customers
  where store_id = v_store.id and phone = v_phone order by created_at, id limit 1;
  if not found then
    insert into public.customers (store_id, name, phone, email, tags, notes)
    values (v_store.id, v_name, v_phone, v_email, '{}', '') returning * into v_customer;
  elsif coalesce(a #>> '{customer,email}', '') <> '' and v_customer.email = '' then
    update public.customers set email = v_email where id = v_customer.id;
  end if;

  for it in select value from jsonb_array_elements(q -> 'items') loop
    update public.products set sold_count = sold_count + (it ->> 'qty')::int where id = (it ->> 'product_id')::uuid;
    continue when not (select track_stock from public.products where id = (it ->> 'product_id')::uuid);
    if it ->> 'variant_id' is not null then
      update public.variants set stock = stock - (it ->> 'qty')::int where id = (it ->> 'variant_id')::uuid;
    else
      update public.products set stock = stock - (it ->> 'qty')::int where id = (it ->> 'product_id')::uuid;
    end if;
  end loop;
  if v_coupon_json is not null then
    update public.coupons set uses = uses + 1 where id = v_coupon.id;
  end if;

  -- Número do pedido: sequência por loja (a linha da loja está travada).
  select greatest(1000, coalesce(max(number), 0)) + 1 into v_number from public.orders where store_id = v_store.id;
  v_paid := v_manual and private.truthy(a -> 'paid');
  v_status := case when v_paid then 'paid' else 'pending' end;

  insert into public.orders (
    store_id, number, status, token, customer_id, customer, shipping, payment, items,
    subtotal_cents, discount_cents, shipping_cents, total_cents, platform_fee_cents, coupon_code,
    notes, internal_notes, tracking_code, source, history, manual, created_at, paid_at)
  values (
    v_store.id, v_number, v_status, private.random_token(), v_customer.id,
    jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email),
    jsonb_build_object('method', v_method, 'label', q ->> 'shipping_label', 'fee_cents', (q ->> 'shipping_cents')::int,
      'address', case when v_needs_address then a #> '{shipping,address}' else null end),
    jsonb_build_object('method', a #>> '{payment,method}', 'status', case when v_paid then 'paid' else 'pending' end,
      'provider_ref', '', 'change_for_cents', coalesce(private.num(a #> '{payment,change_for_cents}'), 0)),
    q -> 'items',
    (q ->> 'subtotal_cents')::int, (q ->> 'discount_cents')::int, (q ->> 'shipping_cents')::int,
    (q ->> 'total_cents')::int, (q ->> 'platform_fee_cents')::int,
    case when v_coupon_json is not null and q ->> 'coupon_error' = '' then v_coupon.code else '' end,
    private.js_trim(a ->> 'notes'), '', '',
    nullif(a -> 'source', 'null'::jsonb),
    jsonb_build_array(jsonb_build_object('status', v_status, 'at', private.iso(v_now),
      'note', case when v_manual then 'Pedido registrado no painel' else 'Pedido feito na loja' end)),
    v_manual, v_now, case when v_paid then v_now else null end)
  returning * into v_order;

  if coalesce(a ->> 'checkout_id', '') <> '' then
    update public.checkouts set order_id = v_order.id
    where id::text = a ->> 'checkout_id' and store_id = v_store.id;
  end if;

  return jsonb_build_object('id', v_order.id, 'number', v_order.number, 'token', v_order.token,
    'total_cents', v_order.total_cents, 'status', v_order.status);
end $$;

create function public.check_coupon(a jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(c) from public.coupons c
  where c.store_id::text = a ->> 'store_id' and c.code = upper(private.js_trim(a ->> 'code')) and c.active
  limit 1
$$;

create function public.get_public_order(a jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(o) || jsonb_build_object(
    'internal_notes', '',
    'platform_fee_cents', 0,
    'items', coalesce((select jsonb_agg(i || '{"cost_cents": null}'::jsonb order by n)
                       from jsonb_array_elements(o.items) with ordinality as x (i, n)), '[]'::jsonb))
  from public.orders o
  where o.id::text = a ->> 'id' and o.token = coalesce(a ->> 'token', '')
$$;

create function public.set_order_status(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders;
  v_status text := a ->> 'status';
  v_was_closed boolean;
  v_closing boolean;
  v_became_paid boolean;
  v_now timestamptz := now();
begin
  select * into o from public.orders where id::text = a ->> 'order_id' for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  perform private.assert_owner(o.store_id);
  if v_status is null or v_status not in ('pending', 'paid', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled', 'refunded') then
    raise exception 'Situação inválida.';
  end if;
  if o.status = v_status then return to_jsonb(o); end if;
  v_was_closed := o.status in ('cancelled', 'refunded');
  v_closing := v_status in ('cancelled', 'refunded');
  if v_was_closed and not v_closing then
    raise exception 'Um pedido cancelado não pode ser reaberto. Registre um novo pedido.';
  end if;
  if v_closing and not v_was_closed then perform private.restock(o.store_id, o.items); end if;
  v_became_paid := o.paid_at is null and v_status in ('paid', 'preparing', 'ready', 'shipped', 'delivered');
  update public.orders set
    status = v_status,
    paid_at = case when v_became_paid then v_now else o.paid_at end,
    payment = o.payment || jsonb_build_object('status',
      case when v_status = 'refunded' then 'refunded'
           when v_became_paid or o.payment ->> 'status' = 'paid' then 'paid'
           else o.payment -> 'status' #>> '{}' end),
    history = o.history || jsonb_build_array(jsonb_build_object('status', v_status, 'at', private.iso(v_now), 'note', coalesce(a ->> 'note', '')))
  where id = o.id
  returning * into o;
  return to_jsonb(o);
end $$;

create function public.save_checkout(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
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

create function public.submit_review(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders;
  v_rating numeric := private.num(a -> 'rating');
  v_name text := left(private.js_trim(a ->> 'name'), 60);
begin
  select * into o from public.orders where id::text = a ->> 'order_id' and token = coalesce(a ->> 'token', '');
  if not found or o.status <> 'delivered' then raise exception 'Só é possível avaliar pedidos entregues.'; end if;
  if not exists (select 1 from jsonb_array_elements(o.items) i where i ->> 'product_id' = a ->> 'product_id') then
    raise exception 'Este produto não faz parte do pedido.';
  end if;
  if exists (select 1 from public.reviews where order_id = o.id and product_id::text = a ->> 'product_id') then
    raise exception 'Você já avaliou este produto.';
  end if;
  if v_rating is null then raise exception 'Escolha uma nota de 1 a 5.'; end if;
  insert into public.reviews (store_id, product_id, order_id, name, rating, comment, approved)
  values (o.store_id, (a ->> 'product_id')::uuid, o.id,
          case when v_name <> '' then v_name else split_part(o.customer ->> 'name', ' ', 1) end,
          least(5, greatest(1, floor(v_rating + 0.5)))::int,
          left(private.js_trim(a ->> 'comment'), 1000), false);
  return null;
exception when unique_violation then
  raise exception 'Você já avaliou este produto.';
end $$;

create function public.delete_my_store(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  -- As tabelas da loja são apagadas em cascata.
  delete from public.stores where owner_id = auth.uid();
  return null;
end $$;

-- payment_connections(a) fica em 0002_payments.sql (junto com o fluxo do Mercado Pago).

-- ---------- Admin da plataforma ----------

create function public.admin_list_stores(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  perform private.assert_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
      'store', to_jsonb(s),
      'email', coalesce(u.email, ''),
      'last_sign_in_at', u.last_sign_in_at,
      'product_count', (select count(*) from public.products p where p.store_id = s.id),
      'orders_30d', (select count(*) from public.orders o where o.store_id = s.id and o.created_at >= now() - interval '30 days'),
      'notes', coalesce(n.notes, '')
    ) order by s.created_at, s.id), '[]'::jsonb)
  into v
  from public.stores s
  left join auth.users u on u.id = s.owner_id
  left join public.store_admin_notes n on n.store_id = s.id;
  return v;
end $$;

create function public.admin_update_store(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_store uuid;
  v_parts text[] := '{}';
begin
  perform private.assert_admin();
  select id into v_store from public.stores where id::text = a ->> 'store_id' for update;
  if v_store is null then raise exception 'Loja não encontrada.'; end if;
  if coalesce(a ->> 'plan', '') <> '' then
    update public.stores set plan = a ->> 'plan' where id = v_store;
    v_parts := v_parts || ('plano para ' || (a ->> 'plan'));
  end if;
  if coalesce(a ->> 'status', '') <> '' then
    update public.stores set status = a ->> 'status' where id = v_store;
    v_parts := v_parts || ('situação para ' || (a ->> 'status'));
  end if;
  if a ? 'trial_ends_at' then
    update public.stores set trial_ends_at = (a ->> 'trial_ends_at')::timestamptz where id = v_store;
    v_parts := v_parts || 'fim do teste'::text;
  end if;
  if a ? 'paid_until' then
    update public.stores set paid_until = (a ->> 'paid_until')::timestamptz where id = v_store;
    v_parts := v_parts || 'vencimento'::text;
  end if;
  if a ? 'notes' then
    insert into public.store_admin_notes (store_id, notes) values (v_store, coalesce(a ->> 'notes', ''))
    on conflict (store_id) do update set notes = excluded.notes;
    v_parts := v_parts || 'anotações'::text;
  end if;
  perform private.audit(v_store, 'Alterou ' || array_to_string(v_parts, ', '));
  return null;
end $$;

create function public.admin_register_payment(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.stores;
  v_months int := coalesce(private.num(a -> 'months'), 0)::int;
  inv public.invoices;
begin
  perform private.assert_admin();
  select * into s from public.stores where id::text = a ->> 'store_id' for update;
  if not found then raise exception 'Loja não encontrada.'; end if;
  if v_months < 1 then raise exception 'Informe quantos meses foram pagos.'; end if;
  update public.stores set
    paid_until = greatest(now(), coalesce(s.paid_until, now())) + make_interval(months => v_months),
    status = 'active'
  where id = s.id;
  perform private.audit(s.id, format('Pagamento registrado: %s mês(es)', v_months));
  insert into public.invoices (store_id, plan, amount_cents, months, method, note, paid_at)
  values (s.id, s.plan, coalesce(private.num(a -> 'amount_cents'), 0)::int, v_months,
          coalesce(a ->> 'method', ''), coalesce(a ->> 'note', ''), now())
  returning * into inv;
  return to_jsonb(inv);
end $$;

create function public.admin_set_product_blocked(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.products;
begin
  perform private.assert_admin();
  update public.products set blocked = private.truthy(a -> 'blocked')
  where id::text = a ->> 'product_id' returning * into p;
  if not found then raise exception 'Registro não encontrado.'; end if;
  perform private.audit(p.store_id, format('%s o produto "%s"', case when p.blocked then 'Bloqueou' else 'Desbloqueou' end, p.name));
  return null;
end $$;

create function public.admin_log(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.assert_admin();
  perform private.audit(nullif(a ->> 'store_id', '')::uuid, coalesce(a ->> 'action', ''));
  return null;
end $$;

create function public.admin_audit_list(a jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  perform private.assert_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'admin_email', l.admin_email, 'store_id', l.store_id, 'action', l.action, 'created_at', l.created_at)
      order by l.created_at desc, l.id desc), '[]'::jsonb)
  into v
  from (
    select * from public.audit_log
    where coalesce(a ->> 'store_id', '') = '' or store_id::text = a ->> 'store_id'
    order by created_at desc, id desc
    limit 500
  ) l;
  return v;
end $$;

create function public.admin_update_plan(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.plans;
begin
  perform private.assert_admin();
  update public.plans set
    price_cents = private.num(a -> 'price_cents')::int,
    fee_percent = private.num(a -> 'fee_percent')
  where id = a ->> 'id' returning * into p;
  if not found then raise exception 'Plano não encontrado.'; end if;
  perform private.audit(null, format('Alterou o plano %s: %s, taxa de %s%%', p.name, private.brl(p.price_cents), p.fee_percent));
  return null;
end $$;

create function public.admin_announce(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.assert_admin();
  insert into public.announcements (title, body) values (coalesce(a ->> 'title', ''), coalesce(a ->> 'body', ''));
  perform private.audit(null, format('Publicou o aviso "%s"', coalesce(a ->> 'title', '')));
  return null;
end $$;

-- ---------- Tarefa agendada (ver supabase/cron.sql) ----------

-- Cancela pedidos Pix/Mercado Pago que ficaram 24 horas sem pagamento e devolve o estoque.
create function public.expire_pending_orders() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders;
  n int := 0;
begin
  for o in
    select * from public.orders
    where status = 'pending' and created_at < now() - interval '24 hours'
      and payment ->> 'method' in ('pix', 'mercadopago')
    order by created_at
    for update skip locked
  loop
    perform private.restock(o.store_id, o.items);
    update public.orders set
      status = 'cancelled',
      history = history || jsonb_build_array(jsonb_build_object(
        'status', 'cancelled', 'at', private.iso(now()), 'note', 'Pagamento não confirmado em 24 horas'))
    where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Quem pode chamar cada função ----------

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- usadas pelas políticas e gatilhos (rodam com o papel de quem faz a requisição)
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function private.owns_store(uuid) to anon, authenticated;
grant execute on function private.store_is_public(uuid) to anon, authenticated;

-- rpc públicas (vitrine)
grant execute on function public.place_order(jsonb) to anon, authenticated;
grant execute on function public.check_coupon(jsonb) to anon, authenticated;
grant execute on function public.get_public_order(jsonb) to anon, authenticated;
grant execute on function public.save_checkout(jsonb) to anon, authenticated;
grant execute on function public.submit_review(jsonb) to anon, authenticated;
grant execute on function public.is_admin(jsonb) to anon, authenticated;

-- rpc de quem está logado
grant execute on function public.create_store(jsonb) to authenticated;
grant execute on function public.set_order_status(jsonb) to authenticated;
grant execute on function public.delete_my_store(jsonb) to authenticated;
grant execute on function public.admin_list_stores(jsonb) to authenticated;
grant execute on function public.admin_update_store(jsonb) to authenticated;
grant execute on function public.admin_register_payment(jsonb) to authenticated;
grant execute on function public.admin_set_product_blocked(jsonb) to authenticated;
grant execute on function public.admin_log(jsonb) to authenticated;
grant execute on function public.admin_audit_list(jsonb) to authenticated;
grant execute on function public.admin_update_plan(jsonb) to authenticated;
grant execute on function public.admin_announce(jsonb) to authenticated;

-- expire_pending_orders(): só o banco (pg_cron) e o service role.
grant execute on function public.expire_pending_orders() to service_role;

-- =====================================================================
-- Armazenamento de imagens
-- =====================================================================

insert into storage.buckets (id, name, public) values ('media', 'media', true)
on conflict (id) do update set public = true;

-- Cada lojista só mexe na pasta com o id da própria loja: "<store_id>/<arquivo>.jpg".
create policy media_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');
create policy media_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] in (
    select id::text from public.stores where owner_id = (select auth.uid())));
create policy media_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] in (
    select id::text from public.stores where owner_id = (select auth.uid())));
create policy media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select public.is_admin()));

-- =====================================================================
-- Tempo real: o painel recebe pedidos novos na hora
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
