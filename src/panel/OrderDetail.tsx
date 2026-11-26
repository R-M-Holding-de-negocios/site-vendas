import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { db, storeUrl } from '../lib/api'
import { STATUS_LABEL } from '../lib/orders'
import { PAY_LABEL } from '../lib/pricing'
import type { Order, OrderStatus } from '../lib/types'
import { brl, fmtDateTime, formatAddress, formatPhone, waLink } from '../lib/util'
import { Badge, ErrorBox, Field, Loading, PageHead, toast, useAsync } from '../ui/kit'
import { STATUS_TONE } from './Orders'
import { usePanel } from './PanelApp'

/** Próximo passo natural de cada situação. */
function nextSteps(o: Order): { status: OrderStatus; label: string }[] {
  const ship = o.shipping.method === 'pickup' ? { status: 'ready' as const, label: 'Pronto para retirada' } : { status: 'shipped' as const, label: 'Marcar como enviado' }
  switch (o.status) {
    case 'pending':
      return [{ status: 'paid', label: 'Confirmar pagamento' }]
    case 'paid':
      return [{ status: 'preparing', label: 'Começar a preparar' }, ship]
    case 'preparing':
      return [ship]
    case 'ready':
    case 'shipped':
      return [{ status: 'delivered', label: 'Marcar como entregue' }]
    default:
      return []
  }
}

function message(o: Order, storeName: string, slug: string) {
  const link = storeUrl(slug, `/pedido/${o.id}?t=${o.token}`)
  const first = o.customer.name.split(' ')[0]
  switch (o.status) {
    case 'pending':
      return `Olá, ${first}! Recebemos seu pedido #${o.number} na ${storeName} (${brl(o.total_cents)}). Assim que o pagamento for confirmado, começamos a preparar. Acompanhe: ${link}`
    case 'paid':
    case 'preparing':
      return `Olá, ${first}! O pagamento do pedido #${o.number} foi confirmado e já estamos preparando tudo. Acompanhe: ${link}`
    case 'ready':
      return `Olá, ${first}! Seu pedido #${o.number} está pronto para retirada. Te esperamos! ${link}`
    case 'shipped':
      return `Olá, ${first}! Seu pedido #${o.number} saiu para entrega.${o.tracking_code ? ` Código de rastreio: ${o.tracking_code}.` : ''} Acompanhe: ${link}`
    case 'delivered':
      return `Olá, ${first}! Esperamos que tenha gostado do pedido #${o.number}. Se puder, conte o que achou: ${link}`
    default:
      return `Olá, ${first}! Sobre o seu pedido #${o.number} na ${storeName}.`
  }
}

