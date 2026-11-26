import { beforeAll, describe, expect, it } from 'vitest'
import { DemoStore } from '../../src/lib/db-demo'
import { seedDemo } from '../../src/lib/seed'
import {
  PERIODS,
  REPORTS,
  SEGMENTS,
  abcCurve,
  computeHome,
  funnelCounts,
  isSale,
  periodRange,
  profitByProduct,
  quintileScores,
  rangeLength,
  rfmTable,
  salesInsight,
  salesTotals,
  spMidnight,
  tableToCsvRows,
  type Range,
  type ReportData,
} from '../../src/panel/reports/compute'

let data: ReportData
let range: Range
let prev: Range
const now = new Date()

beforeAll(() => {
  localStorage.clear()
  const s = new DemoStore()
  seedDemo(s)
  const store = s.rows('stores').find((x) => x.slug === 'doces-da-ana')!
  const mine = <T extends { store_id: string }>(rows: T[]) => rows.filter((r) => r.store_id === store.id)
  data = {
    store,
    orders: mine(s.rows('orders')),
    events: mine(s.rows('events')),
    products: mine(s.rows('products')),
    variants: mine(s.rows('variants')),
    customers: mine(s.rows('customers')),
    checkouts: mine(s.rows('checkouts')),
    categories: mine(s.rows('categories')),
    contents: mine(s.rows('contents')),
    now,
  }
  ;({ range, prev } = periodRange('30d', now))
})

const inRange = (iso: string, r: Range) => Date.parse(iso) >= Date.parse(r.from) && Date.parse(iso) < Date.parse(r.to)

describe('períodos', () => {
  it('o período anterior tem sempre o mesmo tamanho e termina onde o atual começa (ou antes)', () => {
    for (const p of PERIODS) {
      const r = periodRange(p.id, now, { from: '2026-10-03', to: '2026-10-20' })
      expect(rangeLength(r.prev), p.id).toBe(rangeLength(r.range))
      expect(Date.parse(r.prev.to), p.id).toBeLessThanOrEqual(Date.parse(r.range.to))
      expect(Date.parse(r.prev.from)).toBeLessThan(Date.parse(r.range.from))
    }
  })
  it('usa o horário de Brasília: o dia começa às 03:00 UTC', () => {
    expect(new Date(spMidnight('2026-11-26')).toISOString()).toBe('2026-11-26T03:00:00.000Z')
    const r = periodRange('mes_passado', new Date('2026-11-26T15:00:00Z'))
    expect(r.range.from).toBe('2026-10-01T03:00:00.000Z')
    expect(r.range.to).toBe('2026-11-01T03:00:00.000Z')
    expect(r.days).toBe(31)
  })
})

describe('vendas', () => {
  it('total de vendas é a soma dos pedidos pagos (sem cancelados e devolvidos)', () => {
    const expected = data.orders.filter((o) => isSale(o) && inRange(o.paid_at!, range))
    const t = salesTotals(data, range)
    expect(t.orders).toBe(expected.length)
    expect(t.revenue).toBe(expected.reduce((a, o) => a + o.total_cents, 0))
    expect(t.revenue).toBeGreaterThan(0)
  })
  it('o relatório no tempo fecha com o total e o gráfico soma o mesmo valor', () => {
    const r = REPORTS.find((x) => x.id === 'vendas-no-tempo')!.compute(data, range, prev, {})
    const total = r.table.rows.find((x) => x.label === 'Total')!
    expect(total.net).toBe(salesTotals(data, range).revenue)
    expect(r.chart?.kind).toBe('line')
    if (r.chart?.kind === 'line') {
      expect(r.chart.points.reduce((a, p) => a + p.value, 0)).toBe(salesTotals(data, range).revenue)
      expect(r.chart.prev!.reduce((a, p) => a + p.value, 0)).toBe(salesTotals(data, prev).revenue)
    }
  })
  it('explica a variação com pedidos e ticket médio', () => {
    expect(salesInsight({ revenue: 8800, orders: 10 }, { revenue: 10000, orders: 10 })).toBe(
      'As vendas caíram 12% porque o ticket médio diminuiu 12%; o número de pedidos ficou igual.',
    )
    expect(salesInsight({ revenue: 12000, orders: 12 }, { revenue: 10000, orders: 10 })).toMatch(/^As vendas subiram 20% porque o número de pedidos aumentou 20%/)
  })
})

