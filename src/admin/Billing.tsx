import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminStoreRow, PlanRow, Store } from '../lib/types'
import { brl, daysBetween, fmtDate, plural } from '../lib/util'
import { Empty, ErrorBox, Loading, PageHead, Stat, useAsync } from '../ui/kit'
import { billingBuckets, planLabel, planPrice } from './logic'
import { loadPlans, loadStores, PaymentModal, SituationBadge, WhatsAppReminder } from './shared'

export function BillingPage() {
  const { data, error, loading, reload } = useAsync(() => Promise.all([loadStores(), loadPlans()]), [])
  const [paying, setPaying] = useState<Store | null>(null)

  if (error)
    return (
      <>
        <PageHead title="Mensalidades" />
        <ErrorBox message={error} onRetry={reload} />
      </>
    )
  if (loading || !data)
    return (
      <>
        <PageHead title="Mensalidades" />
        <Loading />
      </>
    )

  const [rows, plans] = data
  const b = billingBuckets(rows)
  const sumOf = (list: AdminStoreRow[]) => list.reduce((a, r) => a + planPrice(plans, r.store.plan), 0)

  return (
    <>
      <PageHead title="Mensalidades" sub="Quem vence, quem atrasou e quem está terminando o teste" />
      <div className="stack">
        <div className="stats">
          <Stat label="Vence esta semana" value={brl(sumOf(b.dueThisWeek))} hint={plural(b.dueThisWeek.length, 'loja', 'lojas')} />
          <Stat label="Atrasado" value={brl(sumOf(b.overdue))} hint={plural(b.overdue.length, 'loja', 'lojas')} />
          <Stat label="Testes vencendo" value={b.trialsEnding.length} hint="Nos próximos 7 dias ou já vencidos" />
        </div>
        <Bucket title="Atrasadas" empty="Nenhuma mensalidade atrasada." rows={b.overdue} plans={plans} kind="paid" onPay={setPaying} />
        <Bucket title="Vence esta semana" empty="Nenhuma mensalidade vence nos próximos 7 dias." rows={b.dueThisWeek} plans={plans} kind="paid" onPay={setPaying} />
        <Bucket title="Testes vencendo" empty="Nenhum teste termina nos próximos 7 dias." rows={b.trialsEnding} plans={plans} kind="trial" onPay={setPaying} />
      </div>
      {paying && <PaymentModal store={paying} plans={plans} onClose={() => setPaying(null)} onDone={reload} />}
    </>
  )
}

function when(iso: string | null, kind: 'paid' | 'trial') {
  if (!iso) return '—'
  const d = daysBetween(new Date(new Date().toDateString()), new Date(new Date(iso).toDateString()))
  const verb = kind === 'trial' ? (d < 0 ? 'Teste terminou' : 'Teste termina') : d < 0 ? 'Venceu' : 'Vence'
  const rel = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : d === -1 ? 'ontem' : d < 0 ? `há ${-d} dias` : `em ${d} dias`
  return `${verb} ${rel} (${fmtDate(iso)})`
}

function Bucket({
  title,
  empty,
  rows,
  plans,
  kind,
  onPay,
}: {
  title: string
  empty: string
  rows: AdminStoreRow[]
  plans: PlanRow[]
  kind: 'paid' | 'trial'
  onPay: (s: Store) => void
}) {
  return (
    <section className="card bucket">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="muted small">{plural(rows.length, 'loja', 'lojas')}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted bucket-empty">{empty}</p>
      ) : (
        <ul className="bill-list">
          {rows.map((r) => (
            <li key={r.store.id} className="bill-row">
              <div className="grow">
                <Link to={`/admin/lojas/${r.store.id}`}>
                  <b>{r.store.name}</b>
                </Link>{' '}
                <SituationBadge store={r.store} />
                <span className="hint block">
                  {when(kind === 'trial' ? r.store.trial_ends_at : r.store.paid_until, kind)} · Plano {planLabel(plans, r.store.plan)} ·{' '}
                  {brl(planPrice(plans, r.store.plan))}
                </span>
              </div>
              <div className="row bill-actions">
                <WhatsAppReminder store={r.store} plans={plans} />
                <button className="btn small" onClick={() => onPay(r.store)}>
                  Registrar pagamento
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
