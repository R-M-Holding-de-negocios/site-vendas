// Cálculos dos relatórios do lojista. Funções puras: sem React e sem acesso ao banco.
//
// Definições (combinadas com a dona do produto):
// - Uma venda conta quando o pedido tem paid_at e não foi cancelado nem devolvido; a data da venda é paid_at.
// - Receita do pedido = total_cents. Receita de produto = unit_price_cents × qty; custo = cost_cents congelado no item.
// - Datas são agrupadas no horário de Brasília (America/Sao_Paulo). O Brasil não tem horário de verão
//   desde 2019, então o fuso é UTC−3 fixo.
// - Todo período é comparado com o período anterior de mesmo tamanho.
import type { Category, CheckoutDraft, Content, Customer, Order, PayMethod, Product, ShipMethod, Store, StoreEvent, Variant } from '../../lib/types'
import { brl, onlyDigits, waLink } from '../../lib/util'

// ---------- Tipos ----------

export interface ReportData {
  store: Store
  orders: Order[]
  events: StoreEvent[]
  products: Product[]
  variants: Variant[]
  customers: Customer[]
  checkouts: CheckoutDraft[]
  categories: Category[]
  /** Posts e páginas, para dar nome aos conteúdos no relatório "por post". */
  contents?: Content[]
  /** "Agora" para o que depende da situação atual (pedidos atrasados). Padrão: new Date(). */
  now?: Date
}

/** Intervalo [from, to) em ISO 8601 (UTC). */
export interface Range {
  from: string
  to: string
}

export type Unit = 'text' | 'brl' | 'int' | 'num' | 'pct' | 'delta' | 'days' | 'hours' | 'date' | 'wa'
export type Granularity = 'hora' | 'dia' | 'semana' | 'mes'
export type FilterKey = 'product' | 'category' | 'payment' | 'source' | 'city' | 'granularity'

export interface Filters {
  product?: string
  category?: string
  payment?: string
  source?: string
  city?: string
  granularity?: Granularity
}

export interface Point {
  label: string
  value: number
}

export type ChartSpec =
  | { kind: 'line'; unit: Unit; name: string; prevName: string; points: Point[]; prev?: Point[] }
  | { kind: 'bar'; unit: Unit; items: Point[] }
  | { kind: 'heatmap'; unit: Unit; /** [dia da semana 0=domingo][hora 0–23] */ values: number[][] }
  | { kind: 'funnel'; steps: Point[] }
  | { kind: 'pareto'; items: Point[] }

export interface Kpi {
  label: string
  value: number
  unit: Unit
  prev?: number | null
  /** true quando subir é ruim (cancelamentos, abandono): a variação não é pintada de verde. */
  upIsBad?: boolean
  hint?: string
}

export interface Column {
  key: string
  label: string
  unit: Unit
}

export type Cell = string | number | null
/** Linha da tabela. A chave especial `_unit` troca a unidade das colunas numéricas daquela linha. */
export type Row = Record<string, Cell>

export interface ReportResult {
  kpis?: Kpi[]
  chart?: ChartSpec
  table: { columns: Column[]; rows: Row[] }
  insight: string
}

export type GroupId = 'vendas' | 'clientes' | 'produtos' | 'funil' | 'origem' | 'financeiro' | 'operacao'

export interface ReportDef {
  id: string
  group: GroupId
  title: string
  /** A decisão que o relatório ajuda a tomar (aparece como subtítulo). */
  decision: string
  filters: FilterKey[]
  /** false = mostra a situação atual; o período escolhido não muda o resultado. */
  usesPeriod?: boolean
  compute(data: ReportData, range: Range, prev: Range, filters: Filters): ReportResult
}

export const GROUPS: { id: GroupId; title: string }[] = [
  { id: 'vendas', title: 'Vendas' },
  { id: 'clientes', title: 'Clientes' },
  { id: 'produtos', title: 'Produtos e estoque' },
  { id: 'funil', title: 'Funil e comportamento' },
  { id: 'origem', title: 'Origem das vendas' },
  { id: 'financeiro', title: 'Financeiro' },
  { id: 'operacao', title: 'Operação' },
]

// ---------- Datas (horário de Brasília) ----------

export const HOUR = 3600000
export const DAY = 24 * HOUR
const SP_OFFSET = 3 * HOUR

export const ms = (iso: string) => Date.parse(iso)
/** Data deslocada para ler dia/hora de Brasília com getUTC*. */
const sp = (t: number) => new Date(t - SP_OFFSET)
export const dayKey = (t: number) => sp(t).toISOString().slice(0, 10)
export const spHour = (t: number) => sp(t).getUTCHours()
export const spDow = (t: number) => sp(t).getUTCDay()
/** Meia-noite (Brasília) do dia "AAAA-MM-DD", em ms UTC. */
export const spMidnight = (key: string) => Date.parse(key + 'T00:00:00Z') + SP_OFFSET
const iso = (t: number) => new Date(t).toISOString()
const inR = (t: number, r: { f: number; t: number }) => t >= r.f && t < r.t
const rr = (r: Range) => ({ f: ms(r.from), t: ms(r.to) })

export const rangeLength = (r: Range) => ms(r.to) - ms(r.from)

export type PeriodId = 'hoje' | '7d' | '30d' | 'mes' | 'mes_passado' | '90d' | 'livre'
export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes_passado', label: 'Mês passado' },
  { id: '90d', label: '90 dias' },
  { id: 'livre', label: 'Datas livres' },
]

/**
 * Período e período anterior. O anterior é o mesmo intervalo deslocado N dias para trás
 * (N = dias do período), então os dois têm sempre o mesmo tamanho — inclusive "hoje até agora"
 * contra "ontem até a mesma hora".
 */
export function periodRange(id: PeriodId, now: Date, custom?: { from: string; to: string }): { range: Range; prev: Range; days: number } {
  const n = now.getTime()
  const today = dayKey(n)
  const t0 = spMidnight(today)
  let from: number
  let to = n
  let days: number
  const [y, m] = today.split('-').map(Number)
  if (id === 'hoje') {
    from = t0
    days = 1
  } else if (id === '7d' || id === '30d' || id === '90d') {
    days = id === '7d' ? 7 : id === '30d' ? 30 : 90
    from = t0 - (days - 1) * DAY
  } else if (id === 'mes') {
    from = spMidnight(`${y}-${String(m).padStart(2, '0')}-01`)
    days = Math.round((t0 - from) / DAY) + 1
  } else if (id === 'mes_passado') {
    const py = m === 1 ? y - 1 : y
    const pm = m === 1 ? 12 : m - 1
    from = spMidnight(`${py}-${String(pm).padStart(2, '0')}-01`)
    to = spMidnight(`${y}-${String(m).padStart(2, '0')}-01`)
    days = Math.round((to - from) / DAY)
  } else {
    let a = custom?.from || today
    let b = custom?.to || today
    if (a > b) [a, b] = [b, a]
    from = spMidnight(a)
    to = spMidnight(b) + DAY
    days = Math.round((to - from) / DAY)
  }
  const shift = days * DAY
  return { range: { from: iso(from), to: iso(to) }, prev: { from: iso(from - shift), to: iso(to - shift) }, days }
}

export const fmtDay = (t: number) => {
  const d = sp(t)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export const fmtDayFull = (t: number) => `${fmtDay(t)}/${sp(t).getUTCFullYear()}`
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const DOW = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const DOW_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export function rangeLabel(r: Range) {
  const a = ms(r.from)
  const b = ms(r.to) - 1
  return dayKey(a) === dayKey(b) ? fmtDayFull(a) : `${fmtDayFull(a)} a ${fmtDayFull(b)}`
}

export function autoGranularity(r: Range): Granularity {
  const d = rangeLength(r) / DAY
  return d <= 1.01 ? 'hora' : d <= 35 ? 'dia' : d <= 120 ? 'semana' : 'mes'
}

interface Buckets {
  labels: string[]
  index(t: number): number
}
function buckets(r: Range, g: Granularity): Buckets {
  const { f, t } = rr(r)
  if (g === 'hora') {
    const n = Math.max(1, Math.ceil((t - f) / HOUR))
    return { labels: Array.from({ length: n }, (_, i) => `${spHour(f + i * HOUR)}h`), index: (x) => Math.floor((x - f) / HOUR) }
  }
  if (g === 'dia' || g === 'semana') {
    const step = g === 'dia' ? DAY : 7 * DAY
    const n = Math.max(1, Math.ceil((t - f) / step))
    return {
      labels: Array.from({ length: n }, (_, i) => (g === 'dia' ? fmtDay(f + i * step) : `sem. ${fmtDay(f + i * step)}`)),
      index: (x) => Math.floor((x - f) / step),
    }
  }
  const mi = (x: number) => sp(x).getUTCFullYear() * 12 + sp(x).getUTCMonth()
  const m0 = mi(f)
  const n = mi(t - 1) - m0 + 1
  return {
    labels: Array.from({ length: n }, (_, i) => `${MONTHS[(m0 + i) % 12]}/${String(Math.floor((m0 + i) / 12)).slice(2)}`),
    index: (x) => mi(x) - m0,
  }
}

/** Soma valores por intervalo; o período anterior é deslocado para cair nos mesmos intervalos. */
function series<T>(list: T[], when: (x: T) => number, value: (x: T) => number, r: Range, prevR: Range, g: Granularity) {
  const b = buckets(r, g)
  const cur = b.labels.map(() => 0)
  const prev = b.labels.map(() => 0)
  const R = rr(r)
  const P = rr(prevR)
  const shift = R.f - P.f
  for (const x of list) {
    const t = when(x)
    if (inR(t, R)) {
      const i = b.index(t)
      if (i >= 0 && i < cur.length) cur[i] += value(x)
    } else if (inR(t, P)) {
      const i = b.index(t + shift)
      if (i >= 0 && i < prev.length) prev[i] += value(x)
    }
  }
  return {
    points: b.labels.map((label, i) => ({ label, value: cur[i] })),
    prev: b.labels.map((label, i) => ({ label, value: prev[i] })),
  }
}

// ---------- Rótulos ----------

export const PAY_LABEL: Record<PayMethod, string> = {
  whatsapp: 'Combinar pelo WhatsApp',
  pix: 'Pix',
  cash: 'Dinheiro',
  card_on_delivery: 'Cartão na entrega',
  mercadopago: 'Mercado Pago',
}
export const SHIP_LABEL: Record<ShipMethod, string> = {
  pickup: 'Retirada na loja',
  zone: 'Entrega por bairro',
  fixed: 'Entrega com taxa fixa',
  arrange: 'Entrega a combinar',
}
const SOURCE_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  google: 'Google',
  direto: 'Direto',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  outro: 'Outro',
}
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? (s ? s[0].toUpperCase() + s.slice(1) : 'Direto')
export const deviceLabel = (d: string | undefined) => (d === 'desktop' ? 'Computador' : 'Celular')

// ---------- Formatação ----------

const nf = (n: number, d = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 })
export const pctTxt = (x: number, d = 0) => `${nf(x * 100, d)}%`
const absPct = (x: number) => `${nf(Math.abs(x) * 100)}%`
const dias = (n: number) => (n === 1 ? '1 dia' : `${n} dias`)

