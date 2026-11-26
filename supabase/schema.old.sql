-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.

create table stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$' and slug not in ('entrar', 'painel')),
  name text not null,
  whatsapp text not null,
  description text not null default '',
  -- Você (dono da plataforma) desliga aqui a loja de quem não pagou.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  description text not null default '',
  image_url text not null default '',
  available boolean not null default true,
  created_at timestamptz not null default now()
);
create index on products (store_id);

alter table stores enable row level security;
alter table products enable row level security;

-- O lojista não pode mexer em "active" nem em "owner_id".
revoke insert, update on stores from authenticated, anon;
grant insert (slug, name, whatsapp, description) on stores to authenticated;
grant update (slug, name, whatsapp, description) on stores to authenticated;

create policy "lojas ativas sao publicas" on stores for select
  using (active or owner_id = auth.uid());
create policy "dono cria a loja" on stores for insert to authenticated
  with check (owner_id = auth.uid());
create policy "dono edita a loja" on stores for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "produtos de lojas ativas sao publicos" on products for select
  using (exists (select 1 from stores s where s.id = store_id and (s.active or s.owner_id = auth.uid())));
create policy "dono gerencia produtos" on products for all to authenticated
  using (exists (select 1 from stores s where s.id = store_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from stores s where s.id = store_id and s.owner_id = auth.uid()));

-- Fotos dos produtos: bucket público, cada lojista só grava na própria pasta.
insert into storage.buckets (id, name, public) values ('produtos', 'produtos', true);
create policy "lojista envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "lojista apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and (storage.foldername(name))[1] = auth.uid()::text);
