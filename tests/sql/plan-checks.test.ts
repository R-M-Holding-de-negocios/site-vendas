// Migração 0006: o servidor confere plano e forma de pagamento mesmo com chamada direta à API.
import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, anon, errorOf } from './harness'

let db: TestDb
let pro: Awaited<ReturnType<TestDb['merchant']>>
let loja: Awaited<ReturnType<TestDb['merchant']>>
let vitrine: Awaited<ReturnType<TestDb['merchant']>>
let product = ''

beforeAll(async () => {
  db = await TestDb.create()
  pro = await db.merchant('loja-pro')
  loja = await db.merchant('loja-media', 'loja')
  vitrine = await db.merchant('loja-basica', 'vitrine')
  for (const m of [pro, loja]) await db.insert('coupons', { store_id: m.storeId, code: 'DEZ', type: 'percent', value: 10 })
  product = (await db.insert<{ id: string }>('products', { store_id: pro.storeId, name: 'P', price_cents: 1000 })).id
})

const order = (payment: unknown) => ({
  store_id: pro.storeId, lines: [{ product_id: product, variant_id: null, qty: 1 }],
  customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
  payment, coupon: '', notes: '', source: null, checkout_id: null,
})

describe('plano conferido no servidor', () => {
  it('cupom só responde em loja Pro no ar', async () => {
    expect(await db.rpc(anon, 'check_coupon', { store_id: pro.storeId, code: 'dez' })).toMatchObject({ code: 'DEZ' })
    expect(await db.rpc(anon, 'check_coupon', { store_id: loja.storeId, code: 'DEZ' })).toBeNull()
    await db.q({ role: 'postgres' }, `update stores set status = 'suspended' where id = $1`, [pro.storeId])
    expect(await db.rpc(anon, 'check_coupon', { store_id: pro.storeId, code: 'DEZ' })).toBeNull()
    await db.q({ role: 'postgres' }, `update stores set status = 'active' where id = $1`, [pro.storeId])
  })

  it('carrinho abandonado só no Pro', async () => {
    const args = (store_id: string) => ({ id: null, store_id, session_id: 's', customer: { name: 'A', phone: '19988887777' }, items: [], total_cents: 0 })
    expect(await db.rpc(anon, 'save_checkout', args(pro.storeId))).toHaveProperty('id')
    expect(await errorOf(db.rpc(anon, 'save_checkout', args(loja.storeId)))).toBe('Recurso indisponível nesta loja.')
  })

  it('contatos só no Pro; aviso de chegada a partir do Loja', async () => {
    await db.q(anon, `insert into leads (store_id, contact) values ($1, 'x')`, [pro.storeId])
    expect(await errorOf(db.q(anon, `insert into leads (store_id, contact) values ($1, 'x')`, [loja.storeId]))).toMatch(/row-level security/)
    await db.q(anon, `insert into stock_alerts (store_id, product_id, contact) values ($1, $2, 'x')`, [loja.storeId, product])
    expect(await errorOf(db.q(anon, `insert into stock_alerts (store_id, product_id, contact) values ($1, $2, 'x')`, [vitrine.storeId, product]))).toMatch(/row-level security/)
  })

  it('pedido sem forma de pagamento é recusado', async () => {
    expect(await errorOf(db.rpc(anon, 'place_order', order(null)))).toBe('Escolha a forma de pagamento.')
    expect(await errorOf(db.rpc(anon, 'place_order', order({})))).toBe('Escolha a forma de pagamento.')
    expect(await db.rpc(anon, 'place_order', order({ method: 'whatsapp' }))).toHaveProperty('number')
  })
})