export function fmtValue(v: Cell, unit: Unit): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'string') return unit === 'date' ? fmtDayFull(ms(v)) : v
  switch (unit) {
    case 'brl':
      return brl(Math.round(v))
    case 'int':
      return nf(Math.round(v))
    case 'num':
      return nf(v, 1)
    case 'pct':
      return pctTxt(v, v < 0.1 && v > 0 ? 1 : 0)
    case 'delta':
      return Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${absPct(v)}` : 'novo'
    case 'days':
      return v === 1 ? '1 dia' : `${nf(v, v < 10 ? 1 : 0)} dias`
    case 'hours':
      return v < 48 ? `${nf(v, v < 10 ? 1 : 0)} h` : `${nf(v / 24, 1)} dias`
    default:
      return nf(v, 1)
  }
}

/** Valor para planilha: números sem "R$" e com vírgula decimal. */
export function csvValue(v: Cell, unit: Unit): string | number {
  if (v == null) return ''
  if (typeof v === 'string') return unit === 'date' ? fmtDayFull(ms(v)) : v
  if (unit === 'brl') return (v / 100).toFixed(2).replace('.', ',')
  if (unit === 'pct' || unit === 'delta') return Number.isFinite(v) ? (v * 100).toFixed(1).replace('.', ',') + '%' : ''
  if (unit === 'int') return Math.round(v)
  return String(Math.round(v * 10) / 10).replace('.', ',')
}

export function tableToCsvRows(t: ReportResult['table']) {
  return [
    t.columns.map((c) => c.label),
    ...t.rows.map((r) => t.columns.map((c) => csvValue(r[c.key], c.unit !== 'text' && typeof r._unit === 'string' ? (r._unit as Unit) : c.unit))),
  ]
}

// ---------- Base de cálculo ----------

export const isSale = (o: Order) => !!o.paid_at && o.status !== 'cancelled' && o.status !== 'refunded'
export const isReversed = (o: Order) => !!o.paid_at && (o.status === 'cancelled' || o.status === 'refunded')
export const customerKey = (o: Order) => o.customer_id ?? 'tel:' + onlyDigits(o.customer.phone)
export const orderSource = (o: Order) => o.source?.source || 'direto'
export const orderCity = (o: Order) => o.shipping.address?.city || (o.shipping.method === 'pickup' ? 'Retirada na loja' : 'Sem endereço')
const itemRev = (i: { unit_price_cents: number; qty: number }) => i.unit_price_cents * i.qty
const ratio = (a: number, b: number) => (b ? a / b : 0)
/** Variação relativa; Infinity quando não havia nada antes. */
export const change = (cur: number, prev: number) => (prev ? cur / prev - 1 : cur ? Infinity : 0)

interface Ctx {
  d: ReportData
  f: Filters
  product: Map<string, Product>
  category: Map<string, Category>
  /** Vendas (todas as datas) que passam nos filtros, com paid_at em ms. */
  sales: { o: Order; t: number }[]
  /** Todos os pedidos que passam nos filtros (inclui pendentes e cancelados). */
  all: Order[]
  itemOk(productId: string): boolean
}

function makeCtx(d: ReportData, f: Filters): Ctx {
  const product = new Map(d.products.map((p) => [p.id, p]))
  const category = new Map(d.categories.map((c) => [c.id, c]))
  const itemOk = (pid: string) => {
    if (f.product && pid !== f.product) return false
    if (f.category && !(product.get(pid)?.category_ids ?? []).includes(f.category)) return false
    return true
  }
  const orderOk = (o: Order) =>
    (!f.payment || o.payment.method === f.payment) &&
    (!f.source || orderSource(o) === f.source) &&
    (!f.city || orderCity(o) === f.city) &&
    (!f.product && !f.category ? true : o.items.some((i) => itemOk(i.product_id)))
  const all = d.orders.filter(orderOk)
  const sales = all.filter(isSale).map((o) => ({ o, t: ms(o.paid_at!) }))
  return { d, f, product, category, sales, all, itemOk }
}

const salesIn = (c: Ctx, r: Range) => {
  const R = rr(r)
  return c.sales.filter((s) => inR(s.t, R)).map((s) => s.o)
}
const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
const productName = (c: Ctx, id: string, fallback = 'Produto removido') => c.product.get(id)?.name ?? fallback

/** Totais de vendas de um período (usado no painel inicial e nos testes). */
export function salesTotals(d: ReportData, r: Range, f: Filters = {}) {
  const os = salesIn(makeCtx(d, f), r)
  const revenue = sumBy(os, (o) => o.total_cents)
  return { revenue, orders: os.length, ticket: ratio(revenue, os.length) }
}

// ---------- Frases automáticas ----------

const STABLE = 0.03
function movePhrase(subject: string, ch: number, up = 'aumentou', down = 'diminuiu', same = 'ficou igual') {
  if (!Number.isFinite(ch)) return `${subject} ${up}`
  if (Math.abs(ch) < STABLE) return `${subject} ${same}`
  return `${subject} ${ch > 0 ? up : down} ${absPct(ch)}`
}

/** "As vendas caíram 12% porque o ticket médio diminuiu; o número de pedidos ficou igual." */
export function salesInsight(cur: { revenue: number; orders: number }, prev: { revenue: number; orders: number }) {
  if (!cur.revenue && !prev.revenue) return 'Não houve vendas neste período nem no período anterior.'
  if (!prev.revenue) return `Foram ${brl(cur.revenue)} em vendas; no período anterior não houve vendas para comparar.`
  if (!cur.revenue) return `Não houve vendas neste período; no período anterior foram ${brl(prev.revenue)}.`
  const rc = change(cur.revenue, prev.revenue)
  const oc = change(cur.orders, prev.orders)
  const tc = change(cur.revenue / cur.orders, prev.revenue / prev.orders)
  const orders = movePhrase('o número de pedidos', oc)
  const ticket = movePhrase('o ticket médio', tc)
  if (Math.abs(rc) < STABLE) return `As vendas ficaram estáveis (${brl(cur.revenue)}): ${orders} e ${ticket}.`
  const head = `As vendas ${rc > 0 ? 'subiram' : 'caíram'} ${absPct(rc)}`
  const ordersDrive = Math.abs(Math.log(1 + oc)) >= Math.abs(Math.log(1 + tc))
  return ordersDrive ? `${head} porque ${orders}; ${ticket}.` : `${head} porque ${ticket}; ${orders}.`
}

function shareInsight(rows: { label: string; cur: number; prev: number }[], noun = 'da receita', empty = 'Não houve vendas neste período.') {
  const total = sumBy(rows, (r) => r.cur)
  if (!total) return empty
  const sorted = [...rows].sort((a, b) => b.cur - a.cur)
  const [a, b] = sorted
  let s = `${a.label} responde por ${pctTxt(a.cur / total)} ${noun}`
  if (b && b.cur) s += `, seguido de ${b.label} (${pctTxt(b.cur / total)})`
  s += '.'
  const movers = rows.filter((r) => r.prev > 0 && r.cur + r.prev > total * 0.05).map((r) => ({ ...r, ch: r.cur / r.prev - 1 }))
  const big = movers.sort((x, y) => Math.abs(y.ch) - Math.abs(x.ch))[0]
  if (big && Math.abs(big.ch) >= 0.15) s += ` A maior mudança foi ${big.label}: ${big.ch > 0 ? 'subiu' : 'caiu'} ${absPct(big.ch)} em relação ao período anterior.`
  return s
}

// ---------- Quebras genéricas ----------

interface Group {
  label: string
  cur: number
  prev: number
  orders: number
  units: number
  extra: Row
}

function breakdownRows(groups: Map<string, Group>, opts: { unitsCol?: boolean; extraCols?: Column[]; firstCols?: Column[] } = {}) {
  const list = [...groups.values()].sort((a, b) => b.cur - a.cur || b.prev - a.prev)
  const total = sumBy(list, (g) => g.cur)
  const columns: Column[] = [
    ...(opts.firstCols ?? [{ key: 'label', label: 'Nome', unit: 'text' as Unit }]),
    { key: 'orders', label: 'Pedidos', unit: 'int' },
    ...(opts.unitsCol ? [{ key: 'units', label: 'Unidades', unit: 'int' as Unit }] : []),
    { key: 'revenue', label: 'Receita', unit: 'brl' },
    { key: 'share', label: '% da receita', unit: 'pct' },
    ...(opts.extraCols ?? []),
    { key: 'prev', label: 'Período anterior', unit: 'brl' },
    { key: 'change', label: 'Variação', unit: 'delta' },
  ]
  const rows: Row[] = list.map((g) => ({
    label: g.label,
    ...g.extra,
    orders: g.orders,
    units: g.units,
    revenue: g.cur,
    share: ratio(g.cur, total),
    prev: g.prev,
    change: g.prev || g.cur ? change(g.cur, g.prev) : null,
  }))
  return { columns, rows, list }
}

function addTo(groups: Map<string, Group>, key: string, label: string, isCur: boolean, value: number, units = 0, extra: Row = {}, countOrder = true) {
  let g = groups.get(key)
  if (!g) groups.set(key, (g = { label, cur: 0, prev: 0, orders: 0, units: 0, extra }))
  if (isCur) {
    g.cur += value
    g.units += units
    if (countOrder) g.orders++
  } else g.prev += value
}

/** Quebra por um atributo do pedido (forma de pagamento, entrega, cidade, cupom, origem). */
function byOrder(c: Ctx, r: Range, p: Range, key: (o: Order) => [string, string, Row?] | null, firstCols?: Column[]) {
  const groups = new Map<string, Group>()
  for (const [rng, isCur] of [[r, true], [p, false]] as const)
    for (const o of salesIn(c, rng)) {
      const k = key(o)
      if (k) addTo(groups, k[0], k[1], isCur, o.total_cents, 0, k[2] ?? {})
    }
  const b = breakdownRows(groups, { firstCols, extraCols: [{ key: 'ticket', label: 'Ticket médio', unit: 'brl' }] })
  b.rows.forEach((row, i) => (row.ticket = ratio(b.list[i].cur, b.list[i].orders)))
  return b
}

const barTop = (list: { label: string; cur: number }[], n = 10): ChartSpec => ({
  kind: 'bar',
  unit: 'brl',
  items: list.filter((x) => x.cur > 0).slice(0, n).map((x) => ({ label: x.label, value: x.cur })),
})

// ---------- Relatórios: Vendas ----------

function vendasTempo(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const g = f.granularity ?? autoGranularity(r)
  const paid = c.all.filter((o) => o.paid_at)
  const b = buckets(r, g)
  const R = rr(r)
  const acc = b.labels.map((label) => ({ label, orders: 0, gross: 0, discount: 0, shipping: 0, returns: 0 }))
  for (const o of paid) {
    const t = ms(o.paid_at!)
    if (!inR(t, R)) continue
    const a = acc[b.index(t)]
    if (!a) continue
    a.gross += o.subtotal_cents
    a.discount += o.discount_cents
    a.shipping += o.shipping_cents
    if (isReversed(o)) a.returns += o.total_cents
    else a.orders++
  }
  const s = series(c.sales, (x) => x.t, (x) => x.o.total_cents, r, p, g)
  const cur = salesTotals(d, r, f)
  const prev = salesTotals(d, p, f)
  const rows: Row[] = acc.map((a) => ({ ...a, net: a.gross - a.discount + a.shipping - a.returns }))
  const tot = rows.reduce<Row>(
    (t, x) => {
      for (const k of ['orders', 'gross', 'discount', 'shipping', 'returns', 'net']) t[k] = (t[k] as number) + (x[k] as number)
      return t
    },
    { label: 'Total', orders: 0, gross: 0, discount: 0, shipping: 0, returns: 0, net: 0 },
  )
  const gName = { hora: 'Hora', dia: 'Dia', semana: 'Semana', mes: 'Mês' }[g]
  return {
    kpis: [
      { label: 'Vendas líquidas', value: cur.revenue, prev: prev.revenue, unit: 'brl' },
      { label: 'Pedidos pagos', value: cur.orders, prev: prev.orders, unit: 'int' },
      { label: 'Ticket médio', value: cur.ticket, prev: prev.ticket, unit: 'brl' },
      { label: 'Descontos dados', value: tot.discount as number, unit: 'brl' },
    ],
    chart: { kind: 'line', unit: 'brl', name: 'Este período', prevName: 'Período anterior', points: s.points, prev: s.prev },
    table: {
      columns: [
        { key: 'label', label: gName, unit: 'text' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'gross', label: 'Bruto (produtos)', unit: 'brl' },
        { key: 'discount', label: 'Descontos', unit: 'brl' },
        { key: 'shipping', label: 'Frete', unit: 'brl' },
        { key: 'returns', label: 'Devoluções', unit: 'brl' },
        { key: 'net', label: 'Líquido', unit: 'brl' },
      ],
      rows: [...rows, tot],
    },
    insight: salesInsight(cur, prev),
  }
}

function vendasProduto(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const groups = new Map<string, Group>()
  for (const [rng, isCur] of [[r, true], [p, false]] as const)
    for (const o of salesIn(c, rng)) {
      const seen = new Set<string>()
      for (const i of o.items) {
        if (!c.itemOk(i.product_id)) continue
        const k = i.product_id + '|' + (i.variant_id ?? '')
        const first = !seen.has(k)
        seen.add(k)
        addTo(groups, k, productName(c, i.product_id, i.name), isCur, itemRev(i), i.qty, { variant: i.variant_label || '' }, first)
      }
    }
  const b = breakdownRows(groups, {
    unitsCol: true,
    firstCols: [
      { key: 'label', label: 'Produto', unit: 'text' },
      { key: 'variant', label: 'Variação', unit: 'text' },
    ],
  })
  const named = b.list.map((g) => ({ ...g, label: g.extra.variant ? `${g.label} (${g.extra.variant})` : g.label }))
  return {
    chart: barTop(named),
    table: { columns: b.columns, rows: b.rows },
    insight: shareInsight(named),
  }
}

function vendasCategoria(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const groups = new Map<string, Group>()
  for (const [rng, isCur] of [[r, true], [p, false]] as const)
    for (const o of salesIn(c, rng)) {
      const seen = new Set<string>()
      for (const i of o.items) {
        if (!c.itemOk(i.product_id)) continue
        const cats = c.product.get(i.product_id)?.category_ids ?? []
        for (const cid of cats.length ? cats : ['']) {
          const first = !seen.has(cid)
          seen.add(cid)
          addTo(groups, cid, c.category.get(cid)?.name ?? 'Sem categoria', isCur, itemRev(i), i.qty, {}, first)
        }
      }
    }
  const b = breakdownRows(groups, { unitsCol: true, firstCols: [{ key: 'label', label: 'Categoria', unit: 'text' }] })
  return { chart: barTop(b.list), table: { columns: b.columns, rows: b.rows }, insight: shareInsight(b.list) }
}

function simpleBreakdown(label: string, key: (o: Order) => [string, string] | null) {
  return (d: ReportData, r: Range, p: Range, f: Filters): ReportResult => {
    const b = byOrder(makeCtx(d, f), r, p, key, [{ key: 'label', label, unit: 'text' }])
    return { chart: barTop(b.list), table: { columns: b.columns, rows: b.rows }, insight: shareInsight(b.list) }
  }
}

function vendasDiaHora(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const os = salesIn(c, r)
  const values = DOW.map(() => Array.from({ length: 24 }, () => 0))
  const rev = DOW.map(() => 0)
  for (const o of os) {
    const t = ms(o.created_at)
    values[spDow(t)][spHour(t)]++
    rev[spDow(t)] += o.total_cents
  }
  const part = (dow: number, a: number, b: number) => sumBy(values[dow].slice(a, b), (x) => x)
  const rows: Row[] = DOW.map((label, i) => ({
    label,
    orders: part(i, 0, 24),
    revenue: rev[i],
    morning: part(i, 6, 12),
    afternoon: part(i, 12, 18),
    night: part(i, 18, 24),
    dawn: part(i, 0, 6),
  }))
  let insight = 'Não houve vendas neste período.'
  if (os.length) {
    let best = [0, 0]
    values.forEach((row, dw) => row.forEach((v, h) => v > values[best[0]][best[1]] && (best = [dw, h])))
    // Melhor janela de 3 horas para não depender de uma hora isolada
    const byDow = rows.map((x) => x.orders as number)
    const worst = byDow.indexOf(Math.min(...byDow))
    const top = byDow.indexOf(Math.max(...byDow))
    const hours = Array.from({ length: 24 }, (_, h) => sumBy(values, (row) => row[h]))
    let bh = 0
    for (let h = 0; h < 22; h++) if (hours[h] + hours[h + 1] + hours[h + 2] > hours[bh] + hours[bh + 1] + hours[bh + 2]) bh = h
    insight = `O dia com mais pedidos é ${DOW[top].toLowerCase()} e o horário mais forte é entre ${bh}h e ${bh + 3}h; ${DOW[worst].toLowerCase()} é o dia mais fraco. Programe posts e promoções um pouco antes do pico.`
  }
  return {
    chart: { kind: 'heatmap', unit: 'int', values },
    table: {
      columns: [
        { key: 'label', label: 'Dia', unit: 'text' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'revenue', label: 'Receita', unit: 'brl' },
        { key: 'dawn', label: 'Madrugada (0h–6h)', unit: 'int' },
        { key: 'morning', label: 'Manhã (6h–12h)', unit: 'int' },
        { key: 'afternoon', label: 'Tarde (12h–18h)', unit: 'int' },
        { key: 'night', label: 'Noite (18h–24h)', unit: 'int' },
      ],
      rows,
    },
    insight,
  }
}

function vendasCidade(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const b = byOrder(
    makeCtx(d, f),
    r,
    p,
    (o) => {
      const city = orderCity(o)
      const district = o.shipping.address?.district || ''
      return [city + '|' + district, district ? `${district} (${city})` : city, { city, district }]
    },
    [
      { key: 'city', label: 'Cidade', unit: 'text' },
      { key: 'district', label: 'Bairro', unit: 'text' },
    ],
  )
  return { chart: barTop(b.list), table: { columns: b.columns, rows: b.rows }, insight: shareInsight(b.list) }
}

function vendasCupom(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const b = byOrder(c, r, p, (o) => (o.coupon_code ? [o.coupon_code.toUpperCase(), o.coupon_code.toUpperCase()] : ['', 'Sem cupom']), [
    { key: 'label', label: 'Cupom', unit: 'text' },
  ])
  const disc = new Map<string, number>()
  for (const o of salesIn(c, r)) disc.set(o.coupon_code.toUpperCase(), (disc.get(o.coupon_code.toUpperCase()) ?? 0) + o.discount_cents)
  b.rows.forEach((row, i) => (row.discount = disc.get([...b.list][i].label === 'Sem cupom' ? '' : b.list[i].label) ?? 0))
  b.columns.splice(5, 0, { key: 'discount', label: 'Descontos', unit: 'brl' })
  const withC = b.list.filter((g) => g.label !== 'Sem cupom')
  const without = b.list.find((g) => g.label === 'Sem cupom')
  let insight = 'Nenhum pedido usou cupom neste período.'
  const wo = sumBy(withC, (g) => g.orders)
  if (wo) {
    const tW = sumBy(withC, (g) => g.cur) / wo
    const tN = without && without.orders ? without.cur / without.orders : 0
    insight = `${wo} ${wo === 1 ? 'pedido usou' : 'pedidos usaram'} cupom (${pctTxt(wo / (wo + (without?.orders ?? 0)))} dos pedidos).`
    if (tN) {
      const ch = tW / tN - 1
      insight += Math.abs(ch) < STABLE ? ' O ticket médio com cupom é igual ao sem cupom.' : ` O ticket médio com cupom é ${absPct(ch)} ${ch > 0 ? 'maior' : 'menor'} que o dos pedidos sem cupom.`
    }
  }
  return { chart: barTop(withC), table: { columns: b.columns, rows: b.rows }, insight }
}

// ---------- Relatórios: Clientes ----------

interface Buyer {
  key: string
  name: string
  phone: string
  orders: number
  revenue: number
  first: number
  last: number
  times: number[]
}

/** Compradores com todas as vendas até `until` (exclusivo). */
function buyers(c: Ctx, until: number) {
  const map = new Map<string, Buyer>()
  for (const { o, t } of c.sales) {
    if (t >= until) continue
    const k = customerKey(o)
    let b = map.get(k)
    if (!b) map.set(k, (b = { key: k, name: o.customer.name, phone: o.customer.phone, orders: 0, revenue: 0, first: t, last: t, times: [] }))
    b.orders++
    b.revenue += o.total_cents
    b.times.push(t)
    if (t < b.first) b.first = t
    if (t > b.last) {
      b.last = t
      b.name = o.customer.name || b.name
      b.phone = o.customer.phone || b.phone
    }
  }
  return map
}

const waMsg = (store: Store, name: string, text: string) => `Oi, ${name.split(' ')[0] || 'tudo bem'}! ${text} — ${store.name}`
const wa = (phone: string, text: string) => (onlyDigits(phone).length >= 10 ? waLink(phone, text) : null)

function clientesNovos(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const firsts = buyers(c, Infinity)
  const g = autoGranularity(r)
  const summarize = (rng: Range) => {
    const R = rr(rng)
    const acc = { novos: { c: new Set<string>(), o: 0, v: 0 }, rec: { c: new Set<string>(), o: 0, v: 0 } }
    for (const o of salesIn(c, rng)) {
      const k = customerKey(o)
      const isNew = inR(firsts.get(k)!.first, R)
      const a = isNew ? acc.novos : acc.rec
      a.c.add(k)
      a.o++
      a.v += o.total_cents
    }
    return acc
  }
  const cur = summarize(r)
  const prv = summarize(p)
  const firstList = [...firsts.values()]
  const s = series(firstList, (b) => b.first, () => 1, r, p, g)
  const total = cur.novos.v + cur.rec.v
  const row = (label: string, a: typeof cur.novos, b: typeof cur.novos): Row => ({
    label,
    customers: a.c.size,
    orders: a.o,
    revenue: a.v,
    share: ratio(a.v, total),
    ticket: ratio(a.v, a.o),
    prev: b.c.size,
    change: b.c.size || a.c.size ? change(a.c.size, b.c.size) : null,
  })
  const nc = cur.novos.c.size
  const rc = cur.rec.c.size
  return {
    kpis: [
      { label: 'Clientes novos', value: nc, prev: prv.novos.c.size, unit: 'int' },
      { label: 'Clientes que voltaram', value: rc, prev: prv.rec.c.size, unit: 'int' },
      { label: 'Receita de quem voltou', value: ratio(cur.rec.v, total), prev: ratio(prv.rec.v, prv.novos.v + prv.rec.v), unit: 'pct' },
    ],
    chart: { kind: 'line', unit: 'int', name: 'Clientes novos', prevName: 'Período anterior', points: s.points, prev: s.prev },
    table: {
      columns: [
        { key: 'label', label: 'Tipo', unit: 'text' },
        { key: 'customers', label: 'Clientes', unit: 'int' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'revenue', label: 'Receita', unit: 'brl' },
        { key: 'share', label: '% da receita', unit: 'pct' },
        { key: 'ticket', label: 'Ticket médio', unit: 'brl' },
        { key: 'prev', label: 'Clientes no período anterior', unit: 'int' },
        { key: 'change', label: 'Variação', unit: 'delta' },
      ],
      rows: [row('Novos (primeira compra)', cur.novos, prv.novos), row('Recorrentes (já tinham comprado)', cur.rec, prv.rec)],
    },
    insight:
      nc + rc === 0
        ? 'Ninguém comprou neste período.'
        : `${nc} ${nc === 1 ? 'cliente comprou' : 'clientes compraram'} pela primeira vez e ${rc} ${rc === 1 ? 'voltou' : 'voltaram'} a comprar; quem voltou trouxe ${pctTxt(ratio(cur.rec.v, total))} da receita.`,
  }
}

function taxaRecompra(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const now = buyers(c, ms(r.to))
  const before = buyers(c, ms(p.to))
  const rate = (m: Map<string, Buyer>) => ratio([...m.values()].filter((b) => b.orders >= 2).length, m.size)
  const bins: [string, number, number][] = [
    ['1 pedido', 1, 1],
    ['2 pedidos', 2, 2],
    ['3 pedidos', 3, 3],
    ['4 a 5 pedidos', 4, 5],
    ['6 pedidos ou mais', 6, Infinity],
  ]
  const list = [...now.values()]
  const rows: Row[] = bins.map(([label, a, b]) => {
    const xs = list.filter((x) => x.orders >= a && x.orders <= b)
    return { label, customers: xs.length, share: ratio(xs.length, list.length), revenue: sumBy(xs, (x) => x.revenue) }
  })
  const gaps: number[] = []
  for (const b of list) {
    const ts = [...b.times].sort((x, y) => x - y)
    for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / DAY)
  }
  const avgGap = gaps.length ? sumBy(gaps, (x) => x) / gaps.length : 0
  const rt = rate(now)
  return {
    kpis: [
      { label: 'Taxa de recompra', value: rt, prev: rate(before), unit: 'pct', hint: 'Clientes com 2 pedidos ou mais' },
      { label: 'Clientes que compraram', value: now.size, prev: before.size, unit: 'int' },
      { label: 'Intervalo médio entre compras', value: avgGap, unit: 'days' },
    ],
    chart: { kind: 'bar', unit: 'int', items: rows.map((x) => ({ label: x.label as string, value: x.customers as number })) },
    table: {
      columns: [
        { key: 'label', label: 'Pedidos por cliente', unit: 'text' },
        { key: 'customers', label: 'Clientes', unit: 'int' },
        { key: 'share', label: '% dos clientes', unit: 'pct' },
        { key: 'revenue', label: 'Receita total', unit: 'brl' },
      ],
      rows,
    },
    insight: now.size
      ? `${pctTxt(rt)} dos clientes já compraram mais de uma vez${avgGap ? `, em média a cada ${fmtValue(avgGap, 'days')}` : ''}. ${
          rt < 0.3 ? 'Vale mandar uma mensagem depois da primeira compra para trazer o cliente de volta.' : 'Seus clientes voltam: cuide bem deles.'
        }`
      : 'Ainda não há vendas para calcular a recompra.',
  }
}

function melhoresClientes(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const R = rr(r)
  const m = new Map<string, Buyer>()
  for (const { o, t } of c.sales) {
    if (!inR(t, R)) continue
    const k = customerKey(o)
    let b = m.get(k)
    if (!b) m.set(k, (b = { key: k, name: o.customer.name, phone: o.customer.phone, orders: 0, revenue: 0, first: t, last: t, times: [] }))
    b.orders++
    b.revenue += o.total_cents
    b.last = Math.max(b.last, t)
  }
  const list = [...m.values()].sort((a, b) => b.revenue - a.revenue)
  const total = sumBy(list, (b) => b.revenue)
  const top = list.slice(0, 30)
  const top5 = sumBy(list.slice(0, 5), (b) => b.revenue)
  return {
    chart: { kind: 'bar', unit: 'brl', items: top.slice(0, 10).map((b) => ({ label: b.name || 'Sem nome', value: b.revenue })) },
    table: {
      columns: [
        { key: 'name', label: 'Cliente', unit: 'text' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'revenue', label: 'Receita', unit: 'brl' },
        { key: 'share', label: '% da receita', unit: 'pct' },
        { key: 'ticket', label: 'Ticket médio', unit: 'brl' },
        { key: 'last', label: 'Última compra', unit: 'date' },
        { key: 'wa', label: 'WhatsApp', unit: 'wa' },
      ],
      rows: top.map((b) => ({
        name: b.name || 'Sem nome',
        orders: b.orders,
        revenue: b.revenue,
        share: ratio(b.revenue, total),
        ticket: ratio(b.revenue, b.orders),
        last: iso(b.last),
        wa: wa(b.phone, waMsg(d.store, b.name, 'Obrigada por ser um dos nossos melhores clientes!')),
      })),
    },
    insight: list.length
      ? `Os ${Math.min(5, list.length)} melhores clientes trouxeram ${pctTxt(ratio(top5, total))} da receita do período. Um agradecimento ou um mimo no próximo pedido ajuda a manter esses clientes.`
      : 'Ninguém comprou neste período.',
  }
}

export type Segment = 'Campeões' | 'Fiéis' | 'Novos' | 'Em risco' | 'Perdidos'
export const SEGMENTS: { id: Segment; action: string }[] = [
  { id: 'Campeões', action: 'Agradeça e peça indicação ou avaliação' },
  { id: 'Fiéis', action: 'Mostre novidades e lançamentos primeiro' },
  { id: 'Novos', action: 'Dê boas-vindas e convide para a segunda compra' },
  { id: 'Em risco', action: 'Mande uma mensagem pessoal com um motivo para voltar' },
  { id: 'Perdidos', action: 'Tente um cupom de retorno; se não responder, siga em frente' },
]

/** Nota de 1 a 5 pela posição (percentil) de cada valor, com empates recebendo a mesma nota. */
export function quintileScores(values: number[], higherIsBetter = true): number[] {
  const n = values.length
  if (n === 0) return []
  if (n === 1) return [5]
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const rank = new Array<number>(n)
  for (let i = 0; i < n; ) {
    let j = i
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2
    for (let k = i; k <= j; k++) rank[idx[k][1]] = avg
    i = j + 1
  }
  return rank.map((rk) => {
    const pr = rk / (n - 1)
    const s = 1 + Math.min(4, Math.floor((higherIsBetter ? pr : 1 - pr) * 5))
    return s
  })
}

export function segmentOf(R: number, F: number, M: number): Segment {
  if (R >= 4 && F >= 4 && M >= 4) return 'Campeões'
  if (R >= 3 && F >= 3) return 'Fiéis'
  if (R >= 3) return 'Novos'
  if (F >= 3) return 'Em risco'
  return 'Perdidos'
}

export function rfmTable(d: ReportData, until: number, f: Filters = {}) {
  const list = [...buyers(makeCtx(d, f), until).values()]
  const rec = list.map((b) => (until - b.last) / DAY)
  const R = quintileScores(rec, false)
  const F = quintileScores(list.map((b) => b.orders))
  const M = quintileScores(list.map((b) => b.revenue))
  return list.map((b, i) => ({ ...b, recency: rec[i], R: R[i], F: F[i], M: M[i], segment: segmentOf(R[i], F[i], M[i]) }))
}

function rfm(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const list = rfmTable(d, ms(r.to), f)
  const total = sumBy(list, (b) => b.revenue)
  const order = SEGMENTS.map((s) => s.id)
  list.sort((a, b) => order.indexOf(a.segment) - order.indexOf(b.segment) || b.revenue - a.revenue)
  const count = (s: Segment) => list.filter((b) => b.segment === s).length
  const rev = (s: Segment) => sumBy(list.filter((b) => b.segment === s), (b) => b.revenue)
  const action = Object.fromEntries(SEGMENTS.map((s) => [s.id, s.action]))
  const msg: Record<Segment, string> = {
    Campeões: 'Obrigada por comprar sempre com a gente! Se puder, conta para um amigo 💛',
    Fiéis: 'Temos novidades que acho que você vai gostar. Quer ver?',
    Novos: 'Obrigada pela primeira compra! Já conhece nossos outros produtos?',
    'Em risco': 'Faz um tempinho que você não aparece. Preparamos uma novidade para você!',
    Perdidos: 'Sentimos sua falta! Tenho um desconto especial para sua volta.',
  }
  return {
    kpis: SEGMENTS.map((s) => ({ label: s.id, value: count(s.id), unit: 'int' as Unit, hint: `${pctTxt(ratio(rev(s.id), total))} da receita` })),
    chart: { kind: 'bar', unit: 'int', items: SEGMENTS.map((s) => ({ label: s.id, value: count(s.id) })) },
    table: {
      columns: [
        { key: 'name', label: 'Cliente', unit: 'text' },
        { key: 'segment', label: 'Grupo', unit: 'text' },
        { key: 'action', label: 'O que fazer', unit: 'text' },
        { key: 'recency', label: 'Dias desde a última compra', unit: 'int' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'revenue', label: 'Total gasto', unit: 'brl' },
        { key: 'score', label: 'Notas R-F-V', unit: 'text' },
        { key: 'wa', label: 'WhatsApp', unit: 'wa' },
      ],
      rows: list.map((b) => ({
        name: b.name || 'Sem nome',
        segment: b.segment,
        action: action[b.segment],
        recency: Math.floor(b.recency),
        orders: b.orders,
        revenue: b.revenue,
        score: `${b.R}-${b.F}-${b.M}`,
        wa: wa(b.phone, waMsg(d.store, b.name, msg[b.segment])),
      })),
    },
    insight: list.length
      ? `Você tem ${count('Campeões')} ${count('Campeões') === 1 ? 'cliente campeão' : 'clientes campeões'} (${pctTxt(ratio(rev('Campeões'), total))} da receita) e ${count('Em risco')} em risco — esses últimos já compraram bastante e sumiram: são os que mais valem uma mensagem agora.`
      : 'Ainda não há vendas para agrupar os clientes.',
  }
}

function clientesSumidos(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const until = ms(r.to)
  const list = [...buyers(makeCtx(d, f), until).values()]
    .map((b) => ({ ...b, days: Math.floor((until - b.last) / DAY) }))
    .filter((b) => b.days >= 30)
    .sort((a, b) => b.revenue - a.revenue)
  const band = (x: number) => (x >= 90 ? '90 dias ou mais' : x >= 60 ? '60 a 89 dias' : '30 a 59 dias')
  const bands = ['30 a 59 dias', '60 a 89 dias', '90 dias ou mais']
  const n = (bd: string) => list.filter((b) => band(b.days) === bd).length
  return {
    kpis: bands.map((b) => ({ label: `Sem comprar há ${b}`, value: n(b), unit: 'int' as Unit })),
    chart: { kind: 'bar', unit: 'int', items: bands.map((b) => ({ label: b, value: n(b) })) },
    table: {
      columns: [
        { key: 'name', label: 'Cliente', unit: 'text' },
        { key: 'band', label: 'Sem comprar há', unit: 'text' },
        { key: 'days', label: 'Dias', unit: 'int' },
        { key: 'last', label: 'Última compra', unit: 'date' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'revenue', label: 'Total gasto', unit: 'brl' },
        { key: 'wa', label: 'WhatsApp', unit: 'wa' },
      ],
      rows: list.map((b) => ({
        name: b.name || 'Sem nome',
        band: band(b.days),
        days: b.days,
        last: iso(b.last),
        orders: b.orders,
        revenue: b.revenue,
        wa: wa(b.phone, waMsg(d.store, b.name, 'Sentimos sua falta por aqui! Quer ver as novidades da semana?')),
      })),
    },
    insight: list.length
      ? `${list.length} ${list.length === 1 ? 'cliente não compra' : 'clientes não compram'} há mais de 30 dias; juntos já gastaram ${brl(sumBy(list, (b) => b.revenue))} na loja. Comece pelos que mais gastaram (estão no topo da lista).`
      : 'Nenhum cliente está há mais de 30 dias sem comprar.',
  }
}

export function ltvSummary(list: Buyer[]) {
  const orders = sumBy(list, (b) => b.orders)
  const revenue = sumBy(list, (b) => b.revenue)
  const months = list.map((b) => Math.max(1, (b.last - b.first) / (30 * DAY)))
  const ticket = ratio(revenue, orders)
  const frequency = ratio(orders, sumBy(months, (m) => m))
  const lifetime = months.length ? sumBy(months, (m) => m) / months.length : 0
  return { ticket, frequency, lifetime, ltv: ticket * frequency * lifetime }
}

function valorCliente(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const list = [...buyers(c, ms(r.to)).values()]
  const s = ltvSummary(list)
  const sp0 = ltvSummary([...buyers(c, ms(p.to)).values()])
  const cohorts = new Map<string, Buyer[]>()
  for (const b of list) {
    const k = dayKey(b.first).slice(0, 7)
    cohorts.set(k, [...(cohorts.get(k) ?? []), b])
  }
  const rows: Row[] = [...cohorts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, bs]) => {
      const [y, m] = k.split('-').map(Number)
      const orders = sumBy(bs, (b) => b.orders)
      const rev = sumBy(bs, (b) => b.revenue)
      return { label: `${MONTHS[m - 1]}/${String(y).slice(2)}`, customers: bs.length, perCustomer: ratio(orders, bs.length), ticket: ratio(rev, orders), value: ratio(rev, bs.length) }
    })
  return {
    kpis: [
      { label: 'Valor do cliente (LTV)', value: s.ltv, prev: sp0.ltv, unit: 'brl' },
      { label: 'Ticket médio', value: s.ticket, prev: sp0.ticket, unit: 'brl' },
      { label: 'Pedidos por cliente por mês', value: s.frequency, prev: sp0.frequency, unit: 'num' },
      { label: 'Tempo de relacionamento', value: s.lifetime, unit: 'num', hint: 'meses, em média' },
    ],
    chart: { kind: 'bar', unit: 'brl', items: rows.map((x) => ({ label: `Clientes de ${x.label}`, value: x.value as number })) },
    table: {
      columns: [
        { key: 'label', label: 'Primeira compra em', unit: 'text' },
        { key: 'customers', label: 'Clientes', unit: 'int' },
        { key: 'perCustomer', label: 'Pedidos por cliente', unit: 'num' },
        { key: 'ticket', label: 'Ticket médio', unit: 'brl' },
        { key: 'value', label: 'Receita por cliente até agora', unit: 'brl' },
      ],
      rows,
    },
    insight: list.length
      ? `Cada cliente vale em média ${brl(Math.round(s.ltv))} para a loja (ticket de ${brl(Math.round(s.ticket))} × ${fmtValue(s.frequency, 'num')} ${s.frequency === 1 ? 'pedido' : 'pedidos'} por mês × ${fmtValue(s.lifetime, 'num')} meses de relacionamento). Gastar menos que isso para conquistar um cliente novo vale a pena.`
      : 'Ainda não há vendas para calcular o valor do cliente.',
  }
}

// ---------- Relatórios: Produtos e estoque ----------

export function abcCurve(d: ReportData, r: Range, f: Filters = {}) {
  const c = makeCtx(d, f)
  const m = new Map<string, { id: string; label: string; revenue: number; units: number }>()
  for (const o of salesIn(c, r))
    for (const i of o.items) {
      if (!c.itemOk(i.product_id)) continue
      let x = m.get(i.product_id)
      if (!x) m.set(i.product_id, (x = { id: i.product_id, label: productName(c, i.product_id, i.name), revenue: 0, units: 0 }))
      x.revenue += itemRev(i)
      x.units += i.qty
    }
  const list = [...m.values()].filter((x) => x.revenue > 0).sort((a, b) => b.revenue - a.revenue)
  const total = sumBy(list, (x) => x.revenue)
  let cum = 0
  return list.map((x) => {
    const before = cum
    const share = x.revenue / total
    cum += share
    return { ...x, share, cumulative: cum, cls: (before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C') as 'A' | 'B' | 'C' }
  })
}

function curvaAbc(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const list = abcCurve(d, r, f)
  const n = (k: string) => list.filter((x) => x.cls === k).length
  const a = list.filter((x) => x.cls === 'A')
  return {
    kpis: [
      { label: 'Classe A', value: n('A'), unit: 'int', hint: '80% da receita' },
      { label: 'Classe B', value: n('B'), unit: 'int', hint: 'próximos 15%' },
      { label: 'Classe C', value: n('C'), unit: 'int', hint: 'últimos 5%' },
    ],
    chart: { kind: 'pareto', items: list.map((x) => ({ label: x.label, value: x.revenue })) },
    table: {
      columns: [
        { key: 'label', label: 'Produto', unit: 'text' },
        { key: 'cls', label: 'Classe', unit: 'text' },
        { key: 'units', label: 'Unidades', unit: 'int' },
        { key: 'revenue', label: 'Receita', unit: 'brl' },
        { key: 'share', label: '% da receita', unit: 'pct' },
        { key: 'cumulative', label: '% acumulado', unit: 'pct' },
      ],
      rows: list.map((x) => ({ label: x.label, cls: x.cls, units: x.units, revenue: x.revenue, share: x.share, cumulative: x.cumulative })),
    },
    insight: list.length
      ? `${a.length} de ${list.length} produtos vendidos (${a.map((x) => x.label).slice(0, 3).join(', ')}${a.length > 3 ? '…' : ''}) trazem 80% da receita: são os que nunca podem faltar. Os da classe C podem sair do destaque ou virar combo.`
      : 'Não houve vendas neste período.',
  }
}

function lastSaleByProduct(c: Ctx, until: number) {
  const last = new Map<string, number>()
  for (const { o, t } of c.sales) {
    if (t >= until) continue
    for (const i of o.items) if (t > (last.get(i.product_id) ?? 0)) last.set(i.product_id, t)
  }
  return last
}

function produtosParados(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { category: f.category })
  const until = ms(r.to)
  const last = lastSaleByProduct(c, until)
  const list = d.products
    .filter((p) => !p.blocked && c.itemOk(p.id) && ms(p.created_at) < until)
    .map((p) => {
      const l = last.get(p.id)
      const since = l ?? ms(p.created_at)
      return { p, last: l, days: Math.floor((until - since) / DAY) }
    })
    .filter((x) => x.days >= 30)
    .sort((a, b) => b.days - a.days)
  const band = (x: number) => (x >= 90 ? '90 dias ou mais' : x >= 60 ? '60 a 89 dias' : '30 a 59 dias')
  const bands = ['30 a 59 dias', '60 a 89 dias', '90 dias ou mais']
  const stuck = sumBy(list, (x) => (x.p.track_stock ? x.p.stock * (x.p.cost_cents ?? 0) : 0))
  return {
    kpis: bands.map((b) => ({ label: `Sem vender há ${b}`, value: list.filter((x) => band(x.days) === b).length, unit: 'int' as Unit })),
    table: {
      columns: [
        { key: 'label', label: 'Produto', unit: 'text' },
        { key: 'band', label: 'Sem vender há', unit: 'text' },
        { key: 'last', label: 'Última venda', unit: 'date' },
        { key: 'days', label: 'Dias', unit: 'int' },
        { key: 'available', label: 'Visível na loja', unit: 'text' },
        { key: 'stock', label: 'Estoque', unit: 'int' },
        { key: 'value', label: 'Dinheiro parado (custo)', unit: 'brl' },
      ],
      rows: list.map((x) => ({
        label: x.p.name,
        band: x.last ? band(x.days) : 'nunca vendeu',
        last: x.last ? iso(x.last) : null,
        days: x.days,
        available: x.p.available ? 'Sim' : 'Não',
        stock: x.p.track_stock ? x.p.stock : null,
        value: x.p.track_stock && x.p.cost_cents != null ? x.p.stock * x.p.cost_cents : null,
      })),
    },
    insight: list.length
      ? `${list.length} ${list.length === 1 ? 'produto está' : 'produtos estão'} há 30 dias ou mais sem vender${stuck ? `, com ${brl(stuck)} parados em estoque (a preço de custo)` : ''}. Tente uma foto nova, um combo ou uma promoção — ou tire da loja.`
      : 'Todos os produtos venderam nos últimos 30 dias.',
  }
}

function sessionsBy(events: StoreEvent[], r: Range, type: StoreEvent['type'], f: Filters = {}) {
  const R = rr(r)
  const out = new Map<string, Set<string>>()
  for (const e of events) {
    if (e.type !== type || !inR(ms(e.created_at), R)) continue
    if (f.source && (e.data.source || 'direto') !== f.source) continue
    const k = e.product_id ?? ''
    let s = out.get(k)
    if (!s) out.set(k, (s = new Set()))
    s.add(e.session_id)
  }
  return out
}

function vistosPoucoComprados(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { category: f.category })
  const R = rr(r)
  const views = new Map<string, number>()
  for (const e of d.events) if (e.type === 'product_view' && e.product_id && inR(ms(e.created_at), R)) views.set(e.product_id, (views.get(e.product_id) ?? 0) + 1)
  const people = sessionsBy(d.events, r, 'product_view')
  const sold = new Map<string, { orders: number; units: number }>()
  for (const o of salesIn(c, r)) {
    const seen = new Set<string>()
    for (const i of o.items) {
      const x = sold.get(i.product_id) ?? { orders: 0, units: 0 }
      x.units += i.qty
      if (!seen.has(i.product_id)) x.orders++
      seen.add(i.product_id)
      sold.set(i.product_id, x)
    }
  }
  const list = [...people.entries()]
    .filter(([pid]) => pid && c.itemOk(pid))
    .map(([pid, s]) => ({ pid, label: productName(c, pid), views: views.get(pid) ?? 0, people: s.size, ...(sold.get(pid) ?? { orders: 0, units: 0 }) }))
    .map((x) => ({ ...x, conv: ratio(x.orders, x.people) }))
    .sort((a, b) => b.people - a.people)
  const avg = ratio(sumBy(list, (x) => x.orders), sumBy(list, (x) => x.people))
  const med = list.length ? list[Math.floor(list.length / 2)].people : 0
  const flagged = list.filter((x) => x.people >= med && x.conv < avg * 0.6)
  return {
    chart: { kind: 'bar', unit: 'pct', items: list.slice(0, 10).map((x) => ({ label: x.label, value: x.conv })) },
    table: {
      columns: [
        { key: 'label', label: 'Produto', unit: 'text' },
        { key: 'views', label: 'Visualizações', unit: 'int' },
        { key: 'people', label: 'Pessoas que viram', unit: 'int' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'units', label: 'Unidades', unit: 'int' },
        { key: 'conv', label: 'Viram e compraram', unit: 'pct' },
        { key: 'flag', label: 'Situação', unit: 'text' },
      ],
      rows: list.map((x) => ({ label: x.label, views: x.views, people: x.people, orders: x.orders, units: x.units, conv: x.conv, flag: flagged.includes(x) ? 'Muito visto, pouco comprado' : '' })),
    },
    insight: !list.length
      ? 'Nenhum produto foi visto neste período.'
      : flagged.length
        ? `${flagged.map((x) => x.label).slice(0, 3).join(', ')} ${flagged.length === 1 ? 'chama' : 'chamam'} atenção mas ${flagged.length === 1 ? 'vende' : 'vendem'} pouco (${pctTxt(flagged[0].conv, 1)} de quem viu comprou, contra ${pctTxt(avg, 1)} na média). Revise preço, fotos, descrição e frete desses produtos.`
        : `Os produtos mais vistos convertem perto da média da loja (${pctTxt(avg, 1)} de quem vê compra).`,
  }
}

interface StockItem {
  label: string
  variant: string
  stock: number
  price: number
  cost: number | null
  sold: number
}

function stockItems(c: Ctx, from: number, to: number): StockItem[] {
  const soldP = new Map<string, number>()
  const soldV = new Map<string, number>()
  for (const { o, t } of c.sales) {
    if (t < from || t >= to) continue
    for (const i of o.items) {
      soldP.set(i.product_id, (soldP.get(i.product_id) ?? 0) + i.qty)
      if (i.variant_id) soldV.set(i.variant_id, (soldV.get(i.variant_id) ?? 0) + i.qty)
    }
  }
  const out: StockItem[] = []
  for (const p of c.d.products) {
    if (!p.track_stock || p.blocked || !c.itemOk(p.id)) continue
    const price = p.promo_price_cents ?? p.price_cents
    const vs = c.d.variants.filter((v) => v.product_id === p.id)
    if (vs.length)
      for (const v of vs)
        out.push({ label: p.name, variant: Object.values(v.values).join(' / '), stock: v.stock, price: v.price_cents ?? price, cost: p.cost_cents, sold: soldV.get(v.id) ?? 0 })
    else out.push({ label: p.name, variant: '', stock: p.stock, price, cost: p.cost_cents, sold: soldP.get(p.id) ?? 0 })
  }
  return out
}

function estoqueBaixo(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { category: f.category })
  const to = ms(r.to)
  const items = stockItems(c, to - 30 * DAY, to).map((x) => {
    const perDay = x.sold / 30
    const days = perDay ? x.stock / perDay : null
    const status = x.stock <= 0 ? 'Esgotado' : x.stock <= 3 || (days != null && days <= 7) ? 'Repor já' : days != null && days <= 14 ? 'Atenção' : 'Ok'
    return { ...x, perDay, days, status }
  })
  items.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.stock - b.stock)
  const urgent = items.filter((x) => x.status === 'Repor já' || x.status === 'Esgotado')
  return {
    chart: { kind: 'bar', unit: 'days', items: items.filter((x) => x.days != null).slice(0, 10).map((x) => ({ label: x.variant ? `${x.label} (${x.variant})` : x.label, value: x.days! })) },
    table: {
      columns: [
        { key: 'label', label: 'Produto', unit: 'text' },
        { key: 'variant', label: 'Variação', unit: 'text' },
        { key: 'stock', label: 'Estoque', unit: 'int' },
        { key: 'perDay', label: 'Venda média por dia', unit: 'num' },
        { key: 'days', label: 'Dias de estoque', unit: 'num' },
        { key: 'status', label: 'Situação', unit: 'text' },
      ],
      rows: items.map((x) => ({ label: x.label, variant: x.variant, stock: x.stock, perDay: x.perDay, days: x.days, status: x.days == null && x.status === 'Ok' ? 'Sem vendas em 30 dias' : x.status })),
    },
    insight: !items.length
      ? 'Nenhum produto tem controle de estoque ligado.'
      : urgent.length
        ? `${urgent.length} ${urgent.length === 1 ? 'item precisa' : 'itens precisam'} de reposição agora (${urgent.slice(0, 3).map((x) => (x.variant ? `${x.label} ${x.variant}` : x.label)).join(', ')}). A conta usa a venda média dos últimos 30 dias.`
        : 'Nenhum produto deve acabar na próxima semana, pelo ritmo de vendas dos últimos 30 dias.',
  }
}

function giroEstoque(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { category: f.category })
  const R = rr(r)
  const days = (R.t - R.f) / DAY
  const items = stockItems(c, R.f, R.t).map((x) => {
    const avgStock = x.stock + x.sold / 2
    return { ...x, turn: ratio(x.sold, avgStock), cover: x.sold ? x.stock / (x.sold / days) : null }
  })
  items.sort((a, b) => b.turn - a.turn)
  const slow = items.filter((x) => x.stock > 0 && x.turn < 0.5)
  return {
    chart: { kind: 'bar', unit: 'num', items: items.slice(0, 10).map((x) => ({ label: x.variant ? `${x.label} (${x.variant})` : x.label, value: x.turn })) },
    table: {
      columns: [
        { key: 'label', label: 'Produto', unit: 'text' },
        { key: 'variant', label: 'Variação', unit: 'text' },
        { key: 'sold', label: 'Vendidos no período', unit: 'int' },
        { key: 'stock', label: 'Estoque atual', unit: 'int' },
        { key: 'turn', label: 'Giro (vezes)', unit: 'num' },
        { key: 'cover', label: 'Estoque dura', unit: 'days' },
      ],
      rows: items.map((x) => ({ label: x.label, variant: x.variant, sold: x.sold, stock: x.stock, turn: x.turn, cover: x.cover })),
    },
    insight: !items.length
      ? 'Nenhum produto tem controle de estoque ligado.'
      : `Giro = unidades vendidas ÷ estoque médio do período (estimado pelo estoque atual mais metade do que foi vendido). ${
          slow.length ? `${slow.length} ${slow.length === 1 ? 'item gira' : 'itens giram'} devagar (${slow.slice(0, 2).map((x) => x.label).join(', ')}): compre menos deles na próxima reposição.` : 'Todos os itens com estoque giraram bem no período.'
        }`,
  }
}

function valorEstoque(d: ReportData, _r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { category: f.category })
  const items = stockItems(c, 0, 0).filter((x) => x.stock > 0)
  const atCost = sumBy(items, (x) => (x.cost != null ? x.cost * x.stock : 0))
  const atPrice = sumBy(items, (x) => x.price * x.stock)
  const noCost = [...new Set(items.filter((x) => x.cost == null).map((x) => x.label))]
  items.sort((a, b) => b.price * b.stock - a.price * a.stock)
  return {
    kpis: [
      { label: 'Valor a preço de custo', value: atCost, unit: 'brl' },
      { label: 'Valor a preço de venda', value: atPrice, unit: 'brl' },
      { label: 'Unidades em estoque', value: sumBy(items, (x) => x.stock), unit: 'int' },
    ],
    chart: { kind: 'bar', unit: 'brl', items: items.slice(0, 10).map((x) => ({ label: x.variant ? `${x.label} (${x.variant})` : x.label, value: x.price * x.stock })) },
    table: {
      columns: [
        { key: 'label', label: 'Produto', unit: 'text' },
        { key: 'variant', label: 'Variação', unit: 'text' },
        { key: 'stock', label: 'Estoque', unit: 'int' },
        { key: 'cost', label: 'Custo unitário', unit: 'brl' },
        { key: 'atCost', label: 'Total a custo', unit: 'brl' },
        { key: 'price', label: 'Preço', unit: 'brl' },
        { key: 'atPrice', label: 'Total a preço de venda', unit: 'brl' },
      ],
      rows: items.map((x) => ({ label: x.label, variant: x.variant, stock: x.stock, cost: x.cost, atCost: x.cost != null ? x.cost * x.stock : null, price: x.price, atPrice: x.price * x.stock })),
    },
    insight: !items.length
      ? 'Não há produtos com estoque controlado e unidades disponíveis.'
      : `Você tem ${brl(atCost)} investidos em estoque, que podem virar ${brl(atPrice)} em vendas.${noCost.length ? ` Falta o custo de: ${noCost.join(', ')} — cadastre para a conta ficar completa.` : ''}`,
  }
}

// ---------- Relatórios: Funil e comportamento ----------

export const FUNNEL_STEPS: { type: StoreEvent['type']; label: string }[] = [
  { type: 'visit', label: 'Visitou a loja' },
  { type: 'product_view', label: 'Viu um produto' },
  { type: 'add_to_cart', label: 'Pôs no carrinho' },
  { type: 'checkout_start', label: 'Começou a finalizar' },
  { type: 'order_placed', label: 'Fez o pedido' },
]

/** Sessões distintas em cada etapa; uma sessão só conta numa etapa se passou por todas as anteriores. */
export function funnelCounts(events: StoreEvent[], r: Range, f: Filters = {}) {
  const R = rr(r)
  const steps = new Map<string, Set<string>>()
  for (const e of events) {
    if (!inR(ms(e.created_at), R)) continue
    if (f.source && (e.data.source || 'direto') !== f.source) continue
    let s = steps.get(e.session_id)
    if (!s) steps.set(e.session_id, (s = new Set()))
    s.add(e.type)
  }
  const counts = FUNNEL_STEPS.map(() => 0)
  for (const s of steps.values()) {
    for (let k = 0; k < FUNNEL_STEPS.length; k++) {
      if (!s.has(FUNNEL_STEPS[k].type)) break
      counts[k]++
    }
  }
  return counts
}

function funil(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const cur = funnelCounts(d.events, r, f)
  const prv = funnelCounts(d.events, p, f)
  const rows: Row[] = FUNNEL_STEPS.map((s, i) => ({
    label: s.label,
    sessions: cur[i],
    ofStart: ratio(cur[i], cur[0]),
    ofPrev: i ? ratio(cur[i], cur[i - 1]) : null,
    lost: i ? cur[i - 1] - cur[i] : null,
    prev: prv[i],
  }))
  let worst = 1
  for (let i = 1; i < cur.length; i++) if (ratio(cur[i], cur[i - 1]) < ratio(cur[worst], cur[worst - 1])) worst = i
  return {
    kpis: [
      { label: 'Visitas', value: cur[0], prev: prv[0], unit: 'int' },
      { label: 'Pedidos', value: cur[4], prev: prv[4], unit: 'int' },
      { label: 'Conversão', value: ratio(cur[4], cur[0]), prev: ratio(prv[4], prv[0]), unit: 'pct', hint: 'Visitas que viraram pedido' },
    ],
    chart: { kind: 'funnel', steps: FUNNEL_STEPS.map((s, i) => ({ label: s.label, value: cur[i] })) },
    table: {
      columns: [
        { key: 'label', label: 'Etapa', unit: 'text' },
        { key: 'sessions', label: 'Visitas', unit: 'int' },
        { key: 'ofStart', label: '% do início', unit: 'pct' },
        { key: 'ofPrev', label: '% que seguiu da etapa anterior', unit: 'pct' },
        { key: 'lost', label: 'Pararam aqui', unit: 'int' },
        { key: 'prev', label: 'Período anterior', unit: 'int' },
      ],
      rows,
    },
    insight: cur[0]
      ? `A maior perda está entre "${FUNNEL_STEPS[worst - 1].label}" e "${FUNNEL_STEPS[worst].label}": ${pctTxt(1 - ratio(cur[worst], cur[worst - 1]))} das visitas param aí. ${
          [
            '',
            'Destaque os produtos na página inicial e use fotos melhores.',
            'Revise preço, fotos e descrição dos produtos mais vistos.',
            'Mostre o frete e o prazo antes do carrinho, e facilite o pedido mínimo.',
            'Simplifique o fechamento: menos campos e mais formas de pagamento.',
          ][worst]
        }`
      : 'Não houve visitas neste período.',
  }
}

function carrinhosAbandonados(d: ReportData, r: Range, p: Range, _f: Filters): ReportResult {
  const R = rr(r)
  const stats = (rng: Range) => {
    const starts = sessionsBy(d.events, rng, 'checkout_start').get('') ?? new Set<string>()
    const placed = sessionsBy(d.events, rng, 'order_placed').get('') ?? new Set<string>()
    const abandoned = [...starts].filter((s) => !placed.has(s)).length
    return { starts: starts.size, abandoned, rate: ratio(abandoned, starts.size), placed }
  }
  const cur = stats(r)
  const prv = stats(p)
  const ordersByPhone = new Map<string, number[]>()
  for (const o of d.orders) {
    if (o.status === 'cancelled') continue
    const k = onlyDigits(o.customer.phone)
    ordersByPhone.set(k, [...(ordersByPhone.get(k) ?? []), ms(o.created_at)])
  }
  const drafts = d.checkouts
    .filter((x) => inR(ms(x.created_at), R) && !cur.placed.has(x.session_id) && (!x.order_id || x.contacted_at))
    .map((x) => {
      const contacted = x.contacted_at ? ms(x.contacted_at) : null
      const recovered = !!x.order_id || (contacted != null && (ordersByPhone.get(onlyDigits(x.customer.phone)) ?? []).some((t) => t >= contacted))
      return { x, contacted, recovered }
    })
    .sort((a, b) => b.x.total_cents - a.x.total_cents)
  const open = drafts.filter((x) => !x.recovered)
  const rec = drafts.filter((x) => x.recovered)
  const contacted = drafts.filter((x) => x.contacted != null)
  return {
    kpis: [
      { label: 'Carrinhos abandonados', value: cur.abandoned, prev: prv.abandoned, unit: 'int', upIsBad: true },
      { label: 'Taxa de abandono', value: cur.rate, prev: prv.rate, unit: 'pct', upIsBad: true, hint: 'Começaram a finalizar e não pediram' },
      { label: 'Valor em aberto', value: sumBy(open, (x) => x.x.total_cents), unit: 'brl' },
      { label: 'Recuperados', value: rec.length, unit: 'int', hint: `${brl(sumBy(rec, (x) => x.x.total_cents))} de ${contacted.length} contatados` },
    ],
    table: {
      columns: [
        { key: 'date', label: 'Data', unit: 'date' },
        { key: 'name', label: 'Cliente', unit: 'text' },
        { key: 'items', label: 'Itens', unit: 'text' },
        { key: 'value', label: 'Valor', unit: 'brl' },
        { key: 'contacted', label: 'Contatado', unit: 'text' },
        { key: 'recovered', label: 'Recuperado', unit: 'text' },
        { key: 'wa', label: 'WhatsApp', unit: 'wa' },
      ],
      rows: drafts.map(({ x, contacted, recovered }) => ({
        date: x.created_at,
        name: x.customer.name || 'Sem nome',
        items: x.items.map((i) => `${i.qty}× ${i.name}`).join(', '),
        value: x.total_cents,
        contacted: contacted ? 'Sim' : 'Não',
        recovered: recovered ? 'Sim' : 'Não',
        wa: recovered ? null : wa(x.customer.phone, waMsg(d.store, x.customer.name, `Vi que você separou ${x.items.map((i) => i.name).join(', ')} e não finalizou. Posso ajudar com alguma coisa?`)),
      })),
    },
    insight: cur.starts
      ? `${pctTxt(cur.rate)} de quem começou a finalizar não fez o pedido (${cur.abandoned} ${cur.abandoned === 1 ? 'carrinho' : 'carrinhos'}). ${open.length ? `Há ${brl(sumBy(open, (x) => x.x.total_cents))} em carrinhos com contato para chamar no WhatsApp.` : ''}${contacted.length ? ` Dos contatados, ${pctTxt(ratio(rec.length, contacted.length))} voltaram e compraram.` : ''}`.trim()
      : 'Ninguém começou a finalizar uma compra neste período.',
  }
}

function buscas(d: ReportData, r: Range, _p: Range, _f: Filters): ReportResult {
  const R = rr(r)
  const m = new Map<string, { q: string; n: number; people: Set<string>; results: number }>()
  for (const e of d.events) {
    if (e.type !== 'search' || !inR(ms(e.created_at), R)) continue
    const q = (e.data.q ?? '').trim().toLowerCase()
    if (!q) continue
    let x = m.get(q)
    if (!x) m.set(q, (x = { q, n: 0, people: new Set(), results: e.data.results ?? 0 }))
    x.n++
    x.people.add(e.session_id)
    x.results = e.data.results ?? x.results
  }
  const list = [...m.values()].sort((a, b) => b.n - a.n)
  const total = sumBy(list, (x) => x.n)
  const zero = list.filter((x) => !x.results)
  const zeroN = sumBy(zero, (x) => x.n)
  return {
    kpis: [
      { label: 'Buscas', value: total, unit: 'int' },
      { label: 'Buscas sem resultado', value: ratio(zeroN, total), unit: 'pct', upIsBad: true },
      { label: 'Termos diferentes', value: list.length, unit: 'int' },
    ],
    chart: { kind: 'bar', unit: 'int', items: list.slice(0, 10).map((x) => ({ label: x.results ? x.q : `${x.q} (sem resultado)`, value: x.n })) },
    table: {
      columns: [
        { key: 'q', label: 'Termo buscado', unit: 'text' },
        { key: 'n', label: 'Buscas', unit: 'int' },
        { key: 'people', label: 'Pessoas', unit: 'int' },
        { key: 'results', label: 'Resultados', unit: 'int' },
        { key: 'zero', label: 'Encontrou algo?', unit: 'text' },
      ],
      rows: list.map((x) => ({ q: x.q, n: x.n, people: x.people.size, results: x.results, zero: x.results ? 'Sim' : 'Não' })),
    },
    insight: !total
      ? 'Ninguém usou a busca da loja neste período.'
      : zero.length
        ? `${zeroN} ${zeroN === 1 ? 'busca não encontrou' : 'buscas não encontraram'} nada — ${zero.slice(0, 3).map((x) => `"${x.q}" (${x.n}×)`).join(', ')}. Pense em criar esses produtos ou incluir essas palavras no nome e na descrição.`
        : `O termo mais buscado foi "${list[0].q}" e todas as buscas encontraram produtos.`,
  }
}

function maisVistos(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, {})
  const R = rr(r)
  const m = new Map<string, { type: string; label: string; views: number; people: Set<string> }>()
  for (const e of d.events) {
    if (!inR(ms(e.created_at), R)) continue
    if (f.source && (e.data.source || 'direto') !== f.source) continue
    let key: string
    let type: string
    let label: string
    if (e.type === 'product_view' && e.product_id) {
      key = 'p:' + e.product_id
      type = 'Produto'
      label = productName(c, e.product_id)
    } else if (e.type === 'content_view' && e.data.content_id) {
      key = 'c:' + e.data.content_id
      type = 'Post ou página'
      label = d.contents?.find((x) => x.id === e.data.content_id)?.title ?? 'Conteúdo removido'
    } else if (e.type === 'visit' && e.data.path) {
      key = 'v:' + e.data.path
      type = 'Página de entrada'
      label = e.data.path === '/' ? 'Página inicial' : e.data.path
    } else continue
    let x = m.get(key)
    if (!x) m.set(key, (x = { type, label, views: 0, people: new Set() }))
    x.views++
    x.people.add(e.session_id)
  }
  const list = [...m.values()].sort((a, b) => b.views - a.views)
  const prods = list.filter((x) => x.type === 'Produto')
  return {
    chart: { kind: 'bar', unit: 'int', items: prods.slice(0, 10).map((x) => ({ label: x.label, value: x.views })) },
    table: {
      columns: [
        { key: 'type', label: 'Tipo', unit: 'text' },
        { key: 'label', label: 'Nome', unit: 'text' },
        { key: 'views', label: 'Visualizações', unit: 'int' },
        { key: 'people', label: 'Pessoas', unit: 'int' },
      ],
      rows: list.map((x) => ({ type: x.type, label: x.label, views: x.views, people: x.people.size })),
    },
    insight: prods.length
      ? `O produto mais visto foi ${prods[0].label} (${prods[0].views} visualizações por ${prods[0].people.size} pessoas). Mantenha os mais vistos no topo da loja e sempre com estoque.`
      : 'Nenhum produto foi visto neste período.',
  }
}

function dispositivo(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { source: f.source })
  const calc = (rng: Range) => {
    const R = rr(rng)
    const dev = new Map<string, string>()
    const placed = new Set<string>()
    for (const e of d.events) {
      if (!inR(ms(e.created_at), R)) continue
      if (f.source && (e.data.source || 'direto') !== f.source) continue
      if (!dev.has(e.session_id)) dev.set(e.session_id, e.data.device === 'desktop' ? 'desktop' : 'mobile')
      if (e.type === 'order_placed') placed.add(e.session_id)
    }
    const out: Record<string, { visits: number; orders: number; revenue: number; sales: number }> = {
      mobile: { visits: 0, orders: 0, revenue: 0, sales: 0 },
      desktop: { visits: 0, orders: 0, revenue: 0, sales: 0 },
    }
    for (const [s, dv] of dev) {
      out[dv].visits++
      if (placed.has(s)) out[dv].orders++
    }
    for (const o of salesIn(c, rng)) {
      const dv = o.source?.device === 'desktop' ? 'desktop' : 'mobile'
      out[dv].revenue += o.total_cents
      out[dv].sales++
    }
    return out
  }
  const cur = calc(r)
  const prv = calc(p)
  const keys = ['mobile', 'desktop'] as const
  const totalV = cur.mobile.visits + cur.desktop.visits
  const conv = (k: 'mobile' | 'desktop', x = cur) => ratio(x[k].orders, x[k].visits)
  return {
    chart: { kind: 'bar', unit: 'pct', items: keys.map((k) => ({ label: `Conversão no ${deviceLabel(k).toLowerCase()}`, value: conv(k) })) },
    table: {
      columns: [
        { key: 'label', label: 'Aparelho', unit: 'text' },
        { key: 'visits', label: 'Visitas', unit: 'int' },
        { key: 'share', label: '% das visitas', unit: 'pct' },
        { key: 'orders', label: 'Pedidos', unit: 'int' },
        { key: 'conv', label: 'Conversão', unit: 'pct' },
        { key: 'prevConv', label: 'Conversão no período anterior', unit: 'pct' },
        { key: 'revenue', label: 'Receita', unit: 'brl' },
        { key: 'ticket', label: 'Ticket médio', unit: 'brl' },
      ],
      rows: keys.map((k) => ({
        label: deviceLabel(k),
        visits: cur[k].visits,
        share: ratio(cur[k].visits, totalV),
        orders: cur[k].orders,
        conv: conv(k),
        prevConv: conv(k, prv),
        revenue: cur[k].revenue,
        ticket: ratio(cur[k].revenue, cur[k].sales),
      })),
    },
    insight: totalV
      ? `${pctTxt(ratio(cur.mobile.visits, totalV))} das visitas vêm do celular. A conversão é de ${pctTxt(conv('mobile'), 1)} no celular e ${pctTxt(conv('desktop'), 1)} no computador${
          conv('mobile') < conv('desktop') * 0.8 ? ': teste sua loja pelo celular e veja onde a compra fica difícil.' : '.'
        }`
      : 'Não houve visitas neste período.',
  }
}

// ---------- Relatórios: Origem das vendas ----------

function bySessionAttr(d: ReportData, c: Ctx, r: Range, p: Range, attr: (data: StoreEvent['data']) => string, orderAttr: (o: Order) => string, labelOf: (k: string) => string) {
  const visits = (rng: Range) => {
    const R = rr(rng)
    const m = new Map<string, Set<string>>()
    for (const e of d.events) {
      if (e.type !== 'visit' || !inR(ms(e.created_at), R)) continue
      const k = attr(e.data)
      if (!k) continue
      let s = m.get(k)
      if (!s) m.set(k, (s = new Set()))
      s.add(e.session_id)
    }
    return m
  }
  const vc = visits(r)
  const groups = new Map<string, Group>()
  for (const [rng, isCur] of [[r, true], [p, false]] as const)
    for (const o of salesIn(c, rng)) {
      const k = orderAttr(o)
      if (k) addTo(groups, k, labelOf(k), isCur, o.total_cents)
    }
  for (const k of vc.keys()) if (!groups.has(k)) groups.set(k, { label: labelOf(k), cur: 0, prev: 0, orders: 0, units: 0, extra: {} })
  const b = breakdownRows(groups, {
    firstCols: [
      { key: 'label', label: 'Origem', unit: 'text' },
      { key: 'visits', label: 'Visitas', unit: 'int' },
    ],
    extraCols: [
      { key: 'conv', label: 'Conversão', unit: 'pct' },
      { key: 'ticket', label: 'Ticket médio', unit: 'brl' },
    ],
  })
  const keyOf = new Map([...groups.entries()].map(([k, g]) => [g, k]))
  b.rows.forEach((row, i) => {
    const g = b.list[i]
    const v = vc.get(keyOf.get(g)!)?.size ?? 0
    row.visits = v
    row.conv = v ? ratio(g.orders, v) : null
    row.ticket = ratio(g.cur, g.orders)
  })
  return b
}

function origem(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { ...f, source: undefined })
  const b = bySessionAttr(d, c, r, p, (x) => x.source || 'direto', orderSource, sourceLabel)
  const best = [...b.rows].filter((x) => (x.visits as number) >= 20).sort((x, y) => (y.conv as number) - (x.conv as number))[0]
  return {
    chart: barTop(b.list),
    table: { columns: b.columns, rows: b.rows },
    insight: shareInsight(b.list) + (best && b.list.length > 1 ? ` Quem chega por ${best.label} é quem mais compra (${pctTxt(best.conv as number, 1)} das visitas viram pedido).` : ''),
  }
}

function campanha(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, { ...f, source: undefined })
  const b = bySessionAttr(d, c, r, p, (x) => x.campaign || '', (o) => o.source?.campaign || '', (k) => k)
  b.columns[0] = { key: 'label', label: 'Campanha', unit: 'text' }
  return {
    chart: barTop(b.list),
    table: { columns: b.columns, rows: b.rows },
    insight: b.list.length
      ? shareInsight(b.list, 'da receita vinda de campanhas', 'As campanhas trouxeram visitas, mas nenhuma venda neste período.')
      : 'Nenhuma visita chegou por link de campanha neste período. Crie links com utm_campaign para saber qual post ou anúncio vende mais.',
  }
}

function posts(d: ReportData, r: Range, _p: Range, _f: Filters): ReportResult {
  const R = rr(r)
  const bySession = new Map<string, StoreEvent[]>()
  for (const e of d.events) {
    if (!inR(ms(e.created_at), R)) continue
    if (e.type !== 'content_view' && e.type !== 'order_placed') continue
    bySession.set(e.session_id, [...(bySession.get(e.session_id) ?? []), e])
  }
  const m = new Map<string, { label: string; readers: Set<string>; orders: number; revenue: number }>()
  for (const evs of bySession.values()) {
    const views = evs.filter((e) => e.type === 'content_view' && e.data.content_id)
    const orders = evs.filter((e) => e.type === 'order_placed')
    for (const cid of new Set(views.map((v) => v.data.content_id!))) {
      const firstView = Math.min(...views.filter((v) => v.data.content_id === cid).map((v) => ms(v.created_at)))
      let x = m.get(cid)
      if (!x) m.set(cid, (x = { label: d.contents?.find((ct) => ct.id === cid)?.title ?? 'Conteúdo removido', readers: new Set(), orders: 0, revenue: 0 }))
      x.readers.add(evs[0].session_id)
      const after = orders.filter((o) => ms(o.created_at) >= firstView)
      x.orders += after.length
      x.revenue += sumBy(after, (o) => o.data.value_cents ?? 0)
    }
  }
  const list = [...m.values()].sort((a, b) => b.revenue - a.revenue || b.readers.size - a.readers.size)
  return {
    chart: list.some((x) => x.revenue) ? { kind: 'bar', unit: 'brl', items: list.slice(0, 10).map((x) => ({ label: x.label, value: x.revenue })) } : undefined,
    table: {
      columns: [
        { key: 'label', label: 'Post', unit: 'text' },
        { key: 'readers', label: 'Pessoas que leram', unit: 'int' },
        { key: 'orders', label: 'Pedidos depois de ler', unit: 'int' },
        { key: 'conv', label: 'Conversão', unit: 'pct' },
        { key: 'revenue', label: 'Receita', unit: 'brl' },
      ],
      rows: list.map((x) => ({ label: x.label, readers: x.readers.size, orders: x.orders, conv: ratio(x.orders, x.readers.size), revenue: x.revenue })),
    },
    insight: list.length
      ? list[0].revenue
        ? `"${list[0].label}" foi o post que mais vendeu: ${list[0].orders} ${list[0].orders === 1 ? 'pedido' : 'pedidos'} (${brl(list[0].revenue)}) feitos na mesma visita, depois da leitura.`
        : `${list.reduce((a, x) => a + x.readers.size, 0)} pessoas leram posts, mas nenhuma fez pedido na mesma visita. Coloque links para produtos dentro dos posts.`
      : 'Ninguém leu posts da loja neste período.',
  }
}

// ---------- Relatórios: Financeiro ----------

function recebidoReceber(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const calc = (rng: Range) => {
    const R = rr(rng)
    const m = new Map<string, { paid: number; pending: number; pendingN: number; n: number }>()
    for (const o of c.all) {
      if (!inR(ms(o.created_at), R) || o.status === 'cancelled' || o.status === 'refunded') continue
      const x = m.get(o.payment.method) ?? { paid: 0, pending: 0, pendingN: 0, n: 0 }
      x.n++
      if (o.paid_at) x.paid += o.total_cents
      else {
        x.pending += o.total_cents
        x.pendingN++
      }
      m.set(o.payment.method, x)
    }
    return m
  }
  const cur = calc(r)
  const prv = calc(p)
  const tot = (m: Map<string, { paid: number; pending: number }>, k: 'paid' | 'pending') => sumBy([...m.values()], (x) => x[k])
  const rows: Row[] = [...cur.entries()]
    .sort((a, b) => b[1].paid + b[1].pending - a[1].paid - a[1].pending)
    .map(([k, x]) => ({ label: PAY_LABEL[k as PayMethod] ?? k, n: x.n, paid: x.paid, pending: x.pending, pendingN: x.pendingN }))
  const pending = tot(cur, 'pending')
  return {
    kpis: [
      { label: 'Recebido', value: tot(cur, 'paid'), prev: tot(prv, 'paid'), unit: 'brl' },
      { label: 'A receber', value: pending, prev: tot(prv, 'pending'), unit: 'brl', upIsBad: true },
      { label: 'Pedidos aguardando pagamento', value: sumBy([...cur.values()], (x) => x.pendingN), unit: 'int' },
    ],
    table: {
      columns: [
        { key: 'label', label: 'Forma de pagamento', unit: 'text' },
        { key: 'n', label: 'Pedidos', unit: 'int' },
        { key: 'paid', label: 'Recebido', unit: 'brl' },
        { key: 'pending', label: 'A receber', unit: 'brl' },
        { key: 'pendingN', label: 'Pedidos pendentes', unit: 'int' },
      ],
      rows,
    },
    insight: rows.length
      ? pending
        ? `Dos pedidos feitos no período, ${brl(tot(cur, 'paid'))} já entraram e ${brl(pending)} ainda não foram pagos. Confira os pedidos pendentes e cobre quem esqueceu.`
        : `Todos os ${sumBy(rows, (x) => x.n as number)} pedidos do período já foram pagos (${brl(tot(cur, 'paid'))}).`
      : 'Não houve pedidos neste período.',
  }
}

function taxas(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const os = salesIn(c, r)
  const fee = sumBy(os, (o) => o.platform_fee_cents)
  const sales = sumBy(os, (o) => o.total_cents)
  const prevFee = sumBy(salesIn(c, p), (o) => o.platform_fee_cents)
  const m = new Map<string, { n: number; sales: number; fee: number }>()
  for (const o of os) {
    const x = m.get(o.payment.method) ?? { n: 0, sales: 0, fee: 0 }
    x.n++
    x.sales += o.total_cents
    x.fee += o.platform_fee_cents
    m.set(o.payment.method, x)
  }
  return {
    kpis: [
      { label: 'Taxas da plataforma', value: fee, prev: prevFee, unit: 'brl', upIsBad: true },
      { label: '% das vendas', value: ratio(fee, sales), unit: 'pct' },
    ],
    table: {
      columns: [
        { key: 'label', label: 'Forma de pagamento', unit: 'text' },
        { key: 'n', label: 'Pedidos', unit: 'int' },
        { key: 'sales', label: 'Vendas', unit: 'brl' },
        { key: 'fee', label: 'Taxa da plataforma', unit: 'brl' },
        { key: 'pct', label: '% das vendas', unit: 'pct' },
      ],
      rows: [...m.entries()].map(([k, x]) => ({ label: PAY_LABEL[k as PayMethod] ?? k, n: x.n, sales: x.sales, fee: x.fee, pct: ratio(x.fee, x.sales) })),
    },
    insight: `Você pagou ${brl(fee)} em taxas da plataforma no período (${pctTxt(ratio(fee, sales), 1)} das vendas). A taxa da empresa de pagamento (Mercado Pago, maquininha) não aparece aqui porque o sistema não recebe esse valor; confira no extrato dela.`,
  }
}

export function profitByProduct(d: ReportData, r: Range, f: Filters = {}) {
  const c = makeCtx(d, f)
  const m = new Map<string, { label: string; units: number; revenue: number; cost: number; discount: number; missing: boolean }>()
  for (const o of salesIn(c, r)) {
    const sub = sumBy(o.items, itemRev)
    for (const i of o.items) {
      if (!c.itemOk(i.product_id)) continue
      const x = m.get(i.product_id) ?? { label: productName(c, i.product_id, i.name), units: 0, revenue: 0, cost: 0, discount: 0, missing: false }
      const rev = itemRev(i)
      x.units += i.qty
      x.revenue += rev
      x.discount += sub ? (o.discount_cents * rev) / sub : 0
      if (i.cost_cents == null) x.missing = true
      else x.cost += i.cost_cents * i.qty
      m.set(i.product_id, x)
    }
  }
  return [...m.values()].map((x) => ({ ...x, profit: x.missing ? null : x.revenue - x.cost - x.discount }))
}

function lucroProduto(d: ReportData, r: Range, _p: Range, f: Filters): ReportResult {
  const list = profitByProduct(d, r, f).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity))
  const ok = list.filter((x) => x.profit != null)
  const profit = sumBy(ok, (x) => x.profit!)
  const rev = sumBy(ok, (x) => x.revenue)
  const missing = list.filter((x) => x.missing)
  const worst = [...ok].sort((a, b) => a.profit! / a.revenue - b.profit! / b.revenue)[0]
  return {
    kpis: [
      { label: 'Lucro bruto', value: profit, unit: 'brl', hint: 'Só produtos com custo' },
      { label: 'Margem', value: ratio(profit, rev), unit: 'pct' },
      { label: 'Produtos sem custo', value: missing.length, unit: 'int' },
    ],
    chart: { kind: 'bar', unit: 'brl', items: ok.filter((x) => x.profit! > 0).slice(0, 10).map((x) => ({ label: x.label, value: x.profit! })) },
    table: {
      columns: [
        { key: 'label', label: 'Produto', unit: 'text' },
        { key: 'units', label: 'Unidades', unit: 'int' },
        { key: 'revenue', label: 'Receita', unit: 'brl' },
        { key: 'cost', label: 'Custo', unit: 'brl' },
        { key: 'discount', label: 'Parte dos descontos', unit: 'brl' },
        { key: 'profit', label: 'Lucro', unit: 'brl' },
        { key: 'margin', label: 'Margem', unit: 'pct' },
        { key: 'note', label: 'Observação', unit: 'text' },
      ],
      rows: list.map((x) => ({
        label: x.label,
        units: x.units,
        revenue: x.revenue,
        cost: x.missing ? null : x.cost,
        discount: Math.round(x.discount),
        profit: x.profit == null ? null : Math.round(x.profit),
        margin: x.profit == null ? null : ratio(x.profit, x.revenue),
        note: x.missing ? 'Sem custo cadastrado' : '',
      })),
    },
    insight: !list.length
      ? 'Não houve vendas neste período.'
      : `O lucro bruto dos produtos foi ${brl(Math.round(profit))} (margem de ${pctTxt(ratio(profit, rev))}), já descontando a parte de cada produto nos descontos dos pedidos.${
          worst ? ` A menor margem é de ${worst.label} (${pctTxt(ratio(worst.profit!, worst.revenue))}).` : ''
        }${missing.length ? ` Sem custo cadastrado: ${missing.map((x) => x.label).join(', ')}.` : ''}`,
  }
}

function devolucoes(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const list = (rng: Range) => {
    const R = rr(rng)
    return c.all.filter((o) => inR(ms(o.created_at), R))
  }
  const cur = list(r)
  const prv = list(p)
  const bad = (os: Order[]) => os.filter((o) => o.status === 'cancelled' || o.status === 'refunded')
  const b = bad(cur)
  const reason = (o: Order) => [...o.history].reverse().find((h) => h.status === o.status)?.note || ''
  return {
    kpis: [
      { label: 'Cancelados', value: b.filter((o) => o.status === 'cancelled').length, unit: 'int', upIsBad: true },
      { label: 'Devolvidos', value: b.filter((o) => o.status === 'refunded').length, unit: 'int', upIsBad: true },
      { label: 'Valor', value: sumBy(b, (o) => o.total_cents), unit: 'brl' },
      { label: '% dos pedidos', value: ratio(b.length, cur.length), prev: ratio(bad(prv).length, prv.length), unit: 'pct', upIsBad: true },
    ],
    table: {
      columns: [
        { key: 'number', label: 'Pedido', unit: 'text' },
        { key: 'date', label: 'Data', unit: 'date' },
        { key: 'name', label: 'Cliente', unit: 'text' },
        { key: 'status', label: 'Situação', unit: 'text' },
        { key: 'pay', label: 'Pagamento', unit: 'text' },
        { key: 'value', label: 'Valor', unit: 'brl' },
        { key: 'reason', label: 'Motivo', unit: 'text' },
      ],
      rows: b.map((o) => ({
        number: `#${o.number}`,
        date: o.created_at,
        name: o.customer.name,
        status: o.status === 'cancelled' ? (o.paid_at ? 'Cancelado depois de pago' : 'Cancelado') : 'Devolvido',
        pay: PAY_LABEL[o.payment.method],
        value: o.total_cents,
        reason: reason(o),
      })),
    },
    insight: b.length
      ? `${b.length} de ${cur.length} pedidos (${pctTxt(ratio(b.length, cur.length), 1)}) foram cancelados ou devolvidos, somando ${brl(sumBy(b, (o) => o.total_cents))}.${
          (() => {
            const reasons = b.map(reason).filter(Boolean)
            if (!reasons.length) return ''
            const top = Object.entries(reasons.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {})).sort((x, y) => y[1] - x[1])[0]
            return ` Motivo mais comum: "${top[0]}".`
          })()
        }`
      : 'Nenhum pedido foi cancelado ou devolvido neste período.',
  }
}

