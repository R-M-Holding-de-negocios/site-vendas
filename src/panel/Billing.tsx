import { db, PLATFORM_PIX, SUPPORT_WHATSAPP } from '../lib/api'
import { DEFAULT_PLANS, PLAN_SUMMARY, planName } from '../lib/plans'
import type { PlanRow } from '../lib/types'
import { brl, fmtDate, waLink } from '../lib/util'
import { Badge, CopyButton, Loading, PageHead, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

const STATUS: Record<string, [string, '' | 'ok' | 'warn' | 'bad' | 'info']> = {
  trial: ['Em teste grátis', 'info'],
  active: ['Em dia', 'ok'],
  overdue: ['Em atraso', 'warn'],
  suspended: ['Suspensa', 'bad'],
  closed: ['Encerrada', 'bad'],
}

export default function Billing() {
  const { store } = usePanel()
  const data = useAsync(
    () => Promise.all([db.list('invoices', { eq: { store_id: store.id }, order: ['paid_at', 'desc'] }), db.list('plans').then((p: PlanRow[]) => (p.length ? p : DEFAULT_PLANS))]),
    [store.id],
  )
  const plans = data.data?.[1] ?? DEFAULT_PLANS
  const current = plans.find((p) => p.id === store.plan)!
  // Rebaixada por falta de pagamento: o valor a pagar é o do plano que volta.
  const toPay = (store.plan_before_downgrade && plans.find((p) => p.id === store.plan_before_downgrade)) || current
  const [label, tone] = STATUS[store.status]
  const ask = (text: string) => (SUPPORT_WHATSAPP ? waLink(SUPPORT_WHATSAPP, text) : '')

  return (
    <div className="stack">
      <PageHead title="Plano e mensalidade" />
      <section className="card stack">
        <div className="card-head">
          <h2>
            Plano {planName(store.plan)} <Badge tone={tone}>{label}</Badge>
          </h2>
          <b>{brl(current.price_cents)}/mês</b>
        </div>
        <dl className="kv">
          {store.status === 'trial' && (
            <>
              <dt>Teste grátis até</dt>
              <dd>{fmtDate(store.trial_ends_at)}</dd>
            </>
          )}
          {store.plan_before_downgrade && (
            <>
              <dt>Plano anterior</dt>
              <dd>{planName(store.plan_before_downgrade)}: volta assim que o pagamento for registrado</dd>
            </>
          )}
          <dt>Pago até</dt>
          <dd>{fmtDate(store.paid_until)}</dd>
          <dt>Taxa por venda online</dt>
          <dd>{current.fee_percent ? `${String(current.fee_percent).replace('.', ',')}% (descontada automaticamente no Mercado Pago)` : 'Nenhuma'}</dd>
        </dl>
        <div className="alert">
          <span>
            Para pagar a mensalidade, faça um Pix de <b>{brl(toPay.price_cents)}</b>{toPay !== current && <> (plano {toPay.name})</>}
            {PLATFORM_PIX ? <> para a chave <b>{PLATFORM_PIX}</b></> : ' para a chave informada pelo suporte'} e envie o comprovante.
          </span>
          {PLATFORM_PIX && <CopyButton text={PLATFORM_PIX} label="Copiar chave" />}
          {SUPPORT_WHATSAPP && (
            <a className="btn wa small" href={ask(`Olá! Segue o comprovante da mensalidade da loja ${store.name} (${store.slug}).`)} target="_blank" rel="noreferrer">
              Enviar comprovante
            </a>
          )}
        </div>
      </section>

      <section className="stack tight">
        <h2>Planos</h2>
        <div className="plans">
          {plans.map((p) => (
            <div key={p.id} className={`plan ${p.id === store.plan ? 'featured' : ''}`}>
              <div className="row between">
                <h3>{p.name}</h3>
                {p.id === store.plan && <Badge tone="ok">Seu plano</Badge>}
              </div>
              <div className="price">
                {brl(p.price_cents)}
                <small>/mês</small>
              </div>
              <p className="muted small">{p.fee_percent ? `+ ${String(p.fee_percent).replace('.', ',')}% por venda paga online` : 'Sem taxa por venda'}</p>
              <ul>{PLAN_SUMMARY[p.id].map((f) => <li key={f}>{f}</li>)}</ul>
              {p.id !== store.plan && (
                SUPPORT_WHATSAPP ? (
                  <a className="btn ghost" href={ask(`Olá! Quero mudar a loja ${store.name} (${store.slug}) para o plano ${p.name}.`)} target="_blank" rel="noreferrer">
                    Mudar para {p.name}
                  </a>
                ) : (
                  <span className="muted small">Para mudar de plano, fale com o suporte.</span>
                )
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Pagamentos</h2>
        {!data.data ? (
          <Loading />
        ) : !data.data[0].length ? (
          <p className="muted" style={{ marginTop: 8 }}>Nenhum pagamento registrado ainda.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr><th>Data</th><th>Plano</th><th>Meses</th><th>Forma</th><th className="num">Valor</th></tr>
              </thead>
              <tbody>
                {data.data[0].map((i) => (
                  <tr key={i.id}><td>{fmtDate(i.paid_at)}</td><td>{planName(i.plan)}</td><td>{i.months}</td><td>{i.method}</td><td className="num">{brl(i.amount_cents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
