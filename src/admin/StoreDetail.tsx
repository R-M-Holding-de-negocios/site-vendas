import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { db, storeUrl } from '../lib/api'
import type { Rpc } from '../lib/db'
import { PLAN_ORDER } from '../lib/plans'
import type { AdminStoreRow, PlanId, PlanRow, Product, StoreStatus } from '../lib/types'
import { brl, fmtDate, fmtDateTime, formatPhone } from '../lib/util'
import { Badge, Empty, ErrorBox, Field, Loading, PageHead, Tabs, toast, useAsync } from '../ui/kit'
import { extendTrial, planLabel, planPrice, prettyAction, situation } from './logic'
import { Confirm, loadPlans, loadStores, PaymentModal, SituationBadge, useActAsMerchant, WhatsAppReminder } from './shared'

type Action = 'plan' | 'trial' | 'suspend' | 'reactivate' | 'close' | 'payment' | null

export function StoreDetailPage() {
  const { id = '' } = useParams()
  const { data, error, loading, reload } = useAsync(async () => {
    const [rows, plans] = await Promise.all([loadStores(), loadPlans()])
    return { row: rows.find((r) => r.store.id === id) ?? null, plans }
  }, [id])
  const [tab, setTab] = useState<'payments' | 'products' | 'audit'>('payments')
  const [action, setAction] = useState<Action>(null)
  const [version, setVersion] = useState(0)
  const actAs = useActAsMerchant()

  if (error)
    return (
      <>
        <PageHead title="Loja" back="/admin/lojas" />
        <ErrorBox message={error} onRetry={reload} />
      </>
    )
  if (loading || !data)
    return (
      <>
        <PageHead title="Loja" back="/admin/lojas" />
        <Loading />
      </>
    )
  if (!data.row)
    return (
      <>
        <PageHead title="Loja" back="/admin/lojas" />
        <div className="card">
          <Empty title="Loja não encontrada" text="Ela pode ter sido apagada pelo lojista." />
        </div>
      </>
    )

  const { row, plans } = data
  const st = row.store
  const sit = situation(st)
  const refresh = () => {
    reload()
    setVersion((v) => v + 1)
  }
  const update = async (patch: Omit<Parameters<Rpc['admin_update_store']>[0], 'store_id'>, msg: string) => {
    await db.rpc('admin_update_store', { store_id: st.id, ...patch })
    toast(msg)
    refresh()
  }

  return (
    <>
      <PageHead
        back="/admin/lojas"
        title={st.name}
        sub={
          <span className="row">
            <SituationBadge store={st} />
            <span>Plano {planLabel(plans, st.plan)}</span>
          </span>
        }
        actions={
          <>
            <a className="btn ghost small" href={storeUrl(st.slug)} target="_blank" rel="noreferrer">
              Abrir a loja
            </a>
            <button className="btn small" onClick={() => actAs(st.id)}>
              Entrar como o lojista
            </button>
          </>
        }
      />

      <div className="detail-grid">
          <section className="card detail-facts">
            <h2>Dados da loja</h2>
            <dl className="facts">
              <div className="wide">
                <dt>E-mail do dono</dt>
                <dd>
                  <a href={`mailto:${row.email}`}>{row.email}</a>
                </dd>
              </div>
              <div>
                <dt>WhatsApp</dt>
                <dd>{st.whatsapp ? formatPhone(st.whatsapp) : '—'}</dd>
              </div>
              <div className="wide">
                <dt>Endereço</dt>
                <dd className="break">
                  <a href={storeUrl(st.slug)} target="_blank" rel="noreferrer">
                    {storeUrl(st.slug).replace(/^https?:\/\//, '')}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Plano</dt>
                <dd>
                  {planLabel(plans, st.plan)} · <span className="nowrap">{brl(planPrice(plans, st.plan))}/mês</span>
                </dd>
              </div>
              <div>
                <dt>Fim do teste</dt>
                <dd>{fmtDate(st.trial_ends_at)}</dd>
              </div>
              <div>
                <dt>Pago até</dt>
                <dd>{fmtDate(st.paid_until)}</dd>
              </div>
              <div>
                <dt>Criada em</dt>
                <dd>{fmtDate(st.created_at)}</dd>
              </div>
              <div>
                <dt>Último acesso</dt>
                <dd>{fmtDateTime(row.last_sign_in_at)}</dd>
              </div>
              <div>
                <dt>Produtos</dt>
                <dd>{row.product_count}</dd>
              </div>
              <div>
                <dt>Pedidos em 30 dias</dt>
                <dd>{row.orders_30d}</dd>
              </div>
            </dl>
          </section>
          <Notes row={row} onSaved={refresh} />

        <section className="card detail-actions">
          <h2>Ações</h2>
          <div className="actions-list">
            <button className="btn full" onClick={() => setAction('payment')}>
              Registrar pagamento
            </button>
            <WhatsAppReminder store={st} plans={plans} className="btn wa full" />
            <button className="btn ghost full" onClick={() => setAction('plan')}>
              Mudar plano
            </button>
            {st.status === 'trial' && (
              <button className="btn ghost full" onClick={() => setAction('trial')}>
                Estender teste
              </button>
            )}
            {(st.status === 'suspended' || st.status === 'closed') && (
              <button className="btn ghost full" onClick={() => setAction('reactivate')}>
                Reativar loja
              </button>
            )}
            {st.status !== 'suspended' && st.status !== 'closed' && (
              <button className="btn danger full" onClick={() => setAction('suspend')}>
                Suspender loja
              </button>
            )}
            {st.status !== 'closed' && (
              <button className="btn danger full" onClick={() => setAction('close')}>
                Encerrar loja
              </button>
            )}
          </div>
          {sit === 'overdue' && <p className="hint">Mensalidade atrasada desde {fmtDate(st.paid_until)}.</p>}
        </section>
      </div>

      <div className="detail-tabs">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'payments', label: 'Pagamentos' },
            { id: 'products', label: 'Produtos' },
            { id: 'audit', label: 'Registro' },
          ]}
        />
        <div className="tab-body">
          {tab === 'payments' && <Payments storeId={st.id} plans={plans} version={version} />}
          {tab === 'products' && <Products storeId={st.id} />}
          {tab === 'audit' && <StoreAudit storeId={st.id} plans={plans} version={version} />}
        </div>
      </div>

      {action === 'payment' && <PaymentModal store={st} plans={plans} onClose={() => setAction(null)} onDone={refresh} />}
      {action === 'plan' && <PlanAction row={row} plans={plans} onClose={() => setAction(null)} onSave={(plan) => update({ plan }, 'Plano alterado')} />}
      {action === 'trial' && <TrialAction current={st.trial_ends_at} onClose={() => setAction(null)} onSave={(d) => update({ trial_ends_at: d }, 'Teste estendido')} />}
      {action === 'suspend' && (
        <StatusAction
          title="Suspender loja"
          label="Suspender"
          danger
          onClose={() => setAction(null)}
          onSave={() => update({ status: 'suspended' }, 'Loja suspensa')}
        >
          <p>
            A loja <b>{st.name}</b> sai do ar e deixa de receber pedidos. O lojista continua conseguindo entrar no painel. Dá para reativar depois.
          </p>
        </StatusAction>
      )}
      {action === 'reactivate' && (
        <StatusAction title="Reativar loja" label="Reativar" onClose={() => setAction(null)} onSave={() => update({ status: reactivateStatus(row) }, 'Loja reativada')}>
          <p>
            A loja <b>{st.name}</b> volta ao ar e passa a receber pedidos de novo.
          </p>
          {st.paid_until && new Date(st.paid_until) < new Date() && (
            <div className="alert warn">O vencimento ({fmtDate(st.paid_until)}) já passou: a loja vai aparecer como atrasada até registrar um pagamento.</div>
          )}
        </StatusAction>
      )}
      {action === 'close' && (
        <StatusAction title="Encerrar loja" label="Encerrar loja" danger confirmText={st.slug} onClose={() => setAction(null)} onSave={() => update({ status: 'closed' }, 'Loja encerrada')}>
          <p>
            A loja <b>{st.name}</b> sai do ar e é marcada como encerrada (por exemplo, quando o lojista desistiu). Os dados continuam guardados e dá para reativar depois.
          </p>
        </StatusAction>
      )}
    </>
  )
}