describe('produtos', () => {
  it('curva ABC soma 100% e as classes seguem a ordem A, B, C', () => {
    const abc = abcCurve(data, range)
    expect(abc.length).toBeGreaterThan(3)
    expect(abc.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 9)
    expect(abc[abc.length - 1].cumulative).toBeCloseTo(1, 9)
    const order = abc.map((x) => x.cls).join('')
    expect(order).toMatch(/^A+B*C*$/)
    const aShare = abc.filter((x) => x.cls === 'A').reduce((a, x) => a + x.share, 0)
    expect(aShare).toBeGreaterThanOrEqual(0.8)
  })
  it('lucro por produto usa preço − custo − parte do desconto', () => {
    const list = profitByProduct(data, range)
    const totalDiscount = data.orders.filter((o) => isSale(o) && inRange(o.paid_at!, range)).reduce((a, o) => a + o.discount_cents, 0)
    expect(list.reduce((a, x) => a + x.discount, 0)).toBeCloseTo(totalDiscount, 3)
    for (const x of list) if (x.profit != null) expect(x.profit).toBeCloseTo(x.revenue - x.cost - x.discount, 6)
  })
})

describe('funil e clientes', () => {
  it('o funil nunca aumenta de uma etapa para a outra', () => {
    for (const r of [range, prev, periodRange('7d', now).range, periodRange('90d', now).range]) {
      const f = funnelCounts(data.events, r)
      expect(f[0]).toBeGreaterThan(0)
      for (let i = 1; i < f.length; i++) expect(f[i]).toBeLessThanOrEqual(f[i - 1])
    }
  })
  it('os grupos de comportamento cobrem todos os clientes que compraram', () => {
    const until = Date.parse(range.to)
    const list = rfmTable(data, until)
    const buyers = new Set(data.orders.filter((o) => isSale(o) && Date.parse(o.paid_at!) < until).map((o) => o.customer_id))
    expect(list.length).toBe(buyers.size)
    const ids = SEGMENTS.map((s) => s.id)
    for (const b of list) {
      expect(ids).toContain(b.segment)
      for (const s of [b.R, b.F, b.M]) expect(s >= 1 && s <= 5).toBe(true)
    }
    expect(new Set(list.map((b) => b.segment)).size).toBeGreaterThan(2)
  })
  it('notas de 1 a 5 dão a mesma nota a valores iguais', () => {
    expect(quintileScores([1, 1, 1, 1])).toEqual([3, 3, 3, 3])
    expect(quintileScores([10, 20, 30, 40, 50])).toEqual([1, 2, 3, 4, 5])
    expect(quintileScores([10, 20, 30, 40, 50], false)).toEqual([5, 4, 3, 2, 1])
  })
})

describe('todos os relatórios', () => {
  it.each(REPORTS.map((r) => [r.id, r]))('%s calcula com frase, tabela e CSV', (_id, def) => {
    for (const [r, p] of [
      [range, prev],
      [periodRange('hoje', now).range, periodRange('hoje', now).prev],
    ]) {
      const res = def.compute(data, r, p, {})
      expect(res.insight.trim().length).toBeGreaterThan(10)
      expect(res.insight).not.toMatch(/NaN|undefined|Infinity/)
      expect(res.table.columns.length).toBeGreaterThan(0)
      for (const row of res.table.rows) for (const c of res.table.columns) expect(row[c.key]).not.toBeUndefined()
      const csv = tableToCsvRows(res.table)
      expect(csv[0]).toEqual(res.table.columns.map((c) => c.label))
      expect(csv.flat().join(' ')).not.toMatch(/NaN/)
    }
  })
  it('ids são únicos e cada relatório diz a decisão que apoia', () => {
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length)
    for (const r of REPORTS) expect(r.decision.length).toBeGreaterThan(20)
  })
})

describe('painel inicial', () => {
  it('compara cada janela com a anterior e aponta o que precisa de atenção', () => {
    const h = computeHome(data, range, prev, now)
    expect(h.windows.map((w) => w.label)).toEqual(['Hoje', 'Últimos 7 dias', 'Últimos 30 dias'])
    expect(h.windows[2].value).toBe(salesTotals(data, range).revenue)
    expect(h.top.length).toBe(5)
    expect(h.sources[0].label).toBe('Instagram')
    expect(h.lowStock.some((x) => x.label === 'Cesta de café da manhã')).toBe(true)
    expect(h.month.goal).toBe(600000)
    expect(h.insight.length).toBeGreaterThan(10)
  })
})
