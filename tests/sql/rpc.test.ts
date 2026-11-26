// Funções do servidor além do place_order, conferidas com src/lib/demo-rpc.ts.
import { beforeAll, describe, expect, it } from 'vitest'
import { DemoStore } from '../../src/lib/db-demo'
import { demoRpc } from '../../src/lib/demo-rpc'
import { defaultSettings, defaultTheme } from '../../src/lib/theme'
import type { Order, OrderStatus, Product, Store, Variant } from '../../src/lib/types'
import { TestDb, anon, errorOf, superuser, user } from './harness'

let db: TestDb

beforeAll(async () => {
  db = await TestDb.create()
})

function withCashAndPix() {
  const s = defaultSettings()
  s.payments.cash.enabled = true
  s.payments.pix = { enabled: true, key: 'k', holder: '', city: '', discount_percent: 0 }
  return s
}

async function storeWithOrder(slug: string) {
  const m = await db.merchant(slug, 'pro', withCashAndPix())
  const p = await db.insert<Product>('products', { store_id: m.storeId, name: 'Bolo', price_cents: 3000, cost_cents: 1000, track_stock: true, stock: 10 })
  const d = await db.insert<Product>('products', { store_id: m.storeId, name: 'Camiseta', price_cents: 5000, track_stock: true, options: [{ name: 'Tamanho', values: ['P'] }] })
  const v = await db.insert<Variant>('variants', { store_id: m.storeId, product_id: d.id, values: { Tamanho: 'P' }, stock: 4 })
  const order = await db.rpc<{ id: string; token: string }>(anon, 'place_order', {
    store_id: m.storeId,
    lines: [{ product_id: p.id, variant_id: null, qty: 3 }, { product_id: d.id, variant_id: v.id, qty: 2 }],
    customer: { name: 'Ana Souza', phone: '19988887777', email: '' },
    shipping: { method: 'pickup', address: null },
    payment: { method: 'cash', change_for_cents: 5000 },
    coupon: '', notes: '', source: null, checkout_id: null,
  })
  await db.q(superuser, `update orders set internal_notes = 'cliente chata' where id = $1`, [order.id])
  const stock = async () => {
    const [{ s1 }] = await db.q<{ s1: number }>(superuser, `select stock s1 from products where id = $1`, [p.id])
    const [{ s2 }] = await db.q<{ s2: number }>(superuser, `select stock s2 from variants where id = $1`, [v.id])
    return [s1, s2]
  }
  return { ...m, p, d, v, order, stock }
}

describe('create_store', () => {
  it('cria a loja em teste no plano Pro por 14 dias', async () => {
    const id = await db.createUser('nova@exemplo.com')
    const who = user(id)
    const s = await db.rpc<Store>(who, 'create_store', { name: '  Doces da Bia ', slug: 'doces-da-bia', whatsapp: '19999990000', settings: defaultSettings(), theme: defaultTheme() })
    expect(s).toMatchObject({ owner_id: id, slug: 'doces-da-bia', name: 'Doces da Bia', plan: 'pro', status: 'trial', paid_until: null, theme_draft: null, theme_history: [], description: '', logo_url: '' })
    expect(s.settings).toEqual(defaultSettings())
    const days = (Date.parse(s.trial_ends_at!) - Date.now()) / 86400000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThan(14.1)
    expect(await errorOf(db.rpc(who, 'create_store', { name: 'x', slug: 'outra-loja', whatsapp: '', settings: {}, theme: {} }))).toBe('Você já tem uma loja.')
  })

  it('valida o endereço como validSlug()', async () => {
    const who = user(await db.createUser('slug@exemplo.com'))
    const msg = 'Escolha outro endereço: use de 3 a 40 letras, números ou hífens.'
    for (const slug of ['ab', 'Maiuscula', '-comeca', 'termina-', 'com espaco', 'admin', 'painel', 'a'.repeat(41), 'acentuação'])
      expect(await errorOf(db.rpc(who, 'create_store', { name: 'x', slug, whatsapp: '', settings: {}, theme: {} })), slug).toBe(msg)
    expect(await errorOf(db.rpc(who, 'create_store', { name: 'x', slug: 'doces-da-bia', whatsapp: '', settings: {}, theme: {} }))).toBe('Esse endereço já está em uso. Escolha outro.')
    await expect(db.rpc(who, 'create_store', { name: 'x', slug: 'abc', whatsapp: '', settings: {}, theme: {} })).resolves.toMatchObject({ slug: 'abc' })
  })
})

