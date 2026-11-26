// Avisos aos lojistas, configuração dos planos e registro de ações.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../lib/api'
import type { PlanRow } from '../lib/types'
import { brl, fmtDate, fmtDateTime, plural } from '../lib/util'
import { Empty, ErrorBox, Field, Loading, MoneyInput, PageHead, toast, useAsync } from '../ui/kit'
import { prettyAction } from './logic'
import { Confirm, loadPlans, loadStores } from './shared'

export function AnnouncementsPage() {
  const { data, error, loading, reload } = useAsync(() => db.list('announcements', { order: ['created_at', 'desc'] }), [])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [confirming, setConfirming] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim() && body.trim()) setConfirming(true)
  }

  return (
    <>
      <PageHead title="Avisos aos lojistas" sub="Aparecem no painel de todas as lojas" />
      <div className="split">
        <section className="card">
          <h2>Avisos enviados</h2>
          {error ? (
            <ErrorBox message={error} onRetry={reload} />
          ) : loading || !data ? (
            <Loading />
          ) : data.length === 0 ? (
            <Empty title="Nenhum aviso enviado ainda" text="Use avisos para contar novidades, manutenções ou mudanças de preço." />
          ) : (
            <ul className="announce-list">
              {data.map((a) => (
                <li key={a.id}>
                  <div className="row between">
                    <b>{a.title}</b>
                    <span className="hint">{fmtDate(a.created_at)}</span>
                  </div>
                  <p className="pre">{a.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Novo aviso</h2>
          <form className="stack" onSubmit={submit}>
            <Field label="Título">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
            </Field>
            <Field label="Mensagem" hint={`${body.length}/600`}>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} required rows={5} />
            </Field>
            <button className="btn" disabled={!title.trim() || !body.trim()}>
              Enviar aviso
            </button>
          </form>
        </section>
      </div>
      {confirming && (
        <Confirm
          title="Enviar aviso"
          confirmLabel="Enviar para todos"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await db.rpc('admin_announce', { title: title.trim(), body: body.trim() })
            setTitle('')
            setBody('')
            toast('Aviso enviado')
            reload()
          }}
        >
          <p>Todos os lojistas vão ver este aviso no painel:</p>
          <div className="quote">
            <b className="block">{title.trim()}</b>
            <p className="pre">{body.trim()}</p>
          </div>
        </Confirm>
      )}
    </>
  )
}

export function PlansPage() {
  const { data, error, loading, reload } = useAsync(loadPlans, [])
  return (
    <>
      <PageHead title="Planos" sub="Preço da mensalidade e taxa sobre vendas online de cada plano" />
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : (
        <div className="plan-cards">
          {data.map((p) => (
            <PlanEditor key={p.id + p.price_cents + p.fee_percent} plan={p} onSaved={reload} />
          ))}
        </div>
      )}
    </>
  )
}

function PlanEditor({ plan, onSaved }: { plan: PlanRow; onSaved: () => void }) {
  const [price, setPrice] = useState<number | null>(plan.price_cents)
  const [fee, setFee] = useState(String(plan.fee_percent).replace('.', ','))
  const [confirming, setConfirming] = useState(false)
  const feeNum = Number(fee.replace(',', '.'))
  const feeOk = fee.trim() !== '' && Number.isFinite(feeNum) && feeNum >= 0 && feeNum <= 20
  const priceOk = price != null && price >= 0
  const dirty = price !== plan.price_cents || feeNum !== plan.fee_percent
  return (
    <section className="card">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (priceOk && feeOk && dirty) setConfirming(true)
        }}
      >
        <h2>Plano {plan.name}</h2>
        <Field label="Mensalidade" error={priceOk ? undefined : 'Informe o preço.'}>
          <MoneyInput value={price} onChange={setPrice} required />
        </Field>
        <Field label="Taxa sobre vendas online (%)" hint="Cobrada nos pedidos pagos online. 0 = sem taxa." error={feeOk ? undefined : 'Use um número de 0 a 20.'}>
          <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} required />
        </Field>
        <button className="btn" disabled={!dirty || !priceOk || !feeOk}>
          Salvar
        </button>
      </form>
      {confirming && (
        <Confirm
          title={`Mudar o plano ${plan.name}`}
          confirmLabel="Salvar mudança"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await db.rpc('admin_update_plan', { id: plan.id, price_cents: price!, fee_percent: feeNum })
            toast('Plano atualizado')
            onSaved()
          }}
        >
          <p>A mudança vale para todas as lojas do plano {plan.name}:</p>
          <ul className="changes">
            {price !== plan.price_cents && (
              <li>
                Mensalidade: {brl(plan.price_cents)} → <b>{brl(price!)}</b>
              </li>
            )}
            {feeNum !== plan.fee_percent && (
              <li>
                Taxa: {String(plan.fee_percent).replace('.', ',')}% → <b>{fee}%</b>
              </li>
            )}
          </ul>
          <p className="hint">Avise os lojistas antes de aumentar o preço (em Avisos).</p>
        </Confirm>
      )}
    </section>
  )
}

const PAGE = 100

export function AuditPage() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [audit, rows, plans] = await Promise.all([db.rpc('admin_audit_list', { store_id: null }), loadStores(), loadPlans()])
    return { audit, names: new Map(rows.map((r) => [r.store.id, r.store.name])), plans }
  }, [])
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)

  const term = q.trim().toLowerCase()
  const list = data
    ? data.audit.filter(
        (a) =>
          !term ||
          a.action.toLowerCase().includes(term) ||
          a.admin_email.toLowerCase().includes(term) ||
          (data.names.get(a.store_id) ?? '').toLowerCase().includes(term),
      )
    : []

  return (
    <>
      <PageHead title="Registro de ações" sub="Tudo o que a equipe fez nas lojas, do mais recente para o mais antigo" />
      <div className="filters">
        <label className="field grow">
          <span className="sr-only">Buscar no registro</span>
          <input type="search" placeholder="Buscar por loja, ação ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="card">
          <Empty title={term ? 'Nada encontrado' : 'Nenhuma ação registrada ainda'} text={term ? 'Tente outra busca.' : 'As mudanças feitas nas lojas aparecem aqui.'} />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Loja</th>
                  <th>Ação</th>
                  <th>Feita por</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{fmtDateTime(a.created_at)}</td>
                    <td>
                      {data.names.has(a.store_id) ? <Link to={`/admin/lojas/${a.store_id}`}>{data.names.get(a.store_id)}</Link> : <span className="muted">Loja apagada</span>}
                    </td>
                    <td>{prettyAction(a.action, data.plans)}</td>
                    <td className="muted">{a.admin_email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row between list-foot">
            <span className="muted small">
              Mostrando {Math.min(shown, list.length)} de {plural(list.length, 'ação', 'ações')}
            </span>
            {shown < list.length && (
              <button className="btn ghost small" onClick={() => setShown((n) => n + PAGE)}>
                Mostrar mais
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}