function fechamento(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const calc = (rng: Range) => {
    const R = rr(rng)
    const paid = c.all.filter((o) => o.paid_at && inR(ms(o.paid_at), R))
    const sales = paid.filter(isSale)
    const gross = sumBy(paid, (o) => o.subtotal_cents)
    const discount = sumBy(paid, (o) => o.discount_cents)
    const shipping = sumBy(paid, (o) => o.shipping_cents)
    const returns = sumBy(paid.filter(isReversed), (o) => o.total_cents)
    const net = gross - discount + shipping - returns
    const fee = sumBy(sales, (o) => o.platform_fee_cents)
    const items = sales.flatMap((o) => o.items)
    const cost = sumBy(items, (i) => (i.cost_cents ?? 0) * i.qty)
    const missingCost = items.some((i) => i.cost_cents == null)
    const byPay = new Map<string, number>()
    for (const o of sales) byPay.set(o.payment.method, (byPay.get(o.payment.method) ?? 0) + o.total_cents)
    return { gross, discount, shipping, returns, net, fee, cost, missingCost, orders: sales.length, ticket: ratio(net, sales.length), byPay }
  }
  const a = calc(r)
  const b = calc(p)
  const row = (label: string, cur: number, prev: number, unit: Unit = 'brl'): Row => ({ label, cur, prev, _unit: unit })
  const rows: Row[] = [
    row('Vendas brutas (produtos)', a.gross, b.gross),
    row('(−) Descontos', a.discount, b.discount),
    row('(+) Frete cobrado', a.shipping, b.shipping),
    row('(−) Devoluções e cancelamentos', a.returns, b.returns),
    row('(=) Vendas líquidas', a.net, b.net),
    row('(−) Taxas da plataforma', a.fee, b.fee),
    row('(=) Líquido após taxas', a.net - a.fee, b.net - b.fee),
    row('Custo dos produtos vendidos' + (a.missingCost ? ' (incompleto)' : ''), a.cost, b.cost),
    row('Lucro bruto estimado', a.net - a.fee - a.cost - a.shipping, b.net - b.fee - b.cost - b.shipping),
    row('Pedidos pagos', a.orders, b.orders, 'int'),
    row('Ticket médio', a.ticket, b.ticket),
    ...[...new Set([...a.byPay.keys(), ...b.byPay.keys()])].map((k) => row(`Recebido em ${PAY_LABEL[k as PayMethod] ?? k}`, a.byPay.get(k) ?? 0, b.byPay.get(k) ?? 0)),
  ]
  return {
    kpis: [
      { label: 'Vendas líquidas', value: a.net, prev: b.net, unit: 'brl' },
      { label: 'Líquido após taxas', value: a.net - a.fee, prev: b.net - b.fee, unit: 'brl' },
      { label: 'Pedidos pagos', value: a.orders, prev: b.orders, unit: 'int' },
    ],
    table: {
      columns: [
        { key: 'label', label: 'Item', unit: 'text' },
        { key: 'cur', label: 'Este período', unit: 'brl' },
        { key: 'prev', label: 'Período anterior', unit: 'brl' },
      ],
      rows,
    },
    insight: `No período, as vendas líquidas foram ${brl(a.net)} em ${a.orders} ${a.orders === 1 ? 'pedido pago' : 'pedidos pagos'}; descontadas as taxas da plataforma, ficam ${brl(a.net - a.fee)}. O lucro bruto estimado não inclui frete nem a taxa da empresa de pagamento${a.missingCost ? ', e alguns produtos estão sem custo' : ''}. Baixe a planilha para o contador.`,
  }
}

