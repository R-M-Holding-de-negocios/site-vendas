import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, brl, shrinkImage, slugify, type Product, type Store } from '../data'

const RESERVED = ['entrar', 'painel']

export default function Painel() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState<Store | null>(null)
  const [editingStore, setEditingStore] = useState(false)

  useEffect(() => {
    api.user().then(async (u) => {
      if (!u) return nav('/entrar')
      setStore(await api.myStore())
      setLoading(false)
    })
  }, [nav])

  if (loading) return <main className="wrap">Carregando…</main>

  const link = store && `${location.origin}/${store.slug}`
  return (
    <main className="wrap">
      <header className="top">
        <strong className="brand">Vitrine</strong>
        <button className="link" onClick={() => api.signOut().then(() => nav('/'))}>
          Sair
        </button>
      </header>
      {!store || editingStore ? (
        <StoreForm
          store={store}
          onSaved={(s) => {
            setStore(s)
            setEditingStore(false)
          }}
          onCancel={store ? () => setEditingStore(false) : undefined}
        />
      ) : (
        <>
          <section className="card">
            <h1>{store.name}</h1>
            <p>
              Link da sua loja:{' '}
              <a href={link!} target="_blank" rel="noreferrer">
                {link}
              </a>
            </p>
            <div className="row">
              <button className="btn ghost" onClick={() => navigator.clipboard.writeText(link!)}>
                Copiar link
              </button>
              <button className="btn ghost" onClick={() => setEditingStore(true)}>
                Editar dados da loja
              </button>
            </div>
          </section>
          <Products store={store} />
        </>
      )}
    </main>
  )
}

function StoreForm(props: { store: Store | null; onSaved: (s: Store) => void; onCancel?: () => void }) {
  const s = props.store
  const [name, setName] = useState(s?.name ?? '')
  const [slug, setSlug] = useState(s?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(!!s)
  const [whatsapp, setWhatsapp] = useState(s?.whatsapp ?? '')
  const [description, setDescription] = useState(s?.description ?? '')
  const [msg, setMsg] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (slug.length < 3 || RESERVED.includes(slug)) return setMsg('Escolha outro endereço (mínimo 3 letras).')
    if (whatsapp.replace(/\D/g, '').length < 10) return setMsg('Informe o WhatsApp com DDD.')
    try {
      props.onSaved(await api.saveStore({ id: s?.id, name, slug, whatsapp, description }))
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="card form">
      <h1>{s ? 'Dados da loja' : 'Vamos criar sua loja'}</h1>
      <label>
        Nome da loja
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (!slugTouched) setSlug(slugify(e.target.value))
          }}
        />
      </label>
      <label>
        Endereço da loja
        <span className="prefix">
          {location.host}/
          <input
            required
            value={slug}
            onChange={(e) => {
              setSlug(slugify(e.target.value))
              setSlugTouched(true)
            }}
          />
        </span>
      </label>
      <label>
        WhatsApp que recebe os pedidos (com DDD)
        <input required type="tel" placeholder="(11) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
      </label>
      <label>
        Descrição (opcional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Doces artesanais em Campinas" />
      </label>
      {msg && <p className="msg">{msg}</p>}
      <div className="row">
        <button className="btn">{s ? 'Salvar' : 'Criar loja'}</button>
        {props.onCancel && (
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

function Products({ store }: { store: Store }) {
  const [list, setList] = useState<Product[]>([])
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const reload = () => api.products(store.id).then(setList)
  useEffect(() => {
    reload()
  }, [store.id])

  return (
    <section>
      <div className="row between">
        <h2>Produtos</h2>
        {!editing && (
          <button className="btn" onClick={() => setEditing('new')}>
            + Novo produto
          </button>
        )}
      </div>
      {editing && (
        <ProductForm
          key={editing === 'new' ? 'new' : editing.id}
          storeId={store.id}
          product={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
      {list.length === 0 && !editing && <p className="muted">Nenhum produto ainda. Cadastre o primeiro!</p>}
      <ul className="plist">
        {list.map((p) => (
          <li key={p.id} className="card">
            {p.image_url ? <img src={p.image_url} alt="" /> : <div className="noimg" />}
            <div className="grow">
              <b>{p.name}</b>
              <span>
                {brl(p.price_cents)}
                {!p.available && ' · indisponível'}
              </span>
            </div>
            <button className="link" onClick={() => setEditing(p)}>
              Editar
            </button>
            <button
              className="link danger"
              onClick={() => confirm(`Excluir "${p.name}"?`) && api.deleteProduct(p.id).then(reload)}
            >
              Excluir
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProductForm(props: { storeId: string; product: Product | null; onDone: () => void }) {
  const p = props.product
  const [name, setName] = useState(p?.name ?? '')
  const [price, setPrice] = useState(p ? (p.price_cents / 100).toFixed(2).replace('.', ',') : '')
  const [description, setDescription] = useState(p?.description ?? '')
  const [available, setAvailable] = useState(p?.available ?? true)
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(price.replace(/\./g, '').replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents < 0) return setMsg('Preço inválido. Ex.: 19,90')
    setBusy(true)
    try {
      const image_url = file ? await api.uploadImage(await shrinkImage(file)) : (p?.image_url ?? '')
      await api.saveProduct({ id: p?.id, store_id: props.storeId, name, price_cents: cents, description, image_url, available })
      props.onDone()
    } catch (err) {
      setMsg((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card form">
      <label>
        Nome do produto
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Preço (R$)
        <input required inputMode="decimal" placeholder="19,90" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label>
        Descrição (opcional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Foto {p?.image_url && '(deixe vazio para manter a atual)'}
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
        Disponível para venda
      </label>
      {msg && <p className="msg">{msg}</p>}
      <div className="row">
        <button className="btn" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar produto'}
        </button>
        <button type="button" className="btn ghost" onClick={props.onDone}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