describe('set_order_status', () => {
  it('confirma pagamento, guarda histórico e devolve o estoque ao cancelar', async () => {
    const m = await storeWithOrder('status-1')
    expect(await m.stock()).toEqual([7, 2])
    const paid = await db.rpc<Order>(m.who, 'set_order_status', { order_id: m.order.id, status: 'paid', note: 'Pix conferido' })
    expect(paid.status).toBe('paid')
    expect(paid.paid_at).toBeTruthy()
    expect(paid.payment).toEqual({ method: 'cash', status: 'paid', provider_ref: '', change_for_cents: 5000 })
    expect(paid.history.map((h) => [h.status, h.note])).toEqual([['pending', 'Pedido feito na loja'], ['paid', 'Pix conferido']])
    // mesma situação: nada muda
    const same = await db.rpc<Order>(m.who, 'set_order_status', { order_id: m.order.id, status: 'paid', note: 'de novo' })
    expect(same.history).toHaveLength(2)
    const shipped = await db.rpc<Order>(m.who, 'set_order_status', { order_id: m.order.id, status: 'shipped', note: '' })
    expect(shipped.paid_at).toBe(paid.paid_at)
    const refunded = await db.rpc<Order>(m.who, 'set_order_status', { order_id: m.order.id, status: 'refunded', note: 'devolveu' })
    expect(refunded.payment.status).toBe('refunded')
    expect(await m.stock()).toEqual([10, 4])
    // estornado -> cancelado não devolve de novo
    await db.rpc(m.who, 'set_order_status', { order_id: m.order.id, status: 'cancelled', note: '' })
    expect(await m.stock()).toEqual([10, 4])
    expect(await errorOf(db.rpc(m.who, 'set_order_status', { order_id: m.order.id, status: 'paid', note: '' }))).toBe('Um pedido cancelado não pode ser reaberto. Registre um novo pedido.')
    expect(await errorOf(db.rpc(m.who, 'set_order_status', { order_id: m.order.id, status: 'pending', note: '' }))).toBe('Um pedido cancelado não pode ser reaberto. Registre um novo pedido.')
  })

  it('cancelar pedido pendente mantém o pagamento pendente', async () => {
    const m = await storeWithOrder('status-2')
    const o = await db.rpc<Order>(m.who, 'set_order_status', { order_id: m.order.id, status: 'cancelled', note: '' })
    expect(o.payment.status).toBe('pending')
    expect(o.paid_at).toBeNull()
    expect(await m.stock()).toEqual([10, 4])
  })

  it('só o dono da loja ou o admin', async () => {
    const m = await storeWithOrder('status-3')
    const other = await db.merchant('status-outro')
    expect(await errorOf(db.rpc(other.who, 'set_order_status', { order_id: m.order.id, status: 'paid', note: '' }))).toBe('Você não tem permissão para fazer isso.')
    expect(await errorOf(db.rpc(other.who, 'set_order_status', { order_id: '00000000-0000-0000-0000-000000000000', status: 'paid', note: '' }))).toBe('Pedido não encontrado.')
    const adminId = await db.createUser('adm-status@vitrine.com')
    await db.makeAdmin(adminId)
    expect(await errorOf(db.rpc(user(adminId, 'aal1'), 'set_order_status', { order_id: m.order.id, status: 'paid', note: '' }))).toBe('Você não tem permissão para fazer isso.')
    await expect(db.rpc(user(adminId, 'aal2'), 'set_order_status', { order_id: m.order.id, status: 'paid', note: '' })).resolves.toMatchObject({ status: 'paid' })
  })

  it('segue a mesma sequência de situações que o modo demonstração', async () => {
    const m = await storeWithOrder('status-4')
    localStorage.clear()
    const s = new DemoStore()
    s.user = { id: m.ownerId, email: 'x@y.com' }
    const [dbOrder] = await db.rows<Order>(superuser, `select * from orders where id = $1`, [m.order.id])
    s.rows('stores').push({ id: m.storeId, owner_id: m.ownerId } as Store)
    s.rows('orders').push(structuredClone(dbOrder))
    s.rows('products').push({ id: m.p.id, track_stock: true, stock: 7 } as Product, { id: m.d.id, track_stock: true, stock: 0 } as Product)
    s.rows('variants').push({ id: m.v.id, stock: 2 } as Variant)
    const demo = demoRpc(s)
    const steps: OrderStatus[] = ['preparing', 'ready', 'delivered', 'refunded', 'cancelled']
    for (const status of steps) {
      const a = await db.rpc<Order>(m.who, 'set_order_status', { order_id: m.order.id, status, note: status })
      const b = await demo.set_order_status({ order_id: m.order.id, status, note: status })
      expect([a.status, a.payment, !!a.paid_at, a.history.map((h) => [h.status, h.note])]).toEqual([b.status, b.payment, !!b.paid_at, b.history.map((h) => [h.status, h.note])])
    }
    expect(await m.stock()).toEqual([s.rows('products')[0].stock, s.rows('variants')[0].stock])
  })
})

