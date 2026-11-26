import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { db, storeUrl, track } from '../lib/api'
import { renderMarkdown, plainText } from '../lib/markdown'
import { can } from '../lib/plans'
import { availableStock, basePrice, qtyDiscountPercent, shippingOptions } from '../lib/pricing'
import type { Content, Product, Variant } from '../lib/types'
import { brl, waLink } from '../lib/util'
import { Icon } from '../ui/icons'
import { ratingOf, useStore, visibleProducts, youtubeId } from './context'
import { priceInfo, ProductGrid, QtyStepper, soldOut, Stars } from './parts'
import { Sections } from './sections'

export function useSeo(title: string, description = '') {
  useEffect(() => {
    document.title = title
    let m = document.querySelector('meta[name="description"]')
    if (!m) {
      m = document.createElement('meta')
      m.setAttribute('name', 'description')
      document.head.appendChild(m)
    }
    m.setAttribute('content', description.slice(0, 160))
  }, [title, description])
}

export function HomePage() {
  const { store, theme } = useStore()
  useSeo(store.name, store.description)
  return <Sections sections={theme.sections} />
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

type Sort = 'relevance' | 'price_asc' | 'price_desc' | 'new' | 'best'

export function ListPage({ mode }: { mode: 'category' | 'search' | 'all' }) {
  const { store, products, variants, categories, path } = useStore()
  const { id } = useParams()
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const cat = categories.find((c) => c.id === id)
  const [sort, setSort] = useState<Sort>('relevance')
  const [onlyAvail, setOnlyAvail] = useState(false)
  const [onlyPromo, setOnlyPromo] = useState(false)
  const [maxPrice, setMaxPrice] = useState<number | null>(null)
  const [opt, setOpt] = useState<Record<string, string>>({})
  const filters = can(store, 'filters')

  const base = useMemo(() => {
    let list = visibleProducts(products)
    if (mode === 'category') list = list.filter((p) => p.category_ids.includes(id ?? ''))
    if (mode === 'search') {
      const terms = norm(q).split(/\s+/).filter(Boolean)
      list = list.filter((p) => terms.every((t) => norm(`${p.name} ${p.description}`).includes(t)))
    }
    return list
  }, [products, mode, id, q])

  useEffect(() => {
    if (mode === 'search' && q) track(store.id, 'search', { data: { q: q.slice(0, 80), results: base.length } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const optionNames = [...new Set(base.flatMap((p) => p.options.map((o) => o.name)))]
  const list = useMemo(() => {
    let l = base
    if (onlyAvail) l = l.filter((p) => !soldOut(p, variants))
    if (onlyPromo) l = l.filter((p) => priceInfo(p, variants).old != null)
    if (maxPrice != null) l = l.filter((p) => priceInfo(p, variants).current <= maxPrice)
    for (const [name, value] of Object.entries(opt))
      if (value) l = l.filter((p) => variants.some((v) => v.product_id === p.id && v.available && v.values[name] === value))
    const price = (p: Product) => priceInfo(p, variants).current
    if (sort === 'price_asc') l = [...l].sort((a, b) => price(a) - price(b))
    if (sort === 'price_desc') l = [...l].sort((a, b) => price(b) - price(a))
    if (sort === 'new') l = [...l].sort((a, b) => b.created_at.localeCompare(a.created_at))
    if (sort === 'best') l = [...l].sort((a, b) => (b.sold_count ?? 0) - (a.sold_count ?? 0))
    // Esgotados vão para o fim
    return [...l].sort((a, b) => Number(soldOut(a, variants)) - Number(soldOut(b, variants)))
  }, [base, onlyAvail, onlyPromo, maxPrice, opt, sort, variants])

  const title = mode === 'category' ? (cat?.name ?? 'Categoria') : mode === 'search' ? `Busca: “${q}”` : 'Todos os produtos'
  useSeo(`${cat?.seo.title || title} | ${store.name}`, cat?.seo.description ?? '')
  const prices = base.map((p) => priceInfo(p, variants).current)
  const top = prices.length ? Math.max(...prices) : 0

  return (
    <div className="page">
      <div className="wrap">
        <nav className="crumbs" aria-label="Você está em">
          <Link to={path('')}>Início</Link> / <span>{title}</span>
        </nav>
        <div className="list-head">
          <h1 style={{ fontSize: '1.6rem' }}>{title}</h1>
          <label className="row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="note">Ordenar</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="relevance">Destaques</option>
              <option value="best">Mais vendidos</option>
              <option value="new">Novidades</option>
              <option value="price_asc">Menor preço</option>
              <option value="price_desc">Maior preço</option>
            </select>
          </label>
        </div>
        {filters && base.length > 3 && (
          <div className="filters" style={{ marginBottom: 18 }}>
            <div className="fchips">
              <button className="fchip" aria-pressed={onlyAvail} onClick={() => setOnlyAvail(!onlyAvail)}>
                Só disponíveis
              </button>
              <button className="fchip" aria-pressed={onlyPromo} onClick={() => setOnlyPromo(!onlyPromo)}>
                Em promoção
              </button>
              {top > 0 &&
                [0.25, 0.5].map((f) => {
                  const v = Math.ceil((top * f) / 1000) * 1000
                  return (
                    <button key={f} className="fchip" aria-pressed={maxPrice === v} onClick={() => setMaxPrice(maxPrice === v ? null : v)}>
                      Até {brl(v)}
                    </button>
                  )
                })}
            </div>
            {optionNames.map((name) => {
              const values = [...new Set(variants.filter((v) => base.some((p) => p.id === v.product_id)).map((v) => v.values[name]).filter(Boolean))]
              return (
                <div key={name} className="fchips" role="group" aria-label={name}>
                  <span className="note" style={{ alignSelf: 'center' }}>
                    {name}:
                  </span>
                  {values.map((v) => (
                    <button key={v} className="fchip" aria-pressed={opt[name] === v} onClick={() => setOpt({ ...opt, [name]: opt[name] === v ? '' : v })}>
                      {v}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        {list.length ? (
          <ProductGrid products={list} />
        ) : (
          <div className="empty-state">
            <p>{mode === 'search' ? `Não encontramos nada para “${q}”.` : 'Nenhum produto aqui ainda.'}</p>
            {mode === 'search' && (
              <>
                <p className="muted">Que tal dar uma olhada nos destaques?</p>
                <ProductGrid products={visibleProducts(products).filter((p) => p.featured && p.available).slice(0, 4)} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function matchVariant(variants: Variant[], p: Product, chosen: Record<string, string>) {
  if (!p.options.length) return null
  if (p.options.some((o) => !chosen[o.name])) return null
  return variants.find((v) => v.product_id === p.id && p.options.every((o) => v.values[o.name] === chosen[o.name])) ?? null
}

function ShippingEstimate() {
  const { store } = useStore()
  const opts = shippingOptions(store)
  const [zone, setZone] = useState('')
  if (!opts.length) return null
  const threshold = can(store, 'free_shipping_bar') ? store.settings.free_shipping_above_cents : 0
  const z = opts.find((o) => o.method === 'zone')
  return (
    <div className="box">
      <b>
        <Icon name="truck" size={18} /> Entrega
      </b>
      {opts.map((o) =>
        o.method === 'zone' ? (
          <div key="zone" style={{ display: 'grid', gap: 6 }}>
            <label className="flabel">
              Calcule a entrega no seu bairro
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">Escolha o bairro</option>
                {z!.zones!.map((zz) => (
                  <option key={zz.name}>{zz.name}</option>
                ))}
              </select>
            </label>
            {zone && <div className="box-row"><span>Entrega em {zone}</span><b>{brl(z!.zones!.find((x) => x.name === zone)!.fee_cents)}</b></div>}
          </div>
        ) : (
          <div key={o.method} className="box-row">
            <span>{o.label}</span>
            <b>{o.method === 'pickup' ? 'Grátis' : o.method === 'fixed' ? brl(o.fee_cents ?? 0) : 'A combinar'}</b>
          </div>
        ),
      )}
      {threshold > 0 && <span className="note">Frete grátis nas compras acima de {brl(threshold)}.</span>}
      {store.settings.prep_days > 0 && <span className="note">Pedido preparado em até {store.settings.prep_days} dia(s) útil(eis).</span>}
    </div>
  )
}

function StockAlert({ p, v }: { p: Product; v: Variant | null }) {
  const { store, preview } = useStore()
  const [contact, setContact] = useState('')
  const [done, setDone] = useState(false)
  if (!can(store, 'stock_alert')) return null
  return done ? (
    <p className="ok-text">Combinado! Avisaremos você quando chegar.</p>
  ) : (
    <form
      className="box"
      onSubmit={async (e) => {
        e.preventDefault()
        if (preview || contact.replace(/\D/g, '').length < 10) return
        await db.insert('stock_alerts', { store_id: store.id, product_id: p.id, variant_id: v?.id ?? null, contact, notified: false }).catch(() => undefined)
        setDone(true)
      }}
    >
      <b>Avise-me quando chegar</b>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="tel" inputMode="tel" placeholder="Seu WhatsApp com DDD" value={contact} onChange={(e) => setContact(e.target.value)} aria-label="Seu WhatsApp" style={{ flex: '1 1 180px' }} required />
        <button className="sbtn">Avisar</button>
      </div>
    </form>
  )
}

export function ProductPage() {
  const { id } = useParams()
  const { store, products, variants, categories, reviews, theme, path, cart, openCart, preview } = useStore()
  const p = products.find((x) => x.id === id && !x.blocked)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [qty, setQty] = useState(1)
  const [img, setImg] = useState(0)
  const [zoom, setZoom] = useState(false)
  useEffect(() => {
    setChosen({})
    setQty(1)
    setImg(0)
    if (p && !preview) track(store.id, 'product_view', { product_id: p.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useSeo(p ? `${p.seo.title || p.name} | ${store.name}` : store.name, p ? p.seo.description || plainText(p.description) : '')
  if (!p)
    return (
      <div className="page wrap empty-state">
        <h1>Produto não encontrado</h1>
        <Link className="sbtn" to={path('')}>
          Voltar para a loja
        </Link>
      </div>
    )
  const v = matchVariant(variants, p, chosen)
  const pv = variants.filter((x) => x.product_id === p.id)
  const now = new Date()
  const unit = basePrice(p, v, now)
  const pro = can(store, 'qty_discount')
  const off = pro ? qtyDiscountPercent(p, qty) : 0
  const info = priceInfo(p, variants)
  const stock = availableStock(p, v)
  const needsChoice = p.options.length > 0 && !v
  const out = !p.available || (v ? !v.available || stock <= 0 : !p.options.length && stock <= 0) || soldOut(p, variants)
  const images = [...(v?.image ? [v.image] : []), ...p.images].filter((x, i, a) => a.indexOf(x) === i)
  const blocks = theme.product.blocks.filter((b) => b.enabled).map((b) => b.id)
  const rating = can(store, 'reviews') ? ratingOf(reviews, p.id) : null
  const related = visibleProducts(products)
    .filter((x) => x.id !== p.id && x.available && x.category_ids.some((c) => p.category_ids.includes(c)))
    .slice(0, 4)
  const cat = categories.find((c) => p.category_ids.includes(c.id))
  const yt = youtubeId(p.video_url)
  const valueAvailable = (name: string, value: string) =>
    pv.some((x) => x.available && x.values[name] === value && (!p.track_stock || x.stock > 0) && p.options.every((o) => o.name === name || !chosen[o.name] || x.values[o.name] === chosen[o.name]))
  const share = async () => {
    const url = storeUrl(store.slug, `/p/${p.id}`)
    if (navigator.share) await navigator.share({ title: p.name, url }).catch(() => undefined)
    else window.open(`https://wa.me/?text=${encodeURIComponent(`${p.name} - ${url}`)}`, '_blank')
  }
  const style = { '--ratio': theme.product.ratio.replace('/', ' / '), '--fit': theme.product.fit } as React.CSSProperties

  return (
    <div className="page">
      <div className="wrap">
        <nav className="crumbs" aria-label="Você está em">
          <Link to={path('')}>Início</Link> /{' '}
          {cat && (
            <>
              <Link to={path(`/c/${cat.id}`)}>{cat.name}</Link> /{' '}
            </>
          )}
          <span>{p.name}</span>
        </nav>
        <div className="pdp">
          <div className={`gal ${theme.product.gallery}`} style={style}>
            {theme.product.gallery === 'stacked' ? (
              <div className="stack-imgs">
                {images.map((u, i) => (
                  <img key={u} src={u} alt={i === 0 ? p.name : ''} />
                ))}
              </div>
            ) : (
              <>
                <button className="main" onClick={() => setZoom(true)} aria-label="Ampliar foto">
                  {images[img] && <img src={images[img]} alt={p.name} />}
                </button>
                {images.length > 1 && (
                  <div className="thumbs">
                    {images.map((u, i) => (
                      <button key={u} aria-current={i === img} onClick={() => setImg(i)} aria-label={`Foto ${i + 1}`}>
                        <img src={u} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="pinfo">
            <div style={{ display: 'grid', gap: 6 }}>
              <h1>{p.name}</h1>
              {rating && <Stars value={rating.avg} count={rating.count} />}
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="price" style={{ fontSize: '1.6rem' }}>
                <span>{brl(v ? unit : info.current)}</span>
                {!v && info.old && <s>{brl(info.old)}</s>}
                {!v && info.off > 0 && <span className="tag sale" style={{ fontSize: '0.8rem' }}>-{info.off}%</span>}
              </div>
              {p.promo_ends_at && info.old && <span className="note">Promoção válida até {new Date(p.promo_ends_at).toLocaleDateString('pt-BR')}</span>}
              {store.settings.payments.pix.discount_percent > 0 && store.settings.payments.pix.enabled && can(store, 'pix') && (
                <span className="note">
                  {brl(Math.floor((v ? unit : info.current) * (1 - store.settings.payments.pix.discount_percent / 100)))} no Pix ({store.settings.payments.pix.discount_percent}% de desconto)
                </span>
              )}
              {store.settings.max_installments > 1 && <span className="note">ou em até {store.settings.max_installments}x no cartão</span>}
            </div>
            {pro && p.qty_discounts.length > 0 && (
              <div className="box">
                <b>
                  <Icon name="tag" size={16} /> Leve mais e pague menos
                </b>
                {[...p.qty_discounts].sort((a, b) => a.min_qty - b.min_qty).map((t) => (
                  <div className="box-row" key={t.min_qty}>
                    <span>A partir de {t.min_qty} unidades</span>
                    <b>{t.percent}% de desconto</b>
                  </div>
                ))}
              </div>
            )}
            {p.options.map((o) => (
              <div key={o.name} style={{ display: 'grid', gap: 8 }}>
                <b>
                  {o.name}
                  {chosen[o.name] ? `: ${chosen[o.name]}` : ''}
                </b>
                <div className="opt-values" role="group" aria-label={o.name}>
                  {o.values.map((val) => (
                    <button key={val} type="button" aria-pressed={chosen[o.name] === val} disabled={!valueAvailable(o.name, val)} onClick={() => setChosen({ ...chosen, [o.name]: val })}>
                      {val}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {out && !needsChoice ? (
              <>
                <p className="warn-text">{p.available ? 'Esgotado no momento.' : 'Indisponível no momento.'}</p>
                <StockAlert p={p} v={v} />
              </>
            ) : (
              <div className="buyrow">
                <QtyStepper label={p.name} value={qty} max={Number.isFinite(stock) ? stock : 999} onChange={(n) => setQty(Math.max(1, n))} />
                <button
                  className="sbtn buy"
                  disabled={needsChoice}
                  onClick={() => {
                    if (preview) return
                    cart.add(p.id, v?.id ?? null, qty)
                    track(store.id, 'add_to_cart', { product_id: p.id })
                    openCart()
                  }}
                >
                  {needsChoice ? `Escolha ${p.options.find((o) => !chosen[o.name])?.name.toLowerCase()}` : theme.product.buy_label || 'Adicionar ao carrinho'}
                </button>
              </div>
            )}
            {off > 0 && <p className="ok-text">Você ganha {off}% de desconto levando {qty} unidades.</p>}
            {blocks.includes('stock') && p.track_stock && !out && Number.isFinite(stock) && stock <= 10 && <p className="warn-text">Restam só {stock} unidades.</p>}
            <a className="sbtn light" href={waLink(store.whatsapp, `Olá! Tenho uma dúvida sobre ${p.name}.`)} target="_blank" rel="noopener noreferrer">
              <Icon name="whatsapp" /> Tirar dúvida no WhatsApp
            </a>
            {blocks.includes('shipping') && <ShippingEstimate />}
            {blocks.includes('share') && (
              <button className="slink" onClick={share} style={{ justifySelf: 'start' }}>
                <Icon name="share" size={16} /> Compartilhar
              </button>
            )}
            {p.description && (
              <div style={{ display: 'grid', gap: 8 }}>
                <h2 style={{ fontSize: '1.1rem' }}>Descrição</h2>
                <div className="rich" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.description) }} />
              </div>
            )}
            {yt && (
              <div className="video">
                <iframe src={`https://www.youtube-nocookie.com/embed/${yt}`} title={`Vídeo de ${p.name}`} allowFullScreen loading="lazy" />
              </div>
            )}
          </div>
        </div>
        {blocks.includes('reviews') && rating && (
          <section style={{ marginTop: 40, maxWidth: 760 }}>
            <h2 className="sec-title">Avaliações</h2>
            {reviews
              .filter((r) => r.product_id === p.id && r.approved)
              .map((r) => (
                <div key={r.id} className="review">
                  <Stars value={r.rating} />
                  <p>{r.comment}</p>
                  <span className="note">
                    {r.name} · {new Date(r.created_at).toLocaleDateString('pt-BR')} · compra verificada
                  </span>
                </div>
              ))}
          </section>
        )}
        {blocks.includes('related') && related.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 className="sec-title">Você também pode gostar</h2>
            <ProductGrid products={related} layout="carousel" />
          </section>
        )}
      </div>
      {zoom && (
        <button className="lightbox" onClick={() => setZoom(false)} aria-label="Fechar foto ampliada">
          <img src={images[img]} alt={p.name} />
        </button>
      )}
    </div>
  )
}

export function ContentPage({ kind }: { kind: 'page' | 'post' }) {
  const { slug } = useParams()
  const { contents, store, path, products } = useStore()
  const c = contents.find((x) => x.kind === kind && x.slug === slug)
  useSeo(c ? `${c.seo.title || c.title} | ${store.name}` : store.name, c ? c.seo.description || plainText(c.body) : '')
  useEffect(() => {
    if (c) track(store.id, 'content_view', { data: { content_id: c.id } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id])
  if (!c)
    return (
      <div className="page wrap empty-state">
        <h1>Página não encontrada</h1>
        <Link className="sbtn" to={path('')}>
          Voltar para a loja
        </Link>
      </div>
    )
  const linked = c.product_ids.map((id) => products.find((p) => p.id === id && !p.blocked)).filter(Boolean) as Product[]
  return (
    <div className="page">
      <article className="wrap" style={{ maxWidth: 780 }}>
        <nav className="crumbs">
          <Link to={path('')}>Início</Link> / {kind === 'post' && <><Link to={path('/blog')}>Blog</Link> / </>}
          <span>{c.title}</span>
        </nav>
        {c.cover_url && <img src={c.cover_url} alt="" style={{ borderRadius: 'var(--st-radius)', width: '100%', aspectRatio: '16/9', objectFit: 'cover', marginBottom: 20 }} />}
        <h1 style={{ fontSize: 'clamp(1.6rem, 5cqi, 2.4rem)', marginBottom: 6 }}>{c.title}</h1>
        {kind === 'post' && <p className="note" style={{ marginBottom: 18 }}>{new Date(c.publish_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
        <div className="rich" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }} />
        {linked.length > 0 && (
          <section style={{ marginTop: 32 }}>
            <h2 className="sec-title">Produtos deste post</h2>
            <ProductGrid products={linked} />
          </section>
        )}
      </article>
    </div>
  )
}

export function BlogPage() {
  const { contents, store, path } = useStore()
  useSeo(`Blog | ${store.name}`)
  const posts = contents.filter((c) => c.kind === 'post').sort((a, b) => b.publish_at.localeCompare(a.publish_at))
  return (
    <div className="page wrap">
      <h1 style={{ marginBottom: 20 }}>Blog</h1>
      {!posts.length && <p className="muted">Nenhum post publicado ainda.</p>}
      <div className="posts">
        {posts.map((c: Content) => (
          <Link key={c.id} to={path(`/blog/${c.slug}`)} className="post-card">
            {c.cover_url && <img src={c.cover_url} alt="" loading="lazy" />}
            <div>
              <b>{c.title}</b>
              <span className="note">{plainText(c.body).slice(0, 110)}…</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function PolicyPage() {
  const { kind } = useParams()
  const { store, path } = useStore()
  const map = {
    troca: ['Trocas e devoluções', store.settings.policies.exchange],
    entrega: ['Entrega', store.settings.policies.shipping],
    privacidade: ['Política de privacidade', store.settings.policies.privacy],
  } as const
  const entry = map[kind as keyof typeof map]
  useSeo(`${entry?.[0] ?? 'Políticas'} | ${store.name}`)
  if (!entry) return <div className="page wrap"><Link to={path('')}>Voltar</Link></div>
  const legal = store.settings.legal
  return (
    <div className="page">
      <article className="wrap rich" style={{ maxWidth: 780 }}>
        <h1>{entry[0]}</h1>
        <p style={{ whiteSpace: 'pre-line' }}>{entry[1]}</p>
        <p className="note">
          {legal.name}
          {legal.document && ` · ${legal.document}`}
          {legal.address && ` · ${legal.address}`} · WhatsApp {store.whatsapp}
        </p>
      </article>
    </div>
  )
}

export { HomePage as default }
