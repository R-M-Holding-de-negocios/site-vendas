-- Ajustes de segurança e robustez (27/11/2026). Só acrescenta; pode ser rodada uma vez,
-- depois das migrações 0001 a 0003.

-- ---------------------------------------------------------------------
-- 1. Custo do produto: só o dono da loja (e o admin) conhece.
-- A 0003 escondeu a coluna dos visitantes, mas qualquer usuário logado ainda lia o custo
-- dos produtos de todas as lojas no ar. Permissão por coluna não distingue o dono, então
-- ninguém lê a coluna direto: o painel busca o custo pela função product_costs.
-- Gravar continua igual (insert/update de cost_cents pelo dono, conforme as políticas).
-- ---------------------------------------------------------------------
revoke select on public.products from authenticated;
grant select (
  id, store_id, name, description, price_cents, promo_price_cents, promo_ends_at, images, category_ids,
  available, featured, position, sku, track_stock, stock, weight_g, height_cm, width_cm, length_cm,
  options, qty_discounts, video_url, seo, blocked, sold_count, created_at
) on public.products to authenticated;

-- Contrato do app (src/lib/db.ts, Rpc.product_costs): { ids: uuid[] } -> { "<id>": custo }.
-- Produtos de outras lojas (ou sem custo) não aparecem na resposta.
create or replace function public.product_costs(a jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(p.id::text, p.cost_cents), '{}'::jsonb)
  from public.products p
  join public.stores s on s.id = p.store_id
  where p.id::text in (select jsonb_array_elements_text(coalesce(a -> 'ids', '[]'::jsonb)))
    and p.cost_cents is not null
    and (s.owner_id = auth.uid() or public.is_admin());
$$;
revoke all on function public.product_costs(jsonb) from public, anon;
grant execute on function public.product_costs(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. payment_connections: search_path fixo também sem pg_temp, como as demais.
-- ---------------------------------------------------------------------
alter function public.payment_connections(jsonb) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------
-- 3. Pasta de imagens: até 5 MB e só formatos comuns de foto. SVG fica de fora
-- (pode carregar script e é servido do mesmo domínio público do storage).
-- O painel já reduz as fotos para JPEG antes de enviar.
-- ---------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'media';

-- ---------------------------------------------------------------------
-- 4. Cancelamento automático em 24 horas só para Mercado Pago.
-- Pix direto é confirmado à mão pelo lojista: cancelar sozinho fazia o lojista perder
-- pedidos já pagos (pedido cancelado não reabre). Ele cancela os que não pagarem.
-- ---------------------------------------------------------------------
create or replace function public.expire_pending_orders() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders;
  n int := 0;
begin
  for o in
    select * from public.orders
    where status = 'pending' and created_at < now() - interval '24 hours'
      and payment ->> 'method' = 'mercadopago'
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
revoke execute on function public.expire_pending_orders() from public, anon, authenticated;
grant execute on function public.expire_pending_orders() to service_role;