// ---------- Relatórios: Operação ----------

function prepHours(o: Order): number | null {
  const paid = o.history.find((h) => h.status === 'paid')?.at ?? o.paid_at
  const done = o.history.find((h) => h.status === 'shipped' || h.status === 'ready')?.at ?? o.history.find((h) => h.status === 'delivered')?.at
  if (!paid || !done) return null
  return Math.max(0, (ms(done) - ms(paid)) / HOUR)
}

function tempoPreparo(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const hrs = (rng: Range) => salesIn(c, rng).map(prepHours).filter((x): x is number => x != null).sort((a, b) => a - b)
  const cur = hrs(r)
  const prv = hrs(p)
  const avg = (xs: number[]) => (xs.length ? sumBy(xs, (x) => x) / xs.length : 0)
  const med = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)] : 0)
  const limit = Math.max(1, d.store.settings.prep_days) * 24
  const bins: [string, number, number][] = [
    ['Até 12 horas', 0, 12],
    ['12 a 24 horas', 12, 24],
    ['1 a 2 dias', 24, 48],
    ['2 a 3 dias', 48, 72],
    ['Mais de 3 dias', 72, Infinity],
  ]
  const rows: Row[] = bins.map(([label, a, b]) => {
    const n = cur.filter((x) => x >= a && x < b).length
    return { label, n, share: ratio(n, cur.length) }
  })
  const onTime = ratio(cur.filter((x) => x <= limit).length, cur.length)
  return {
    kpis: [
      { label: 'Tempo médio', value: avg(cur), prev: avg(prv), unit: 'hours', upIsBad: true },
      { label: 'Metade sai em até', value: med(cur), unit: 'hours' },
      { label: 'Dentro do prazo', value: onTime, prev: ratio(prv.filter((x) => x <= limit).length, prv.length), unit: 'pct', hint: `Prazo: ${dias(d.store.settings.prep_days)}` },
    ],
    chart: { kind: 'bar', unit: 'int', items: rows.map((x) => ({ label: x.label as string, value: x.n as number })) },
    table: {
      columns: [
        { key: 'label', label: 'Tempo entre pagamento e envio/retirada', unit: 'text' },
        { key: 'n', label: 'Pedidos', unit: 'int' },
        { key: 'share', label: '% dos pedidos', unit: 'pct' },
      ],
      rows,
    },
    insight: cur.length
      ? `Os pedidos levam em média ${fmtValue(avg(cur), 'hours')} entre o pagamento e ficar pronto ou sair para entrega; ${pctTxt(onTime)} ficaram dentro do prazo de ${dias(d.store.settings.prep_days)} que a loja informa.`
      : 'Nenhum pedido pago neste período chegou a ser enviado ou ficar pronto.',
  }
}

