-- 0007: dados internos da loja só para o dono e o admin; conexão do Mercado Pago que caiu.

-- ---------------------------------------------------------------------
-- 1. Visitantes liam todas as colunas de stores: rascunho do tema ainda não publicado,
-- histórico de versões e datas de cobrança. Agora essas colunas saem da leitura direta
-- e o painel busca pela função store_private (como o custo do produto na 0004).
-- Gravar continua igual (grant update da 0001).
-- ---------------------------------------------------------------------
revoke select on public.stores from anon, authenticated;
grant select (
  id, owner_id, slug, name, whatsapp, description, logo_url, plan, status, settings, theme, created_at
) on public.stores to anon, authenticated;

-- Contrato do app (src/lib/db.ts, Rpc.store_private): { ids: uuid[] } -> { "<id>": { ...colunas internas } }.
create or replace function public.store_private(a jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(s.id::text, jsonb_build_object(
    'trial_ends_at', s.trial_ends_at,
    'paid_until', s.paid_until,
    'theme_draft', s.theme_draft,
    'theme_history', s.theme_history,
    'plan_before_downgrade', s.plan_before_downgrade
  )), '{}'::jsonb)
  from public.stores s
  where s.id::text in (select jsonb_array_elements_text(coalesce(a -> 'ids', '[]'::jsonb)))
    and (s.owner_id = auth.uid() or public.is_admin());
$$;
revoke all on function public.store_private(jsonb) from public, anon;
grant execute on function public.store_private(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Quando o Mercado Pago recusa a renovação do acesso (lojista desautorizou o app,
-- trocou a senha etc.), as funções guardam a conexão como 'mercadopago_revoked_<data>'
-- em vez de apagar. A loja deixa de oferecer Mercado Pago (place_order só aceita
-- provider = 'mercadopago') e o painel avisa para conectar de novo.
-- ---------------------------------------------------------------------
create or replace function public.payment_connections(a jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'mercadopago', exists (
      select 1 from public.store_secrets s
      where s.store_id = (a ->> 'store_id')::uuid and s.provider = 'mercadopago'
        and coalesce(s.data ->> 'access_token', '') <> ''),
    'mercadopago_lost', not exists (
      select 1 from public.store_secrets s
      where s.store_id = (a ->> 'store_id')::uuid and s.provider = 'mercadopago')
      and exists (
      select 1 from public.store_secrets s
      where s.store_id = (a ->> 'store_id')::uuid and s.provider like 'mercadopago_revoked_%'
        and private.owns_store(s.store_id))
  );
$$;
