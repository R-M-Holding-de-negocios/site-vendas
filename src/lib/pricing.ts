// Regras de preço do pedido. Esta é a implementação de referência: o banco
// (função place_order em supabase/migrations) repete exatamente estas regras e
// os testes em tests/sql conferem que os dois chegam aos mesmos valores.
import { can } from './plans'
import type { Coupon, OrderItem, PayMethod, Product, ShipMethod, Store, Variant } from './types'
import { brl } from './util'

export interface CartLine {
  product_id: string
  variant_id: string | null
  qty: number
}

export interface QuoteInput {
  store: Pick<Store, 'plan' | 'settings'>
  lines: CartLine[]
  products: Product[]
  variants: Variant[]
  shipping: { method: ShipMethod; zone?: string } | null
  payment: PayMethod | null
  coupon: Coupon | null
  feePercent: number
  now: Date
}

export interface Quote {
  items: OrderItem[]
  subtotal_cents: number
  coupon_discount_cents: number
  pix_discount_cents: number
  discount_cents: number
  shipping_cents: number
  shipping_label: string
  total_cents: number
  platform_fee_cents: number
  free_shipping: boolean
  /** Quanto falta para o frete grátis (0 quando já atingiu ou não existe). */
  free_shipping_missing_cents: number
  coupon_error: string
  errors: string[]
}

export const promoActive = (p: Pick<Product, 'promo_price_cents' | 'promo_ends_at'>, now: Date) =>
  p.promo_price_cents != null && (p.promo_ends_at == null || new Date(p.promo_ends_at) > now)

/** Preço da unidade antes do desconto por quantidade. */
export function basePrice(p: Product, v: Variant | null, now: Date) {
  if (v && v.price_cents != null) return v.price_cents
  return promoActive(p, now) ? p.promo_price_cents! : p.price_cents
}

export function qtyDiscountPercent(p: Product, qty: number) {
  let best = 0
  for (const t of p.qty_discounts ?? []) if (qty >= t.min_qty && t.percent > best) best = t.percent
  return best
}

export const variantLabel = (v: Variant | null) => (v ? Object.values(v.values).join(' / ') : '')

export function availableStock(p: Product, v: Variant | null) {
  if (!p.track_stock) return Infinity
  return v ? v.stock : p.stock
}

export function couponProblem(c: Coupon | null, subtotal: number, now: Date): string {
  if (!c || !c.active) return 'Cupom inválido.'
  if (c.starts_at && new Date(c.starts_at) > now) return 'Este cupom ainda não está valendo.'
  if (c.ends_at && new Date(c.ends_at) <= now) return 'Este cupom expirou.'
  if (c.max_uses != null && c.uses >= c.max_uses) return 'Este cupom já foi usado o máximo de vezes.'
  if (subtotal < c.min_order_cents) return `Este cupom vale para compras a partir de ${brl(c.min_order_cents)}.`
  return ''
}

export function shippingOptions(store: Pick<Store, 'plan' | 'settings'>) {
  const d = store.settings.delivery
  const out: { method: ShipMethod; label: string; zones?: { name: string; fee_cents: number }[]; fee_cents?: number }[] = []
  if (!can(store, 'checkout')) return out
  if (d.pickup.enabled) out.push({ method: 'pickup', label: 'Retirar na loja' })
  if (d.zones.enabled && d.zones.items.length) out.push({ method: 'zone', label: 'Entrega no meu bairro', zones: d.zones.items })
  if (d.fixed.enabled) out.push({ method: 'fixed', label: d.fixed.label || 'Entrega', fee_cents: d.fixed.fee_cents })
  if (d.arrange.enabled) out.push({ method: 'arrange', label: 'Combinar a entrega pelo WhatsApp' })
  return out
}

export const PAY_LABEL: Record<PayMethod, string> = {
  whatsapp: 'Combinar pelo WhatsApp',
  pix: 'Pix',
  cash: 'Dinheiro na entrega ou retirada',
  card_on_delivery: 'Cartão na entrega ou retirada',
  mercadopago: 'Cartão, Pix ou boleto pelo Mercado Pago',
}

export function paymentOptions(store: Pick<Store, 'plan' | 'settings'>): PayMethod[] {
  const p = store.settings.payments
  if (!can(store, 'checkout')) return ['whatsapp']
  const out: PayMethod[] = []
  if (p.pix.enabled && p.pix.key) out.push('pix')
  if (p.mercadopago.enabled) out.push('mercadopago')
  if (p.cash.enabled) out.push('cash')
  if (p.card_on_delivery.enabled) out.push('card_on_delivery')
  if (p.whatsapp.enabled || out.length === 0) out.push('whatsapp')
  return out
}