/** Pedidos pagos ou em preparo há mais de prep_days + 1 dias. Situação atual, não depende do período. */
export function lateOrders(d: ReportData, now = d.now ?? new Date()) {
  const limit = (d.store.settings.prep_days + 1) * DAY
  return d.orders
    .filter((o) => (o.status === 'paid' || o.status === 'preparing') && o.paid_at && now.getTime() - ms(o.paid_at) > limit)
    .sort((a, b) => ms(a.paid_at!) - ms(b.paid_at!))
}

function atrasados(d: ReportData, _r: Range, _p: Range, _f: Filters): ReportResult {
  const now = (d.now ?? new Date()).getTime()
  const list = lateOrders(d)
  return {
    kpis: [{ label: 'Pedidos atrasados', value: list.length, unit: 'int', upIsBad: true }],
    table: {
      columns: [
        { key: 'number', label: 'Pedido', unit: 'text' },
        { key: 'name', label: 'Cliente', unit: 'text' },
        { key: 'status', label: 'Situação', unit: 'text' },
        { key: 'paid', label: 'Pago em', unit: 'date' },
        { key: 'days', label: 'Dias desde o pagamento', unit: 'int' },
        { key: 'value', label: 'Valor', unit: 'brl' },
        { key: 'wa', label: 'WhatsApp', unit: 'wa' },
      ],
      rows: list.map((o) => ({
        number: `#${o.number}`,
        name: o.customer.name,
        status: o.status === 'paid' ? 'Pago, não iniciado' : 'Em preparo',
        paid: o.paid_at,
        days: Math.floor((now - ms(o.paid_at!)) / DAY),
        value: o.total_cents,
        wa: wa(o.customer.phone, waMsg(d.store, o.customer.name, `Seu pedido #${o.number} está atrasado e queremos te dar uma previsão.`)),
      })),
    },
    insight: list.length
      ? `${list.length} ${list.length === 1 ? 'pedido passou' : 'pedidos passaram'} do prazo de preparo (${dias(d.store.settings.prep_days)} + 1 de tolerância). Avise esses clientes antes que eles perguntem.`
      : 'Nenhum pedido está atrasado agora.',
  }
}

