import { describe, expect, it } from 'vitest'
import { buildPreference, createCheckout, preferenceItems, statementDescriptor } from '../../supabase/functions/_shared/preference'
import { FakeDb, NOW, ORDER_ID, STORE_ID, env, fakeFetch, makeDeps, order, secret, store } from './fakes'

const sumCents = (items: { unit_price: number; quantity: number }[]) => items.reduce((s, i) => s + Math.round(i.unit_price * 100) * i.quantity, 0)

describe('preferência do Checkout Pro', () => {
  it('monta itens, taxa da plataforma, referência e URLs de volta', () => {
    const p = buildPreference(env, store(), order())
    expect(p.items).toEqual([
      { id: 'p1', title: 'Brigadeiro', quantity: 10, unit_price: 3.5, currency_id: 'BRL', picture_url: 'https://cdn.example/b.jpg' },
      { id: 'p2', title: 'Bolo (Chocolate / G)', quantity: 1, unit_price: 89.9, currency_id: 'BRL' },
      { id: 'entrega', title: 'Entrega: Centro', quantity: 1, unit_price: 8, currency_id: 'BRL' },
    ])
    expect(sumCents(p.items)).toBe(13290)
    expect(p.marketplace_fee).toBe(2.66)
    expect(p.external_reference).toBe(ORDER_ID)
    const back = `https://vitrine.example/doces-da-ana/pedido/${ORDER_ID}?t=tok123`
    expect(p.back_urls).toEqual({ success: back, pending: back, failure: back })
    expect(p.auto_return).toBe('approved')
    expect(p.notification_url).toBe(`https://proj.supabase.co/functions/v1/mp-webhook?store_id=${STORE_ID}&source_news=webhooks`)
    expect(p.statement_descriptor).toBe('DOCES DA ANA CIA')
    expect(p.payer).toEqual({ name: 'Maria', surname: 'da Silva Souza', email: 'maria@example.com', phone: { area_code: '11', number: '987654321' } })
    expect(p.payment_methods).toEqual({ installments: 6, excluded_payment_types: [{ id: 'ticket' }] })
  })

  it('distribui o desconto do cupom e a soma bate com o total', () => {
    const o = order({ discount_cents: 1001, total_cents: 13290 - 1001 })
    const items = preferenceItems(o)
    expect(sumCents(items)).toBe(o.total_cents)
    expect(items[0]).toMatchObject({ title: 'Brigadeiro x10', quantity: 1 })
    expect(items.at(-1)).toMatchObject({ id: 'entrega', unit_price: 8 })
  })

  it('sem frete não manda linha de entrega', () => {
    const items = preferenceItems(order({ shipping_cents: 0, total_cents: 12490 }))
    expect(items.map((i) => i.id)).toEqual(['p1', 'p2'])
  })

  it('nome na fatura sem acentos e com até 22 letras', () => {
    expect(statementDescriptor('Açaí do João — Delivery 24h Ltda')).toBe('ACAI DO JOAO DELIVERY')
    expect(statementDescriptor('!!!')).toBe('LOJA')
  })

  it('cria a preferência com o token do lojista e devolve o init_point', async () => {
    const db = new FakeDb()
    const { fetch, calls } = fakeFetch({ 'POST /checkout/preferences': () => ({ id: 'pref-1', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' }) })
    const r = await createCheckout(makeDeps(db, fetch), { order_id: ORDER_ID, token: 'tok123' })
    expect(r.url).toContain('pref_id=pref-1')
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.authorization).toBe('Bearer APP_USR-seller')
    expect((calls[0].body as { marketplace_fee: number }).marketplace_fee).toBe(2.66)
  })

  it('renova o token vencido antes de criar a preferência', async () => {
    const db = new FakeDb()
    db.secrets.set(STORE_ID, secret({ expires_at: '2026-11-26T13:00:00Z' }))
    const { fetch, calls } = fakeFetch({
      'POST /oauth/token': () => ({ access_token: 'APP_USR-novo', refresh_token: 'TG-novo', expires_in: 15552000, user_id: 999 }),
      'POST /checkout/preferences': () => ({ init_point: 'https://mp/checkout' }),
    })
    await createCheckout(makeDeps(db, fetch), { order_id: ORDER_ID, token: 'tok123' })
    expect(calls[0].body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'TG-refresh', client_secret: 'segredo-app' })
    expect(calls[1].headers.authorization).toBe('Bearer APP_USR-novo')
    const saved = db.secrets.get(STORE_ID)!
    expect(saved.access_token).toBe('APP_USR-novo')
    expect(saved.public_key).toBe('APP_USR-pk')
    expect(Date.parse(saved.expires_at)).toBe(NOW.getTime() + 15552000 * 1000)
  })

  it('recusa token errado, pedido pago ou de outra forma de pagamento, loja sem conta', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /checkout/preferences': () => ({ init_point: 'x' }) })
    const run = (db: FakeDb, body: unknown) => createCheckout(makeDeps(db, fetch), body)
    await expect(run(new FakeDb(), { order_id: ORDER_ID, token: 'errado' })).rejects.toThrow('Pedido não encontrado')
    await expect(run(new FakeDb(), {})).rejects.toThrow('Pedido não encontrado')
    const paid = new FakeDb()
    paid.orders = [order({ status: 'paid' })]
    await expect(run(paid, { order_id: ORDER_ID, token: 'tok123' })).rejects.toThrow('já foi pago')
    const pix = new FakeDb()
    pix.orders = [order({ payment: { method: 'pix', status: 'pending', provider_ref: '', change_for_cents: 0 } })]
    await expect(run(pix, { order_id: ORDER_ID, token: 'tok123' })).rejects.toThrow('não é pago pelo Mercado Pago')
    const noAccount = new FakeDb()
    noAccount.secrets.clear()
    await expect(run(noAccount, { order_id: ORDER_ID, token: 'tok123' })).rejects.toThrow('ainda não conectou')
    expect(calls).toHaveLength(0)
  })
})

describe('renovação do acesso ao Mercado Pago', () => {
  const expired = () => secret({ expires_at: '2026-11-26T13:00:00Z' })

  it('Mercado Pago recusa a renovação: conexão fica como caída e a loja deixa de oferecer', async () => {
    const db = new FakeDb()
    db.secrets.set(STORE_ID, expired())
    const { fetch } = fakeFetch({ 'POST /oauth/token': () => new Response('{"error":"invalid_grant"}', { status: 400 }) })
    await expect(createCheckout(makeDeps(db, fetch), { order_id: ORDER_ID, token: 'tok123' })).rejects.toThrow('ainda não conectou')
    expect(db.revoked).toEqual([STORE_ID])
  })

  it('outra chamada renovou primeiro: usa o token novo sem derrubar a conexão', async () => {
    const db = new FakeDb()
    db.secrets.set(STORE_ID, expired())
    const { fetch, calls } = fakeFetch({
      'POST /oauth/token': () => {
        db.secrets.set(STORE_ID, secret({ access_token: 'APP_USR-da-outra', expires_at: '2027-05-01T00:00:00Z' }))
        return new Response('{"error":"invalid_grant"}', { status: 400 })
      },
      'POST /checkout/preferences': () => ({ init_point: 'https://mp/checkout' }),
    })
    await createCheckout(makeDeps(db, fetch), { order_id: ORDER_ID, token: 'tok123' })
    expect(calls[1].headers.authorization).toBe('Bearer APP_USR-da-outra')
    expect(db.revoked).toEqual([])
  })

  it('falha passageira com token ainda válido: segue com o token atual', async () => {
    const db = new FakeDb()
    db.secrets.set(STORE_ID, secret({ expires_at: '2026-11-26T18:00:00Z' })) // vence em 6 h (renova antes de 24 h)
    const { fetch, calls } = fakeFetch({
      'POST /oauth/token': () => new Response('erro', { status: 503 }),
      'POST /checkout/preferences': () => ({ init_point: 'https://mp/checkout' }),
    })
    await createCheckout(makeDeps(db, fetch), { order_id: ORDER_ID, token: 'tok123' })
    expect(calls[1].headers.authorization).toBe('Bearer APP_USR-seller')
    expect(db.revoked).toEqual([])
  })
})
