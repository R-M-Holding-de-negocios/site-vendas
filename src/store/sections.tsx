import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../lib/api'
import { WEEKDAYS } from '../lib/hours'
import { planAtLeast } from '../lib/plans'
import { promoActive } from '../lib/pricing'
import { SECTION_INFO } from '../lib/theme'
import type { Product, Section } from '../lib/types'
import { Icon } from '../ui/icons'
import { useStore, visibleProducts, youtubeId } from './context'
import { Price, ProductGrid, Reveal, Stars } from './parts'

export function pickProducts(products: Product[], props: Section['props']): Product[] {
  const list = visibleProducts(products).filter((p) => p.available)
  const limit = Number(props.limit) || 8
  switch (props.source) {
    case 'featured':
      return list.filter((p) => p.featured).slice(0, limit)
    case 'best_sellers':
      return [...list].sort((a, b) => (b.sold_count ?? 0) - (a.sold_count ?? 0)).slice(0, limit)
    case 'new':
      return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
    case 'promo':
      return list.filter((p) => promoActive(p, new Date())).slice(0, limit)
    case 'category':
      return list.filter((p) => p.category_ids.includes(props.category_id)).slice(0, limit)
    case 'manual':
      return (props.ids as string[]).map((id) => list.find((p) => p.id === id)).filter(Boolean).slice(0, limit) as Product[]
    default:
      return list.slice(0, limit)
  }
}

function Title({ text, center }: { text?: string; center?: boolean }) {
  return text ? <h2 className={`sec-title ${center ? 'center' : ''}`}>{text}</h2> : null
}