export function quote(input: QuoteInput): Quote {
  const { store, now } = input
  const errors: string[] = []
  const items: OrderItem[] = []
  const pro = can(store, 'qty_discount')

  for (const line of input.lines) {
    const p = input.products.find((x) => x.id === line.product_id)
    if (!p || !p.available || p.blocked) {
      errors.push(`${p?.name ?? 'Um produto'} não está mais disponível.`)
      continue
    }
    const hasOptions = (p.options ?? []).length > 0
    const v = line.variant_id ? (input.variants.find((x) => x.id === line.variant_id && x.product_id === p.id) ?? null) : null
    if (hasOptions && !v) {
      errors.push(`Escolha as opções de ${p.name}.`)
      continue
    }
    if (v && !v.available) {
      errors.push(`${p.name} (${variantLabel(v)}) não está mais disponível.`)
      continue
    }
    const qty = Math.floor(line.qty)
    if (!(qty >= 1)) {
      errors.push(`Quantidade inválida para ${p.name}.`)
      continue
    }
    const stock = availableStock(p, v)
    if (qty > stock) {
      errors.push(stock <= 0 ? `${p.name} esgotou.` : `Só restam ${stock} unidades de ${p.name}.`)
      continue
    }
    const base = basePrice(p, v, now)
    const off = pro ? qtyDiscountPercent(p, qty) : 0
    const unit = base - Math.floor((base * off) / 100)
    items.push({
      product_id: p.id,
      variant_id: v?.id ?? null,
      name: p.name,
      variant_label: variantLabel(v),
      list_price_cents: v?.price_cents ?? p.price_cents,
      unit_price_cents: unit,
      cost_cents: p.cost_cents,
      qty,
      image: v?.image || p.images[0] || '',
    })
  }

  const subtotal = items.reduce((s, i) => s + i.unit_price_cents * i.qty, 0)
  const s = store.settings

  // Cupom
  let couponDiscount = 0
  let couponFreeShipping = false
  let couponError = ''
  if (input.coupon && can(store, 'coupons')) {
    couponError = couponProblem(input.coupon, subtotal, now)
    if (!couponError) {
      const c = input.coupon
      if (c.type === 'percent') couponDiscount = Math.floor((subtotal * Math.min(c.value, 100)) / 100)
      else if (c.type === 'fixed') couponDiscount = Math.min(c.value, subtotal)
      else couponFreeShipping = true
    }
  }
  const afterCoupon = subtotal - couponDiscount

  // Entrega
  let shipping = 0
  let shippingLabel = ''
  const threshold = can(store, 'free_shipping_bar') ? s.free_shipping_above_cents : 0
  const reachedFree = threshold > 0 && afterCoupon >= threshold
  if (input.shipping) {
    const opt = shippingOptions(store).find((o) => o.method === input.shipping!.method)
    if (!opt) errors.push('Forma de entrega indisponível.')
    else if (opt.method === 'zone') {
      const z = opt.zones!.find((z) => z.name === input.shipping!.zone)
      if (!z) errors.push('Escolha o bairro de entrega.')
      else {
        shipping = z.fee_cents
        shippingLabel = `Entrega em ${z.name}`
      }
    } else if (opt.method === 'fixed') {
      shipping = opt.fee_cents ?? 0
      shippingLabel = opt.label
    } else shippingLabel = opt.label
  }
  const paidDelivery = input.shipping?.method === 'zone' || input.shipping?.method === 'fixed'
  const freeShipping = paidDelivery && (couponFreeShipping || reachedFree)
  if (freeShipping) shipping = 0

  // Pagamento
  let pixDiscount = 0
  if (input.payment) {
    if (!paymentOptions(store).includes(input.payment)) errors.push('Forma de pagamento indisponível.')
    else if (input.payment === 'pix') pixDiscount = Math.floor((afterCoupon * s.payments.pix.discount_percent) / 100)
  }

  if (items.length && subtotal < s.min_order_cents) errors.push(`O pedido mínimo é de ${brl(s.min_order_cents)}.`)
  if (!input.lines.length) errors.push('O carrinho está vazio.')

  const total = Math.max(0, afterCoupon - pixDiscount + shipping)
  return {
    items,
    subtotal_cents: subtotal,
    coupon_discount_cents: couponDiscount,
    pix_discount_cents: pixDiscount,
    discount_cents: couponDiscount + pixDiscount,
    shipping_cents: shipping,
    shipping_label: shippingLabel,
    total_cents: total,
    platform_fee_cents: input.payment === 'mercadopago' ? Math.round((total * input.feePercent) / 100) : 0,
    free_shipping: freeShipping,
    free_shipping_missing_cents: threshold > 0 && !reachedFree ? threshold - afterCoupon : 0,
    coupon_error: couponError,
    errors,
  }
}
