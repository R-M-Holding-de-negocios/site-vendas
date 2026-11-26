-- O custo do produto é informação do lojista: visitantes leem todas as colunas menos essa.
-- A loja pública (src/store/StoreApp.tsx) pede as colunas explicitamente.
revoke select on public.products from anon;
grant select (
  id, store_id, name, description, price_cents, promo_price_cents, promo_ends_at, images, category_ids,
  available, featured, position, sku, track_stock, stock, weight_g, height_cm, width_cm, length_cm,
  options, qty_discounts, video_url, seo, blocked, sold_count, created_at
) on public.products to anon;
