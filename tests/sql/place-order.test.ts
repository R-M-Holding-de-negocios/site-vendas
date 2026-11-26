// place_order no banco x quote() de src/lib/pricing.ts com as mesmas entradas.
import { beforeAll, describe, expect, it } from 'vitest'
import { openState } from '../../src/lib/hours'
import { quote, type CartLine } from '../../src/lib/pricing'
import { defaultSettings } from '../../src/lib/theme'
import type { Coupon, Order, PayMethod, PlanId, Product, ShipMethod, StoreSettings, Variant } from '../../src/lib/types'
import { TestDb, anon, errorOf, superuser } from './harness'

const DAY = 86400000
const future = new Date(Date.now() + 30 * DAY).toISOString()
const past = new Date(Date.now() - 30 * DAY).toISOString()

type ProductRow = Product & { sold_count: number }

function settingsFor(over: (s: StoreSettings) => void = () => undefined): StoreSettings {
  const s = defaultSettings()
  s.delivery.zones = { enabled: true, items: [{ name: 'Centro', fee_cents: 800 }, { name: 'Cambuí', fee_cents: 1250 }] }
  s.delivery.fixed = { enabled: true, fee_cents: 1500, label: 'Motoboy' }
  s.payments.pix = { enabled: true, key: 'pix@loja.com', holder: 'Ana', city: 'Campinas', discount_percent: 5 }
  s.payments.cash.enabled = true
  s.payments.mercadopago.enabled = true
  over(s)
  return s
}

interface Scenario {
  name: string
  plan?: PlanId
  settings?: (s: StoreSettings) => void
  lines: (ids: Ids) => CartLine[]
  shipping?: { method: ShipMethod; zone?: string }
  payment?: PayMethod
  coupon?: Partial<Coupon> | string
  mercadopagoConnected?: boolean
  manual?: boolean
  /** Mensagem esperada quando não vem do quote() (validações antes do cálculo). */
  error?: string
}

interface Ids {
  a: string // com estoque e desconto por quantidade
  b: string // promoção válida
  c: string // promoção vencida
  d: string // com opções
  dP: string
  dM: string
  dG: string // variação indisponível
  dX: string // variação esgotada
  e: string // indisponível
  f: string // sem controle de estoque, com custo
  g: string // bloqueado pelo admin
  other: string // produto de outra loja
}

let db: TestDb
let counter = 0
let otherProduct: string

async function setupStore(plan: PlanId, settings: StoreSettings) {
  const m = await db.merchant(`loja-${++counter}`, plan, settings)
  const sid = m.storeId
  const p = (row: Partial<ProductRow>) => db.insert<ProductRow>('products', { store_id: sid, ...row })
  const a = await p({ name: 'Bolo de pote', price_cents: 2990, track_stock: true, stock: 10, cost_cents: 1200, images: ['a.jpg'], qty_discounts: [{ min_qty: 3, percent: 10 }, { min_qty: 6, percent: 15 }] })
  const b = await p({ name: 'Torta', price_cents: 5000, promo_price_cents: 3990, promo_ends_at: future, qty_discounts: [{ min_qty: 2, percent: 7.5 }] })
  const c = await p({ name: 'Pudim', price_cents: 5000, promo_price_cents: 3990, promo_ends_at: past })
  const d = await p({ name: 'Camiseta', price_cents: 5000, promo_price_cents: 4500, track_stock: true, images: ['d.jpg'], options: [{ name: 'Tamanho', values: ['P', 'M', 'G', 'GG'] }, { name: 'Cor', values: ['Azul'] }] })
  const v = (row: Partial<Variant>) => db.insert<Variant>('variants', { store_id: sid, product_id: d.id, ...row })
  const dP = await v({ values: { Tamanho: 'P', Cor: 'Azul' }, price_cents: null, stock: 5, image: 'p.jpg' })
  const dM = await v({ values: { Tamanho: 'M', Cor: 'Azul' }, price_cents: 6500, stock: 3 })
  const dG = await v({ values: { Tamanho: 'G', Cor: 'Azul' }, stock: 9, available: false })
  const dX = await v({ values: { Tamanho: 'GG', Cor: 'Azul' }, stock: 0 })
  const e = await p({ name: 'Brownie', price_cents: 900, available: false })
  const f = await p({ name: 'Caixa presente', price_cents: 1999, cost_cents: 800 })
  const g = await p({ name: 'Proibido', price_cents: 100, blocked: true })
  const ids: Ids = { a: a.id, b: b.id, c: c.id, d: d.id, dP: dP.id, dM: dM.id, dG: dG.id, dX: dX.id, e: e.id, f: f.id, g: g.id, other: otherProduct }
  return { ...m, ids }
}

