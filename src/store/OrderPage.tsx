import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../lib/api'
import { startMercadoPagoCheckout } from '../lib/mercadopago'
import { STATUS_LABEL } from '../lib/orders'
import { pixPayload } from '../lib/pix'
import { can } from '../lib/plans'
import { PAY_LABEL } from '../lib/pricing'
import type { Order, OrderStatus } from '../lib/types'
import { brl, fmtDateTime, formatAddress, waLink } from '../lib/util'
import { CopyButton, QrImage } from '../ui/kit'
import { useStore } from './context'
import { useSeo } from './pages'


function Review({ order, token }: { order: Order; token: string }) {
  const [rating, setRating] = useState<Record<string, number>>({})
  const [text, setText] = useState<Record<string, string>>({})
  const [done, setDone] = useState<Record<string, string>>({})
  return (
    <section className="step">
      <h2>Avalie sua compra</h2>
      {order.items.map((i) => (
        <div key={i.product_id} style={{ display: 'grid', gap: 8 }}>
          <b>{i.name}</b>
          {done[i.product_id] ? (
            <p className={done[i.product_id].startsWith('Obrigado') ? 'ok-text' : 'err-text'}>{done[i.product_id]}</p>
          ) : (
            <>
              <div className="opt-values" role="radiogroup" aria-label={`Nota para ${i.name}`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-pressed={rating[i.product_id] === n} onClick={() => setRating({ ...rating, [i.product_id]: n })}>
                    {n} ★
                  </button>
                ))}
              </div>
              <textarea placeholder="Conte o que achou (opcional)" value={text[i.product_id] ?? ''} onChange={(e) => setText({ ...text, [i.product_id]: e.target.value })} aria-label="Comentário" />
              <button
                className="sbtn small"
                style={{ justifySelf: 'start' }}
                disabled={!rating[i.product_id]}
                onClick={() =>
                  db
                    .rpc('submit_review', { order_id: order.id, token, product_id: i.product_id, rating: rating[i.product_id], comment: text[i.product_id] ?? '', name: order.customer.name.split(' ')[0] })
                    .then(
                      () => setDone({ ...done, [i.product_id]: 'Obrigado! Sua avaliação aparece na loja depois de aprovada.' }),
                      (e: Error) => setDone({ ...done, [i.product_id]: e.message }),
                    )
                }
              >
                Enviar avaliação
              </button>
            </>
          )}
        </div>
      ))}
    </section>
  )
}

