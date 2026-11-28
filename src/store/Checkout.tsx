import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { checkoutDraftId, db, forgetCheckoutDraft, rememberCheckoutDraft, sessionId, track, trafficSource } from '../lib/api'
import { openState } from '../lib/hours'
import { startMercadoPagoCheckout } from '../lib/mercadopago'
import { can } from '../lib/plans'
import { PAY_LABEL, paymentOptions, quote, shippingOptions } from '../lib/pricing'
import type { Address, Coupon, PayMethod, ShipMethod } from '../lib/types'
import { brl, onlyDigits, parseMoney } from '../lib/util'
import { useStore } from './context'
import { useSeo } from './pages'

const emptyAddress: Address = { cep: '', street: '', number: '', complement: '', district: '', city: '', state: '' }

function loadSaved<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') }
  } catch {
    return fallback
  }
}

export default function Checkout() {
  const { store, products, variants, cart, path, feePercent, preview } = useStore()
  const nav = useNavigate()
  useSeo(`Fechar pedido | ${store.name}`)
  const saved = loadSaved('vt_customer', { name: '', phone: '', email: '', address: emptyAddress })
  const [name, setName] = useState(saved.name)
  const [phone, setPhone] = useState(saved.phone)
  const [email, setEmail] = useState(saved.email)
  const ships = shippingOptions(store)
  const pays = paymentOptions(store)
  const [ship, setShip] = useState<ShipMethod | ''>(ships.length === 1 ? ships[0].method : '')
  const [zone, setZone] = useState('')
  const [addr, setAddr] = useState<Address>(saved.address)
  const [pay, setPay] = useState<PayMethod | ''>(pays.length === 1 ? pays[0] : '')
  const [change, setChange] = useState('')
  const [couponText, setCouponText] = useState('')
  const [coupon, setCoupon] = useState<Coupon | null>(null)
  const [couponMsg, setCouponMsg] = useState('')
  const [notes, setNotes] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cepBusy, setCepBusy] = useState(false)
  // Mesmo rascunho durante a visita: sair e voltar ao checkout não cria outro carrinho abandonado.
  const checkoutId = useRef<string | null>(checkoutDraftId(store.id))
  const open = openState(store.settings.hours)
  const blocked = !open.open && (store.settings.hours.paused || store.settings.hours.outside === 'block')

  const q = quote({
    store,
    lines: cart.lines,
    products,
    variants,
    shipping: ship ? { method: ship, zone } : null,
    payment: pay || null,
    coupon,
    feePercent,
    now: new Date(),
  })
  const needsAddress = ship === 'zone' || ship === 'fixed'

  useEffect(() => {
    if (!preview) track(store.id, 'checkout_start')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Guarda o carrinho com o contato para a recuperação de carrinho abandonado.
  const draftKey = useMemo(() => JSON.stringify([name, onlyDigits(phone), q.total_cents, cart.lines]), [name, phone, q.total_cents, cart.lines])
  useEffect(() => {
    if (preview || !can(store, 'abandoned_carts') || onlyDigits(phone).length < 10 || !q.items.length) return
    const t = setTimeout(() => {
      db.rpc('save_checkout', {
        id: checkoutId.current,
        store_id: store.id,
        session_id: sessionId(),
        customer: { name, phone: onlyDigits(phone) },
        items: q.items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, qty: i.qty, name: i.name, unit_price_cents: i.unit_price_cents })),
        total_cents: q.total_cents,
      })
        .then((r) => {
          checkoutId.current = r.id
          rememberCheckoutDraft(store.id, r.id)
        })
        .catch(() => undefined)
    }, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  async function lookupCep(cep: string) {
    const d = onlyDigits(cep)
    if (d.length !== 8) return
    setCepBusy(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const j = await r.json()
      if (!j.erro) setAddr((a) => ({ ...a, cep, street: j.logradouro || a.street, district: j.bairro || a.district, city: j.localidade || a.city, state: j.uf || a.state }))
    } catch {
      /* sem internet ou serviço fora: o cliente preenche à mão */
    } finally {
      setCepBusy(false)
    }
  }

  async function applyCoupon() {
    setCouponMsg('')
    if (!couponText.trim()) return setCoupon(null)
    const c = await db.rpc('check_coupon', { store_id: store.id, code: couponText }).catch(() => null)
    if (!c) {
      setCoupon(null)
      setCouponMsg('Cupom inválido.')
    } else setCoupon(c)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (preview) return
    if (!ship) return setError('Escolha como quer receber.')
    if (!pay) return setError('Escolha a forma de pagamento.')
    if (q.errors.length) return setError(q.errors[0])
    if (coupon && q.coupon_error) return setError(q.coupon_error)
    setBusy(true)
    try {
      localStorage.setItem('vt_customer', JSON.stringify({ name, phone, email, address: addr }))
    } catch {
      /* ignora */
    }
    try {
      const r = await db.rpc('place_order', {
        store_id: store.id,
        lines: cart.lines,
        customer: { name, phone, email },
        shipping: { method: ship, zone, address: needsAddress ? addr : null },
        payment: { method: pay, change_for_cents: pay === 'cash' ? Math.max(0, parseMoney(change) || 0) : 0 },
        coupon: coupon && !q.coupon_error ? coupon.code : '',
        notes,
        source: trafficSource(),
        checkout_id: checkoutId.current,
      })
      track(store.id, 'order_placed', { data: { value_cents: r.total_cents } })
      cart.clear()
      forgetCheckoutDraft(store.id)
      const orderPath = path(`/pedido/${r.id}?t=${r.token}&novo=1`)
      if (pay === 'mercadopago') {
        // O pedido já existe: se abrir o Mercado Pago falhar, o cliente vai para a página do
        // pedido, que tem o botão "Pagar com Mercado Pago" para tentar de novo.
        try {
          const url = await startMercadoPagoCheckout(r.id, r.token, store.slug)
          if (/^https?:/.test(url)) return void (location.href = url)
          return nav(url.replace(`/${store.slug}`, path('')))
        } catch {
          return nav(orderPath)
        }
      }
      nav(orderPath)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (!can(store, 'checkout'))
    return (
      <div className="page wrap empty-state">
        <p>Esta loja recebe pedidos pelo WhatsApp. Abra o carrinho para enviar o seu.</p>
        <Link className="sbtn" to={path('')}>
          Voltar para a loja
        </Link>
      </div>
    )
  if (!cart.lines.length)
    return (
      <div className="page wrap empty-state">
        <h1>Seu carrinho está vazio</h1>
        <Link className="sbtn" to={path('')}>
          Ver produtos
        </Link>
      </div>
    )

  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, [k]: e.target.value })

  return (
    <div className="page">
      <form className="wrap checkout" onSubmit={submit}>
        <div style={{ display: 'grid', gap: 16 }}>
          <h1 style={{ fontSize: '1.6rem' }}>Fechar pedido</h1>
          {blocked && <p className="warn-text">{open.message}</p>}
          <section className="step">
            <h2>
              <span className="n">1</span> Seus dados
            </h2>
            <div className="fgrid">
              <label className="flabel">
                Nome
                <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
              <label className="flabel">
                WhatsApp com DDD
                <input required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(11) 99999-9999" />
              </label>
            </div>
            <label className="flabel">
              E-mail (opcional, para receber o resumo)
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
          </section>

          <section className="step">
            <h2>
              <span className="n">2</span> Como você quer receber
            </h2>
            {ships.map((o) => (
              <label key={o.method} className="choice">
                <input type="radio" name="ship" checked={ship === o.method} onChange={() => setShip(o.method)} />
                <span className="c-main">
                  <b>{o.label}</b>
                  {o.method === 'pickup' && store.settings.delivery.pickup.address && <span className="note">{store.settings.delivery.pickup.address}</span>}
                  {o.method === 'pickup' && store.settings.delivery.pickup.instructions && <span className="note">{store.settings.delivery.pickup.instructions}</span>}
                  {o.method === 'arrange' && <span className="note">O valor da entrega é combinado depois, pelo WhatsApp.</span>}
                </span>
                <b>{o.method === 'pickup' ? 'Grátis' : o.method === 'fixed' ? (q.free_shipping && ship === 'fixed' ? 'Grátis' : brl(o.fee_cents ?? 0)) : o.method === 'zone' ? 'por bairro' : ''}</b>
              </label>
            ))}
            {ship === 'zone' && (
              <label className="flabel">
                Bairro de entrega
                <select required value={zone} onChange={(e) => { setZone(e.target.value); setAddr((a) => ({ ...a, district: a.district || e.target.value })) }}>
                  <option value="">Escolha o bairro</option>
                  {store.settings.delivery.zones.items.map((z) => (
                    <option key={z.name} value={z.name}>
                      {z.name} — {q.free_shipping ? 'grátis' : brl(z.fee_cents)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {needsAddress && (
              <div className="fgrid">
                <label className="flabel">
                  CEP {cepBusy && <span className="note">buscando…</span>}
                  <input inputMode="numeric" value={addr.cep} onChange={set('cep')} onBlur={(e) => lookupCep(e.target.value)} autoComplete="postal-code" />
                </label>
                <label className="flabel" style={{ gridColumn: 'span 2' }}>
                  Rua
                  <input required value={addr.street} onChange={set('street')} autoComplete="address-line1" />
                </label>
                <label className="flabel">
                  Número
                  <input required value={addr.number} onChange={set('number')} />
                </label>
                <label className="flabel">
                  Complemento
                  <input value={addr.complement} onChange={set('complement')} autoComplete="address-line2" />
                </label>
                <label className="flabel">
                  Bairro
                  <input value={addr.district} onChange={set('district')} />
                </label>
                <label className="flabel">
                  Cidade
                  <input value={addr.city} onChange={set('city')} autoComplete="address-level2" />
                </label>
              </div>
            )}
          </section>

          <section className="step">
            <h2>
              <span className="n">3</span> Pagamento
            </h2>
            {pays.map((m) => (
              <label key={m} className="choice">
                <input type="radio" name="pay" checked={pay === m} onChange={() => setPay(m)} />
                <span className="c-main">
                  <b>{PAY_LABEL[m]}</b>
                  {m === 'pix' && store.settings.payments.pix.discount_percent > 0 && <span className="ok-text">{store.settings.payments.pix.discount_percent}% de desconto</span>}
                  {m === 'pix' && <span className="note">Você recebe o código Pix na próxima tela.</span>}
                  {m === 'mercadopago' && <span className="note">Você será levado ao Mercado Pago para pagar com segurança.</span>}
                  {m === 'whatsapp' && <span className="note">A loja entra em contato para combinar o pagamento.</span>}
                </span>
              </label>
            ))}
            {pay === 'cash' && (
              <label className="flabel">
                Troco para quanto? (opcional)
                <input inputMode="decimal" placeholder="Ex.: 100,00" value={change} onChange={(e) => setChange(e.target.value)} />
              </label>
            )}
          </section>

          <section className="step">
            <label className="flabel">
              Observações para a loja (opcional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: horário para entrega, cartão de presente…" maxLength={500} />
            </label>
          </section>
        </div>

        <aside className="step" aria-label="Resumo do pedido">
          <h2>Resumo</h2>
          {q.items.map((i) => (
            <div key={i.product_id + i.variant_id} className="box-row">
              <span>
                {i.qty}x {i.name}
                {i.variant_label && <span className="note"> ({i.variant_label})</span>}
              </span>
              <span>{brl(i.unit_price_cents * i.qty)}</span>
            </div>
          ))}
          {can(store, 'coupons') && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Cupom de desconto" value={couponText} onChange={(e) => setCouponText(e.target.value.toUpperCase())} aria-label="Cupom de desconto" />
                <button type="button" className="sbtn light" onClick={applyCoupon}>
                  Aplicar
                </button>
              </div>
              {(couponMsg || (coupon && q.coupon_error)) && <span className="err-text">{couponMsg || q.coupon_error}</span>}
              {coupon && !q.coupon_error && <span className="ok-text">Cupom {coupon.code} aplicado.</span>}
            </div>
          )}
          <div className="totals">
            <div className="box-row">
              <span>Subtotal</span>
              <span>{brl(q.subtotal_cents)}</span>
            </div>
            {q.coupon_discount_cents > 0 && (
              <div className="box-row ok-text">
                <span>Cupom</span>
                <span>−{brl(q.coupon_discount_cents)}</span>
              </div>
            )}
            {q.pix_discount_cents > 0 && (
              <div className="box-row ok-text">
                <span>Desconto no Pix</span>
                <span>−{brl(q.pix_discount_cents)}</span>
              </div>
            )}
            <div className="box-row">
              <span>Entrega</span>
              <span>{!ship ? '—' : ship === 'arrange' ? 'A combinar' : q.shipping_cents ? brl(q.shipping_cents) : 'Grátis'}</span>
            </div>
            <div className="box-row total">
              <span>Total</span>
              <span>{brl(q.total_cents)}</span>
            </div>
          </div>
          {store.settings.prep_days > 0 && <p className="note">Prazo de preparo: até {store.settings.prep_days} dia(s) útil(eis) após a confirmação do pagamento.</p>}
          <label className="check" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem' }}>
            <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 18, minHeight: 0, height: 18, marginTop: 2 }} />
            <span>
              Li e concordo com a <Link to={path('/politicas/troca')}>política de troca</Link> e a <Link to={path('/politicas/privacidade')}>política de privacidade</Link>. Posso desistir da compra em até 7 dias após o recebimento.
            </span>
          </label>
          {error && (
            <p className="err-text" role="alert">
              {error}
            </p>
          )}
          <button className="sbtn full buy" disabled={busy || blocked}>
            {busy ? 'Enviando…' : `Confirmar pedido · ${brl(q.total_cents)}`}
          </button>
        </aside>
      </form>
    </div>
  )
}
