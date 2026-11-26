import type { PlanId, PlanRow, Store } from './types'

/** Valores padrão; o admin pode mudar preço e taxa na tabela "plans" do banco. */
export const DEFAULT_PLANS: PlanRow[] = [
  { id: 'vitrine', name: 'Vitrine', price_cents: 3900, fee_percent: 0 },
  { id: 'loja', name: 'Loja', price_cents: 4900, fee_percent: 2 },
  { id: 'pro', name: 'Pro', price_cents: 9900, fee_percent: 1 },
]

export const PLAN_ORDER: PlanId[] = ['vitrine', 'loja', 'pro']
export const TRIAL_DAYS = 14

/** Em que plano cada recurso fica disponível. O que não está aqui é do plano Vitrine. */
export const FEATURES = {
  saved_orders: 'loja',
  checkout: 'loja',
  pix: 'loja',
  cash: 'loja',
  mercadopago: 'loja',
  variants: 'loja',
  promo_price: 'loja',
  free_shipping_bar: 'loja',
  cross_sell: 'loja',
  stock_alert: 'loja',
  themes: 'loja',
  fonts: 'loja',
  layout: 'loja',
  sections: 'loja',
  animations: 'loja',
  pages: 'loja',
  menu: 'loja',
  footer: 'loja',
  basic_reports: 'loja',
  manual_order: 'loja',
  tracking_pixels: 'loja',
  stock: 'pro',
  cost: 'pro',
  csv: 'pro',
  bulk_edit: 'pro',
  customers: 'pro',
  coupons: 'pro',
  abandoned_carts: 'pro',
  posts: 'pro',
  campaign_links: 'pro',
  reports: 'pro',
  reviews: 'pro',
  lead_popup: 'pro',
  qty_discount: 'pro',
  filters: 'pro',
  seo: 'pro',
  hide_branding: 'pro',
  pro_sections: 'pro',
} as const satisfies Record<string, PlanId>

export type Feature = keyof typeof FEATURES

export const planAtLeast = (plan: PlanId, min: PlanId) => PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min)

export const can = (store: Pick<Store, 'plan'>, feature: Feature) => planAtLeast(store.plan, FEATURES[feature])

export const planName = (id: PlanId) => DEFAULT_PLANS.find((p) => p.id === id)!.name

export const PLAN_SUMMARY: Record<PlanId, string[]> = {
  vitrine: ['Loja com link próprio', 'Produtos ilimitados com fotos', 'Pedido pronto no WhatsApp', 'Logo, cores e banner'],
  loja: [
    'Tudo do Vitrine',
    'Pedidos salvos no painel',
    'Pix, pagamento na entrega e Mercado Pago',
    'Entrega por bairro, retirada e frete grátis',
    'Temas, seções e animações',
  ],
  pro: [
    'Tudo do Loja',
    'Relatórios completos de vendas e clientes',
    'Estoque, cupons e carrinho abandonado',
    'Posts, avaliações e captação de contatos',
    'Taxa menor por venda online',
  ],
}