describe('get_public_order', () => {
  it('esconde custo, taxa e anotações internas', async () => {
    const m = await storeWithOrder('publico-1')
    const o = await db.rpc<Order>(anon, 'get_public_order', { id: m.order.id, token: m.order.token })
    expect(o.internal_notes).toBe('')
    expect(o.platform_fee_cents).toBe(0)
    expect(o.items.map((i) => i.cost_cents)).toEqual([null, null])
    expect(o.items.map((i) => i.name)).toEqual(['Bolo', 'Camiseta'])
    expect(o.token).toBe(m.order.token)
    expect(await db.rpc(anon, 'get_public_order', { id: m.order.id, token: 'errado' })).toBeNull()
    expect(await db.rpc(anon, 'get_public_order', { id: m.order.id, token: '' })).toBeNull()
    // o lojista continua vendo o custo
    const [full] = await db.rows<Order>(m.who, `select * from orders where id = $1`, [m.order.id])
    expect(full.items[0].cost_cents).toBe(1000)
    expect(full.internal_notes).toBe('cliente chata')
  })
})

describe('check_coupon', () => {
  it('acha cupom ativo pelo código, sem diferenciar maiúsculas', async () => {
    const m = await db.merchant('cupons')
    await db.insert('coupons', { store_id: m.storeId, code: 'BEMVINDO', type: 'percent', value: 10 })
    await db.insert('coupons', { store_id: m.storeId, code: 'OFF', active: false })
    expect(await db.rpc(anon, 'check_coupon', { store_id: m.storeId, code: ' bemvindo ' })).toMatchObject({ code: 'BEMVINDO', value: 10 })
    expect(await db.rpc(anon, 'check_coupon', { store_id: m.storeId, code: 'OFF' })).toBeNull()
    expect(await db.rpc(anon, 'check_coupon', { store_id: m.storeId, code: 'NADA' })).toBeNull()
  })
})

describe('save_checkout', () => {
  it('cria e atualiza o carrinho da sessão', async () => {
    const m = await db.merchant('carrinhos')
    const args = { id: null, store_id: m.storeId, session_id: 's1', customer: { name: 'Ana', phone: '1999' }, items: [], total_cents: 100 }
    const a = await db.rpc<{ id: string }>(anon, 'save_checkout', args)
    const b = await db.rpc<{ id: string }>(anon, 'save_checkout', { ...args, id: a.id, total_cents: 250 })
    expect(b.id).toBe(a.id)
    const [c] = await db.rows<{ total_cents: number }>(m.who, `select * from checkouts where id = $1`, [a.id])
    expect(c.total_cents).toBe(250)
    // outro id de outra loja não é reaproveitado
    const other = await db.merchant('carrinhos-2')
    const d = await db.rpc<{ id: string }>(anon, 'save_checkout', { ...args, id: a.id, store_id: other.storeId })
    expect(d.id).not.toBe(a.id)
  })
})

describe('submit_review', () => {
  it('só pedidos entregues, uma vez por produto, aguardando aprovação', async () => {
    const m = await storeWithOrder('avaliacoes')
    const args = { order_id: m.order.id, token: m.order.token, product_id: m.p.id, rating: 4.6, comment: '  Muito bom!  ', name: '' }
    expect(await errorOf(db.rpc(anon, 'submit_review', args))).toBe('Só é possível avaliar pedidos entregues.')
    await db.rpc(m.who, 'set_order_status', { order_id: m.order.id, status: 'delivered', note: '' })
    expect(await errorOf(db.rpc(anon, 'submit_review', { ...args, token: 'x' }))).toBe('Só é possível avaliar pedidos entregues.')
    expect(await errorOf(db.rpc(anon, 'submit_review', { ...args, product_id: '00000000-0000-0000-0000-000000000000' }))).toBe('Este produto não faz parte do pedido.')
    await db.rpc(anon, 'submit_review', args)
    expect(await errorOf(db.rpc(anon, 'submit_review', args))).toBe('Você já avaliou este produto.')
    const [r] = await db.rows<{ name: string; rating: number; comment: string; approved: boolean }>(superuser, `select * from reviews where order_id = $1`, [m.order.id])
    expect(r).toMatchObject({ name: 'Ana', rating: 5, comment: 'Muito bom!', approved: false })
    expect((await db.q(anon, `select 1 from reviews where order_id = $1`, [m.order.id])).length).toBe(0)
    await db.rpc(anon, 'submit_review', { ...args, product_id: m.d.id, rating: 0, name: 'B'.repeat(80) })
    const [r2] = await db.rows<{ name: string; rating: number }>(superuser, `select * from reviews where product_id = $1`, [m.d.id])
    expect(r2).toMatchObject({ name: 'B'.repeat(60), rating: 1 })
  })
})