function cancelamento(d: ReportData, r: Range, p: Range, f: Filters): ReportResult {
  const c = makeCtx(d, f)
  const calc = (rng: Range) => {
    const R = rr(rng)
    const os = c.all.filter((o) => inR(ms(o.created_at), R))
    const m = new Map<string, { n: number; bad: number }>()
    for (const o of os) {
      const x = m.get(o.payment.method) ?? { n: 0, bad: 0 }
      x.n++
      if (o.status === 'cancelled' || o.status === 'refunded') x.bad++
      m.set(o.payment.method, x)
    }
    const bad = os.filter((o) => o.status === 'cancelled' || o.status === 'refunded').length
    return { n: os.length, bad, rate: ratio(bad, os.length), m }
  }
  const a = calc(r)
  const b = calc(p)
  const rows: Row[] = [...a.m.entries()].sort((x, y) => y[1].n - x[1].n).map(([k, x]) => ({ label: PAY_LABEL[k as PayMethod] ?? k, n: x.n, bad: x.bad, rate: ratio(x.bad, x.n) }))
  const worst = [...rows].filter((x) => (x.n as number) >= 5).sort((x, y) => (y.rate as number) - (x.rate as number))[0]
  return {
    kpis: [
      { label: 'Taxa de cancelamento', value: a.rate, prev: b.rate, unit: 'pct', upIsBad: true },
      { label: 'Pedidos cancelados ou devolvidos', value: a.bad, prev: b.bad, unit: 'int', upIsBad: true },
      { label: 'Pedidos feitos', value: a.n, prev: b.n, unit: 'int' },
    ],
    chart: { kind: 'bar', unit: 'pct', items: rows.map((x) => ({ label: x.label as string, value: x.rate as number })) },
    table: {
      columns: [
        { key: 'label', label: 'Forma de pagamento', unit: 'text' },
        { key: 'n', label: 'Pedidos', unit: 'int' },
        { key: 'bad', label: 'Cancelados ou devolvidos', unit: 'int' },
        { key: 'rate', label: 'Taxa', unit: 'pct' },
      ],
      rows,
    },
    insight: a.n
      ? `${pctTxt(a.rate, 1)} dos pedidos foram cancelados ou devolvidos (${Math.abs(a.rate - b.rate) < 0.005 ? 'igual ao período anterior' : `${a.rate > b.rate ? 'subiu' : 'caiu'} de ${pctTxt(b.rate, 1)} no período anterior`}).${
          worst && (worst.rate as number) > a.rate * 1.5 ? ` ${worst.label} cancela mais que as outras formas (${pctTxt(worst.rate as number, 1)}).` : ''
        }`
      : 'Não houve pedidos neste período.',
  }
}

