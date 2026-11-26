import { Link } from 'react-router-dom'
import { db } from '../lib/api'
import { brl, fmtDate, plural } from '../lib/util'
import { Empty, ErrorBox, Loading, PageHead, Stat, useAsync } from '../ui/kit'
import { businessNumbers, dueDate, situationInfo } from './logic'
import { loadPlans, loadStores } from './shared'
import { Badge } from '../ui/kit'

export function HomePage() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [rows, plans, audit] = await Promise.all([loadStores(), loadPlans(), db.rpc('admin_audit_list', { store_id: null })])
    return { n: businessNumbers(rows, plans, audit), total: rows.length }
  }, [])

  return (
    <>
      <PageHead title="Números do negócio" sub={new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} />
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : (
        <div className="stack">
          <div className="stats">
            <Stat label="Receita mensal" value={brl(data.n.revenue_cents)} hint="Mensalidades das lojas em dia" />
            <Stat label="Lojas ativas" value={data.n.active} />
            <Stat label="Em teste" value={data.n.trial} />
            <Stat label="Novas no mês" value={data.n.newThisMonth} />
            <Stat label="Encerradas no mês" value={data.n.closedThisMonth} />
          </div>

          <div className="split">
            <section className="card">
              <div className="card-head">
                <h2>Precisa de atenção</h2>
                {data.n.attention.length > 0 && <Badge tone="bad">{data.n.attention.length}</Badge>}
              </div>
              {data.n.attention.length === 0 ? (
                <Empty title="Tudo em ordem" text="Nenhuma loja atrasada, com teste vencido ou suspensa." />
              ) : (
                <ul className="attention">
                  {data.n.attention.slice(0, 8).map(({ row, situation }) => {
                    const info = situationInfo(situation)
                    return (
                      <li key={row.store.id}>
                        <Link to={`/admin/lojas/${row.store.id}`} className="list-row">
                          <span className="grow">
                            <b className="block">{row.store.name}</b>
                            <span className="hint">
                              {situation === 'suspended' ? row.email : `${situation === 'trial_expired' ? 'Teste terminou' : 'Venceu'} em ${fmtDate(dueDate(row.store))}`}
                            </span>
                          </span>
                          <Badge tone={info.tone}>{info.label}</Badge>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
              {data.n.attention.length > 8 && (
                <p className="small">
                  <Link to="/admin/lojas">Ver todas as lojas</Link>
                </p>
              )}
            </section>

            <section className="card">
              <h2>Lojas por plano</h2>
              <ul className="plan-bars">
                {data.n.perPlan.map((p) => {
                  const total = data.n.perPlan.reduce((a, x) => a + x.count, 0) || 1
                  return (
                    <li key={p.plan}>
                      <div className="row between">
                        <Link to={`/admin/lojas?plano=${p.plan}`}>{p.name}</Link>
                        <span className="muted small">{plural(p.count, 'loja', 'lojas')}</span>
                      </div>
                      <div className="progress" aria-hidden>
                        <span style={{ width: `${(p.count / total) * 100}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="hint">Sem contar as encerradas. Total cadastrado: {plural(data.total, 'loja', 'lojas')}.</p>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
