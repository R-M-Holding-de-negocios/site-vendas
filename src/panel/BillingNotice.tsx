// Avisos de vencimento em todas as telas do painel (faixa no topo) e um lembrete por dia
// quando a loja já venceu (tolerância) ou voltou para o plano Vitrine. Regras em lib/billing.ts.
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { billingMessage, billingState } from '../lib/billing'
import { planName } from '../lib/plans'
import type { Store } from '../lib/types'
import { Modal } from '../ui/kit'

const todayKey = (storeId: string) => `vt_billing_seen_${storeId}_${new Date().toISOString().slice(0, 10)}`

export function BillingNotice({ store, asAdmin }: { store: Store; asAdmin: boolean }) {
  const loc = useLocation()
  const b = billingState(store)
  const msg = billingMessage(b, planName)
  const urgent = b.stage === 'grace' || b.stage === 'downgraded'
  const [popup, setPopup] = useState(() => {
    if (!urgent || asAdmin) return false
    try {
      return !localStorage.getItem(todayKey(store.id))
    } catch {
      return false
    }
  })
  if (!msg) return null
  const closePopup = () => {
    try {
      localStorage.setItem(todayKey(store.id), '1')
    } catch {
      /* sem localStorage */
    }
    setPopup(false)
  }
  const onBilling = loc.pathname.startsWith('/painel/plano')
  return (
    <>
      <div className={`alert ${msg.tone === 'bad' ? 'error' : msg.tone} billing-notice no-print`} role={urgent ? 'alert' : 'status'}>
        <span className="grow">{msg.text}</span>
        {!onBilling && (
          <Link className="btn small" to="/painel/plano">
            {b.stage === 'downgraded' || b.stage === 'grace' ? 'Pagar agora' : 'Ver plano'}
          </Link>
        )}
      </div>
      {popup && !onBilling && (
        <Modal title={b.stage === 'downgraded' ? 'Sua loja voltou para o plano Vitrine' : 'Pagamento pendente'} onClose={closePopup}>
          <div className="stack">
            <p>{msg.text}</p>
            <div className="row">
              <Link className="btn" to="/painel/plano" onClick={closePopup}>
                Ver como pagar
              </Link>
              <button className="btn ghost" onClick={closePopup}>
                Lembrar amanhã
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
