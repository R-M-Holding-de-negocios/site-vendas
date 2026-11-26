// Relatórios do lojista: painel inicial, lista de relatórios por grupo e tela de cada relatório.
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../../lib/api'
import { downloadFile, toCsv } from '../../lib/csv'
import { can } from '../../lib/plans'
import type { Store } from '../../lib/types'
import { brl, fmtDate, formatPhone } from '../../lib/util'
import { BarChart, Funnel, Heatmap, LineChart, Pareto } from '../../ui/charts'
import { Badge, Empty, ErrorBox, Field, Loading, MoneyInput, PageHead, Stat, Upsell, toast, useAsync } from '../../ui/kit'
import {
  GROUPS,
  PERIODS,
  change,
  computeHome,
  dayKey,
  filterOptions,
  fmtValue,
  periodRange,
  rangeLabel,
  reportById,
  REPORTS,
  tableToCsvRows,
  DAY,
  type ChartSpec,
  type FilterKey,
  type Filters,
  type Granularity,
  type Kpi,
  type PeriodId,
  type Range,
  type ReportData,
  type ReportDef,
  type ReportResult,
  type Unit,
} from './compute'
import './reports.css'

const BASE = '/painel/relatorios'

// ---------- Período (fica na URL para valer entre a lista e os relatórios) ----------

function usePeriod() {
  const [params, setParams] = useSearchParams()
  const id = (PERIODS.some((p) => p.id === params.get('p')) ? params.get('p') : '30d') as PeriodId
  const custom = { from: params.get('de') ?? '', to: params.get('ate') ?? '' }
  // "Agora" muda a cada render; arredondar para o minuto evita recalcular tudo sem necessidade.
  const nowMin = Math.floor(Date.now() / 60000)
  const value = useMemo(() => periodRange(id, new Date(nowMin * 60000), custom), [id, custom.from, custom.to, nowMin]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: PeriodId, c?: { from: string; to: string }) => {
    const p = new URLSearchParams(params)
    p.set('p', next)
    if (next === 'livre') {
      const today = dayKey(Date.now())
      p.set('de', c?.from || custom.from || dayKey(Date.now() - 29 * DAY))
      p.set('ate', c?.to || custom.to || today)
    } else {
      p.delete('de')
      p.delete('ate')
    }
    setParams(p, { replace: true })
  }
  return { id, custom, ...value, set, search: params.toString() ? `?${params.toString()}` : '' }
}
type Period = ReturnType<typeof usePeriod>

function PeriodBar({ period }: { period: Period }) {
  return (
    <div className="rp-period no-print">
      <div className="chips" role="group" aria-label="Período">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" className={`chip ${period.id === p.id ? 'on' : ''}`} aria-pressed={period.id === p.id} onClick={() => period.set(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {period.id === 'livre' && (
        <div className="row rp-dates">
          <Field label="De">
            <input type="date" value={period.custom.from} max={period.custom.to || undefined} onChange={(e) => e.target.value && period.set('livre', { from: e.target.value, to: period.custom.to })} />
          </Field>
          <Field label="Até">
            <input type="date" value={period.custom.to} min={period.custom.from || undefined} onChange={(e) => e.target.value && period.set('livre', { from: period.custom.from, to: e.target.value })} />
          </Field>
        </div>
      )}
      <p className="muted small">
        {rangeLabel(period.range)}, comparado com {rangeLabel(period.prev)}
      </p>
    </div>
  )
}

// ---------- Dados ----------

async function loadData(store: Store, eventsFrom: string): Promise<ReportData> {
  const eq = { store_id: store.id }
  const [orders, events, products, variants, customers, checkouts, categories, contents] = await Promise.all([
    db.list('orders', { eq }),
    db.list('events', { eq, gte: ['created_at', eventsFrom] }),
    db.list('products', { eq }),
    db.list('variants', { eq }),
    db.list('customers', { eq }),
    db.list('checkouts', { eq }),
    db.list('categories', { eq, order: ['position', 'asc'] }),
    db.list('contents', { eq }),
  ])
  return { store, orders, events, products, variants, customers, checkouts, categories, contents }
}