// ---------- Registro ----------

export const REPORTS: ReportDef[] = [
  // Vendas
  { id: 'vendas-no-tempo', group: 'vendas', title: 'Vendas no tempo', decision: 'Saber se a loja está crescendo e o que puxou a mudança: mais pedidos ou pedidos maiores.', filters: ['granularity', 'product', 'category', 'payment', 'source', 'city'], compute: vendasTempo },
  { id: 'vendas-por-produto', group: 'vendas', title: 'Vendas por produto e variação', decision: 'Decidir o que produzir mais, o que destacar e o que tirar da loja.', filters: ['category', 'payment', 'source', 'city'], compute: vendasProduto },
  { id: 'vendas-por-categoria', group: 'vendas', title: 'Vendas por categoria', decision: 'Ver quais linhas de produto sustentam a loja e onde investir.', filters: ['payment', 'source', 'city'], compute: vendasCategoria },
  { id: 'vendas-por-pagamento', group: 'vendas', title: 'Vendas por forma de pagamento', decision: 'Decidir quais formas de pagamento oferecer e se vale dar desconto no Pix.', filters: ['product', 'category', 'source', 'city'], compute: simpleBreakdown('Forma de pagamento', (o) => [o.payment.method, PAY_LABEL[o.payment.method] ?? o.payment.method]) },
  { id: 'vendas-por-entrega', group: 'vendas', title: 'Vendas por forma de entrega', decision: 'Decidir onde entregar, quanto cobrar de frete e se vale incentivar a retirada.', filters: ['product', 'category', 'payment', 'source', 'city'], compute: simpleBreakdown('Forma de entrega', (o) => [o.shipping.method, SHIP_LABEL[o.shipping.method] ?? o.shipping.label]) },
  { id: 'vendas-por-dia-e-hora', group: 'vendas', title: 'Vendas por dia da semana e hora', decision: 'Escolher quando postar, abrir promoções e reforçar o atendimento.', filters: ['product', 'category', 'payment', 'source'], compute: vendasDiaHora },
  { id: 'vendas-por-cidade', group: 'vendas', title: 'Vendas por cidade e bairro', decision: 'Decidir onde entregar, ajustar o frete por bairro e onde anunciar.', filters: ['product', 'category', 'payment', 'source'], compute: vendasCidade },
  { id: 'vendas-por-cupom', group: 'vendas', title: 'Vendas por cupom', decision: 'Saber se os cupons trazem vendas que valem o desconto.', filters: ['source'], compute: vendasCupom },
  // Clientes
  { id: 'clientes-novos-e-recorrentes', group: 'clientes', title: 'Clientes novos e recorrentes', decision: 'Equilibrar o esforço entre atrair gente nova e fazer quem já comprou voltar.', filters: [], compute: clientesNovos },
  { id: 'taxa-de-recompra', group: 'clientes', title: 'Taxa de recompra', decision: 'Saber se os clientes voltam e quando vale chamar para a próxima compra.', filters: [], compute: taxaRecompra },
  { id: 'melhores-clientes', group: 'clientes', title: 'Melhores clientes', decision: 'Saber a quem agradecer, dar atenção especial e pedir indicação.', filters: [], compute: melhoresClientes },
  { id: 'grupos-de-clientes', group: 'clientes', title: 'Grupos por comportamento', decision: 'Mandar a mensagem certa para cada grupo: campeões, fiéis, novos, em risco e perdidos.', filters: [], compute: rfm },
  { id: 'clientes-sumidos', group: 'clientes', title: 'Clientes sumidos', decision: 'Chamar de volta quem parou de comprar há 30, 60 ou 90 dias.', filters: [], compute: clientesSumidos },
  { id: 'valor-do-cliente', group: 'clientes', title: 'Valor do cliente', decision: 'Saber quanto vale gastar (anúncio, brinde, desconto) para conquistar um cliente.', filters: [], compute: valorCliente },
  // Produtos e estoque
  { id: 'curva-abc', group: 'produtos', title: 'Curva ABC', decision: 'Separar os poucos produtos que fazem a maior parte da receita e nunca deixar faltar.', filters: ['category', 'payment', 'source'], compute: curvaAbc },
  { id: 'produtos-parados', group: 'produtos', title: 'Produtos parados', decision: 'Decidir o que promover, refazer as fotos ou tirar da loja.', filters: ['category'], compute: produtosParados },
  { id: 'vistos-pouco-comprados', group: 'produtos', title: 'Muito vistos e pouco comprados', decision: 'Achar produtos que atraem mas não convencem: revisar preço, fotos e descrição.', filters: ['category'], compute: vistosPoucoComprados },
  { id: 'estoque-baixo', group: 'produtos', title: 'Estoque baixo', decision: 'Saber o que repor e quando, antes de acabar.', filters: ['category'], usesPeriod: false, compute: estoqueBaixo },
  { id: 'giro-de-estoque', group: 'produtos', title: 'Giro de estoque', decision: 'Comprar mais do que gira rápido e menos do que fica parado.', filters: ['category'], compute: giroEstoque },
  { id: 'valor-em-estoque', group: 'produtos', title: 'Valor em estoque', decision: 'Saber quanto dinheiro está parado em mercadoria (posição atual).', filters: ['category'], usesPeriod: false, compute: valorEstoque },
  // Funil e comportamento
  { id: 'funil-de-compra', group: 'funil', title: 'Funil de compra', decision: 'Descobrir em que etapa as pessoas desistem e o que melhorar primeiro.', filters: ['source'], compute: funil },
  { id: 'carrinhos-abandonados', group: 'funil', title: 'Carrinhos abandonados', decision: 'Recuperar vendas chamando quem quase comprou.', filters: [], compute: carrinhosAbandonados },
  { id: 'buscas-na-loja', group: 'funil', title: 'Buscas na loja', decision: 'Descobrir o que as pessoas procuram e você não tem (ou não encontram).', filters: [], compute: buscas },
  { id: 'mais-vistos', group: 'funil', title: 'Páginas e produtos mais vistos', decision: 'Saber o que mais chama atenção para destacar e manter sempre disponível.', filters: ['source'], compute: maisVistos },
  { id: 'celular-e-computador', group: 'funil', title: 'Celular e computador', decision: 'Saber se a loja vende bem no celular, onde está a maioria das visitas.', filters: ['source'], compute: dispositivo },
  // Origem
  { id: 'vendas-por-origem', group: 'origem', title: 'Visitas e vendas por origem', decision: 'Decidir onde investir tempo e dinheiro: Instagram, WhatsApp, Google…', filters: ['product', 'category', 'payment', 'city'], compute: origem },
  { id: 'vendas-por-campanha', group: 'origem', title: 'Por link de campanha', decision: 'Saber qual campanha, anúncio ou parceria trouxe vendas de verdade.', filters: ['product', 'category'], compute: campanha },
  { id: 'vendas-por-post', group: 'origem', title: 'Por post', decision: 'Saber quais posts do blog levam a pedidos, para escrever mais sobre isso.', filters: [], compute: posts },
  // Financeiro
  { id: 'recebido-e-a-receber', group: 'financeiro', title: 'Recebido e a receber', decision: 'Saber quanto já entrou no caixa e quanto ainda falta cobrar.', filters: ['payment', 'source'], compute: recebidoReceber },
  { id: 'taxas-pagas', group: 'financeiro', title: 'Taxas pagas', decision: 'Saber quanto as taxas levam das vendas e escolher o plano e as formas de pagamento.', filters: ['payment'], compute: taxas },
  { id: 'lucro-por-produto', group: 'financeiro', title: 'Lucro por produto', decision: 'Ajustar preços e saber quais produtos dão lucro de verdade.', filters: ['category', 'payment', 'source'], compute: lucroProduto },
  { id: 'devolucoes-e-cancelamentos', group: 'financeiro', title: 'Devoluções e cancelamentos', decision: 'Entender por que pedidos se perdem e quanto isso custa.', filters: ['payment', 'source'], compute: devolucoes },
  { id: 'fechamento-do-mes', group: 'financeiro', title: 'Fechamento do mês', decision: 'Resumo para o contador e para fechar as contas do mês.', filters: [], compute: fechamento },
  // Operação
  { id: 'tempo-de-preparo', group: 'operacao', title: 'Tempo de preparo', decision: 'Saber se o prazo prometido está sendo cumprido e se precisa de ajuda na produção.', filters: ['product', 'category'], compute: tempoPreparo },
  { id: 'pedidos-atrasados', group: 'operacao', title: 'Pedidos atrasados', decision: 'Agir agora nos pedidos que passaram do prazo (situação atual).', filters: [], usesPeriod: false, compute: atrasados },
  { id: 'taxa-de-cancelamento', group: 'operacao', title: 'Taxa de cancelamento', decision: 'Acompanhar se os cancelamentos estão subindo e em qual forma de pagamento.', filters: ['source'], compute: cancelamento },
]

