import { describe, expect, it } from 'vitest'
import { billingMessage, billingState } from '../../src/lib/billing'
import { planName } from '../../src/lib/plans'

const NOW = new Date('2026-11-27T12:00:00Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString()
const store = (o: Partial<Parameters<typeof billingState>[0]> = {}) => ({ plan: 'pro' as const, status: 'active' as const, trial_ends_at: null, paid_until: days(30), ...o })

describe('billingState', () => {
  it('em dia, sem aviso', () => {
    expect(billingState(store(), NOW).stage).toBe('ok')
    expect(billingMessage(billingState(store(), NOW), planName)).toBeNull()
  })

  it('avisa nos 5 dias antes de vencer', () => {
    const b = billingState(store({ paid_until: days(3) }), NOW)
    expect(b).toMatchObject({ stage: 'due_soon', daysLeft: 3, trial: false })
    expect(billingMessage(b, planName)?.text).toMatch(/Sua mensalidade vence em 3 dias/)
    expect(billingState(store({ paid_until: days(6) }), NOW).stage).toBe('ok')
  })

  it('teste grátis usa a data do teste', () => {
    const b = billingState(store({ status: 'trial', trial_ends_at: days(1), paid_until: null }), NOW)
    expect(b).toMatchObject({ stage: 'due_soon', daysLeft: 1, trial: true })
    expect(billingMessage(b, planName)).toMatchObject({ tone: 'warn', text: expect.stringMatching(/Seu teste grátis vence em 1 dia\./) })
  })

  it('vencido: conta os dias que faltam da tolerância de 7 dias', () => {
    const b = billingState(store({ paid_until: days(-2) }), NOW)
    expect(b).toMatchObject({ stage: 'grace', daysLeft: 5 })
    expect(billingMessage(b, planName)).toMatchObject({ tone: 'warn', text: expect.stringMatching(/Em 5 dias a loja passa para o plano Vitrine/) })
    expect(billingMessage(billingState(store({ paid_until: days(-6) }), NOW), planName)?.tone).toBe('bad')
    expect(billingState(store({ paid_until: days(-9) }), NOW)).toMatchObject({ stage: 'grace', daysLeft: 0 })
  })

  it('rebaixada mostra o plano que volta', () => {
    const b = billingState(store({ plan: 'vitrine', status: 'overdue', plan_before_downgrade: 'loja', paid_until: days(-10) }), NOW)
    expect(b).toMatchObject({ stage: 'downgraded', previousPlan: 'loja' })
    expect(billingMessage(b, planName)?.text).toMatch(/recuperar o plano Loja/)
  })

  it('suspensa e encerrada', () => {
    expect(billingState(store({ status: 'suspended' }), NOW).stage).toBe('suspended')
    expect(billingState(store({ status: 'closed' }), NOW).stage).toBe('closed')
    expect(billingMessage(billingState(store({ status: 'closed' }), NOW), planName)).toBeNull()
  })

  it('sem data de vencimento (ex.: plano Vitrine ativo sem pagamento registrado) não avisa', () => {
    expect(billingState(store({ plan: 'vitrine', paid_until: null }), NOW).stage).toBe('ok')
  })
})
