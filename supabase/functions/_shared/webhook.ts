// mp-webhook: notificações do Mercado Pago sobre pagamentos.
//
// A notificação só diz "o pagamento X mudou". O estado real é sempre consultado na API
// do Mercado Pago com o token do lojista, então uma notificação falsa não consegue
// marcar pedido como pago; a assinatura serve para descartar lixo cedo.
import { getPayment, sellerToken } from './mp.ts'
import { verifySignature } from './signature.ts'
import type { Deps, OrderStatus } from './types.ts'

export interface WebhookResult {
  status: number
  /** Para log e testes: o que foi feito. */
  outcome:
    | 'bad_signature'
    | 'ignored'
    | 'no_token'
    | 'order_not_found'
    | 'amount_mismatch'
    | 'paid'
    | 'already_paid'
    | 'refunded'
    | 'already_refunded'
    | 'not_final'
}

const REFUND_FROM: OrderStatus[] = ['paid', 'preparing', 'ready', 'shipped', 'delivered']

export async function handleWebhook(deps: Deps, req: { url: string; headers: Headers; body: string }, toleranceS?: number): Promise<WebhookResult> {
  const url = new URL(req.url)
  let body: { type?: string; topic?: string; action?: string; data?: { id?: string | number } } = {}
  try {
    body = req.body ? JSON.parse(req.body) : {}
  } catch {
    /* corpo inválido: usa só a query string */
  }
  const dataId = url.searchParams.get('data.id') ?? (body.data?.id != null ? String(body.data.id) : null)
  const sig = await verifySignature({
    secret: deps.env.MP_WEBHOOK_SECRET,
    header: req.headers.get('x-signature'),
    requestId: req.headers.get('x-request-id'),
    // O manifesto usa o data.id da query string; sem ele, o par é omitido.
    dataId: url.searchParams.get('data.id'),
    now: deps.now(),
    toleranceS,
  })
  if (sig !== 'ok') return { status: 401, outcome: 'bad_signature' }

  const type = url.searchParams.get('type') ?? body.type ?? body.topic ?? ''
  const storeId = url.searchParams.get('store_id') ?? ''
  if (type !== 'payment' || !dataId || !/^[0-9a-f-]{36}$/i.test(storeId)) return { status: 200, outcome: 'ignored' }

  const token = await sellerToken(deps, storeId)
  if (!token) return { status: 200, outcome: 'no_token' }
  const payment = await getPayment(deps.fetch, token, dataId)
  const orderId = String(payment.external_reference ?? '')
  const order = /^[0-9a-f-]{36}$/i.test(orderId) ? await deps.db.order(orderId) : null
  if (!order || order.store_id !== storeId) return { status: 200, outcome: 'order_not_found' }

  const at = deps.now().toISOString()
  const ref = String(payment.id)

  if (payment.status === 'approved') {
    if (order.status !== 'pending') return { status: 200, outcome: order.payment.provider_ref === ref || order.status === 'paid' ? 'already_paid' : 'ignored' }
    const amountCents = Math.round(Number(payment.transaction_amount) * 100)
    if (amountCents !== order.total_cents || (payment.currency_id && payment.currency_id !== 'BRL')) {
      console.error(`mp-webhook: valor do pagamento ${ref} (${amountCents}) difere do pedido ${order.id} (${order.total_cents})`)
      return { status: 200, outcome: 'amount_mismatch' }
    }
    const changed = await deps.db.updateOrderIf(order.id, ['pending'], {
      status: 'paid',
      paid_at: at,
      payment: { ...order.payment, status: 'paid', provider_ref: ref },
      history: [...(order.history ?? []), { status: 'paid', at, note: 'Pagamento aprovado no Mercado Pago' }],
    })
    return { status: 200, outcome: changed ? 'paid' : 'already_paid' }
  }

  if (payment.status === 'refunded' || payment.status === 'charged_back') {
    if (order.payment.provider_ref !== ref) return { status: 200, outcome: 'ignored' }
    if (order.status === 'refunded') return { status: 200, outcome: 'already_refunded' }
    if (!REFUND_FROM.includes(order.status)) return { status: 200, outcome: 'ignored' }
    const note = payment.status === 'refunded' ? 'Pagamento devolvido no Mercado Pago' : 'Contestação (chargeback) no Mercado Pago'
    const changed = await deps.db.updateOrderIf(order.id, REFUND_FROM, {
      status: 'refunded',
      payment: { ...order.payment, status: 'refunded' },
      history: [...(order.history ?? []), { status: 'refunded', at, note }],
    })
    return { status: 200, outcome: changed ? 'refunded' : 'already_refunded' }
  }

  return { status: 200, outcome: 'not_final' }
}