export const reportById = (id: string) => REPORTS.find((r) => r.id === id)

// ---------- Painel inicial ----------

export interface HomeData {
  windows: { label: string; value: number; prev: number }[]
  cur: { revenue: number; orders: number; ticket: number }
  prev: { revenue: number; orders: number; ticket: number }
  visitors: number
  prevVisitors: number
  conversion: number
  prevConversion: number
  chart: Extract<ChartSpec, { kind: 'line' }>
  top: { label: string; units: number; revenue: number }[]
  sources: Point[]
  late: Order[]
  lowStock: { label: string; stock: number }[]
  carts: { name: string; phone: string; value: number; items: string; at: string; wa: string | null }[]
  month: { revenue: number; goal: number; projection: number; daysLeft: number }
  insight: string
}

export function computeHome(d: ReportData, r: Range, p: Range, now = d.now ?? new Date()): HomeData {
  const c = makeCtx(d, {})
  const windows = (['hoje', '7d', '30d'] as const).map((id) => {
    const w = periodRange(id, now)
    return { label: id === 'hoje' ? 'Hoje' : id === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias', value: salesTotals(d, w.range).revenue, prev: salesTotals(d, w.prev).revenue }
  })
  const cur = salesTotals(d, r)
  const prev = salesTotals(d, p)
  const f0 = funnelCounts(d.events, r)
  const f1 = funnelCounts(d.events, p)
  const s = series(c.sales, (x) => x.t, (x) => x.o.total_cents, r, p, autoGranularity(r))
  const top = abcCurve(d, r)
    .slice(0, 5)
    .map((x) => ({ label: x.label, units: x.units, revenue: x.revenue }))
  const src = new Map<string, Set<string>>()
  const R = rr(r)
  for (const e of d.events) {
    if (e.type !== 'visit' || !inR(ms(e.created_at), R)) continue
    const k = e.data.source || 'direto'
    if (!src.has(k)) src.set(k, new Set())
    src.get(k)!.add(e.session_id)
  }
  const sources = [...src.entries()].map(([k, v]) => ({ label: sourceLabel(k), value: v.size })).sort((a, b) => b.value - a.value)
  const lowStock: HomeData['lowStock'] = []
  for (const pr of d.products) {
    if (!pr.track_stock || pr.blocked) continue
    const vs = d.variants.filter((v) => v.product_id === pr.id)
    if (vs.length) for (const v of vs) v.stock <= 3 && lowStock.push({ label: `${pr.name} (${Object.values(v.values).join(' / ')})`, stock: v.stock })
    else if (pr.stock <= 3) lowStock.push({ label: pr.name, stock: pr.stock })
  }
  lowStock.sort((a, b) => a.stock - b.stock)
  // Carrinhos abandonados de valor alto: últimos 7 dias, acima do ticket médio de 30 dias, sem pedido nem contato
  const t30 = salesTotals(d, periodRange('30d', now).range).ticket
  const since = now.getTime() - 7 * DAY
  const placed = new Set(d.events.filter((e) => e.type === 'order_placed' && ms(e.created_at) >= since).map((e) => e.session_id))
  const carts = d.checkouts
    .filter((x) => !x.order_id && !x.contacted_at && !placed.has(x.session_id) && ms(x.created_at) >= since && x.total_cents >= t30)
    .sort((a, b) => b.total_cents - a.total_cents)
    .slice(0, 5)
    .map((x) => ({
      name: x.customer.name || 'Sem nome',
      phone: x.customer.phone,
      value: x.total_cents,
      items: x.items.map((i) => `${i.qty}× ${i.name}`).join(', '),
      at: x.created_at,
      wa: wa(x.customer.phone, waMsg(d.store, x.customer.name, `Vi que você separou ${x.items.map((i) => i.name).join(', ')} e não finalizou. Posso ajudar?`)),
    }))
  const m = periodRange('mes', now)
  const monthRev = salesTotals(d, m.range).revenue
  const today = dayKey(now.getTime())
  const [y, mo] = today.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const elapsed = (now.getTime() - ms(m.range.from)) / DAY
  return {
    windows,
    cur,
    prev,
    visitors: f0[0],
    prevVisitors: f1[0],
    conversion: ratio(f0[4], f0[0]),
    prevConversion: ratio(f1[4], f1[0]),
    chart: { kind: 'line', unit: 'brl', name: 'Este período', prevName: 'Período anterior', points: s.points, prev: s.prev },
    top,
    sources,
    late: lateOrders(d, now),
    lowStock,
    carts,
    month: { revenue: monthRev, goal: d.store.settings.goal_cents, projection: elapsed > 0 ? Math.round((monthRev / elapsed) * daysInMonth) : 0, daysLeft: Math.max(0, Math.ceil(daysInMonth - elapsed)) },
    insight: salesInsight(cur, prev),
  }
}

/** Opções dos filtros, tiradas dos próprios dados. */
export function filterOptions(d: ReportData) {
  const pays = [...new Set(d.orders.map((o) => o.payment.method))]
  const srcs = [...new Set([...d.orders.map(orderSource), ...d.events.filter((e) => e.type === 'visit').map((e) => e.data.source || 'direto')])]
  const cities = [...new Set(d.orders.filter(isSale).map(orderCity))]
  return {
    product: d.products.filter((p) => !p.blocked).map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label)),
    category: d.categories.map((c) => ({ value: c.id, label: c.name })),
    payment: pays.map((p) => ({ value: p, label: PAY_LABEL[p] ?? p })),
    source: srcs.map((s) => ({ value: s, label: sourceLabel(s) })).sort((a, b) => a.label.localeCompare(b.label)),
    city: cities.map((c) => ({ value: c, label: c })).sort((a, b) => a.label.localeCompare(b.label)),
  }
}