const address = { cep: '13000-000', street: 'Rua A', number: '10', complement: '', district: 'Centro', city: 'Campinas', state: 'SP' }

async function run(sc: Scenario) {
  const plan = sc.plan ?? 'pro'
  const settings = settingsFor(sc.settings)
  const { storeId, ownerId, ids, who } = await setupStore(plan, settings)
  if (sc.mercadopagoConnected) await db.insert('store_secrets', { store_id: storeId, provider: 'mercadopago', data: { access_token: 'x' } })
  let couponCode = ''
  if (typeof sc.coupon === 'string') couponCode = sc.coupon
  else if (sc.coupon) {
    couponCode = sc.coupon.code ?? 'DESCONTO'
    await db.insert('coupons', { store_id: storeId, code: couponCode, type: 'percent', value: 10, ...sc.coupon })
  }
  const lines = sc.lines(ids)
  const shipping = sc.shipping ?? { method: 'pickup' as ShipMethod }
  const payment = sc.payment ?? 'cash'

  // Entradas do quote() lidas do banco, como o modo demonstração faria.
  const pids = lines.map((l) => l.product_id)
  const products = await db.rows<Product>(superuser, `select * from products where store_id = $1 and id::text = any($2)`, [storeId, pids])
  const variants = await db.rows<Variant>(superuser, `select * from variants where store_id = $1 and product_id::text = any($2)`, [storeId, pids])
  const [coupon] = couponCode
    ? await db.rows<Coupon>(superuser, `select * from coupons where store_id = $1 and code = $2 and active`, [storeId, couponCode.trim().toUpperCase()])
    : []
  const [{ fee_percent }] = await db.rows<{ fee_percent: number }>(superuser, `select fee_percent from plans where id = $1`, [plan])
  const q = quote({
    store: { plan, settings },
    lines,
    products,
    variants,
    shipping,
    payment,
    coupon: plan === 'pro' ? (coupon ?? null) : null,
    feePercent: Number(fee_percent),
    now: new Date(),
  })

  const args = {
    store_id: storeId,
    lines,
    customer: { name: '  Maria Silva ', phone: '(19) 98888-7777', email: 'maria@exemplo.com' },
    shipping: { ...shipping, address: shipping.method === 'zone' || shipping.method === 'fixed' ? address : null },
    payment: { method: payment },
    coupon: couponCode,
    notes: ' sem açúcar ',
    source: { source: 'instagram', medium: '', campaign: '', device: 'mobile' },
    checkout_id: null,
    manual: sc.manual,
  }
  const caller = sc.manual ? who : anon
  const errors = sc.manual ? q.errors.filter((e) => !e.startsWith('O pedido mínimo')) : q.errors
  const expectedError = sc.error ?? errors[0] ?? (coupon && q.coupon_error ? q.coupon_error : undefined)
  return { storeId, ownerId, ids, q, products, variants, coupon, args, caller, expectedError }
}

beforeAll(async () => {
  db = await TestDb.create()
  const other = await db.merchant('outra-loja')
  const p = await db.insert<Product>('products', { store_id: other.storeId, name: 'De outra loja', price_cents: 100 })
  otherProduct = p.id
})

const one = (id: (i: Ids) => string, qty = 1, variant?: (i: Ids) => string) => (i: Ids): CartLine[] => [
  { product_id: id(i), variant_id: variant ? variant(i) : null, qty },
]

