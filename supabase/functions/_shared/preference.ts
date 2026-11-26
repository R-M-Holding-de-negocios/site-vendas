// Checkout Pro: cria a "preferência" de pagamento na conta do lojista e devolve o link.
import { UserError } from './http.ts'
import { createPreference, sellerToken } from './mp.ts'
import type { Deps, Env, Order, StoreLite } from './types.ts'

export interface PreferenceItem {
  id: string
  title: string
  quantity: number
  unit_price: number
  currency_id: 'BRL'
  picture_url?: string
}

const reais = (cents: number) => Math.round(cents) / 100

/**
 * Uma linha por item do pedido, mais a entrega. Se houver desconto (cupom), ele é
 * distribuído proporcionalmente entre os itens, que passam a ir com quantidade 1 e o
 * valor total da linha — assim a soma bate exatamente com o total do pedido.
 */
export function preferenceItems(order: Order): PreferenceItem[] {
  const shipping = Math.max(0, order.shipping_cents)
  const lines = order.items.map((it, i) => ({
    id: it.product_id || `item-${i + 1}`,
    title: (it.variant_label ? `${it.name} (${it.variant_label})` : it.name).slice(0, 250),
    qty: Math.max(1, Math.round(it.qty)),
    unit: Math.round(it.unit_price_cents),
    image: it.image,
  }))
  const itemsTotal = lines.reduce((s, l) => s + l.qty * l.unit, 0)
  const target = order.total_cents - shipping
  const out: PreferenceItem[] = []
  const pic = (u: string) => (/^https:\/\//.test(u) ? { picture_url: u } : {})

  if (target === itemsTotal) {
    for (const l of lines) out.push({ id: l.id, title: l.title, quantity: l.qty, unit_price: reais(l.unit), currency_id: 'BRL', ...pic(l.image) })
  } else {
    if (target < 0 || itemsTotal <= 0) throw new UserError('O valor deste pedido não confere. Fale com a loja.', 409)
    let left = target
    lines.forEach((l, i) => {
      const lineTotal = l.qty * l.unit
      const value = i === lines.length - 1 ? left : Math.floor((lineTotal * target) / itemsTotal)
      left -= value
      if (value <= 0) return
      out.push({
        id: l.id,
        title: l.qty > 1 ? `${l.title} x${l.qty}`.slice(0, 250) : l.title,
        quantity: 1,
        unit_price: reais(value),
        currency_id: 'BRL',
        ...pic(l.image),
      })
    })
  }
  if (shipping > 0)
    out.push({ id: 'entrega', title: `Entrega${order.shipping.label ? `: ${order.shipping.label}` : ''}`.slice(0, 250), quantity: 1, unit_price: reais(shipping), currency_id: 'BRL' })
  return out
}

/** Nome na fatura do cartão: sem acentos, só letras/números/espaço, até 22 caracteres. */
export function statementDescriptor(name: string) {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 22)
    .trim()
  return s || 'LOJA'
}

function phoneParts(phone: string) {
  let d = phone.replace(/\D+/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  return d.length >= 10 ? { area_code: d.slice(0, 2), number: d.slice(2) } : { area_code: '', number: d }
}

export function orderPageUrl(env: Pick<Env, 'SITE_URL'>, store: Pick<StoreLite, 'slug'>, order: Pick<Order, 'id' | 'token'>) {
  return `${env.SITE_URL.replace(/\/+$/, '')}/${encodeURIComponent(store.slug)}/pedido/${encodeURIComponent(order.id)}?t=${encodeURIComponent(order.token)}`
}

export function webhookUrl(env: Pick<Env, 'FUNCTIONS_URL'>, storeId: string) {
  // source_news=webhooks: recebe só no formato Webhooks (com assinatura), não o antigo IPN.
  return `${env.FUNCTIONS_URL.replace(/\/+$/, '')}/mp-webhook?store_id=${encodeURIComponent(storeId)}&source_news=webhooks`
}

export function buildPreference(env: Env, store: StoreLite, order: Order) {
  const [first, ...rest] = order.customer.name.trim().split(/\s+/)
  const back = orderPageUrl(env, store, order)
  const maxInst = Math.min(12, Math.max(1, Math.round(store.settings?.max_installments ?? 12)))
  const fee = Math.max(0, Math.min(order.platform_fee_cents, order.total_cents))
  return {
    items: preferenceItems(order),
    payer: {
      name: first ?? '',
      surname: rest.join(' '),
      ...(order.customer.email ? { email: order.customer.email } : {}),
      phone: phoneParts(order.customer.phone),
    },
    external_reference: order.id,
    marketplace_fee: reais(fee),
    notification_url: webhookUrl(env, store.id),
    back_urls: { success: back, pending: back, failure: back },
    auto_return: 'approved',
    statement_descriptor: statementDescriptor(store.name),
    payment_methods: { installments: maxInst },
    metadata: { store_id: store.id, order_id: order.id, order_number: order.number },
  }
}

/** mp-create-preference: valida o pedido e devolve o link do Checkout Pro. */
export async function createCheckout(deps: Deps, body: unknown): Promise<{ url: string }> {
  const b = (body ?? {}) as { order_id?: unknown; token?: unknown }
  const orderId = typeof b.order_id === 'string' ? b.order_id : ''
  const token = typeof b.token === 'string' ? b.token : ''
  if (!orderId || !token) throw new UserError('Pedido não encontrado.', 404)
  const order = /^[0-9a-f-]{36}$/i.test(orderId) ? await deps.db.order(orderId) : null
  if (!order || !safeEqual(order.token, token)) throw new UserError('Pedido não encontrado.', 404)
  if (order.payment.method !== 'mercadopago') throw new UserError('Este pedido não é pago pelo Mercado Pago.', 409)
  if (order.status !== 'pending' || order.payment.status !== 'pending') throw new UserError('Este pedido já foi pago ou não está mais aguardando pagamento.', 409)
  if (order.total_cents <= 0) throw new UserError('O valor deste pedido não confere. Fale com a loja.', 409)
  const store = await deps.db.store(order.store_id)
  if (!store || store.status === 'suspended' || store.status === 'closed') throw new UserError('Esta loja não está recebendo pedidos.', 409)
  const sellerAccess = await sellerToken(deps, store.id)
  if (!sellerAccess) throw new UserError('Esta loja ainda não conectou o Mercado Pago. Escolha outra forma de pagamento.', 409)
  const pref = await createPreference(deps.fetch, sellerAccess, buildPreference(deps.env, store, order))
  const url = String(pref.init_point ?? '')
  if (!url) throw new Error('Preferência sem init_point')
  return { url }
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