/** Carrega uma vez por período. Pedidos vêm completos (clientes e recompra olham o histórico); eventos, só o necessário. */
function useReportData(store: Store, period: Period) {
  // Pelo menos 60 dias de eventos para o painel inicial (30 dias + 30 anteriores).
  const from = dayKey(Math.min(Date.parse(period.prev.from), Date.now() - 61 * DAY))
  const res = useAsync(() => loadData(store, new Date(Date.parse(from + 'T00:00:00Z')).toISOString()), [store.id, from])
  const data = useMemo(() => (res.data ? { ...res.data, store } : undefined), [res.data, store])
  return { ...res, data }
}

// ---------- Favoritos (só neste navegador) ----------

const FAV_KEY = 'vt_report_favorites'
function useFavorites() {
  const [favs, setFavs] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const toggle = (id: string) => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]
    setFavs(next)
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next))
    } catch {
      // Sem armazenamento: o favorito vale até fechar a página.
    }
  }
  return { favs, toggle }
}

function FavButton({ on, onClick, title }: { on: boolean; onClick: () => void; title: string }) {
  return (
    <button type="button" className={`rp-fav no-print ${on ? 'on' : ''}`} aria-pressed={on} aria-label={on ? `Tirar "${title}" dos favoritos` : `Fixar "${title}" nos favoritos`} title={on ? 'Tirar dos favoritos' : 'Fixar nos favoritos'} onClick={onClick}>
      {on ? '★' : '☆'}
    </button>
  )
}

// ---------- Peças de exibição ----------

