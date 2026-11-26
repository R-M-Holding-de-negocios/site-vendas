import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { PLAN_ORDER } from '../lib/plans'
import type { PlanId } from '../lib/types'
import { fmtDate, fmtDateTime, plural } from '../lib/util'
import { Empty, ErrorBox, Loading, PageHead, useAsync } from '../ui/kit'
import { dueDate, filterStores, planLabel, SITUATIONS, type Situation } from './logic'
import { loadPlans, loadStores, SituationBadge } from './shared'

export function StoresPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') ?? ''
  const plan = (params.get('plano') ?? '') as PlanId | ''
  const sit = (params.get('situacao') ?? '') as Situation | ''
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const { data, error, loading, reload } = useAsync(() => Promise.all([loadStores(), loadPlans()]), [])
  const rows = data ? filterStores(data[0], { q, plan, situation: sit }) : []
  const filtered = !!(q || plan || sit)

  return (
    <>
      <PageHead title="Lojas" sub={data ? plural(data[0].length, 'loja cadastrada', 'lojas cadastradas') : undefined} />
      <div className="filters">
        <label className="field grow">
          <span className="sr-only">Buscar</span>
          <input type="search" placeholder="Buscar por nome, endereço ou e-mail" value={q} onChange={(e) => set('q', e.target.value)} />
        </label>
        <label className="field">
          <span className="sr-only">Plano</span>
          <select value={plan} onChange={(e) => set('plano', e.target.value)}>
            <option value="">Todos os planos</option>
            {PLAN_ORDER.map((p) => (
              <option key={p} value={p}>
                Plano {data ? planLabel(data[1], p) : p}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">Situação</span>
          <select value={sit} onChange={(e) => set('situacao', e.target.value)}>
            <option value="">Todas as situações</option>
            {SITUATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty
            title={filtered ? 'Nenhuma loja encontrada' : 'Nenhuma loja cadastrada ainda'}
            text={filtered ? 'Tente outra busca ou limpe os filtros.' : 'As lojas aparecem aqui assim que alguém cria uma conta.'}
            action={
              filtered && (
                <button className="btn ghost small" onClick={() => setParams({}, { replace: true })}>
                  Limpar filtros
                </button>
              )
            }
          />
        </div>
      ) : (
        <>
          {filtered && <p className="muted small results-count">{plural(rows.length, 'loja encontrada', 'lojas encontradas')}</p>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Plano</th>
                  <th>Situação</th>
                  <th>Criada em</th>
                  <th>Último acesso</th>
                  <th className="num">Produtos</th>
                  <th className="num">Pedidos 30 dias</th>
                  <th>Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.store.id} className="click" onClick={() => navigate(`/admin/lojas/${r.store.id}`)}>
                    <td>
                      <Link to={`/admin/lojas/${r.store.id}`} onClick={(e) => e.stopPropagation()}>
                        <b>{r.store.name}</b>
                      </Link>
                      <span className="hint block">{r.email}</span>
                    </td>
                    <td>{planLabel(data[1], r.store.plan)}</td>
                    <td>
                      <SituationBadge store={r.store} />
                    </td>
                    <td className="nowrap">{fmtDate(r.store.created_at)}</td>
                    <td className="nowrap">{fmtDateTime(r.last_sign_in_at)}</td>
                    <td className="num">{r.product_count}</td>
                    <td className="num">{r.orders_30d}</td>
                    <td className="nowrap">
                      {fmtDate(dueDate(r.store))}
                      {r.store.status === 'trial' && <span className="hint block">fim do teste</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