const scenarios: Scenario[] = [
  { name: 'retirada, dinheiro, preço cheio', lines: one((i) => i.a) },
  { name: 'desconto por quantidade no Pro + entrega por bairro + Pix', lines: one((i) => i.a, 3), shipping: { method: 'zone', zone: 'Centro' }, payment: 'pix' },
  { name: 'faixa maior de desconto por quantidade', lines: one((i) => i.a, 7), shipping: { method: 'fixed' } },
  { name: 'desconto por quantidade não vale no plano Loja', plan: 'loja', lines: one((i) => i.a, 6), shipping: { method: 'fixed' } },
  { name: 'promoção válida, com desconto fracionado por quantidade', lines: one((i) => i.b, 3) },
  { name: 'promoção vencida usa o preço normal', lines: one((i) => i.c, 2), payment: 'pix' },
  {
    name: 'variação com preço próprio e variação com preço do produto (promo)',
    lines: (i) => [
      { product_id: i.d, variant_id: i.dM, qty: 2 },
      { product_id: i.d, variant_id: i.dP, qty: 1 },
      { product_id: i.f, variant_id: null, qty: 1 },
    ],
    shipping: { method: 'zone', zone: 'Cambuí' },
  },
  { name: 'cupom de porcentagem + Pix', coupon: { code: 'DEZ', type: 'percent', value: 10 }, lines: one((i) => i.a, 2), shipping: { method: 'zone', zone: 'Centro' }, payment: 'pix' },
  { name: 'cupom de porcentagem acima de 100% fica em 100%', coupon: { code: 'TUDO', type: 'percent', value: 150 }, lines: one((i) => i.a, 1), shipping: { method: 'fixed' } },
  { name: 'cupom digitado em minúsculas e com espaços', coupon: { code: 'DEZ', type: 'percent', value: 10 }, lines: one((i) => i.f, 3) },
  { name: 'cupom de valor fixo', coupon: { code: 'MENOS15', type: 'fixed', value: 1500 }, lines: one((i) => i.a, 1), shipping: { method: 'fixed' } },
  { name: 'cupom de valor fixo maior que o subtotal', coupon: { code: 'MENOS99', type: 'fixed', value: 9900 }, lines: one((i) => i.f, 1), shipping: { method: 'fixed' }, payment: 'pix' },
  { name: 'cupom de frete grátis', coupon: { code: 'FRETE', type: 'free_shipping', value: 0 }, lines: one((i) => i.a, 1), shipping: { method: 'zone', zone: 'Cambuí' } },
  { name: 'cupom de frete grátis na retirada não muda nada', coupon: { code: 'FRETE', type: 'free_shipping', value: 0 }, lines: one((i) => i.a, 1) },
  { name: 'cupom com valor mínimo não atingido', coupon: { code: 'MIN', type: 'percent', value: 10, min_order_cents: 123456 }, lines: one((i) => i.a, 1) },
  { name: 'cupom com valor mínimo atingido', coupon: { code: 'MIN', type: 'percent', value: 10, min_order_cents: 5000 }, lines: one((i) => i.a, 2) },
  { name: 'cupom vencido', coupon: { code: 'VELHO', ends_at: past }, lines: one((i) => i.a, 1) },
  { name: 'cupom que ainda não começou', coupon: { code: 'NOVO', starts_at: future }, lines: one((i) => i.a, 1) },
  { name: 'cupom esgotado', coupon: { code: 'LIMITE', max_uses: 2, uses: 2 }, lines: one((i) => i.a, 1) },
  { name: 'cupom inexistente', coupon: 'NAOEXISTE', lines: one((i) => i.a, 1), error: 'Cupom inválido.' },
  { name: 'cupom inativo', coupon: { code: 'OFF', active: false }, lines: one((i) => i.a, 1), error: 'Cupom inválido.' },
  { name: 'cupom é ignorado fora do plano Pro', plan: 'loja', coupon: { code: 'DEZ' }, lines: one((i) => i.a, 1) },
  { name: 'frete grátis acima do valor (plano Loja)', plan: 'loja', settings: (s) => (s.free_shipping_above_cents = 5000), lines: one((i) => i.a, 2), shipping: { method: 'zone', zone: 'Centro' } },
  { name: 'frete grátis: abaixo do valor paga o frete', plan: 'loja', settings: (s) => (s.free_shipping_above_cents = 5000), lines: one((i) => i.a, 1), shipping: { method: 'zone', zone: 'Centro' } },
  { name: 'frete grátis conta o valor depois do cupom', settings: (s) => (s.free_shipping_above_cents = 5900), coupon: { code: 'DEZ' }, lines: one((i) => i.a, 2), shipping: { method: 'fixed' } },
  { name: 'taxa fixa com rótulo vazio vira "Entrega"', settings: (s) => (s.delivery.fixed.label = ''), lines: one((i) => i.f, 1), shipping: { method: 'fixed' } },
  { name: 'combinar entrega', lines: one((i) => i.f, 1), shipping: { method: 'arrange' }, payment: 'whatsapp' },
  { name: 'pedido mínimo', settings: (s) => (s.min_order_cents = 100000), lines: one((i) => i.a, 1) },
  { name: 'pedido mínimo não vale para pedido manual', manual: true, settings: (s) => (s.min_order_cents = 100000), lines: one((i) => i.a, 1) },
  { name: 'estoque insuficiente', lines: one((i) => i.a, 11) },
  { name: 'mesmo produto em duas linhas soma o estoque', lines: (i) => [{ product_id: i.a, variant_id: null, qty: 6 }, { product_id: i.a, variant_id: null, qty: 6 }] },
  { name: 'variação esgotada', lines: one((i) => i.d, 1, (i) => i.dX) },
  { name: 'variação indisponível', lines: one((i) => i.d, 1, (i) => i.dG) },
  { name: 'produto com opções sem variação', lines: one((i) => i.d, 1) },
  { name: 'produto indisponível', lines: one((i) => i.e, 1) },
  { name: 'produto bloqueado pelo admin', lines: one((i) => i.g, 1) },
  { name: 'produto de outra loja', lines: one((i) => i.other, 1) },
  { name: 'quantidade inválida', lines: one((i) => i.f, 0) },
  { name: 'quantidade fracionada é arredondada para baixo', lines: one((i) => i.f, 2.7) },
  { name: 'carrinho vazio', lines: () => [] },
  { name: 'bairro não escolhido', lines: one((i) => i.a), shipping: { method: 'zone', zone: 'Lua' } },
  { name: 'entrega desativada', settings: (s) => (s.delivery.pickup.enabled = false), lines: one((i) => i.a) },
  { name: 'pagamento desativado', lines: one((i) => i.a), payment: 'card_on_delivery' },
  { name: 'Mercado Pago conectado cobra a taxa do plano Pro', mercadopagoConnected: true, lines: one((i) => i.a, 3), shipping: { method: 'zone', zone: 'Centro' }, payment: 'mercadopago' },
  { name: 'Mercado Pago conectado cobra a taxa do plano Loja', plan: 'loja', mercadopagoConnected: true, lines: one((i) => i.b, 1), shipping: { method: 'fixed' }, payment: 'mercadopago' },
  { name: 'Mercado Pago sem conta conectada é recusado', lines: one((i) => i.a, 1), payment: 'mercadopago', error: 'Forma de pagamento indisponível.' },
  { name: 'plano Vitrine não recebe pedidos salvos', plan: 'vitrine', lines: one((i) => i.a), error: 'Esta loja recebe pedidos pelo WhatsApp.' },
]

