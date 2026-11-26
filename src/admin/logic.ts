// Regras puras do painel do admin (sem acesso ao banco), testadas em tests/unit/admin.test.ts.
import { DEFAULT_PLANS, PLAN_ORDER } from '../lib/plans'
import type { AdminStoreRow, AuditEntry, PlanId, PlanRow, Store } from '../lib/types'
import { addDays, brl, fmtDate } from '../lib/util'

export type Situation = 'trial' | 'trial_expired' | 'active' | 'overdue' | 'suspended' | 'closed'

export const SITUATIONS: { id: Situation; label: string; tone: '' | 'ok' | 'warn' | 'bad' | 'info' }[] = [
  { id: 'trial', label: 'Em teste', tone: 'info' },
  { id: 'trial_expired', label: 'Teste vencido', tone: 'warn' },
  { id: 'active', label: 'Ativa', tone: 'ok' },
  { id: 'overdue', label: 'Atrasada', tone: 'bad' },
  { id: 'suspended', label: 'Suspensa', tone: 'bad' },
  { id: 'closed', label: 'Encerrada', tone: '' },
]
export const situationInfo = (s: Situation) => SITUATIONS.find((x) => x.id === s)!

const past = (iso: string | null, now: Date) => !!iso && new Date(iso).getTime() < now.getTime()

/** Situação da loja vista pelo admin, combinando o status gravado com as datas. */
export function situation(store: Pick<Store, 'status' | 'trial_ends_at' | 'paid_until'>, now = new Date()): Situation {
  switch (store.status) {
    case 'closed':
      return 'closed'
    case 'suspended':
      return 'suspended'
    case 'overdue':
      return 'overdue'
    case 'trial':
      return past(store.trial_ends_at, now) ? 'trial_expired' : 'trial'
    default:
      return past(store.paid_until, now) ? 'overdue' : 'active'
  }
}

/** Próxima data que importa: fim do teste para lojas em teste, vencimento para as demais. */
export function dueDate(store: Pick<Store, 'status' | 'trial_ends_at' | 'paid_until'>): string | null {
  return store.status === 'trial' ? store.trial_ends_at : store.paid_until
}

/** Planos da tabela "plans", completando com os valores padrão quando faltar algum. */
export function resolvePlans(rows: PlanRow[] | null | undefined): PlanRow[] {
  return PLAN_ORDER.map((id) => rows?.find((r) => r.id === id) ?? DEFAULT_PLANS.find((p) => p.id === id)!)
}
export const planPrice = (plans: PlanRow[], id: PlanId) => (plans.find((p) => p.id === id) ?? DEFAULT_PLANS.find((p) => p.id === id)!).price_cents
export const planLabel = (plans: PlanRow[], id: PlanId) => (plans.find((p) => p.id === id) ?? DEFAULT_PLANS.find((p) => p.id === id)!).name

/** Loja que está pagando em dia: ativa e com mensalidade registrada. */
export const isPaying = (store: Store, now = new Date()) => situation(store, now) === 'active' && !!store.paid_until

/** Receita mensal de mensalidades: soma do preço do plano das lojas pagando em dia. */
export function monthlyRevenue(stores: Store[], plans: PlanRow[], now = new Date()) {
  return stores.filter((s) => isPaying(s, now)).reduce((acc, s) => acc + planPrice(plans, s.plan), 0)
}

