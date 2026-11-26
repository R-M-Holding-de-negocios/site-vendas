import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/api'
import { can, DEFAULT_PLANS } from '../lib/plans'
import { PAY_LABEL, quote, shippingOptions, variantLabel, type CartLine } from '../lib/pricing'
import type { PayMethod, ShipMethod } from '../lib/types'
import { brl } from '../lib/util'
import { ErrorBox, Field, Loading, PageHead, toast, Toggle, Upsell, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

export default function ManualOrder() {
  const { store } = usePanel()
  const nav = useNavigate()
  const data = useAsync(() => Promise.all([db.list('products', { eq: { store_id: store.id } }), db.list('variants', { eq: { store_id: store.id } })]), [store.id])
  const [lines, setLines] = useState<CartLine[]>([])
  const [pick, setPick] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const ships = shippingOptions(store)
  const [ship, setShip] = useState<ShipMethod>(ships[0]?.method ?? 'pickup')
  const [zone, setZone] = useState(store.settings.delivery.zones.items[0]?.name ?? '')
  const [pay, setPay] = useState<PayMethod>('pix')
  const [paid, setPaid] = useState(true)
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (!can(store, 'manual_order')) return <Upsell feature="manual_order" />
  if (!data.data) return <Loading />
  const [products, variants] = data.data
  const options = products.flatMap((p) =>
    p.options.length ? variants.filter((v) => v.product_id === p.id).map((v) => ({ key: `${p.id}|${v.id}`, label: `${p.name} (${variantLabel(v)})` })) : [{ key: `${p.id}|`, label: p.name }],
  )
  const q = quote({ store, lines, products, variants, shipping: { method: ship, zone }, payment: pay, coupon: null, feePercent: DEFAULT_PLANS.find((x) => x.id === store.plan)!.fee_percent, now: new Date() })
  const allowedPays = (['pix', 'cash', 'card_on_delivery', 'whatsapp'] as PayMethod[])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (!lines.length) return setErr('Adicione pelo menos um produto.')
    setBusy(true)
    try {
      const needsAddress = ship === 'zone' || ship === 'fixed'
      const r = await db.rpc('place_order', {
        store_id: store.id,
        lines,
        customer: { name, phone, email: '' },
        shipping: { method: ship, zone, address: needsAddress ? { cep: '', street: 'Combinado com o cliente', number: '-', complement: '', district: zone, city: '', state: '' } : null },
        payment: { method: pay },
        coupon: '',
        notes,
        source: { source: 'balcão', medium: '', campaign: '', device: 'desktop' },
        checkout_id: null,
        manual: true,
        paid,
      })
      toast(`Venda #${r.number} registrada`)
      nav(`/painel/pedidos/${r.id}`)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <PageHead back="/painel/pedidos" title="Registrar venda" sub="Para vendas feitas por fora da loja, como no balcão ou pelo Instagram. O estoque e os relatórios ficam certos." />
      <section className="card form-section">
        <h2>Produtos</h2>
        <div className="row">
          <select className="grow" value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 'auto' }} aria-label="Produto">
            <option value="">Escolha um produto</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn ghost"
            disabled={!pick}
            onClick={() => {
              const [product_id, variant_id] = pick.split('|')
              const i = lines.findIndex((l) => l.product_id === product_id && (l.variant_id ?? '') === variant_id)
              setLines(i >= 0 ? lines.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l)) : [...lines, { product_id, variant_id: variant_id || null, qty: 1 }])
              setPick('')
            }}
          >
            Adicionar
          </button>
        </div>
        {q.items.map((it, i) => (
          <div key={i} className="row between">
            <span className="grow">{it.name}{it.variant_label && ` (${it.variant_label})`}</span>
            <input type="number" min={1} value={it.qty} style={{ width: 80 }} aria-label={`Quantidade de ${it.name}`} onChange={(e) => setLines(lines.map((l) => (l.product_id === it.product_id && l.variant_id === it.variant_id ? { ...l, qty: Math.max(1, +e.target.value) } : l)))} />
            <b className="num" style={{ minWidth: 90 }}>{brl(it.unit_price_cents * it.qty)}</b>
            <button type="button" className="link danger" onClick={() => setLines(lines.filter((l) => !(l.product_id === it.product_id && l.variant_id === it.variant_id)))}>Remover</button>
          </div>
        ))}
        {q.errors.filter((x) => !x.startsWith('O pedido mínimo') && !x.startsWith('O carrinho')).map((x) => <ErrorBox key={x} message={x} />)}
      </section>
      <section className="card form-section">
        <h2>Cliente</h2>
        <div className="grid2">
          <Field label="Nome"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="WhatsApp com DDD"><input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
      </section>
      <section className="card form-section">
        <h2>Entrega e pagamento</h2>
        <div className="grid2">
          <Field label="Entrega">
            <select value={ship} onChange={(e) => setShip(e.target.value as ShipMethod)}>
              {ships.map((s) => <option key={s.method} value={s.method}>{s.label}</option>)}
            </select>
          </Field>
          {ship === 'zone' && (
            <Field label="Bairro">
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                {store.settings.delivery.zones.items.map((z) => <option key={z.name}>{z.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Pagamento">
            <select value={pay} onChange={(e) => setPay(e.target.value as PayMethod)}>
              {allowedPays.map((m) => <option key={m} value={m}>{m === 'whatsapp' ? 'Outro / combinado' : PAY_LABEL[m]}</option>)}
            </select>
          </Field>
        </div>
        <Toggle checked={paid} onChange={setPaid} label="Já foi pago" />
        <Field label="Observações"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </section>
      <div className="row between card">
        <span>Total</span>
        <b style={{ fontSize: '1.3rem' }}>{brl(q.total_cents)}</b>
      </div>
      {err && <ErrorBox message={err} />}
      <div className="form-actions">
        <button className="btn" disabled={busy}>{busy ? 'Registrando…' : 'Registrar venda'}</button>
      </div>
    </form>
  )
}