describe('place_order calcula igual a quote()', () => {
  for (const sc of scenarios) {
    it(sc.name, async () => {
      const r = await run(sc)
      if (r.expectedError) {
        expect(await errorOf(db.rpc(r.caller, 'place_order', r.args))).toBe(r.expectedError)
        // nada foi gravado nem baixado do estoque
        const [{ n }] = await db.q<{ n: number }>(superuser, `select count(*)::int n from orders where store_id = $1`, [r.storeId])
        expect(n).toBe(0)
        const after = await db.rows<ProductRow>(superuser, `select * from products where store_id = $1 order by id`, [r.storeId])
        expect(after.every((p) => p.sold_count === 0)).toBe(true)
        return
      }
      const placed = await db.rpc<{ id: string; number: number; token: string; total_cents: number; status: string }>(r.caller, 'place_order', r.args)
      const [o] = await db.rows<Order>(superuser, `select * from orders where id = $1`, [placed.id])
      const { q } = r
      expect(placed).toEqual({ id: o.id, number: 1001, token: o.token, total_cents: q.total_cents, status: 'pending' })
      expect(o.token).toMatch(/^[a-km-np-z2-9]{24}$/)
      expect(o.items).toEqual(q.items)
      expect({
        subtotal: o.subtotal_cents,
        discount: o.discount_cents,
        shipping: o.shipping_cents,
        total: o.total_cents,
        fee: o.platform_fee_cents,
        label: o.shipping.label,
        fee_cents: o.shipping.fee_cents,
      }).toEqual({
        subtotal: q.subtotal_cents,
        discount: q.discount_cents,
        shipping: q.shipping_cents,
        total: q.total_cents,
        fee: q.platform_fee_cents,
        label: q.shipping_label,
        fee_cents: q.shipping_cents,
      })
      expect(o.coupon_code).toBe(r.coupon && sc.plan !== 'loja' && !q.coupon_error ? r.coupon.code : '')
      expect(o.customer).toEqual({ name: 'Maria Silva', phone: '19988887777', email: 'maria@exemplo.com' })
      expect(o.notes).toBe('sem açúcar')
      expect(o.shipping.address).toEqual(r.args.shipping.address)
      expect(o.payment).toEqual({ method: r.args.payment.method, status: 'pending', provider_ref: '', change_for_cents: 0 })
      expect(o.history).toHaveLength(1)
      expect(o.history[0].note).toBe(sc.manual ? 'Pedido registrado no painel' : 'Pedido feito na loja')
      expect(o.manual).toBe(!!sc.manual)

      // estoque, vendidos e usos do cupom
      const after = await db.rows<ProductRow>(superuser, `select * from products where store_id = $1`, [r.storeId])
      const afterV = await db.rows<Variant>(superuser, `select * from variants where store_id = $1`, [r.storeId])
      for (const p of r.products) {
        const qty = q.items.filter((i) => i.product_id === p.id).reduce((s, i) => s + i.qty, 0)
        const now = after.find((x) => x.id === p.id)!
        expect(now.sold_count).toBe(qty)
        if (p.track_stock && !(p.options ?? []).length) expect(now.stock).toBe(p.stock - qty)
        else expect(now.stock).toBe(p.stock)
      }
      for (const v of r.variants) {
        const qty = q.items.filter((i) => i.variant_id === v.id).reduce((s, i) => s + i.qty, 0)
        expect(afterV.find((x) => x.id === v.id)!.stock).toBe(v.stock - qty)
      }
      if (r.coupon) {
        const [c] = await db.rows<Coupon>(superuser, `select * from coupons where id = $1`, [r.coupon.id])
        expect(c.uses).toBe(r.coupon.uses + (sc.plan === 'loja' ? 0 : 1))
      }
    })
  }
})

