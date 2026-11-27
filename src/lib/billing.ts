// Regra de vencimento da mensalidade e do teste grátis, igual à do servidor
// (supabase/migrations/0005_billing_grace.sql, função downgrade_lapsed_stores).
//
// Linha do tempo:
//   até 5 dias antes do vencimento ........ "vence em X dias" (aviso leve)
//   vencido, até 7 dias de tolerância ..... loja funciona normalmente, avisos diários
//   passou da tolerância .................. o servidor muda a loja para o plano Vitrine
//                                           (pedidos só pelo WhatsApp) até o pagamento
//   pagamento registrado pelo admin ....... volta ao plano anterior
import type { PlanId, Store } from './types'

export const GRACE_DAYS = 7
export const WARN_BEFORE_DAYS = 5

export type BillingStage = 'ok' | 'due_soon' | 'grace' | 'downgraded' | 'suspended' | 'closed'

export interface BillingState {
  stage: BillingStage
  /** Teste grátis (true) ou mensalidade (false). */
  trial: boolean
  dueAt: Date | null
  /** Dias até vencer (due_soon) ou até acabar a tolerância (grace). */
  daysLeft: number
  /** Plano que volta quando o pagamento for registrado (só em downgraded). */
  previousPlan: PlanId | null
}

const DAY = 86400000
const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY)

type BillingStore = Pick<Store, 'plan' | 'status' | 'trial_ends_at' | 'paid_until'> & { plan_before_downgrade?: PlanId | null }

export function billingState(store: BillingStore, now = new Date()): BillingState {
  const trial = store.status === 'trial'
  const due = trial ? store.trial_ends_at : store.paid_until
  const dueAt = due ? new Date(due) : null
  const base = { trial, dueAt, daysLeft: 0, previousPlan: null }
  if (store.status === 'closed') return { ...base, stage: 'closed' }
  if (store.status === 'suspended') return { ...base, stage: 'suspended' }
  if (store.plan_before_downgrade) return { ...base, stage: 'downgraded', previousPlan: store.plan_before_downgrade }
  // Plano Vitrine sem data (ou loja ativa sem vencimento definido): nada a avisar.
  if (!dueAt) return { ...base, stage: 'ok' }
  if (now < dueAt) {
    const left = daysBetween(now, dueAt)
    return { ...base, stage: left <= WARN_BEFORE_DAYS ? 'due_soon' : 'ok', daysLeft: left }
  }
  const graceEnd = new Date(dueAt.getTime() + GRACE_DAYS * DAY)
  // Depois da tolerância o servidor rebaixa a loja (tarefa agendada); até lá, conta como tolerância.
  return { ...base, stage: 'grace', daysLeft: Math.max(0, daysBetween(now, graceEnd)) }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Texto do aviso para o lojista; vazio quando não há o que avisar. */
export function billingMessage(b: BillingState, planName: (p: PlanId) => string): { text: string; tone: 'info' | 'warn' | 'bad' } | null {
  const what = b.trial ? 'Seu teste grátis' : 'Sua mensalidade'
  switch (b.stage) {
    case 'due_soon':
      return { tone: b.daysLeft <= 2 ? 'warn' : 'info', text: `${what} vence em ${plural(b.daysLeft, 'dia', 'dias')}. ${b.trial ? 'Escolha um plano' : 'Pague'} para continuar com todos os recursos.` }
    case 'grace':
      return {
        tone: b.daysLeft <= 2 ? 'bad' : 'warn',
        text:
          b.daysLeft > 0
            ? `${b.trial ? 'Seu teste grátis terminou' : 'Sua mensalidade venceu'}. Em ${plural(b.daysLeft, 'dia', 'dias')} a loja passa para o plano Vitrine: pedidos só pelo WhatsApp, sem Pix, pagamento online nem relatórios.`
            : `${b.trial ? 'Seu teste grátis terminou' : 'Sua mensalidade venceu'}. Hoje a loja passa para o plano Vitrine se o pagamento não for confirmado.`,
      }
    case 'downgraded':
      return { tone: 'bad', text: `Sua loja voltou para o plano Vitrine porque o pagamento não foi confirmado. Pague para recuperar o plano ${planName(b.previousPlan ?? 'loja')}: tudo o que você cadastrou continua guardado.` }
    case 'suspended':
      return { tone: 'bad', text: 'Sua loja está suspensa: o link não abre para os clientes. Regularize o plano ou fale com o suporte.' }
    default:
      return null
  }
}