export default function OrderDetail() {
  const { id = '' } = useParams()
  const { store } = usePanel()
  const data = useAsync(() => db.get('orders', id), [id])
  const [note, setNote] = useState<string | null>(null)
  const [tracking, setTracking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const o = data.data
  if (data.error) return <ErrorBox message={data.error} />
  if (o === undefined) return <Loading />
  if (!o) return <ErrorBox message="Pedido não encontrado." />

  async function setStatus(status: OrderStatus, msg = '') {
    if ((status === 'cancelled' || status === 'refunded') && !confirm(status === 'cancelled' ? 'Cancelar este pedido? O estoque volta.' : 'Marcar como devolvido? Faça a devolução do dinheiro pelo meio de pagamento.')) return
    setBusy(true)
    try {
      data.setData(await db.rpc('set_order_status', { order_id: o!.id, status, note: msg }))
      toast(`Pedido ${STATUS_LABEL[status].toLowerCase()}`)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function saveField(patch: Partial<Order>) {
    data.setData(await db.update('orders', o!.id, patch))
    toast('Salvo')
  }

  const steps = nextSteps(o)
  const closed = o.status === 'cancelled' || o.status === 'refunded'
  return (
    <div className="stack">
      <PageHead
        back="/painel/pedidos"
        title={
          <>
            Pedido #{o.number} <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
          </>
        }
        sub={`${fmtDateTime(o.created_at)}${o.manual ? ' · registrado no painel' : ''}`}
        actions={<button className="btn ghost small no-print" onClick={() => print()}>Imprimir</button>}
      />
      <div className="split">
        <div className="stack">
          {!closed && steps.length > 0 && (
            <section className="card no-print">
              <div className="order-actions">
                {steps.map((s) => (
                  <button key={s.status} className="btn" disabled={busy} onClick={() => setStatus(s.status)}>
                    {s.label}
                  </button>
                ))}
                <a className="btn wa" href={waLink(o.customer.phone, message(o, store.name, store.slug))} target="_blank" rel="noreferrer">
                  Avisar cliente no WhatsApp
                </a>
              </div>
              {o.status === 'pending' && o.payment.method === 'pix' && <p className="muted small" style={{ marginTop: 10 }}>Confira o Pix de {brl(o.total_cents)} no app do seu banco antes de confirmar.</p>}
            </section>
          )}
          <section className="card">
            <h2>Itens</h2>
            <div className="list" style={{ marginTop: 12 }}>
              {o.items.map((i) => (
                <div key={i.product_id + i.variant_id} className="list-row">
                  {i.image ? <img className="pic" src={i.image} alt="" /> : <div className="pic" />}
                  <div className="grow">
                    <b className="block">
                      {i.qty}x {i.name}
                    </b>
                    {i.variant_label && <span className="small muted">{i.variant_label}</span>}
                  </div>
                  <span className="num">
                    {brl(i.unit_price_cents * i.qty)}
                    {i.unit_price_cents !== i.list_price_cents && <span className="block small muted">{brl(i.unit_price_cents)} cada</span>}
                  </span>
                </div>
              ))}
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Subtotal</dt>
              <dd className="num">{brl(o.subtotal_cents)}</dd>
              {o.discount_cents > 0 && (
                <>
                  <dt>Descontos{o.coupon_code && ` (cupom ${o.coupon_code})`}</dt>
                  <dd className="num">−{brl(o.discount_cents)}</dd>
                </>
              )}
              <dt>Entrega</dt>
              <dd className="num">{o.shipping.method === 'arrange' ? 'A combinar' : brl(o.shipping_cents)}</dd>
              <dt><b>Total</b></dt>
              <dd className="num"><b>{brl(o.total_cents)}</b></dd>
              {o.platform_fee_cents > 0 && (
                <>
                  <dt>Taxa da plataforma</dt>
                  <dd className="num">{brl(o.platform_fee_cents)}</dd>
                </>
              )}
            </dl>
            {o.notes && <p className="alert" style={{ marginTop: 12 }}>Observação do cliente: {o.notes}</p>}
          </section>
          <section className="card">
            <h2>Histórico</h2>
            <ul className="timeline" style={{ marginTop: 12 }}>
              {[...o.history].reverse().map((h, i) => (
                <li key={i}>
                  <b>{STATUS_LABEL[h.status]}</b> <span className="small muted">{fmtDateTime(h.at)}</span>
                  {h.note && <span className="block small">{h.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <h2>Cliente</h2>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Nome</dt>
              <dd>{o.customer.name}</dd>
              <dt>WhatsApp</dt>
              <dd>
                <a href={waLink(o.customer.phone, `Olá, ${o.customer.name.split(' ')[0]}!`)} target="_blank" rel="noreferrer">{formatPhone(o.customer.phone)}</a>
              </dd>
              {o.customer.email && (
                <>
                  <dt>E-mail</dt>
                  <dd>{o.customer.email}</dd>
                </>
              )}
            </dl>
          </section>
          <section className="card">
            <h2>Entrega e pagamento</h2>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Entrega</dt>
              <dd>{o.shipping.label}</dd>
              {o.shipping.address && (
                <>
                  <dt>Endereço</dt>
                  <dd>
                    {formatAddress(o.shipping.address)}
                    {o.shipping.address.cep && ` · CEP ${o.shipping.address.cep}`}
                  </dd>
                </>
              )}
              <dt>Pagamento</dt>
              <dd>
                {PAY_LABEL[o.payment.method]} · {o.payment.status === 'paid' ? 'pago' : o.payment.status === 'refunded' ? 'devolvido' : 'pendente'}
              </dd>
              {o.payment.change_for_cents > 0 && (
                <>
                  <dt>Troco para</dt>
                  <dd>{brl(o.payment.change_for_cents)} (levar {brl(o.payment.change_for_cents - o.total_cents)})</dd>
                </>
              )}
              {o.source && (
                <>
                  <dt>Origem</dt>
                  <dd>
                    {o.source.source}
                    {o.source.campaign && ` · ${o.source.campaign}`} · {o.source.device === 'mobile' ? 'celular' : 'computador'}
                  </dd>
                </>
              )}
            </dl>
            {o.shipping.method !== 'pickup' && (
              <Field label="Código de rastreio" className="no-print">
                <div className="row">
                  <input className="grow" value={tracking ?? o.tracking_code} onChange={(e) => setTracking(e.target.value)} style={{ width: 'auto' }} />
                  <button className="btn ghost small" disabled={tracking == null} onClick={() => saveField({ tracking_code: (tracking ?? '').trim() }).then(() => setTracking(null))}>Salvar</button>
                </div>
              </Field>
            )}
          </section>
          <section className="card no-print">
            <Field label="Anotações internas" hint="Só a equipe da loja vê.">
              <textarea value={note ?? o.internal_notes} onChange={(e) => setNote(e.target.value)} rows={3} />
            </Field>
            {note != null && (
              <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => saveField({ internal_notes: note }).then(() => setNote(null))}>
                Salvar anotação
              </button>
            )}
          </section>
          {!closed && (
            <section className="card no-print row">
              <button className="btn danger small" disabled={busy} onClick={() => setStatus('cancelled', prompt('Motivo do cancelamento (opcional)') ?? '')}>Cancelar pedido</button>
              {o.paid_at && <button className="btn danger small" disabled={busy} onClick={() => setStatus('refunded', prompt('Motivo da devolução (opcional)') ?? '')}>Devolver dinheiro</button>}
            </section>
          )}
          {o.payment.method === 'mercadopago' && o.status === 'refunded' && <p className="muted small">Devolução pelo Mercado Pago: faça pelo app ou site do Mercado Pago, na venda correspondente.</p>}
        </div>
      </div>
    </div>
  )
}