describe('place_order: outras regras', () => {
  it('numera por loja a partir de 1001, reaproveita o cliente pelo telefone e marca o carrinho', async () => {
    const m = await db.merchant('numeros', 'pro', settingsFor())
    const p = await db.insert<Product>('products', { store_id: m.storeId, name: 'X', price_cents: 1000 })
    const ck = await db.rpc<{ id: string }>(anon, 'save_checkout', {
      id: null, store_id: m.storeId, session_id: 's1', customer: { name: 'Ana', phone: '19988887777' },
      items: [{ product_id: p.id, variant_id: null, qty: 1, name: 'X', unit_price_cents: 1 }], total_cents: 1,
    })
    const base = {
      store_id: m.storeId, lines: [{ product_id: p.id, variant_id: null, qty: 1 }],
      customer: { name: 'Ana', phone: '(19) 98888-7777', email: '' }, shipping: { method: 'pickup', address: null },
      payment: { method: 'cash' }, coupon: '', notes: '', source: null, checkout_id: ck.id,
    }
    const r1 = await db.rpc<{ number: number; id: string }>(anon, 'place_order', base)
    const r2 = await db.rpc<{ number: number }>(anon, 'place_order', { ...base, checkout_id: null, customer: { name: 'Ana S', phone: '19 98888 7777', email: 'ana@x.com' } })
    expect([r1.number, r2.number]).toEqual([1001, 1002])
    const customers = await db.rows<{ phone: string; email: string; name: string }>(superuser, `select * from customers where store_id = $1`, [m.storeId])
    expect(customers).toHaveLength(1)
    expect(customers[0]).toMatchObject({ phone: '19988887777', email: 'ana@x.com', name: 'Ana' })
    const [c] = await db.rows<{ order_id: string }>(superuser, `select * from checkouts where id = $1`, [ck.id])
    expect(c.order_id).toBe(r1.id)
    // carrinho já convertido em pedido não é reaproveitado
    const ck2 = await db.rpc<{ id: string }>(anon, 'save_checkout', { id: ck.id, store_id: m.storeId, session_id: 's1', customer: { name: 'Ana', phone: '' }, items: [], total_cents: 0 })
    expect(ck2.id).not.toBe(ck.id)
  })

  it('valida nome, telefone e endereço', async () => {
    const m = await db.merchant('validacoes', 'pro', settingsFor())
    const p = await db.insert<Product>('products', { store_id: m.storeId, name: 'X', price_cents: 1000 })
    const base = {
      store_id: m.storeId, lines: [{ product_id: p.id, variant_id: null, qty: 1 }],
      customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
      payment: { method: 'cash' }, coupon: '', notes: '', source: null, checkout_id: null,
    }
    expect(await errorOf(db.rpc(anon, 'place_order', { ...base, customer: { name: '  ', phone: '19988887777', email: '' } }))).toBe('Informe seu nome e WhatsApp com DDD.')
    expect(await errorOf(db.rpc(anon, 'place_order', { ...base, customer: { name: 'Ana', phone: '98888-777', email: '' } }))).toBe('Informe seu nome e WhatsApp com DDD.')
    expect(await errorOf(db.rpc(anon, 'place_order', { ...base, shipping: { method: 'fixed', address: { ...address, number: '' } } }))).toBe('Informe o endereço de entrega.')
  })

  it('recusa loja suspensa, pausada ou fechada com bloqueio', async () => {
    const m = await db.merchant('horarios', 'pro', settingsFor())
    const p = await db.insert<Product>('products', { store_id: m.storeId, name: 'X', price_cents: 1000 })
    const args = {
      store_id: m.storeId, lines: [{ product_id: p.id, variant_id: null, qty: 1 }],
      customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
      payment: { method: 'cash' }, coupon: '', notes: '', source: null, checkout_id: null,
    }
    const setHours = (h: object) => db.q(superuser, `update stores set settings = jsonb_set(settings, '{hours}', $2) where id = $1`, [m.storeId, JSON.stringify(h)])
    const hours = defaultSettings().hours
    await setHours({ ...hours, paused: true })
    expect(await errorOf(db.rpc(anon, 'place_order', args))).toBe('A loja está pausada no momento.')
    // Aberto todos os dias das 00:00 às 00:00 = sempre fechado; abre "amanhã às 00:00".
    const closed = { ...hours, enabled: true, outside: 'block' as const, days: hours.days.map(() => ({ open: true, from: '00:00', to: '00:00' })) }
    await setHours(closed)
    const expected = openState(closed).message
    expect(expected).toBe('Estamos fechados agora. Abrimos amanhã às 00:00.')
    expect(await errorOf(db.rpc(anon, 'place_order', args))).toBe(expected)
    // fora do horário mas aceitando pedidos
    await setHours({ ...closed, outside: 'accept' })
    await expect(db.rpc(anon, 'place_order', args)).resolves.toMatchObject({ status: 'pending' })
    // pedido manual ignora o horário
    await setHours(closed)
    await expect(db.rpc(m.who, 'place_order', { ...args, manual: true, paid: true })).resolves.toMatchObject({ status: 'paid' })
    // pedido manual só pelo dono
    const intruso = await db.merchant('intruso')
    expect(await errorOf(db.rpc(intruso.who, 'place_order', { ...args, manual: true }))).toBe('Você não tem permissão para fazer isso.')
    expect(await errorOf(db.rpc(anon, 'place_order', { ...args, manual: true }))).toBe('Entre na sua conta.')
    await db.q(superuser, `update stores set status = 'suspended' where id = $1`, [m.storeId])
    expect(await errorOf(db.rpc(anon, 'place_order', args))).toBe('Esta loja não está recebendo pedidos.')
  })

  it('o preço enviado pelo cliente é ignorado', async () => {
    const m = await db.merchant('preco-cliente', 'pro', settingsFor())
    const p = await db.insert<Product>('products', { store_id: m.storeId, name: 'X', price_cents: 1000 })
    const r = await db.rpc<{ total_cents: number }>(anon, 'place_order', {
      store_id: m.storeId, lines: [{ product_id: p.id, variant_id: null, qty: 2, unit_price_cents: 1, price_cents: 1 }],
      customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
      payment: { method: 'cash' }, coupon: '', notes: '', source: null, checkout_id: null, total_cents: 1,
    })
    expect(r.total_cents).toBe(2000)
  })
})

describe('horário de funcionamento no banco = openState()', () => {
  it('dá a mesma resposta em vários momentos da semana', async () => {
    const h = defaultSettings().hours
    const variants = [
      { ...h, enabled: true },
      { ...h, enabled: true, days: h.days.map((d, i) => ({ ...d, open: i === 3, from: '13:30', to: '22:00' })) },
      { ...h, enabled: true, days: h.days.map(() => ({ open: false, from: '09:00', to: '18:00' })) },
      { ...h, enabled: false },
    ]
    const start = Date.parse('2026-11-29T00:07:00Z')
    for (const hours of variants)
      for (let t = start; t < start + 7 * DAY; t += 97 * 60000) {
        const now = new Date(t)
        const [r] = await db.q<{ r: { open: boolean; message: string } }>(superuser, `select private.open_state($1::jsonb, $2::timestamptz) r`, [JSON.stringify(hours), now.toISOString()])
        expect(r.r, now.toISOString()).toEqual(openState(hours, now))
      }
  })
})
