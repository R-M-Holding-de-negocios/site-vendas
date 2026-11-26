import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../lib/api'
import { downloadFile, toCsv } from '../lib/csv'
import { STATUS_LABEL } from '../lib/orders'
import { can } from '../lib/plans'
import { PAY_LABEL } from '../lib/pricing'
import type { Order, OrderStatus } from '../lib/types'
import { brl, fmtDateTime, formatPhone, moneyInput } from '../lib/util'
import { Badge, Empty, ErrorBox, Loading, PageHead, Upsell, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

export const STATUS_TONE: Record<OrderStatus, '' | 'ok' | 'warn' | 'bad' | 'info'> = {
  pending: 'warn',
  paid: 'info',
  preparing: 'info',
  ready: 'ok',
  shipped: 'ok',
  delivered: '',
  cancelled: 'bad',
  refunded: 'bad',
}

const TABS: { id: string; label: string; statuses: OrderStatus[] }[] = [
  { id: 'open', label: 'Em aberto', statuses: ['pending', 'paid', 'preparing', 'ready', 'shipped'] },
  { id: 'pending', label: 'Aguardando pagamento', statuses: ['pending'] },
  { id: 'todo', label: 'A preparar', statuses: ['paid', 'preparing'] },
  { id: 'sent', label: 'Enviados e prontos', statuses: ['ready', 'shipped'] },
  { id: 'done', label: 'Entregues', statuses: ['delivered'] },
  { id: 'closed', label: 'Cancelados', statuses: ['cancelled', 'refunded'] },
  { id: 'all', label: 'Todos', statuses: [] },
]

export default function Orders() {
  const { store } = usePanel()
  const nav = useNavigate()
  const data = useAsync(() => (can(store, 'saved_orders') ? db.list('orders', { eq: { store_id: store.id }, order: ['created_at', 'desc'] }) : Promise.resolve([] as Order[])), [store.id])
  const [tab, setTab] = useState('open')
  const [q, setQ] = useState('')
  const [pay, setPay] = useState('')
  const [from, setFrom] = useState('')
  const orders = data.data ?? []
  const list = useMemo(() => {
    const t = TABS.find((x) => x.id === tab)!
    const term = q.toLowerCase().replace(/^#/, '')
    return orders.filter(
      (o) =>
        (!t.statuses.length || t.statuses.includes(o.status)) &&
        (!term || `${o.number} ${o.customer.name} ${o.customer.phone}`.toLowerCase().includes(term)) &&
        (!pay || o.payment.method === pay) &&
        (!from || o.created_at >= from),
    )
  }, [orders, tab, q, pay, from])

  if (!can(store, 'saved_orders'))
    return (
      <div>
        <PageHead title="Pedidos" />
        <Upsell feature="saved_orders">No plano Vitrine os pedidos vão direto para o seu WhatsApp. No plano Loja eles ficam guardados aqui, com situação, pagamento e entrega.</Upsell>
      </div>
    )

  function exportCsv() {
    downloadFile(
      `pedidos-${store.slug}.csv`,
      toCsv([
        ['Número', 'Data', 'Situação', 'Cliente', 'Telefone', 'Itens', 'Subtotal', 'Descontos', 'Entrega', 'Total', 'Pagamento', 'Cupom'],
        ...list.map((o) => [o.number, fmtDateTime(o.created_at), STATUS_LABEL[o.status], o.customer.name, o.customer.phone, o.items.map((i) => `${i.qty}x ${i.name}${i.variant_label ? ` (${i.variant_label})` : ''}`).join(' | '), moneyInput(o.subtotal_cents), moneyInput(o.discount_cents), moneyInput(o.shipping_cents), moneyInput(o.total_cents), PAY_LABEL[o.payment.method], o.coupon_code]),
      ]),
    )
  }

  return (
    <div>
      <PageHead
        title="Pedidos"
        actions={
          <>
            <button className="btn ghost small" onClick={exportCsv}>Exportar</button>
            <Link className="btn" to="/painel/pedidos/novo">+ Registrar venda</Link>
          </>
        }
      />
      <div className="status-pills" role="tablist" style={{ marginBottom: 12 }}>
        {TABS.map((t) => {
          const n = t.statuses.length ? orders.filter((o) => t.statuses.includes(o.status)).length : orders.length
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`chip ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label} ({n})
            </button>
          )
        })}
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Número, nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar pedidos" />
        <select value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Forma de pagamento">
          <option value="">Qualquer pagamento</option>
          {Object.entries(PAY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label className="row small">
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
        </label>
      </div>
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      {!data.data ? (
        <Loading />
      ) : !list.length ? (
        <Empty title="Nenhum pedido aqui" text={orders.length ? 'Tente outro filtro.' : 'Quando alguém comprar na sua loja, o pedido aparece aqui.'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Situação</th>
                <th>Entrega</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 300).map((o) => (
                <tr key={o.id} className="click" onClick={() => nav(`/painel/pedidos/${o.id}`)}>
                  <td>
                    <Link to={`/painel/pedidos/${o.id}`} onClick={(e) => e.stopPropagation()}>
                      <b>#{o.number}</b>
                    </Link>
                    <span className="block small muted">{fmtDateTime(o.created_at)}</span>
                  </td>
                  <td>
                    {o.customer.name}
                    <span className="block small muted">{formatPhone(o.customer.phone)}</span>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                    {o.manual && <span className="block small muted">registrado no painel</span>}
                  </td>
                  <td className="small">{o.shipping.label}</td>
                  <td className="num">
                    <b>{brl(o.total_cents)}</b>
                    <span className="block small muted">{PAY_LABEL[o.payment.method].split(' ')[0]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
