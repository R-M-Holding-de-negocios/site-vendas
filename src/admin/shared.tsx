// Peças reaproveitadas pelas telas do admin.
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/api'
import type { AdminStoreRow, PlanRow, Store } from '../lib/types'
import { brl, waLink } from '../lib/util'
import { Badge, Field, Modal, MoneyInput, toast } from '../ui/kit'
import { planLabel, planPrice, reminderText, resolvePlans, situation, situationInfo } from './logic'

export async function loadPlans(): Promise<PlanRow[]> {
  try {
    return resolvePlans(await db.list('plans'))
  } catch {
    return resolvePlans(null)
  }
}

export async function loadStores(): Promise<AdminStoreRow[]> {
  const rows = await db.rpc('admin_list_stores', {})
  return rows.sort((a, b) => b.store.created_at.localeCompare(a.store.created_at))
}

export function SituationBadge({ store }: { store: Store }) {
  const s = situationInfo(situation(store))
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** Janela de confirmação. onConfirm pode ser assíncrono; erros aparecem na própria janela. */
export function Confirm({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  disabled,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<unknown> | unknown
  onClose: () => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await onConfirm()
      onClose()
    } catch (x) {
      setErr((x as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {children}
        {err && (
          <div className="alert error" role="alert">
            {err}
          </div>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={`btn ${danger ? 'danger-solid' : ''}`} disabled={busy || disabled}>
            {busy ? 'Salvando…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const MONTHS = [1, 3, 6, 12]
const METHODS = ['Pix', 'Cartão', 'Outro']

export function PaymentModal({ store, plans, onClose, onDone }: { store: Store; plans: PlanRow[]; onClose: () => void; onDone: () => void }) {
  const price = planPrice(plans, store.plan)
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState<number | null>(price)
  const [touched, setTouched] = useState(false)
  const [method, setMethod] = useState('Pix')
  const [note, setNote] = useState('')
  const valid = amount != null && amount > 0
  return (
    <Confirm
      title="Registrar pagamento"
      confirmLabel="Registrar pagamento"
      onClose={onClose}
      disabled={!valid}
      onConfirm={async () => {
        await db.rpc('admin_register_payment', { store_id: store.id, amount_cents: amount!, months, method, note: note.trim() })
        toast('Pagamento registrado')
        onDone()
      }}
    >
      <p>
        <b>{store.name}</b> · plano {planLabel(plans, store.plan)} ({brl(price)} por mês)
      </p>
      <fieldset>
        <legend>Meses pagos</legend>
        <div className="chips">
          {MONTHS.map((m) => (
            <button
              type="button"
              key={m}
              className={`chip ${m === months ? 'on' : ''}`}
              aria-pressed={m === months}
              onClick={() => {
                setMonths(m)
                if (!touched) setAmount(price * m)
              }}
            >
              {m === 1 ? '1 mês' : `${m} meses`}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Valor recebido" error={valid ? undefined : 'Informe o valor recebido.'}>
        <MoneyInput
          value={amount}
          onChange={(v) => {
            setTouched(true)
            setAmount(v)
          }}
          required
        />
      </Field>
      <fieldset>
        <legend>Forma de pagamento</legend>
        <div className="chips">
          {METHODS.map((m) => (
            <button type="button" key={m} className={`chip ${m === method ? 'on' : ''}`} aria-pressed={m === method} onClick={() => setMethod(m)}>
              {m}
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Observação" hint="Opcional. Ex.: comprovante recebido no WhatsApp.">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <p className="hint">O vencimento avança {months === 1 ? '1 mês' : `${months} meses`} e a loja volta a ficar ativa.</p>
    </Confirm>
  )
}

export function WhatsAppReminder({ store, plans, className = 'btn wa small' }: { store: Store; plans: PlanRow[]; className?: string }) {
  if (!store.whatsapp) return <span className="hint">Sem WhatsApp</span>
  return (
    <a className={className} href={waLink(store.whatsapp, reminderText(store, plans))} target="_blank" rel="noreferrer">
      Lembrar no WhatsApp
    </a>
  )
}

/** Registra no histórico e abre o painel do lojista em nome da loja. */
export function useActAsMerchant() {
  const navigate = useNavigate()
  return async (storeId: string) => {
    try {
      await db.rpc('admin_log', { store_id: storeId, action: 'Abriu o painel como lojista' })
      navigate(`/painel?loja=${encodeURIComponent(storeId)}`)
    } catch (e) {
      toast((e as Error).message)
    }
  }
}