/** Ao reativar: volta para teste se ainda está no período de teste e nunca pagou; senão, ativa. */
function reactivateStatus(row: AdminStoreRow): StoreStatus {
  const st = row.store
  if (!st.paid_until && st.trial_ends_at && new Date(st.trial_ends_at) > new Date()) return 'trial'
  return 'active'
}

function Notes({ row, onSaved }: { row: AdminStoreRow; onSaved: () => void }) {
  const [text, setText] = useState(row.notes)
  const [busy, setBusy] = useState(false)
  useEffect(() => setText(row.notes), [row.notes])
  const dirty = text !== row.notes
  async function save() {
    setBusy(true)
    try {
      await db.rpc('admin_update_store', { store_id: row.store.id, notes: text })
      toast('Anotações salvas')
      onSaved()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card detail-notes">
      <Field label={<h2 className="as-label">Anotações internas</h2>} hint="Só a equipe da plataforma vê. Ex.: combinados, histórico de contato.">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      </Field>
      <div className="row end notes-actions">
        {dirty && (
          <button className="btn ghost small" onClick={() => setText(row.notes)} disabled={busy}>
            Desfazer
          </button>
        )}
        <button className="btn small" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Salvando…' : 'Salvar anotações'}
        </button>
      </div>
    </section>
  )
}

function PlanAction({ row, plans, onClose, onSave }: { row: AdminStoreRow; plans: PlanRow[]; onClose: () => void; onSave: (p: PlanId) => Promise<void> }) {
  const [plan, setPlan] = useState<PlanId>(row.store.plan)
  return (
    <Confirm title="Mudar plano" confirmLabel="Mudar plano" disabled={plan === row.store.plan} onClose={onClose} onConfirm={() => onSave(plan)}>
      <fieldset>
        <legend>Novo plano para {row.store.name}</legend>
        <div className="stack tight">
          {PLAN_ORDER.map((p) => (
            <label key={p} className="check">
              <input type="radio" name="plan" checked={plan === p} onChange={() => setPlan(p)} />
              <span>
                {planLabel(plans, p)} · {brl(planPrice(plans, p))}/mês {p === row.store.plan && <span className="hint">(atual)</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="hint">Os recursos mudam na hora. A próxima mensalidade passa a ter o valor do novo plano.</p>
    </Confirm>
  )
}

function TrialAction({ current, onClose, onSave }: { current: string | null; onClose: () => void; onSave: (iso: string) => Promise<void> }) {
  const [mode, setMode] = useState<'7' | '14' | 'date'>('7')
  const [date, setDate] = useState('')
  const target = mode === 'date' ? (date ? new Date(`${date}T23:59:00-03:00`).toISOString() : '') : extendTrial(current, Number(mode))
  const invalid = !target || new Date(target) <= new Date()
  return (
    <Confirm title="Estender teste" confirmLabel="Estender teste" disabled={invalid} onClose={onClose} onConfirm={() => onSave(target)}>
      <p>Fim atual do teste: {fmtDate(current)}</p>
      <fieldset>
        <legend>Quanto tempo a mais</legend>
        <div className="chips">
          {(
            [
              ['7', '+7 dias'],
              ['14', '+14 dias'],
              ['date', 'Escolher data'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} type="button" className={`chip ${mode === m ? 'on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      {mode === 'date' && (
        <Field label="Teste até" error={date && invalid ? 'Escolha uma data no futuro.' : undefined}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      )}
      {target && !invalid && <p>Novo fim do teste: <b>{fmtDate(target)}</b></p>}
    </Confirm>
  )
}

function StatusAction({
  title,
  label,
  danger,
  confirmText,
  children,
  onClose,
  onSave,
}: {
  title: string
  label: string
  danger?: boolean
  confirmText?: string
  children: ReactNode
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  return (
    <Confirm title={title} confirmLabel={label} danger={danger} disabled={!!confirmText && typed.trim() !== confirmText} onClose={onClose} onConfirm={onSave}>
      {children}
      {confirmText && (
        <Field label={<>Para confirmar, digite <code>{confirmText}</code></>}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </Field>
      )}
    </Confirm>
  )
}

function Payments({ storeId, plans, version }: { storeId: string; plans: PlanRow[]; version: number }) {
  const { data, error, loading, reload } = useAsync(
    async () => (await db.list('invoices', { eq: { store_id: storeId } })).sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
    [storeId, version],
  )
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (loading || !data) return <Loading />
  if (!data.length) return <div className="card"><Empty title="Nenhum pagamento registrado" text="Os pagamentos registrados por aqui ou pelo controle de mensalidades aparecem nesta lista." /></div>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Plano</th>
            <th>Meses</th>
            <th>Forma</th>
            <th className="num">Valor</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>
          {data.map((i) => (
            <tr key={i.id}>
              <td className="nowrap">{fmtDate(i.paid_at)}</td>
              <td>{planLabel(plans, i.plan)}</td>
              <td>{i.months}</td>
              <td>{i.method}</td>
              <td className="num nowrap">{brl(i.amount_cents)}</td>
              <td className="muted">{i.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Products({ storeId }: { storeId: string }) {
  const { data, error, loading, reload, setData } = useAsync(() => db.list('products', { eq: { store_id: storeId }, order: ['position', 'asc'] }), [storeId])
  const [blocking, setBlocking] = useState<Product | null>(null)
  const [busyId, setBusyId] = useState('')
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (loading || !data) return <Loading />
  if (!data.length) return <div className="card"><Empty title="Nenhum produto cadastrado" /></div>

  const setBlocked = async (p: Product, blocked: boolean) => {
    await db.rpc('admin_set_product_blocked', { product_id: p.id, blocked })
    setData(data.map((x) => (x.id === p.id ? { ...x, blocked } : x)))
    toast(blocked ? 'Produto bloqueado' : 'Produto desbloqueado')
  }
  return (
    <>
      <p className="hint tab-hint">Bloqueie produtos com conteúdo proibido. O produto some da loja e o lojista não consegue reativá-lo.</p>
      <ul className="list">
        {data.map((p) => (
          <li key={p.id} className="list-row">
            {p.images[0] ? <img className="pic" src={p.images[0]} alt="" loading="lazy" /> : <span className="pic" />}
            <span className="grow">
              <b className="block clamp">{p.name}</b>
              <span className="hint">
                {brl(p.promo_price_cents ?? p.price_cents)}
                {!p.available && ' · indisponível'}
              </span>
            </span>
            {p.blocked && <Badge tone="bad">Bloqueado</Badge>}
            {p.blocked ? (
              <button
                className="btn ghost small"
                disabled={busyId === p.id}
                onClick={async () => {
                  setBusyId(p.id)
                  await setBlocked(p, false).catch((e: Error) => toast(e.message))
                  setBusyId('')
                }}
              >
                Desbloquear
              </button>
            ) : (
              <button className="btn danger small" onClick={() => setBlocking(p)}>
                Bloquear
              </button>
            )}
          </li>
        ))}
      </ul>
      {blocking && (
        <Confirm title="Bloquear produto" confirmLabel="Bloquear produto" danger onClose={() => setBlocking(null)} onConfirm={() => setBlocked(blocking, true)}>
          <p>
            O produto <b>{blocking.name}</b> deixa de aparecer na loja. Use para conteúdo proibido. Fica registrado no histórico.
          </p>
        </Confirm>
      )}
    </>
  )
}

function StoreAudit({ storeId, plans, version }: { storeId: string; plans: PlanRow[]; version: number }) {
  const { data, error, loading, reload } = useAsync(() => db.rpc('admin_audit_list', { store_id: storeId }), [storeId, version])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (loading || !data) return <Loading />
  if (!data.length) return <div className="card"><Empty title="Nenhuma ação registrada para esta loja" /></div>
  return (
    <ul className="list">
      {data.map((a) => (
        <li key={a.id} className="list-row audit-row">
          <span className="grow">
            <span className="block">{prettyAction(a.action, plans)}</span>
            <span className="hint">
              {a.admin_email} · {fmtDateTime(a.created_at)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