const brlAxis = (cents: number) => {
  const r = cents / 100
  if (r >= 1_000_000) return `R$ ${(r / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (r >= 1000) return `R$ ${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return `R$ ${Math.round(r)}`
}
const formatter = (unit: Unit) => (n: number) => fmtValue(n, unit)
const axisFormatter = (unit: Unit) => (unit === 'brl' ? brlAxis : formatter(unit))

export function ChartView({ spec, title }: { spec: ChartSpec; title: string }) {
  switch (spec.kind) {
    case 'line':
      return spec.points.length ? (
        <LineChart points={spec.points} prev={spec.prev} name={spec.name} prevName={spec.prevName} format={formatter(spec.unit)} formatAxis={axisFormatter(spec.unit)} label={title} />
      ) : null
    case 'bar':
      return spec.items.length ? <BarChart items={spec.items} format={formatter(spec.unit)} label={title} /> : null
    case 'heatmap':
      return <Heatmap values={spec.values} format={(n) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`} label={title} />
    case 'funnel':
      return <Funnel steps={spec.steps} format={formatter('int')} label={title} />
    case 'pareto':
      return spec.items.length ? <Pareto items={spec.items} format={formatter('brl')} label={title} /> : null
  }
}

function KpiStat({ k }: { k: Kpi }) {
  const hasPrev = k.prev != null
  const delta = hasPrev && !k.upIsBad && k.prev ? change(k.value, k.prev!) : null
  const prevHint = hasPrev && (k.upIsBad || !k.prev) ? `Antes: ${fmtValue(k.prev!, k.unit)}` : ''
  return <Stat label={k.label} value={fmtValue(k.value, k.unit)} delta={delta} hint={[k.hint, prevHint].filter(Boolean).join(' · ') || undefined} />
}

const isNumeric = (u: Unit) => u !== 'text' && u !== 'date' && u !== 'wa'

export function ReportTable({ table, caption }: { table: ReportResult['table']; caption: string }) {
  const [all, setAll] = useState(false)
  const LIMIT = 100
  const rows = all ? table.rows : table.rows.slice(0, LIMIT)
  if (!table.rows.length) return <Empty title="Nada para mostrar neste período" text="Tente um período maior ou tire os filtros." />
  return (
    <>
      <div className="table-wrap rp-table">
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={isNumeric(c.unit) ? 'num' : ''}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.label === 'Total' ? 'rp-total' : ''}>
                {table.columns.map((c) => {
                  const unit = c.unit !== 'text' && typeof r._unit === 'string' ? (r._unit as Unit) : c.unit
                  const v = r[c.key]
                  if (c.unit === 'wa')
                    return (
                      <td key={c.key}>
                        {typeof v === 'string' && v ? (
                          <a className="btn wa small no-print" href={v} target="_blank" rel="noreferrer">
                            Chamar
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    )
                  return (
                    <td key={c.key} className={isNumeric(unit) ? 'num nowrap' : ''}>
                      {fmtValue(v ?? null, unit)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length > LIMIT && !all && (
        <button type="button" className="btn ghost small no-print" onClick={() => setAll(true)}>
          Mostrar todas as {table.rows.length} linhas
        </button>
      )}
    </>
  )
}

// ---------- Painel inicial ----------

function GoalCard({ store, revenue, projection, daysLeft }: { store: Store; revenue: number; projection: number; daysLeft: number }) {
  const [goal, setGoal] = useState(store.settings.goal_cents)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number | null>(goal || null)
  const [busy, setBusy] = useState(false)
  async function save() {
    const goal_cents = Math.max(0, draft ?? 0)
    setBusy(true)
    try {
      await db.update('stores', store.id, { settings: { ...store.settings, goal_cents } })
      store.settings.goal_cents = goal_cents
      setGoal(goal_cents)
      setEditing(false)
      toast('Meta salva')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const p = goal ? Math.min(1, revenue / goal) : 0
  const missing = Math.max(0, goal - revenue)
  return (
    <section className="card rp-goal" aria-labelledby="rp-goal-t">
      <div className="card-head">
        <h2 id="rp-goal-t">Meta do mês</h2>
        {!editing && (
          <button type="button" className="link no-print" onClick={() => (setDraft(goal || null), setEditing(true))}>
            {goal ? 'Mudar meta' : 'Definir meta'}
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="row rp-goal-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Field label="Quanto quer vender este mês?" className="grow">
            <MoneyInput value={draft} onChange={setDraft} />
          </Field>
          <button className="btn" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </form>
      ) : goal ? (
        <div className="stack tight">
          <div className="row between">
            <b className="rp-goal-value">{brl(revenue)}</b>
            <span className="muted">de {brl(goal)}</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label="Meta do mês">
            <span style={{ width: `${p * 100}%` }} />
          </div>
          <p className="small muted">
            {missing
              ? `Faltam ${brl(missing)} em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}. No ritmo atual, o mês fecha em ${brl(projection)}${projection >= goal ? ' — dá para bater a meta.' : '.'}`
              : 'Meta batida! 🎉'}
          </p>
        </div>
      ) : (
        <p className="muted">Defina quanto quer vender no mês para acompanhar o progresso aqui.</p>
      )}
    </section>
  )
}

function Dashboard({ store, data, period, full }: { store: Store; data: ReportData; period: Period; full: boolean }) {
  const h = useMemo(() => computeHome(data, period.range, period.prev), [data, period.range, period.prev])
  const pLabel = PERIODS.find((p) => p.id === period.id)!.label.toLowerCase()
  return (
    <div className="stack">
      <section aria-labelledby="rp-sales-t" className="stack tight">
        <h2 id="rp-sales-t" className="rp-h2">
          Vendas
        </h2>
        <div className="stats">
          {h.windows.map((w) => (
            <Stat key={w.label} label={w.label} value={brl(w.value)} delta={w.prev ? change(w.value, w.prev) : null} hint={w.prev ? undefined : 'Sem vendas no período anterior'} />
          ))}
        </div>
      </section>
      <section aria-labelledby="rp-period-t" className="stack tight">
        <h2 id="rp-period-t" className="rp-h2">
          No período ({pLabel})
        </h2>
        <div className="stats">
          <Stat label="Pedidos pagos" value={h.cur.orders.toLocaleString('pt-BR')} delta={h.prev.orders ? change(h.cur.orders, h.prev.orders) : null} />
          <Stat label="Ticket médio" value={brl(Math.round(h.cur.ticket))} delta={h.prev.ticket ? change(h.cur.ticket, h.prev.ticket) : null} />
          {full && (
            <>
              <Stat label="Visitantes" value={h.visitors.toLocaleString('pt-BR')} delta={h.prevVisitors ? change(h.visitors, h.prevVisitors) : null} />
              <Stat label="Conversão" value={fmtValue(h.conversion, 'pct')} delta={h.prevConversion ? change(h.conversion, h.prevConversion) : null} hint="Visitas que viraram pedido" />
            </>
          )}
        </div>
        <p className="rp-insight">{h.insight}</p>
      </section>
      {full && (
        <>
          <section className="card" aria-labelledby="rp-chart-t">
            <div className="card-head">
              <h2 id="rp-chart-t">Vendas por dia</h2>
              <Link to={`${BASE}/vendas-no-tempo${period.search}`} className="small no-print">
                Ver relatório
              </Link>
            </div>
            <ChartView spec={h.chart} title="Vendas no período comparadas com o período anterior" />
          </section>
          <div className="grid2 rp-grid">
            <section className="card" aria-labelledby="rp-top-t">
              <div className="card-head">
                <h2 id="rp-top-t">5 mais vendidos</h2>
                <Link to={`${BASE}/vendas-por-produto${period.search}`} className="small no-print">
                  Todos
                </Link>
              </div>
              {h.top.length ? (
                <ol className="rp-rank">
                  {h.top.map((t, i) => (
                    <li key={t.label}>
                      <span className="rp-rank-n">{i + 1}</span>
                      <span className="grow">
                        {t.label}
                        <span className="muted small block">{t.units.toLocaleString('pt-BR')} un.</span>
                      </span>
                      <b className="num">{brl(t.revenue)}</b>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">Sem vendas no período.</p>
              )}
            </section>
            <section className="card" aria-labelledby="rp-src-t">
              <div className="card-head">
                <h2 id="rp-src-t">De onde vêm as visitas</h2>
                <Link to={`${BASE}/vendas-por-origem${period.search}`} className="small no-print">
                  Detalhes
                </Link>
              </div>
              {h.sources.length ? <BarChart items={h.sources} format={(n) => n.toLocaleString('pt-BR')} label="Visitas por origem" /> : <p className="muted">Sem visitas no período.</p>}
            </section>
          </div>
          <Attention h={h} search={period.search} />
        </>
      )}
      <GoalCard store={store} revenue={h.month.revenue} projection={h.month.projection} daysLeft={h.month.daysLeft} />
    </div>
  )
}

function Attention({ h, search }: { h: ReturnType<typeof computeHome>; search: string }) {
  const nothing = !h.late.length && !h.lowStock.length && !h.carts.length
  return (
    <section className="card" aria-labelledby="rp-att-t">
      <h2 id="rp-att-t">Atenção</h2>
      {nothing ? (
        <p className="muted">Tudo em dia: nenhum pedido parado, estoque acabando ou carrinho alto esquecido.</p>
      ) : (
        <div className="rp-att">
          {h.late.length > 0 && (
            <div>
              <h3>
                <Badge tone="bad">{h.late.length}</Badge> Pedidos parados
              </h3>
              <ul className="rp-list">
                {h.late.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    <span className="grow">
                      #{o.number} · {o.customer.name}
                      <span className="muted small block">Pago em {fmtDate(o.paid_at)}</span>
                    </span>
                    <span className="num">{brl(o.total_cents)}</span>
                  </li>
                ))}
              </ul>
              <Link to={`${BASE}/pedidos-atrasados${search}`} className="small no-print">
                Ver todos
              </Link>
            </div>
          )}
          {h.lowStock.length > 0 && (
            <div>
              <h3>
                <Badge tone="warn">{h.lowStock.length}</Badge> Produtos acabando
              </h3>
              <ul className="rp-list">
                {h.lowStock.slice(0, 5).map((p) => (
                  <li key={p.label}>
                    <span className="grow">{p.label}</span>
                    <span className="num">{p.stock <= 0 ? 'esgotado' : `${p.stock} un.`}</span>
                  </li>
                ))}
              </ul>
              <Link to={`${BASE}/estoque-baixo${search}`} className="small no-print">
                Ver estoque
              </Link>
            </div>
          )}
          {h.carts.length > 0 && (
            <div>
              <h3>
                <Badge tone="info">{h.carts.length}</Badge> Carrinhos de valor alto
              </h3>
              <ul className="rp-list">
                {h.carts.map((c, i) => (
                  <li key={i}>
                    <span className="grow">
                      {c.name} · {brl(c.value)}
                      <span className="muted small block">{c.phone ? formatPhone(c.phone) : c.items}</span>
                    </span>
                    {c.wa && (
                      <a className="btn wa small no-print" href={c.wa} target="_blank" rel="noreferrer">
                        Chamar
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <Link to={`${BASE}/carrinhos-abandonados${search}`} className="small no-print">
                Ver carrinhos
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Painel inicial sozinho (pode ser usado na home do painel). */
export function HomeDashboard({ store }: { store: Store }) {
  const period = usePeriod()
  const res = useReportData(store, period)
  if (!can(store, 'basic_reports')) return <Upsell feature="basic_reports">Veja quanto vendeu, quantos pedidos recebeu e o ticket médio, sempre comparando com o período anterior.</Upsell>
  return (
    <div className="stack">
      <PeriodBar period={period} />
      {res.error ? (
        <ErrorBox message={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Loading />
      ) : (
        <div className={res.loading ? 'rp-stale' : ''}>
          <Dashboard store={store} data={res.data} period={period} full={can(store, 'reports')} />
        </div>
      )}
    </div>
  )
}

// ---------- Lista de relatórios ----------

function ReportCard({ r, search, fav, onFav }: { r: ReportDef; search: string; fav: boolean; onFav: () => void }) {
  return (
    <li className="rp-card">
      <Link to={`${BASE}/${r.id}${search}`}>
        <b>{r.title}</b>
        <span className="muted small">{r.decision}</span>
      </Link>
      <FavButton on={fav} onClick={onFav} title={r.title} />
    </li>
  )
}

export function ReportsHome({ store }: { store: Store }) {
  const period = usePeriod()
  const res = useReportData(store, period)
  const { favs, toggle } = useFavorites()
  const full = can(store, 'reports')
  if (!can(store, 'basic_reports'))
    return (
      <div className="main-reports">
        <PageHead title="Relatórios" sub="Acompanhe vendas, clientes e estoque com números que ajudam a decidir." />
        <Upsell feature="basic_reports">Veja quanto vendeu, quantos pedidos recebeu e o ticket médio, sempre comparando com o período anterior.</Upsell>
      </div>
    )
  const favReports = favs.map(reportById).filter((r): r is ReportDef => !!r)
  return (
    <div className="main-reports stack">
      <PageHead
        title="Relatórios"
        sub="Painel inicial: todos os números são comparados com o período anterior de mesmo tamanho."
        actions={
          <button type="button" className="btn ghost small no-print" onClick={() => window.print()}>
            Imprimir
          </button>
        }
      />
      <PeriodBar period={period} />
      {res.error ? (
        <ErrorBox message={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Loading />
      ) : (
        <div className={res.loading ? 'rp-stale' : ''}>
          <Dashboard store={store} data={res.data} period={period} full={full} />
        </div>
      )}
      {!full ? (
        <Upsell feature="reports">
          No plano Pro você tem mais de 30 relatórios: produtos mais lucrativos, clientes sumidos para chamar no WhatsApp, curva ABC, funil de compra, carrinhos abandonados e fechamento do mês para o contador.
        </Upsell>
      ) : (
        <div className="stack no-print">
          {favReports.length > 0 && (
            <section aria-labelledby="rp-favs-t">
              <h2 id="rp-favs-t" className="rp-h2">
                ★ Favoritos
              </h2>
              <ul className="rp-cards">
                {favReports.map((r) => (
                  <ReportCard key={r.id} r={r} search={period.search} fav onFav={() => toggle(r.id)} />
                ))}
              </ul>
            </section>
          )}
          {GROUPS.map((g) => (
            <section key={g.id} aria-labelledby={`rp-g-${g.id}`}>
              <h2 id={`rp-g-${g.id}`} className="rp-h2">
                {g.title}
              </h2>
              <ul className="rp-cards">
                {REPORTS.filter((r) => r.group === g.id).map((r) => (
                  <ReportCard key={r.id} r={r} search={period.search} fav={favs.includes(r.id)} onFav={() => toggle(r.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Um relatório ----------

const FILTER_LABEL: Record<Exclude<FilterKey, 'granularity'>, { label: string; all: string }> = {
  product: { label: 'Produto', all: 'Todos os produtos' },
  category: { label: 'Categoria', all: 'Todas as categorias' },
  payment: { label: 'Pagamento', all: 'Todas as formas' },
  source: { label: 'Origem', all: 'Todas as origens' },
  city: { label: 'Cidade', all: 'Todas as cidades' },
}

function FilterBar({ def, data, filters, onChange }: { def: ReportDef; data: ReportData; filters: Filters; onChange: (f: Filters) => void }) {
  const opts = useMemo(() => filterOptions(data), [data])
  if (!def.filters.length) return null
  const active = Object.entries(filters).some(([k, v]) => k !== 'granularity' && v)
  return (
    <div className="rp-filters no-print">
      {def.filters.map((k) =>
        k === 'granularity' ? (
          <Field key={k} label="Agrupar por">
            <select value={filters.granularity ?? ''} onChange={(e) => onChange({ ...filters, granularity: (e.target.value || undefined) as Granularity | undefined })}>
              <option value="">Automático</option>
              <option value="dia">Dia</option>
              <option value="semana">Semana</option>
              <option value="mes">Mês</option>
            </select>
          </Field>
        ) : (
          <Field key={k} label={FILTER_LABEL[k].label}>
            <select value={filters[k] ?? ''} onChange={(e) => onChange({ ...filters, [k]: e.target.value || undefined })}>
              <option value="">{FILTER_LABEL[k].all}</option>
              {opts[k].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        ),
      )}
      {active && (
        <button type="button" className="link" onClick={() => onChange({ granularity: filters.granularity })}>
          Limpar filtros
        </button>
      )}
    </div>
  )
}

function ReportBody({ def, data, range, prev, filters }: { def: ReportDef; data: ReportData; range: Range; prev: Range; filters: Filters }) {
  const result = useMemo(() => def.compute(data, range, prev, filters), [def, data, range, prev, filters])
  return (
    <div className="stack">
      <p className="rp-insight" aria-live="polite">
        {result.insight}
      </p>
      {result.kpis && (
        <div className="stats">
          {result.kpis.map((k) => (
            <KpiStat key={k.label} k={k} />
          ))}
        </div>
      )}
      {result.chart && (
        <figure className="card rp-figure">
          <ChartView spec={result.chart} title={def.title} />
          <figcaption className="muted small">Os números completos estão na tabela abaixo.</figcaption>
        </figure>
      )}
      <ReportTable table={result.table} caption={def.title} />
      <ExportButtons def={def} result={result} range={range} />
    </div>
  )
}

function ExportButtons({ def, result, range }: { def: ReportDef; result: ReportResult; range: Range }) {
  return (
    <div className="row no-print">
      <button type="button" className="btn ghost small" disabled={!result.table.rows.length} onClick={() => downloadFile(`${def.id}-${dayKey(Date.parse(range.from))}.csv`, toCsv(tableToCsvRows(result.table)))}>
        Baixar planilha (CSV)
      </button>
      <button type="button" className="btn ghost small" onClick={() => window.print()}>
        Imprimir ou salvar em PDF
      </button>
    </div>
  )
}

export function ReportView({ store }: { store: Store }) {
  const { id = '' } = useParams()
  const def = reportById(id)
  const period = usePeriod()
  const res = useReportData(store, period)
  const { favs, toggle } = useFavorites()
  const [filters, setFilters] = useState<Filters>({})
  if (!def)
    return (
      <div className="main-reports">
        <PageHead title="Relatório não encontrado" back={BASE + period.search} />
        <Empty title="Este relatório não existe" action={<Link to={BASE + period.search} className="btn">Ver todos os relatórios</Link>} />
      </div>
    )
  const group = GROUPS.find((g) => g.id === def.group)!
  return (
    <div className="main-reports stack">
      <PageHead
        title={
          <span className="row">
            {def.title}
            <FavButton on={favs.includes(def.id)} onClick={() => toggle(def.id)} title={def.title} />
          </span>
        }
        sub={def.decision}
        back={BASE + period.search}
      />
      <p className="rp-print-only small">
        {store.name} · {group.title} · {def.usesPeriod === false ? `Situação em ${fmtDate(new Date().toISOString())}` : `${rangeLabel(period.range)}, comparado com ${rangeLabel(period.prev)}`}
      </p>
      {!can(store, 'reports') ? (
        <Upsell feature="reports">Este relatório faz parte do plano Pro.</Upsell>
      ) : (
        <>
          {def.usesPeriod === false ? <p className="muted small no-print">Este relatório mostra a situação atual; o período não muda o resultado.</p> : <PeriodBar period={period} />}
          {res.error ? (
            <ErrorBox message={res.error} onRetry={res.reload} />
          ) : !res.data ? (
            <Loading />
          ) : (
            <div className={`stack ${res.loading ? 'rp-stale' : ''}`}>
              <FilterBar def={def} data={res.data} filters={filters} onChange={setFilters} />
              <ReportBody def={def} data={res.data} range={period.range} prev={period.prev} filters={filters} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
