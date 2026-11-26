import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { handleWebhook } from '../../supabase/functions/_shared/webhook'
import type { MpPayment } from '../../supabase/functions/_shared/mp'
import { FakeDb, NOW, ORDER_ID, STORE_ID, env, fakeFetch, makeDeps, order } from './fakes'

const ts = String(Math.floor(NOW.getTime() / 1000))

function notification(paymentId: string, opts: { storeId?: string; sign?: boolean; type?: string } = {}) {
  const requestId = 'req-' + paymentId
  const v1 = createHmac('sha256', env.MP_WEBHOOK_SECRET).update(`id:${paymentId};request-id:${requestId};ts:${ts};`).digest('hex')
  const headers = new Headers({ 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${opts.sign === false ? 'f'.repeat(64) : v1}` })
  const type = opts.type ?? 'payment'
  return {
    url: `${env.FUNCTIONS_URL}/mp-webhook?store_id=${opts.storeId ?? STORE_ID}&source_news=webhooks&data.id=${paymentId}&type=${type}`,
    headers,
    body: JSON.stringify({ action: 'payment.updated', type, data: { id: paymentId } }),
  }
}

function mp(payment: Partial<MpPayment>) {
  return fakeFetch({
    [`GET /v1/payments/${payment.id}`]: (c) => {
      expect(c.headers.authorization).toBe('Bearer APP_USR-seller')
      return { currency_id: 'BRL', external_reference: ORDER_ID, ...payment }
    },
  })
}

describe('webhook do Mercado Pago', () => {
  it('marca o pedido como pago quando aprovado e o valor confere', async () => {
    const db = new FakeDb()
    const { fetch } = mp({ id: 555, status: 'approved', transaction_amount: 132.9 })
    const r = await handleWebhook(makeDeps(db, fetch), notification('555'))
    expect(r).toEqual({ status: 200, outcome: 'paid' })
    const o = db.orders[0]
    expect(o.status).toBe('paid')
    expect(o.paid_at).toBe(NOW.toISOString())
    expect(o.payment).toMatchObject({ method: 'mercadopago', status: 'paid', provider_ref: '555' })
    expect(o.history.at(-1)).toEqual({ status: 'paid', at: NOW.toISOString(), note: 'Pagamento aprovado no Mercado Pago' })
    expect(o.history).toHaveLength(2)
  })

  it('é idempotente: a mesma notificação de novo não muda nada', async () => {
    const db = new FakeDb()
    const { fetch } = mp({ id: 555, status: 'approved', transaction_amount: 132.9 })
    await handleWebhook(makeDeps(db, fetch), notification('555'))
    const again = await handleWebhook(makeDeps(db, fetch), notification('555'))
    expect(again).toEqual({ status: 200, outcome: 'already_paid' })
    expect(db.updates).toBe(1)
    expect(db.orders[0].history).toHaveLength(2)
  })

  it('não marca pago se o valor não confere', async () => {
    const db = new FakeDb()
    const { fetch } = mp({ id: 556, status: 'approved', transaction_amount: 1.0 })
    const r = await handleWebhook(makeDeps(db, fetch), notification('556'))
    expect(r.outcome).toBe('amount_mismatch')
    expect(r.status).toBe(200)
    expect(db.orders[0].status).toBe('pending')
  })

  it('não marca pago pagamento de pedido de outra loja', async () => {
    const db = new FakeDb()
    db.orders = [order({ store_id: '33333333-3333-4333-8333-333333333333' })]
    const { fetch } = mp({ id: 557, status: 'approved', transaction_amount: 132.9 })
    const r = await handleWebhook(makeDeps(db, fetch), notification('557'))
    expect(r.outcome).toBe('order_not_found')
    expect(db.updates).toBe(0)
  })

  it('pagamento ainda pendente não muda o pedido', async () => {
    const db = new FakeDb()
    const { fetch } = mp({ id: 558, status: 'in_process', transaction_amount: 132.9 })
    expect((await handleWebhook(makeDeps(db, fetch), notification('558'))).outcome).toBe('not_final')
    expect(db.updates).toBe(0)
  })

  it('devolução marca como reembolsado, uma vez só', async () => {
    const db = new FakeDb()
    db.orders = [order({ status: 'preparing', payment: { method: 'mercadopago', status: 'paid', provider_ref: '559', change_for_cents: 0 } })]
    const { fetch } = mp({ id: 559, status: 'refunded', transaction_amount: 132.9 })
    expect((await handleWebhook(makeDeps(db, fetch), notification('559'))).outcome).toBe('refunded')
    expect(db.orders[0].status).toBe('refunded')
    expect(db.orders[0].payment.status).toBe('refunded')
    expect(db.orders[0].history.at(-1)?.note).toBe('Pagamento devolvido no Mercado Pago')
    expect((await handleWebhook(makeDeps(db, fetch), notification('559'))).outcome).toBe('already_refunded')
    expect(db.updates).toBe(1)
  })

  it('chargeback de outro pagamento é ignorado', async () => {
    const db = new FakeDb()
    db.orders = [order({ status: 'paid', payment: { method: 'mercadopago', status: 'paid', provider_ref: '1', change_for_cents: 0 } })]
    const { fetch } = mp({ id: 560, status: 'charged_back', transaction_amount: 132.9 })
    expect((await handleWebhook(makeDeps(db, fetch), notification('560'))).outcome).toBe('ignored')
    expect(db.orders[0].status).toBe('paid')
  })

  it('recusa assinatura inválida sem consultar o Mercado Pago', async () => {
    const db = new FakeDb()
    const { fetch, calls } = mp({ id: 561, status: 'approved', transaction_amount: 132.9 })
    const r = await handleWebhook(makeDeps(db, fetch), notification('561', { sign: false }))
    expect(r).toEqual({ status: 401, outcome: 'bad_signature' })
    expect(calls).toHaveLength(0)
  })

  it('responde 200 e ignora outros tipos de notificação', async () => {
    const db = new FakeDb()
    const { fetch, calls } = mp({ id: 562, status: 'approved' })
    expect(await handleWebhook(makeDeps(db, fetch), notification('562', { type: 'merchant_order' }))).toEqual({ status: 200, outcome: 'ignored' })
    expect(calls).toHaveLength(0)
  })
})