describe('delete_my_store', () => {
  it('apaga a loja e tudo dela, sem tocar nas outras', async () => {
    const m = await storeWithOrder('apagar')
    const keep = await storeWithOrder('manter')
    await db.insert('store_secrets', { store_id: m.storeId, provider: 'mercadopago', data: {} })
    await db.rpc(m.who, 'delete_my_store', {})
    for (const t of ['stores', 'products', 'variants', 'orders', 'customers', 'store_secrets']) {
      const col = t === 'stores' ? 'id' : 'store_id'
      expect((await db.q(superuser, `select 1 from public.${t} where ${col} = $1`, [m.storeId])).length, t).toBe(0)
    }
    expect((await db.q(superuser, `select 1 from orders where store_id = $1`, [keep.storeId])).length).toBe(1)
    // sem loja: não faz nada
    await expect(db.rpc(m.who, 'delete_my_store', {})).resolves.toBeNull()
  })
})

describe('expire_pending_orders', () => {
  it('cancela Pix/Mercado Pago pendentes há mais de 24 horas e devolve o estoque', async () => {
    const m = await db.merchant('expira', 'pro', withCashAndPix())
    const p = await db.insert<Product>('products', { store_id: m.storeId, name: 'X', price_cents: 1000, track_stock: true, stock: 10 })
    const place = (method: string) =>
      db.rpc<{ id: string }>(anon, 'place_order', {
        store_id: m.storeId, lines: [{ product_id: p.id, variant_id: null, qty: 2 }],
        customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
        payment: { method }, coupon: '', notes: '', source: null, checkout_id: null,
      })
    const oldPix = await place('pix')
    const newPix = await place('pix')
    const oldCash = await place('cash')
    await db.q(superuser, `update orders set created_at = now() - interval '25 hours' where id = any($1)`, [[oldPix.id, oldCash.id]])
    const [{ n }] = await db.q<{ n: number }>(superuser, `select public.expire_pending_orders() n`)
    expect(n).toBe(1)
    const rows = await db.rows<Order>(superuser, `select * from orders where store_id = $1`, [m.storeId])
    const by = (id: string) => rows.find((o) => o.id === id)!
    expect(by(oldPix.id).status).toBe('cancelled')
    expect(by(oldPix.id).history.at(-1)).toMatchObject({ status: 'cancelled', note: 'Pagamento não confirmado em 24 horas' })
    expect(by(newPix.id).status).toBe('pending')
    expect(by(oldCash.id).status).toBe('pending')
    const [{ stock }] = await db.q<{ stock: number }>(superuser, `select stock from products where id = $1`, [p.id])
    expect(stock).toBe(6)
  })
})

describe('pedidos seguidos do mesmo produto', () => {
  it('não vende mais do que o estoque', async () => {
    const m = await db.merchant('concorrencia')
    const p = await db.insert<Product>('products', { store_id: m.storeId, name: 'Último', price_cents: 1000, track_stock: true, stock: 3 })
    const args = {
      store_id: m.storeId, lines: [{ product_id: p.id, variant_id: null, qty: 1 }],
      customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
      payment: { method: 'whatsapp' }, coupon: '', notes: '', source: null, checkout_id: null,
    }
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => db.rpc<{ number: number }>(anon, 'place_order', args)))
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ number: number }>[]
    expect(ok.map((r) => r.value.number).sort()).toEqual([1001, 1002, 1003])
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.message)).toEqual(['Último esgotou.', 'Último esgotou.'])
    const [{ stock }] = await db.q<{ stock: number }>(superuser, `select stock from products where id = $1`, [p.id])
    expect(stock).toBe(0)
  })
})