export default function OrderPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const { store, path } = useStore()
  const [order, setOrder] = useState<Order | null | undefined>(undefined)
  useSeo(`Seu pedido | ${store.name}`)
  useEffect(() => {
    db.rpc('get_public_order', { id, token }).then(setOrder, () => setOrder(null))
  }, [id, token])

  if (order === undefined) return <div className="page wrap">Carregando…</div>
  if (!order)
    return (
      <div className="page wrap empty-state">
        <h1>Pedido não encontrado</h1>
        <p className="muted">Confira se o link está completo.</p>
      </div>
    )

  const pix = store.settings.payments.pix
  const pending = order.status === 'pending'
  const pixCode =
    order.payment.method === 'pix' && pending && pix.key
      ? pixPayload({ key: pix.key, name: pix.holder || store.settings.legal.name || store.name, city: pix.city || 'Brasil', amountCents: order.total_cents, txid: `PED${order.number}` })
      : ''
  const flow: OrderStatus[] = ['pending', 'paid', 'preparing', order.shipping.method === 'pickup' ? 'ready' : 'shipped', 'delivered']
  const reached = (s: OrderStatus) => order.history.some((h) => h.status === s) || flow.indexOf(order.status) >= flow.indexOf(s)
  const closed = order.status === 'cancelled' || order.status === 'refunded'
  const msg = `Olá! Sobre o meu pedido #${order.number} na ${store.name}.`

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 760, display: 'grid', gap: 16 }}>
        {params.get('novo') && (
          <div className="step" style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem' }}>Pedido #{order.number} recebido!</h1>
            <p className="muted">Guarde este link para acompanhar seu pedido.</p>
          </div>
        )}
        {params.get('simulado') && (
          <p className="box note">Modo demonstração: o pagamento pelo Mercado Pago é simulado. Na loja real, o cliente paga no site do Mercado Pago e o pedido é confirmado sozinho.</p>
        )}
        {!params.get('novo') && <h1 style={{ fontSize: '1.5rem' }}>Pedido #{order.number}</h1>}

        {pixCode && (
          <section className="step pixbox">
            <h2>Pague com Pix: {brl(order.total_cents)}</h2>
            <QrImage text={pixCode} size={200} label="QR code do Pix" />
            <p className="note">Abra o app do seu banco, escolha Pix e leia o QR code ou use o código abaixo.</p>
            <code>{pixCode}</code>
            <CopyButton text={pixCode} label="Copiar código Pix" className="sbtn" />
            <a className="sbtn light" href={waLink(store.whatsapp, `${msg} Já fiz o Pix de ${brl(order.total_cents)}, segue o comprovante.`)} target="_blank" rel="noopener noreferrer">
              Enviar comprovante pelo WhatsApp
            </a>
          </section>
        )}
        {order.payment.method === 'mercadopago' && pending && !params.get('simulado') && (
          <section className="step">
            <p>O pagamento ainda não foi confirmado.</p>
            <button className="sbtn" onClick={() => startMercadoPagoCheckout(order.id, token, store.slug).then((u) => (/^https?:/.test(u) ? (location.href = u) : undefined))}>
              Pagar agora
            </button>
          </section>
        )}

        <section className="step">
          <h2>Situação</h2>
          {closed ? (
            <p className="warn-text">{STATUS_LABEL[order.status]}</p>
          ) : (
            <ol className="otimeline">
              {flow.map((s) => {
                const h = [...order.history].reverse().find((x) => x.status === s)
                return (
                  <li key={s} className={reached(s) ? 'done' : ''}>
                    <span>
                      <b>{STATUS_LABEL[s]}</b>
                      {h && <span className="note"> · {fmtDateTime(h.at)}</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
          {order.tracking_code && (
            <p>
              Código de rastreio: <b>{order.tracking_code}</b>{' '}
              <a href={`https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(order.tracking_code)}`} target="_blank" rel="noopener noreferrer">
                Rastrear
              </a>
            </p>
          )}
        </section>

        <section className="step">
          <h2>Resumo</h2>
          {order.items.map((i) => (
            <div key={i.product_id + i.variant_id} className="box-row">
              <span>
                {i.qty}x {i.name}
                {i.variant_label && <span className="note"> ({i.variant_label})</span>}
              </span>
              <span>{brl(i.unit_price_cents * i.qty)}</span>
            </div>
          ))}
          <div className="totals">
            <div className="box-row">
              <span>Subtotal</span>
              <span>{brl(order.subtotal_cents)}</span>
            </div>
            {order.discount_cents > 0 && (
              <div className="box-row ok-text">
                <span>Descontos</span>
                <span>−{brl(order.discount_cents)}</span>
              </div>
            )}
            <div className="box-row">
              <span>{order.shipping.label || 'Entrega'}</span>
              <span>{order.shipping.method === 'arrange' ? 'A combinar' : order.shipping_cents ? brl(order.shipping_cents) : 'Grátis'}</span>
            </div>
            <div className="box-row total">
              <span>Total</span>
              <span>{brl(order.total_cents)}</span>
            </div>
          </div>
          <p className="note">
            Pagamento: {PAY_LABEL[order.payment.method]}
            {order.payment.change_for_cents > 0 && ` · troco para ${brl(order.payment.change_for_cents)}`}
          </p>
          {order.shipping.address && (
            <p className="note">
              Entrega em: {formatAddress(order.shipping.address)}
            </p>
          )}
          {order.shipping.method === 'pickup' && store.settings.delivery.pickup.address && <p className="note">Retirada em: {store.settings.delivery.pickup.address}</p>}
        </section>

        {order.status === 'delivered' && can(store, 'reviews') && <Review order={order} token={token} />}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="sbtn wa" href={waLink(store.whatsapp, msg)} target="_blank" rel="noopener noreferrer">
            Falar com a loja
          </a>
          <Link className="sbtn light" to={path('')}>
            Continuar comprando
          </Link>
        </div>
      </div>
    </div>
  )
}
