import { beforeEach, describe, expect, it } from 'vitest'
import { DemoStore } from '../../src/lib/db-demo'
import { demoRpc } from '../../src/lib/demo-rpc'
import { seedDemo } from '../../src/lib/seed'
import { crc16, pixPayload } from '../../src/lib/pix'
import { renderMarkdown } from '../../src/lib/markdown'
import { openState } from '../../src/lib/hours'
import { defaultSettings } from '../../src/lib/theme'

describe('modo demonstração', () => {
  let s: DemoStore
  beforeEach(() => {
    localStorage.clear()
    s = new DemoStore()
    seedDemo(s)
  })

  it('cria a loja de exemplo com pedidos e eventos', () => {
    expect(s.rows('stores').length).toBe(5)
    expect(s.rows('orders').length).toBeGreaterThan(80)
    expect(s.rows('events').length).toBeGreaterThan(1500)
  })

  it('faz um pedido recalculando preço, frete, Pix e estoque', async () => {
    const rpc = demoRpc(s)
    const store = s.rows('stores').find((x) => x.slug === 'doces-da-ana')!
    store.settings.hours.enabled = false
    const cesta = s.rows('products').find((p) => p.name === 'Cesta de café da manhã')!
    const brig = s.rows('products').find((p) => p.name === 'Brigadeiro tradicional')!
    const before = cesta.stock
    const r = await rpc.place_order({
      store_id: store.id,
      lines: [
        { product_id: cesta.id, variant_id: null, qty: 1 },
        { product_id: brig.id, variant_id: null, qty: 30 },
      ],
      customer: { name: 'Teste', phone: '(19) 98888-7777', email: '' },
      shipping: { method: 'zone', zone: 'Cambuí', address: { cep: '', street: 'Rua A', number: '1', complement: '', district: 'Cambuí', city: 'Campinas', state: 'SP' } },
      payment: { method: 'pix' },
      coupon: '',
      notes: '',
      source: null,
      checkout_id: null,
    })
    // 15900 + 30 * (350 - 10%) = 15900 + 30*315 = 25350; frete grátis acima de 150; Pix 5% = 1267
    const o = s.rows('orders').find((x) => x.id === r.id)!
    expect(o.subtotal_cents).toBe(25350)
    expect(o.shipping_cents).toBe(0)
    expect(o.discount_cents).toBe(1267)
    expect(o.total_cents).toBe(24083)
    expect(s.rows('products').find((p) => p.id === cesta.id)!.stock).toBe(before - 1)
    s.user = { id: store.owner_id, email: 'demo@exemplo.com' }
    await rpc.set_order_status({ order_id: o.id, status: 'cancelled', note: '' })
    expect(s.rows('products').find((p) => p.id === cesta.id)!.stock).toBe(before)
  })

  it('recusa estoque insuficiente e pedido mínimo', async () => {
    const rpc = demoRpc(s)
    const store = s.rows('stores').find((x) => x.slug === 'doces-da-ana')!
    store.settings.hours.enabled = false
    const cesta = s.rows('products').find((p) => p.name === 'Cesta de café da manhã')!
    const base = { store_id: store.id, customer: { name: 'T', phone: '19988887777', email: '' }, shipping: { method: 'pickup' as const, address: null }, payment: { method: 'cash' as const }, coupon: '', notes: '', source: null, checkout_id: null }
    await expect(rpc.place_order({ ...base, lines: [{ product_id: cesta.id, variant_id: null, qty: 99 }] })).rejects.toThrow(/Só restam/)
    const brig = s.rows('products').find((p) => p.name === 'Beijinho')!
    await expect(rpc.place_order({ ...base, lines: [{ product_id: brig.id, variant_id: null, qty: 1 }] })).rejects.toThrow(/pedido mínimo/)
  })
})

describe('Pix copia e cola', () => {
  it('calcula o CRC16 do exemplo do Banco Central', () => {
    expect(crc16('123456789')).toBe('29B1')
  })
  it('gera payload com chave, valor e CRC', () => {
    const p = pixPayload({ key: 'pix@loja.com', name: 'Ana Souza', city: 'Campinas', amountCents: 1990, txid: 'PED1001' })
    expect(p).toContain('br.gov.bcb.pix0112pix@loja.com')
    expect(p).toContain('540519.90')
    expect(p.slice(-8, -4)).toBe('6304')
    expect(crc16(p.slice(0, -4))).toBe(p.slice(-4))
  })
})

describe('formatação de texto', () => {
  it('não deixa passar HTML nem links perigosos', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) **ok**')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<strong>ok</strong>')
  })
})

describe('horário de funcionamento', () => {
  it('fecha fora do horário e informa quando abre', () => {
    const h = { ...defaultSettings().hours, enabled: true }
    // Domingo 12h em Brasília (15h UTC): domingo está fechado no padrão
    const st = openState(h, new Date('2026-11-29T15:00:00Z'))
    expect(st.open).toBe(false)
    expect(st.message).toContain('amanhã às 09:00')
    expect(openState(h, new Date('2026-11-30T15:00:00Z')).open).toBe(true)
  })
})