function SectionLink({ link, label, className = 'sbtn' }: { link: string; label: string; className?: string }) {
  const { path } = useStore()
  if (!label) return null
  if (!link || link.startsWith('#'))
    return (
      <a className={className} href={link || '#produtos'} onClick={(e) => { e.preventDefault(); document.getElementById((link || '#produtos').slice(1))?.scrollIntoView({ behavior: 'smooth' }) }}>
        {label}
      </a>
    )
  if (/^https?:\/\//.test(link))
    return (
      <a className={className} href={link} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    )
  return (
    <Link className={className} to={path(link.startsWith('/') ? link : '/' + link)}>
      {label}
    </Link>
  )
}

function Banner({ s, heading }: { s: Section; heading: boolean }) {
  const p = s.props
  const H = heading ? 'h1' : 'h2'
  return (
    <div className={`banner h-${p.height ?? 'm'} a-${p.align ?? 'center'} ${p.image ? 'has-img' : ''} ${p.overlay > 0 ? 'dark' : ''}`}>
      {p.image && (
        <picture>
          {p.image_mobile && <source media="(max-width: 700px)" srcSet={p.image_mobile} />}
          <img src={p.image} alt="" />
        </picture>
      )}
      {p.image && p.overlay > 0 && <div className="shade" style={{ opacity: p.overlay / 100 }} />}
      <div className="wrap" style={{ position: 'relative' }}>
        <div className="btxt">
          {p.title && <H>{p.title}</H>}
          {p.text && <p>{p.text}</p>}
          <SectionLink link={p.link} label={p.button} />
        </div>
      </div>
    </div>
  )
}

function Carousel({ s, heading }: { s: Section; heading: boolean }) {
  const { theme } = useStore()
  const slides = (s.props.slides ?? []) as Section['props'][]
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const fade = theme.animations.carousel === 'fade'
  useEffect(() => {
    if (paused || slides.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), Math.max(2, theme.animations.carousel_seconds) * 1000)
    return () => clearInterval(t)
  }, [paused, slides.length, theme.animations.carousel_seconds])
  if (!slides.length) return null
  return (
    <div
      className={`carousel ${fade ? 'fade' : ''}`}
      aria-roledescription="carrossel"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onFocus={() => setPaused(true)}
    >
      <div className="track" style={fade ? undefined : { transform: `translateX(-${i * 100}%)` }}>
        {slides.map((sl, j) => (
          <div className="slide" key={j} style={fade ? { opacity: j === i ? 1 : 0, pointerEvents: j === i ? 'auto' : 'none' } : undefined} aria-hidden={j !== i}>
            <Banner s={{ ...s, props: { ...sl, height: s.props.height, align: sl.align ?? 'center', overlay: sl.overlay ?? (sl.image ? 30 : 0) } }} heading={heading && j === 0} />
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <>
          <button className="cnav prev" onClick={() => setI((i - 1 + slides.length) % slides.length)} aria-label="Anterior">
            ‹
          </button>
          <button className="cnav next" onClick={() => setI((i + 1) % slides.length)} aria-label="Próximo">
            ›
          </button>
          <div className="dots">
            {slides.map((_, j) => (
              <button key={j} aria-label={`Ir para o banner ${j + 1}`} aria-current={j === i} onClick={() => setI(j)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Countdown({ s }: { s: Section }) {
  const end = new Date(s.props.ends_at || Date.now()).getTime()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, end - now)
  if (!s.props.ends_at || left === 0) return null
  const parts: [number, string][] = [
    [Math.floor(left / 86400000), 'dias'],
    [Math.floor(left / 3600000) % 24, 'horas'],
    [Math.floor(left / 60000) % 60, 'min'],
    [Math.floor(left / 1000) % 60, 'seg'],
  ]
  return (
    <div className="countdown">
      <h2 className="sec-title" style={{ marginBottom: 0 }}>
        {s.props.title}
      </h2>
      <div className="cd" role="timer">
        {parts.map(([n, l]) => (
          <div key={l}>
            <b>{String(n).padStart(2, '0')}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <SectionLink link={s.props.link} label={s.props.button} />
    </div>
  )
}

function LeadForm({ s }: { s: Section }) {
  const { store, preview } = useStore()
  const [contact, setContact] = useState('')
  const [done, setDone] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (preview || contact.replace(/\D/g, '').length < 10) return
    await db.insert('leads', { store_id: store.id, contact }).catch(() => undefined)
    setDone(true)
  }
  const coupon = store.settings.lead_popup.coupon
  return (
    <div className="lead-box">
      <h2 className="sec-title" style={{ marginBottom: 0 }}>
        {s.props.title}
      </h2>
      {s.props.text && <p className="muted">{s.props.text}</p>}
      {done ? (
        <p className="ok-text">{coupon ? `Prontinho! Use o cupom ${coupon} no fechamento do pedido.` : 'Prontinho! Em breve entraremos em contato.'}</p>
      ) : (
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor={`lead-${s.id}`}>
            Seu WhatsApp
          </label>
          <input id={`lead-${s.id}`} type="tel" inputMode="tel" placeholder="Seu WhatsApp com DDD" value={contact} onChange={(e) => setContact(e.target.value)} required />
          <button className="sbtn">{s.props.button || 'Enviar'}</button>
        </form>
      )}
    </div>
  )
}

function SectionBody({ s, first }: { s: Section; first: boolean }) {
  const { products, categories, contents, path, store } = useStore()
  const p = s.props
  switch (s.type) {
    case 'banner':
      return <Banner s={s} heading={first} />
    case 'carousel':
      return <Carousel s={s} heading={first} />
    case 'video': {
      const id = youtubeId(p.url ?? '')
      return (
        <div className="rich center" style={{ maxWidth: 900 }}>
          <Title text={p.title} center />
          {id ? (
            <div className="video">
              <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title={p.title || 'Vídeo'} allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
            </div>
          ) : (
            <p className="muted">Cole o link de um vídeo do YouTube.</p>
          )}
          {p.text && <p>{p.text}</p>}
        </div>
      )
    }
    case 'categories': {
      const ids = (p.ids as string[]) ?? []
      const list = (ids.length ? ids.map((id) => categories.find((c) => c.id === id)) : categories).filter(Boolean) as typeof categories
      if (!list.length) return null
      return (
        <>
          <Title text={p.title} center />
          <div className={`cats ${p.shape ?? 'circle'}`}>
            {list.map((c) => (
              <Link key={c.id} to={path(`/c/${c.id}`)} className="cat">
                <span className="cimg">{c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : c.name[0]}</span>
                {c.name}
              </Link>
            ))}
          </div>
        </>
      )
    }
    case 'products': {
      const list = pickProducts(products, p)
      if (!list.length) return null
      return (
        <div id={p.source === 'all' ? 'produtos' : undefined}>
          <Title text={p.title} />
          <ProductGrid products={list} layout={p.layout} />
        </div>
      )
    }
    case 'featured_product': {
      const prod = products.find((x) => x.id === p.product_id && !x.blocked) ?? visibleProducts(products).find((x) => x.featured)
      if (!prod) return null
      return (
        <div className="featured">
          {prod.images[0] && <img src={prod.images[0]} alt={prod.name} loading="lazy" />}
          <div className="rich">
            {p.title && <span className="muted">{p.title}</span>}
            <h2 className="sec-title" style={{ marginBottom: 0 }}>
              {prod.name}
            </h2>
            <p>{p.text || prod.description}</p>
            <Price p={prod} big />
            <Link className="sbtn buy" to={path(`/p/${prod.id}`)}>
              Comprar
            </Link>
          </div>
        </div>
      )
    }
    case 'image_text':
      return (
        <div className={`imgtxt ${p.reverse ? 'rev' : ''}`}>
          {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div />}
          <div className="t">
            <h2 className="sec-title" style={{ marginBottom: 0 }}>
              {p.title}
            </h2>
            <p style={{ whiteSpace: 'pre-line' }}>{p.text}</p>
            <SectionLink link={p.link} label={p.button} />
          </div>
        </div>
      )
    case 'text':
      return (
        <div className={`rich ${p.align === 'center' ? 'center' : ''}`}>
          {p.title && <h2 className="sec-title" style={{ marginBottom: 0 }}>{p.title}</h2>}
          <p style={{ whiteSpace: 'pre-line' }}>{p.text}</p>
        </div>
      )
    case 'gallery': {
      const imgs = ((p.images as { url: string; link: string }[]) ?? []).filter((g) => g.url)
      if (!imgs.length) return null
      return (
        <>
          <Title text={p.title} center />
          <div className="gallery" style={{ '--gcols': p.columns ?? 3 } as React.CSSProperties}>
            {imgs.map((g, i) =>
              g.link ? (
                <SectionLinkImage key={i} link={g.link} url={g.url} />
              ) : (
                <img key={i} src={g.url} alt="" loading="lazy" />
              ),
            )}
          </div>
        </>
      )
    }
    case 'testimonials':
      return (
        <>
          <Title text={p.title} center />
          <div className="testis">
            {((p.items as { name: string; text: string; rating: number; photo: string }[]) ?? []).map((t, i) => (
              <figure key={i} className="testi" style={{ margin: 0 }}>
                <Stars value={t.rating || 5} />
                <blockquote style={{ margin: 0 }}>“{t.text}”</blockquote>
                <figcaption className="who">
                  {t.photo ? <img src={t.photo} alt="" /> : <span className="avatar">{t.name?.[0]}</span>}
                  {t.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )
    case 'benefits':
      return (
        <div className="benefits">
          {((p.items as { icon: string; text: string }[]) ?? []).map((b, i) => (
            <div key={i} className="benefit">
              <span className="bi">
                <Icon name={b.icon} size={22} />
              </span>
              {b.text}
            </div>
          ))}
        </div>
      )
    case 'faq':
      return (
        <>
          <Title text={p.title} center />
          <div className="faq">
            {((p.items as { q: string; a: string }[]) ?? []).map((f, i) => (
              <details key={i}>
                <summary>{f.q}</summary>
                <p style={{ whiteSpace: 'pre-line' }}>{f.a}</p>
              </details>
            ))}
          </div>
        </>
      )
    case 'map': {
      const address = p.address || store.settings.delivery.pickup.address || store.settings.legal.address
      const h = store.settings.hours
      return (
        <>
          <Title text={p.title} />
          <div className="mapbox">
            {address ? (
              <iframe title={`Mapa: ${address}`} loading="lazy" src={`https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`} />
            ) : (
              <p className="muted">Informe o endereço da loja.</p>
            )}
            <div className="box">
              <b>
                <Icon name="pin" size={16} /> {address}
              </b>
              {p.show_hours && h.enabled && (
                <div className="hours-list">
                  {h.days.map((d, i) => (
                    <div key={i}>
                      <span>{WEEKDAYS[i]}</span>
                      <span>{d.open ? `${d.from} às ${d.to}` : 'Fechado'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )
    }
    case 'countdown':
      return <Countdown s={s} />
    case 'posts': {
      const posts = contents.filter((c) => c.kind === 'post').sort((a, b) => b.publish_at.localeCompare(a.publish_at)).slice(0, Number(p.limit) || 3)
      if (!posts.length) return null
      return (
        <>
          <Title text={p.title} />
          <div className="posts">
            {posts.map((c) => (
              <Link key={c.id} to={path(`/blog/${c.slug}`)} className="post-card">
                {c.cover_url && <img src={c.cover_url} alt="" loading="lazy" />}
                <div>
                  <b>{c.title}</b>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {new Date(c.publish_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )
    }
    case 'lead':
      return <LeadForm s={s} />
  }
}

function SectionLinkImage({ link, url }: { link: string; url: string }) {
  const { path } = useStore()
  return /^https?:/.test(link) ? (
    <a href={link} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="" loading="lazy" />
    </a>
  ) : (
    <Link to={path(link.startsWith('/') ? link : '/' + link)}>
      <img src={url} alt="" loading="lazy" />
    </Link>
  )
}

export function Sections({ sections }: { sections: Section[] }) {
  const { store } = useStore()
  const visible = sections.filter((s) => s.enabled && planAtLeast(store.plan, SECTION_INFO[s.type].plan))
  return (
    <>
      {visible.map((s, i) => {
        const edge = s.type === 'banner' || s.type === 'carousel'
        const cls = [
          'sec',
          `pad-${s.style.pad}`,
          edge || s.style.width === 'full' ? 'full' : '',
          s.style.device === 'mobile' ? 'only-mobile' : s.style.device === 'desktop' ? 'only-desktop' : '',
        ].join(' ')
        return (
          <section key={s.id} className={cls} style={{ background: s.style.bg || undefined, paddingTop: edge && i === 0 ? 0 : undefined, paddingBottom: edge && s.style.pad === 'm' ? 0 : undefined }} data-section={s.id}>
            <Reveal className="wrap">
              <SectionBody s={s} first={i === 0} />
            </Reveal>
          </section>
        )
      })}
    </>
  )
}
