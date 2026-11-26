import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, brl, type Product, type Store } from '../data'

export default function Loja() {
  const { slug = '' } = useParams()
  const [store, setStore] = useState<Store | null | undefined>(undefined)
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [open, setOpen] = useState(false)
  const [cliente, setCliente] = useState('')
  const [obs, setObs] = useState('')

  useEffect(() => {
    api.storeBySlug(slug).then(async (s) => {
      if (s) {
        setProducts((await api.products(s.id)).filter((p) => p.available))
        document.title = s.name
      }
      setStore(s)
    })
  }, [slug])

  if (store === undefined) return <main className="wrap">Carregando…</main>
  if (!store)
    return (
      <main className="wrap narrow">
        <h1>Loja não encontrada</h1>
        <p className="muted">Confira se o endereço está correto.</p>
      </main>
    )

  const add = (id: string, n: number) =>
    setCart((c) => {
      const q = (c[id] ?? 0) + n
      const { [id]: _, ...rest } = c
      return q > 0 ? { ...rest, [id]: q } : rest
    })
  const items = products.filter((p) => cart[p.id])
  const count = items.reduce((n, p) => n + cart[p.id], 0)
  const total = items.reduce((n, p) => n + cart[p.id] * p.price_cents, 0)

  function enviar() {
    const lines = [
      `Olá! Quero fazer um pedido na *${store!.name}*:`,
      '',
      ...items.map((p) => `• ${cart[p.id]}x ${p.name} — ${brl(cart[p.id] * p.price_cents)}`),
      '',
      `*Total: ${brl(total)}*`,
      ...(cliente ? [`Nome: ${cliente}`] : []),
      ...(obs ? [`Obs.: ${obs}`] : []),
    ]
    let phone = store!.whatsapp.replace(/\D/g, '')
    if (phone.length <= 11) phone = '55' + phone
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank')
  }

  return (
    <main className="wrap loja">
      <header>
        <h1>{store.name}</h1>
        {store.description && <p className="muted">{store.description}</p>}
      </header>
      {products.length === 0 && <p className="muted">Esta loja ainda não tem produtos.</p>}
      <ul className="grid">
        {products.map((p) => (
          <li key={p.id} className="card product">
            {p.image_url ? <img src={p.image_url} alt={p.name} loading="lazy" /> : <div className="noimg" />}
            <b>{p.name}</b>
            {p.description && <span className="muted">{p.description}</span>}
            <span className="price">{brl(p.price_cents)}</span>
            {cart[p.id] ? (
              <div className="qty">
                <button onClick={() => add(p.id, -1)} aria-label={`Remover um ${p.name}`}>
                  −
                </button>
                <span>{cart[p.id]}</span>
                <button onClick={() => add(p.id, 1)} aria-label={`Adicionar mais um ${p.name}`}>
                  +
                </button>
              </div>
            ) : (
              <button className="btn" onClick={() => add(p.id, 1)}>
                Adicionar
              </button>
            )}
          </li>
        ))}
      </ul>

      {count > 0 && (
        <div className="cart">
          {open && (
            <div className="form">
              <ul className="lines">
                {items.map((p) => (
                  <li key={p.id}>
                    <span>
                      {cart[p.id]}x {p.name}
                    </span>
                    <span>{brl(cart[p.id] * p.price_cents)}</span>
                  </li>
                ))}
              </ul>
              <input placeholder="Seu nome" value={cliente} onChange={(e) => setCliente(e.target.value)} />
              <input placeholder="Observação (entrega, retirada…)" value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          )}
          <div className="row between">
            <span>
              {count} {count === 1 ? 'item' : 'itens'} · <b>{brl(total)}</b>
            </span>
            {open ? (
              <button className="btn wa" onClick={enviar}>
                Enviar pedido pelo WhatsApp
              </button>
            ) : (
              <button className="btn" onClick={() => setOpen(true)}>
                Ver pedido
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
