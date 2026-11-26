import { beforeEach, describe, expect, it } from 'vitest'
import { DemoStore } from '../../src/lib/db-demo'
import { demoRpc } from '../../src/lib/demo-rpc'
import { seedDemo } from '../../src/lib/seed'
import { DEFAULT_PLANS } from '../../src/lib/plans'
import type { AdminStoreRow, Store } from '../../src/lib/types'
import { addDays } from '../../src/lib/util'
import {
  billingBuckets,
  businessNumbers,
  extendTrial,
  filterStores,
  monthlyRevenue,
  prettyAction,
  reminderText,
  resolvePlans,
  situation,
} from '../../src/admin/logic'

const now = new Date()
const days = (n: number) => addDays(now, n).toISOString()
const st = (p: Partial<Store>) => ({ status: 'active', trial_ends_at: null, paid_until: null, ...p }) as Store

describe('situação da loja', () => {
  it('classifica pelas datas e pelo status', () => {
    expect(situation(st({ status: 'trial', trial_ends_at: days(3) }), now)).toBe('trial')
    expect(situation(st({ status: 'trial', trial_ends_at: days(-1) }), now)).toBe('trial_expired')
    expect(situation(st({ status: 'active', paid_until: days(10) }), now)).toBe('active')
    expect(situation(st({ status: 'active', paid_until: days(-2) }), now)).toBe('overdue')
    expect(situation(st({ status: 'overdue', paid_until: days(5) }), now)).toBe('overdue')
    expect(situation(st({ status: 'suspended', paid_until: days(5) }), now)).toBe('suspended')
    expect(situation(st({ status: 'closed' }), now)).toBe('closed')
  })
})

describe('admin com a loja de exemplo', () => {
  let s: DemoStore
  let rows: AdminStoreRow[]
  const bySlug = (slug: string) => rows.find((r) => r.store.slug === slug)!
  beforeEach(async () => {
    localStorage.clear()
    s = new DemoStore()
    seedDemo(s)
    s.user = { id: 'x', email: 'admin@exemplo.com' }
    rows = await demoRpc(s).admin_list_stores({})
  })

  it('reconhece cada situação do exemplo', () => {
    const sit = Object.fromEntries(rows.map((r) => [r.store.slug, situation(r.store, now)]))
    expect(sit).toEqual({
      'doces-da-ana': 'active',
      'atelie-da-bia': 'active',
      'brecho-vintage': 'overdue',
      'casa-do-cafe': 'trial',
      'tech-cases': 'suspended',
    })
  })

  it('soma a receita mensal só das lojas pagando em dia', () => {
    const plans = resolvePlans(s.rows('plans'))
    // Doces da Ana (Pro 99,00) + Ateliê da Bia (Loja 49,00)
    expect(monthlyRevenue(rows.map((r) => r.store), plans, now)).toBe(9900 + 4900)
    // Preço vindo da tabela de planos
    const custom = plans.map((p) => (p.id === 'pro' ? { ...p, price_cents: 12900 } : p))
    expect(monthlyRevenue(rows.map((r) => r.store), custom, now)).toBe(12900 + 4900)
    // Sem tabela, usa os valores padrão
    expect(resolvePlans([])).toEqual(DEFAULT_PLANS)
  })

  it('resume os números do negócio', async () => {
    const rpc = demoRpc(s)
    await rpc.admin_update_store({ store_id: bySlug('atelie-da-bia').store.id, status: 'closed' })
    rows = await rpc.admin_list_stores({})
    const audit = await rpc.admin_audit_list({ store_id: null })
    const n = businessNumbers(rows, resolvePlans(s.rows('plans')), audit, now)
    expect(n.active).toBe(1)
    expect(n.trial).toBe(1)
    expect(n.closedThisMonth).toBe(1)
    expect(n.revenue_cents).toBe(9900)
    expect(n.perPlan.map((p) => [p.plan, p.count])).toEqual([
      ['vitrine', 1],
      ['loja', 1],
      ['pro', 2],
    ])
    expect(n.attention.map((a) => a.situation)).toEqual(['overdue', 'suspended'])
  })

  it('filtra por busca, plano e situação', () => {
    expect(filterStores(rows, { q: 'café', plan: '', situation: '' }, now).map((r) => r.store.slug)).toEqual(['casa-do-cafe'])
    expect(filterStores(rows, { q: 'tech-cases@', plan: '', situation: '' }, now)).toHaveLength(1)
    expect(filterStores(rows, { q: '', plan: 'loja', situation: '' }, now)).toHaveLength(2)
    expect(filterStores(rows, { q: '', plan: 'loja', situation: 'suspended' }, now).map((r) => r.store.slug)).toEqual(['tech-cases'])
  })

  it('separa as listas de mensalidades', () => {
    const b = billingBuckets(rows, now)
    expect(b.dueThisWeek.map((r) => r.store.slug)).toEqual(['atelie-da-bia'])
    expect(b.overdue.map((r) => r.store.slug)).toEqual(['brecho-vintage'])
    expect(b.trialsEnding).toHaveLength(0)
  })

  it('monta o lembrete com plano, valor e vencimento', () => {
    const plans = resolvePlans(s.rows('plans'))
    const text = reminderText(bySlug('brecho-vintage').store, plans, now)
    expect(text).toContain('plano Vitrine')
    expect(text).toMatch(/R\$\s?39,00/)
    expect(text).toContain('venceu em')
  })
})

describe('outras regras', () => {
  it('estende o teste a partir do fim atual ou de hoje', () => {
    const end = days(3)
    expect(extendTrial(end, 7, now)).toBe(addDays(new Date(end), 7).toISOString())
    expect(extendTrial(days(-5), 7, now)).toBe(addDays(now, 7).toISOString())
  })
  it('traduz códigos no registro de ações', () => {
    expect(prettyAction('Alterou plano para pro, situação para closed')).toBe('Alterou plano para Pro, situação para encerrada')
  })
})
