import { useMemo, useState } from 'react'
import { Link, Route, Routes, useParams } from 'react-router-dom'
import { db } from '../lib/api'
import { downloadFile, toCsv } from '../lib/csv'
import { STATUS_LABEL } from '../lib/orders'
import { can } from '../lib/plans'
import type { Customer, Order } from '../lib/types'
import { brl, fmtDate, formatPhone, moneyInput, waLink } from '../lib/util'
import { Badge, Empty, ErrorBox, Field, Loading, PageHead, toast, Upsell, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

interface Row {
  c: Customer
  orders: Order[]
  total: number
  last: string | null
}

function useCustomers(storeId: string) {
  return useAsync(async () => {
    const [customers, orders] = await Promise.all([db.list('customers', { eq: { store_id: storeId } }), db.list('orders', { eq: { store_id: storeId } })])
    const valid = orders.filter((o) => o.paid_at && o.status !== 'cancelled' && o.status !== 'refunded')
    return customers.map<Row>((c) => {
      const mine = valid.filter((o) => o.customer_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at))
      return { c, orders: mine, total: mine.reduce((a, o) => a + o.total_cents, 0), last: mine[0]?.created_at ?? null }
    })
  }, [storeId])
}

function List() {
  const { store } = usePanel()
  const data = useCustomers(store.id)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<'total' | 'last' | 'orders' | 'name'>('total')
  const rows = useMemo(() => {
    let r = (data.data ?? []).filter((x) => (!q || `${x.c.name} ${x.c.phone} ${x.c.email}`.toLowerCase().includes(q.toLowerCase())) && (!tag || x.c.tags.includes(tag)))
    r = [...r].sort((a, b) => (sort === 'name' ? a.c.name.localeCompare(b.c.name) : sort === 'last' ? (b.last ?? '').localeCompare(a.last ?? '') : sort === 'orders' ? b.orders.length - a.orders.length : b.total - a.total))
    return r
  }, [data.data, q, tag, sort])
  const tags = [...new Set((data.data ?? []).flatMap((x) => x.c.tags))]
  return (
    <div>
      <PageHead
        title="Clientes"
        sub={data.data && `${data.data.length} clientes`}
        actions={
          <button
            className="btn ghost small"
            onClick={() =>
              downloadFile(`clientes-${store.slug}.csv`, toCsv([['Nome', 'Telefone', 'E-mail', 'Pedidos', 'Total gasto', 'Última compra', 'Grupos'], ...rows.map((x) => [x.c.name, formatPhone(x.c.phone), x.c.email, x.orders.length, moneyInput(x.total), fmtDate(x.last), x.c.tags.join('|')])]))
            }
          >
            Exportar
          </button>
        }
      />
      <div className="toolbar">
        <input type="search" placeholder="Nome, telefone ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar clientes" />
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Grupo">
          <option value="">Todos os grupos</option>
          {tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar">
          <option value="total">Quem mais gastou</option>
          <option value="orders">Mais pedidos</option>
          <option value="last">Compra mais recente</option>
          <option value="name">Nome</option>
        </select>
      </div>
      {data.error && <ErrorBox message={data.error} />}
      {!data.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="Nenhum cliente ainda" text="Cada pessoa que compra na loja entra aqui automaticamente." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="num">Pedidos</th>
                <th className="num">Total gasto</th>
                <th>Última compra</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.c.id}>
                  <td>
                    <Link to={x.c.id}><b>{x.c.name}</b></Link> {x.c.tags.map((t) => <Badge key={t} tone="info">{t}</Badge>)}
                    <span className="block small muted">{formatPhone(x.c.phone)}</span>
                  </td>
                  <td className="num">{x.orders.length}</td>
                  <td className="num">{brl(x.total)}</td>
                  <td>{fmtDate(x.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Detail() {
  const { id } = useParams()
  const { store } = usePanel()
  const data = useCustomers(store.id)
  const row = data.data?.find((x) => x.c.id === id)
  const [notes, setNotes] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  if (!data.data) return <Loading />
  if (!row) return <ErrorBox message="Cliente não encontrado." />
  const c = row.c
  const save = async (patch: Partial<Customer>) => {
    await db.update('customers', c.id, patch)
    toast('Salvo')
    data.reload()
  }
  return (
    <div className="stack">
      <PageHead back="/painel/clientes" title={c.name} sub={`Cliente desde ${fmtDate(c.created_at)}`} actions={<a className="btn wa" href={waLink(c.phone, `Olá, ${c.name.split(' ')[0]}!`)} target="_blank" rel="noreferrer">WhatsApp</a>} />
      <div className="stats">
        <div className="stat"><span className="stat-label">Pedidos</span><b className="stat-value">{row.orders.length}</b></div>
        <div className="stat"><span className="stat-label">Total gasto</span><b className="stat-value">{brl(row.total)}</b></div>
        <div className="stat"><span className="stat-label">Ticket médio</span><b className="stat-value">{brl(row.orders.length ? Math.round(row.total / row.orders.length) : 0)}</b></div>
        <div className="stat"><span className="stat-label">Última compra</span><b className="stat-value" style={{ fontSize: '1.1rem' }}>{fmtDate(row.last)}</b></div>
      </div>
      <div className="split">
        <section className="card">
          <h2>Pedidos</h2>
          <div className="list" style={{ marginTop: 10 }}>
            {row.orders.map((o) => (
              <Link key={o.id} to={`/painel/pedidos/${o.id}`} className="list-row">
                <b>#{o.number}</b>
                <span className="grow small muted">{fmtDate(o.created_at)} · {o.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</span>
                <Badge>{STATUS_LABEL[o.status]}</Badge>
                <b className="num">{brl(o.total_cents)}</b>
              </Link>
            ))}
            {!row.orders.length && <Empty title="Sem pedidos pagos" />}
          </div>
        </section>
        <section className="card stack">
          <dl className="kv">
            <dt>WhatsApp</dt><dd>{formatPhone(c.phone)}</dd>
            {c.email && <><dt>E-mail</dt><dd>{c.email}</dd></>}
          </dl>
          <div className="stack tight">
            <b>Grupos</b>
            <div className="chips">
              {c.tags.map((t) => (
                <button key={t} className="chip on" onClick={() => save({ tags: c.tags.filter((x) => x !== t) })} aria-label={`Remover do grupo ${t}`}>{t} ✕</button>
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (newTag.trim()) save({ tags: [...new Set([...c.tags, newTag.trim()])] }).then(() => setNewTag('')) }}>
              <input className="grow" placeholder="Ex.: VIP, Atacado" value={newTag} onChange={(e) => setNewTag(e.target.value)} style={{ width: 'auto' }} aria-label="Novo grupo" />
              <button className="btn ghost small">Adicionar</button>
            </form>
          </div>
          <Field label="Anotações">
            <textarea rows={4} value={notes ?? c.notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {notes != null && <button className="btn ghost small" onClick={() => save({ notes }).then(() => setNotes(null))}>Salvar anotações</button>}
        </section>
      </div>
    </div>
  )
}

export default function Customers() {
  const { store } = usePanel()
  if (!can(store, 'customers'))
    return (
      <div>
        <PageHead title="Clientes" />
        <Upsell feature="customers">Lista de clientes com histórico de compras, grupos e anotações no plano Pro.</Upsell>
      </div>
    )
  return (
    <Routes>
      <Route index element={<List />} />
      <Route path=":id" element={<Detail />} />
    </Routes>
  )
}