const sameMonth = (iso: string, now: Date) => {
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

/** Ações do registro que encerraram uma loja. */
const CLOSE_ACTION = /closed|encerr/i

export interface BusinessNumbers {
  active: number
  trial: number
  newThisMonth: number
  closedThisMonth: number
  revenue_cents: number
  perPlan: { plan: PlanId; name: string; count: number }[]
  attention: { row: AdminStoreRow; situation: Situation }[]
}

export function businessNumbers(rows: AdminStoreRow[], plans: PlanRow[], audit: AuditEntry[], now = new Date()): BusinessNumbers {
  const stores = rows.map((r) => r.store)
  const sit = new Map(stores.map((s) => [s.id, situation(s, now)]))
  const closedIds = new Set(
    audit.filter((a) => CLOSE_ACTION.test(a.action) && sameMonth(a.created_at, now)).map((a) => a.store_id),
  )
  const order: Situation[] = ['overdue', 'trial_expired', 'suspended']
  return {
    active: stores.filter((s) => sit.get(s.id) === 'active').length,
    trial: stores.filter((s) => sit.get(s.id) === 'trial').length,
    newThisMonth: stores.filter((s) => sameMonth(s.created_at, now)).length,
    closedThisMonth: stores.filter((s) => s.status === 'closed' && closedIds.has(s.id)).length,
    revenue_cents: monthlyRevenue(stores, plans, now),
    perPlan: resolvePlans(plans).map((p) => ({
      plan: p.id,
      name: p.name,
      count: stores.filter((s) => s.plan === p.id && s.status !== 'closed').length,
    })),
    attention: rows
      .map((row) => ({ row, situation: sit.get(row.store.id)! }))
      .filter((x) => order.includes(x.situation))
      .sort((a, b) => order.indexOf(a.situation) - order.indexOf(b.situation)),
  }
}

export interface StoreFilter {
  q: string
  plan: PlanId | ''
  situation: Situation | ''
}

export function filterStores(rows: AdminStoreRow[], f: StoreFilter, now = new Date()) {
  const q = f.q.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (!q || r.store.name.toLowerCase().includes(q) || r.store.slug.includes(q) || r.email.toLowerCase().includes(q)) &&
      (!f.plan || r.store.plan === f.plan) &&
      (!f.situation || situation(r.store, now) === f.situation),
  )
}

/** Listas do controle de mensalidades. */
export function billingBuckets(rows: AdminStoreRow[], now = new Date()) {
  const week = addDays(now, 7).getTime()
  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN)
  const byDate = (key: 'paid_until' | 'trial_ends_at') => (a: AdminStoreRow, b: AdminStoreRow) => t(a.store[key]) - t(b.store[key])
  return {
    dueThisWeek: rows
      .filter((r) => situation(r.store, now) === 'active' && t(r.store.paid_until) <= week)
      .sort(byDate('paid_until')),
    overdue: rows.filter((r) => situation(r.store, now) === 'overdue').sort(byDate('paid_until')),
    trialsEnding: rows
      .filter((r) => r.store.status === 'trial' && t(r.store.trial_ends_at) <= week)
      .sort(byDate('trial_ends_at')),
  }
}

/** Mensagem de lembrete de pagamento enviada pelo WhatsApp. */
export function reminderText(store: Store, plans: PlanRow[], now = new Date()) {
  const plan = planLabel(plans, store.plan)
  const amount = brl(planPrice(plans, store.plan))
  const sit = situation(store, now)
  const first = `Olá! Aqui é da Vitrine, sobre a loja ${store.name}.`
  if (store.status === 'trial') {
    const when = fmtDate(store.trial_ends_at)
    return sit === 'trial_expired'
      ? `${first} Seu teste grátis terminou em ${when}. Para continuar com o plano ${plan}, a mensalidade é de ${amount}. Posso te mandar o Pix?`
      : `${first} Seu teste grátis termina em ${when}. Para continuar com o plano ${plan}, a mensalidade é de ${amount}. Posso te mandar o Pix?`
  }
  const when = fmtDate(store.paid_until)
  return sit === 'overdue'
    ? `${first} A mensalidade do plano ${plan} (${amount}) venceu em ${when}. Para manter a loja no ar, é só fazer o pagamento. Posso te mandar o Pix?`
    : `${first} A mensalidade do plano ${plan} (${amount}) vence em ${when}. Posso te mandar o Pix?`
}

/** Nova data de fim do teste: soma a partir do fim atual (ou de hoje, se já passou). */
export function extendTrial(current: string | null, days: number, now = new Date()) {
  const base = current && new Date(current) > now ? new Date(current) : now
  return addDays(base, days).toISOString()
}

const STATUS_WORDS: Record<string, string> = {
  trial: 'em teste',
  active: 'ativa',
  overdue: 'atrasada',
  suspended: 'suspensa',
  closed: 'encerrada',
}

/** Deixa o texto do registro legível: troca códigos de situação e plano pelos nomes. */
export function prettyAction(action: string, plans: PlanRow[] = DEFAULT_PLANS) {
  return action
    .replace(/situação para (\w+)/g, (_, s: string) => `situação para ${STATUS_WORDS[s] ?? s}`)
    .replace(/plano para (\w+)/g, (_, p: string) => `plano para ${plans.find((x) => x.id === p)?.name ?? p}`)
}
