import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { db, PLATFORM_NAME, track } from '../lib/api'
import { openState } from '../lib/hours'
import { can } from '../lib/plans'
import { PAY_LABEL, paymentOptions, quote } from '../lib/pricing'
import { FONT_PAIRS, fontStack, loadFont } from '../lib/theme'
import type { MenuItem, Theme } from '../lib/types'
import { brl, waLink } from '../lib/util'
import { Icon } from '../ui/icons'
import { useStore, visibleProducts } from './context'
import { QtyStepper } from './parts'

/** Cor do texto que fica legível sobre a cor principal. */
function onColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1d1d1b' : '#ffffff'
}

export function themeStyle(t: Theme): React.CSSProperties {
  const pair = FONT_PAIRS.find((f) => f.id === t.font) ?? FONT_PAIRS[0]
  const serif = /Playfair|DM Serif|Fraunces|Cormorant/.test(pair.head)
  return {
    '--st-primary': t.colors.primary,
    '--st-bg': t.colors.background,
    '--st-surface': t.colors.surface,
    '--st-text': t.colors.text,
    '--st-muted': t.colors.muted,
    '--st-accent': t.colors.accent,
    '--st-on-primary': onColor(t.colors.primary),
    '--st-head': fontStack(pair.head, serif),
    '--st-body': fontStack(pair.body),
  } as React.CSSProperties
}

export function themeClasses(t: Theme) {
  const a = t.animations
  return [
    'st',
    `r-${t.radius}`,
    `s-${t.spacing}`,
    `i-${a.intensity}`,
    `a-${a.sections}`,
    `h-${a.product_hover}`,
    `buy-${a.buy_button}`,
    a.page === 'fade' ? 'page-fade' : '',
  ].join(' ')
}

function useMenuHref() {
  const { path, categories, contents } = useStore()
  return (m: MenuItem) => {
    switch (m.type) {
      case 'home':
        return path('')
      case 'category':
        return categories.some((c) => c.id === m.target) ? path(`/c/${m.target}`) : null
      case 'page': {
        const c = contents.find((c) => c.id === m.target)
        return c ? path(`/pagina/${c.slug}`) : null
      }
      case 'blog':
        return path('/blog')
      case 'url':
        return m.target || null
    }
  }
}

function MenuLink({ m, onClick }: { m: MenuItem; onClick?: () => void }) {
  const href = useMenuHref()(m)
  if (!href) return null
  return /^https?:/.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
      {m.label}
    </a>
  ) : (
    <Link to={href} onClick={onClick}>
      {m.label}
    </Link>
  )
}

/** Itens do menu: os do tema mais as categorias e páginas marcadas para o menu, se o lojista não montou um. */
function useMenu(): MenuItem[] {
  const { theme, categories, contents, store } = useStore()
  return useMemo(() => {
    const custom = can(store, 'menu') && theme.menu.length > 1
    if (custom) return theme.menu
    return [
      { label: 'Início', type: 'home', target: '', children: [] },
      ...categories.slice(0, 6).map((c) => ({ label: c.name, type: 'category' as const, target: c.id, children: [] })),
      ...contents.filter((c) => c.kind === 'page' && c.show_in_menu).map((c) => ({ label: c.title, type: 'page' as const, target: c.id, children: [] })),
    ]
  }, [theme.menu, categories, contents, store])
}

function Announcement() {
  const { theme, path } = useStore()
  const a = theme.announcement
  const msgs = a.messages.filter(Boolean)
  const [i, setI] = useState(0)
  const mode = theme.animations.announcement
  useEffect(() => {
    if (mode !== 'rotate' || msgs.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % msgs.length), 4000)
    return () => clearInterval(t)
  }, [mode, msgs.length])
  if (!a.enabled || !msgs.length) return null
  const text =
    mode === 'marquee' ? (
      <span className="marquee">{msgs.join('   •   ')}</span>
    ) : (
      <span className="rot" key={i}>
        {msgs[mode === 'rotate' ? i % msgs.length : 0]}
      </span>
    )
  return (
    <div className="announce" role="note">
      {a.link ? <Link to={a.link.startsWith('/') ? path(a.link) : path('/' + a.link)}>{text}</Link> : text}
    </div>
  )
}

function Header({ onMenu, onSearch, overBanner }: { onMenu: () => void; onSearch: () => void; overBanner: boolean }) {
  const { store, theme, path, cart, openCart } = useStore()
  const h = theme.header
  const menu = useMenu()
  const [scroll, setScroll] = useState({ y: 0, dir: 0 })
  const [bump, setBump] = useState(false)
  const prevCount = useRef(cart.count)
  useEffect(() => {
    let last = scrollY
    const onScroll = () => {
      setScroll({ y: scrollY, dir: scrollY > last ? 1 : -1 })
      last = scrollY
    }
    addEventListener('scroll', onScroll, { passive: true })
    return () => removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (cart.count > prevCount.current && theme.animations.cart_bounce) {
      setBump(true)
      setTimeout(() => setBump(false), 450)
    }
    prevCount.current = cart.count
  }, [cart.count, theme.animations.cart_bounce])
  const transparent = h.transparent && overBanner && can(store, 'layout')
  const cls = [
    'shead',
    h.sticky ? 'sticky' : '',
    transparent ? 'transparent' : '',
    transparent && scroll.y > 40 ? 'scrolled' : '',
    theme.animations.header === 'shrink' && scroll.y > 60 ? 'small' : '',
    theme.animations.header === 'hide' && scroll.y > 200 && scroll.dir > 0 ? 'hidden' : '',
    h.logo_align === 'center' && can(store, 'layout') ? 'center' : '',
  ].join(' ')
  return (
    <header className={cls}>
      <div className="wrap shead-in">
        <button className="hicon menu-btn" onClick={onMenu} aria-label="Abrir menu">
          <Icon name="menu" />
        </button>
        <nav className="snav" aria-label="Menu principal">
          {menu.map((m, i) => (
            <div key={i}>
              <MenuLink m={m} />
              {m.children.length > 0 && (
                <div className="sub">
                  {m.children.map((c, j) => (
                    <MenuLink key={j} m={c} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <Link to={path('')} className="logo" aria-label={`${store.name}, página inicial`}>
          {store.logo_url ? <img src={store.logo_url} alt="" style={{ height: h.logo_size }} /> : null}
          {(!store.logo_url || h.logo_size < 48) && <span>{store.name}</span>}
        </Link>
        <div className="hicons">
          <button className="hicon" onClick={onSearch} aria-label="Buscar produtos">
            <Icon name="search" />
          </button>
          <button className="hicon" onClick={openCart} aria-label={`Carrinho, ${cart.count} itens`}>
            <Icon name="cart" />
            {cart.count > 0 && <span className={`count ${bump ? 'bump' : ''}`}>{cart.count}</span>}
          </button>
        </div>
      </div>
    </header>
  )
}

function SearchBar({ onClose }: { onClose: () => void }) {
  const { path } = useStore()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  return (
    <div className="wrap search-bar">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (!q.trim()) return
          nav(path(`/busca?q=${encodeURIComponent(q.trim())}`))
          onClose()
        }}
      >
        <label className="sr-only" htmlFor="st-q">
          Buscar
        </label>
        <input id="st-q" autoFocus type="search" placeholder="O que você procura?" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="sbtn">Buscar</button>
      </form>
    </div>
  )
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const { store } = useStore()
  const menu = useMenu()
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer left" aria-label="Menu">
        <div className="drawer-head">
          <b>{store.name}</b>
          <button className="hicon" onClick={onClose} aria-label="Fechar menu">
            <Icon name="close" />
          </button>
        </div>
        <nav className="drawer-body mnav">
          {menu.map((m, i) => (
            <div key={i}>
              <MenuLink m={m} onClick={onClose} />
              {m.children.length > 0 && (
                <div className="sub">
                  {m.children.map((c, j) => (
                    <MenuLink key={j} m={c} onClick={onClose} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}

function CartDrawer({ onClose }: { onClose: () => void }) {
  const { store, products, variants, cart, path, feePercent, preview } = useStore()
  const nav = useNavigate()
  const q = quote({ store, lines: cart.lines, products, variants, shipping: null, payment: null, coupon: null, feePercent, now: new Date() })
  const checkout = can(store, 'checkout')
  const [name, setName] = useState('')
  const [obs, setObs] = useState('')
  const open = openState(store.settings.hours)
  const blocked = !open.open && (store.settings.hours.paused || store.settings.hours.outside === 'block')
  const threshold = can(store, 'free_shipping_bar') ? store.settings.free_shipping_above_cents : 0
  const inCart = new Set(cart.lines.map((l) => l.product_id))
  const cats = new Set(products.filter((p) => inCart.has(p.id)).flatMap((p) => p.category_ids))
  const xsell = can(store, 'cross_sell')
    ? visibleProducts(products)
        .filter((p) => p.available && !inCart.has(p.id) && !p.options.length && p.category_ids.some((c) => cats.has(c)))
        .slice(0, 3)
    : []
  const sub = q.subtotal_cents
  const minErr = sub > 0 && sub < store.settings.min_order_cents

  function sendWhatsApp(e: FormEvent) {
    e.preventDefault()
    const lines = [
      `Olá! Quero fazer um pedido na *${store.name}*:`,
      '',
      ...q.items.map((i) => `• ${i.qty}x ${i.name}${i.variant_label ? ` (${i.variant_label})` : ''} — ${brl(i.unit_price_cents * i.qty)}`),
      '',
      `*Total: ${brl(sub)}*`,
      ...(name ? [`Nome: ${name}`] : []),
      ...(obs ? [`Obs.: ${obs}`] : []),
    ]
    track(store.id, 'checkout_start')
    track(store.id, 'order_placed', { data: { value_cents: sub } })
    window.open(waLink(store.whatsapp, lines.join('\n')), '_blank')
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer right" aria-label="Carrinho">
        <div className="drawer-head">
          <b>Seu carrinho</b>
          <button className="hicon" onClick={onClose} aria-label="Fechar carrinho">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          {!cart.lines.length ? (
            <div className="empty-state">
              <Icon name="cart" size={36} />
              <p>Seu carrinho está vazio.</p>
              <button className="sbtn" onClick={onClose}>
                Ver produtos
              </button>
            </div>
          ) : (
            <>
              {threshold > 0 && (
                <div className="freebar">
                  {q.free_shipping_missing_cents > 0 ? (
                    <span>
                      Faltam <b>{brl(q.free_shipping_missing_cents)}</b> para o frete grátis
                    </span>
                  ) : (
                    <span className="ok-text">Você ganhou frete grátis na entrega!</span>
                  )}
                  <div className="bar">
                    <span style={{ width: `${Math.min(100, (sub / threshold) * 100)}%` }} />
                  </div>
                </div>
              )}
              {cart.lines.map((l) => {
                const p = products.find((x) => x.id === l.product_id)
                const v = variants.find((x) => x.id === l.variant_id)
                const it = q.items.find((i) => i.product_id === l.product_id && i.variant_id === l.variant_id)
                if (!p) return null
                return (
                  <div className="cline" key={l.product_id + l.variant_id}>
                    <img src={v?.image || p.images[0]} alt="" />
                    <div className="cline-info">
                      <Link to={path(`/p/${p.id}`)} onClick={onClose} style={{ textDecoration: 'none', fontWeight: 600 }}>
                        {p.name}
                      </Link>
                      {v && <span className="note">{Object.values(v.values).join(' / ')}</span>}
                      <div className="row2">
                        <QtyStepper
                          small
                          label={p.name}
                          value={l.qty}
                          onChange={(n) => {
                            if (n < l.qty) track(store.id, 'remove_from_cart', { product_id: p.id })
                            cart.setQty(l.product_id, l.variant_id, n)
                          }}
                        />
                        <b>{it ? brl(it.unit_price_cents * it.qty) : '—'}</b>
                      </div>
                    </div>
                  </div>
                )
              })}
              {q.errors.filter((e) => !e.startsWith('O pedido mínimo')).map((e) => (
                <p key={e} className="err-text">
                  {e}
                </p>
              ))}
              {xsell.length > 0 && (
                <div className="xsell">
                  <b>Compre junto</b>
                  {xsell.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                      <Link to={path(`/p/${p.id}`)} onClick={onClose}>
                        <img src={p.images[0]} alt="" />
                        <span>{p.name}</span>
                      </Link>
                      <button className="sbtn small light" onClick={() => !preview && cart.add(p.id, null)} aria-label={`Adicionar ${p.name}`}>
                        + {brl(p.promo_price_cents ?? p.price_cents)}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {cart.lines.length > 0 && (
          <div className="drawer-foot">
            <div className="box-row" style={{ fontSize: '1.05rem' }}>
              <span>Subtotal</span>
              <b>{brl(sub)}</b>
            </div>
            {minErr && <p className="warn-text">O pedido mínimo é de {brl(store.settings.min_order_cents)}.</p>}
            {blocked && <p className="warn-text">{open.message}</p>}
            {checkout ? (
              <button
                className="sbtn full buy"
                disabled={minErr || blocked || q.errors.some((e) => !e.startsWith('O pedido mínimo'))}
                onClick={() => {
                  onClose()
                  nav(path('/checkout'))
                }}
              >
                Fechar pedido
              </button>
            ) : (
              <form onSubmit={sendWhatsApp} style={{ display: 'grid', gap: 8 }}>
                <input placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} aria-label="Seu nome" />
                <input placeholder="Observação (entrega, retirada…)" value={obs} onChange={(e) => setObs(e.target.value)} aria-label="Observação" />
                <button className="sbtn wa full" disabled={minErr || blocked}>
                  <Icon name="whatsapp" /> Enviar pedido pelo WhatsApp
                </button>
              </form>
            )}
          </div>
        )}
      </aside>
    </>
  )
}

function Footer() {
  const { store, theme, path, contents, categories } = useStore()
  const s = store.settings
  const pays = paymentOptions(store)
  const custom = can(store, 'footer') && theme.footer.columns.length > 0
  return (
    <footer className="sfoot">
      <div className="wrap">
        <div className="fcols">
          <div>
            <h3>{store.name}</h3>
            {(theme.footer.text || store.description) && <p className="muted" style={{ marginBottom: 10 }}>{theme.footer.text || store.description}</p>}
            <a href={waLink(store.whatsapp, `Olá, ${store.name}!`)} target="_blank" rel="noopener noreferrer">
              WhatsApp {store.whatsapp}
            </a>
            {s.instagram && (
              <a href={`https://instagram.com/${s.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">
                Instagram @{s.instagram.replace(/^@/, '')}
              </a>
            )}
            {s.facebook && (
              <a href={/^https?:/.test(s.facebook) ? s.facebook : `https://facebook.com/${s.facebook}`} target="_blank" rel="noopener noreferrer">
                Facebook
              </a>
            )}
            {s.tiktok && (
              <a href={`https://tiktok.com/@${s.tiktok.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">
                TikTok
              </a>
            )}
            {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
          </div>
          {custom ? (
            theme.footer.columns.map((c, i) => (
              <div key={i}>
                <h3>{c.title}</h3>
                {c.links.map((m, j) => (
                  <MenuLink key={j} m={m} />
                ))}
              </div>
            ))
          ) : (
            <>
              {categories.length > 0 && (
                <div>
                  <h3>Categorias</h3>
                  {categories.slice(0, 8).map((c) => (
                    <Link key={c.id} to={path(`/c/${c.id}`)}>
                      {c.name}
                    </Link>
                  ))}
                </div>
              )}
              <div>
                <h3>Institucional</h3>
                {contents
                  .filter((c) => c.kind === 'page')
                  .map((c) => (
                    <Link key={c.id} to={path(`/pagina/${c.slug}`)}>
                      {c.title}
                    </Link>
                  ))}
                {contents.some((c) => c.kind === 'post') && <Link to={path('/blog')}>Blog</Link>}
              </div>
            </>
          )}
          <div>
            <h3>Ajuda</h3>
            <Link to={path('/politicas/troca')}>Trocas e devoluções</Link>
            <Link to={path('/politicas/entrega')}>Entrega</Link>
            <Link to={path('/politicas/privacidade')}>Privacidade</Link>
            {theme.footer.show_payments && pays.length > 0 && (
              <div className="paychips" style={{ marginTop: 10 }} aria-label="Formas de pagamento">
                {pays.map((p) => (
                  <span key={p}>{p === 'mercadopago' ? 'Cartão e boleto' : p === 'whatsapp' ? 'Combinar' : PAY_LABEL[p].split(' ')[0]}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="legal">
          {s.legal.name && (
            <span>
              {s.legal.name}
              {s.legal.document && ` · ${s.legal.document.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF'} ${s.legal.document}`}
            </span>
          )}
          {s.legal.address && <span>{s.legal.address}</span>}
          {!(theme.hide_branding && can(store, 'hide_branding')) && (
            <span>
              Loja criada com{' '}
              <a href="/" style={{ color: 'inherit' }}>
                {PLATFORM_NAME}
              </a>
            </span>
          )}
        </div>
      </div>
    </footer>
  )
}

function LeadPopup() {
  const { store, preview } = useStore()
  const cfg = store.settings.lead_popup
  const key = `vt_lead_${store.id}`
  const [show, setShow] = useState(false)
  const [contact, setContact] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (preview || !cfg.enabled || !can(store, 'lead_popup')) return
    try {
      if (localStorage.getItem(key)) return
    } catch {
      return
    }
    const t = setTimeout(() => setShow(true), Math.max(3, cfg.delay_s) * 1000)
    return () => clearTimeout(t)
  }, [cfg.enabled, cfg.delay_s, key, preview, store])
  const close = () => {
    setShow(false)
    try {
      localStorage.setItem(key, '1')
    } catch {
      /* ignora */
    }
  }
  if (!show) return null
  return (
    <div className="popup" role="dialog" aria-label="Oferta">
      <button className="hicon x" onClick={close} aria-label="Fechar">
        <Icon name="close" />
      </button>
      <b style={{ fontSize: '1.15rem', paddingRight: 30 }}>{cfg.text}</b>
      {done ? (
        <p>
          {cfg.coupon ? (
            <>
              Use o cupom <b>{cfg.coupon}</b> no fechamento do pedido.
            </>
          ) : (
            'Obrigado! Em breve entraremos em contato.'
          )}
        </p>
      ) : (
        <form
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (contact.replace(/\D/g, '').length < 10) return
            await db.insert('leads', { store_id: store.id, contact }).catch(() => undefined)
            setDone(true)
            try {
              localStorage.setItem(key, '1')
            } catch {
              /* ignora */
            }
          }}
        >
          <input type="tel" inputMode="tel" placeholder="Seu WhatsApp com DDD" value={contact} onChange={(e) => setContact(e.target.value)} aria-label="Seu WhatsApp" style={{ flex: '1 1 180px' }} required />
          <button className="sbtn">Quero</button>
        </form>
      )}
    </div>
  )
}

/** Ferramentas de anúncio: só carregam depois que o visitante aceita os cookies. */
function TrackingConsent() {
  const { store, preview } = useStore()
  const t = store.settings.tracking
  const ids = {
    ga4: /^G-[A-Z0-9]{4,15}$/.test(t.ga4) ? t.ga4 : '',
    meta: /^\d{6,20}$/.test(t.meta_pixel) ? t.meta_pixel : '',
    tiktok: /^[A-Z0-9]{10,30}$/.test(t.tiktok_pixel) ? t.tiktok_pixel : '',
  }
  const any = can(store, 'tracking_pixels') && (ids.ga4 || ids.meta || ids.tiktok)
  const key = `vt_consent_${store.id}`
  const [answer, setAnswer] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (!any || answer !== 'yes' || preview) return
    const add = (src: string, inline?: string) => {
      if (src) {
        const s = document.createElement('script')
        s.async = true
        s.src = src
        document.head.appendChild(s)
      }
      if (inline) {
        const s = document.createElement('script')
        s.text = inline
        document.head.appendChild(s)
      }
    }
    if (ids.ga4) add(`https://www.googletagmanager.com/gtag/js?id=${ids.ga4}`, `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ids.ga4}');`)
    if (ids.meta)
      add('', `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${ids.meta}');fbq('track','PageView');`)
    if (ids.tiktok)
      add('', `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var s=d.createElement("script");s.async=!0;s.src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid="+e;d.head.appendChild(s)};ttq.load('${ids.tiktok}');ttq.page()}(window,document,'ttq');`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer])
  if (!any || answer || preview) return null
  const set = (v: string) => {
    setAnswer(v)
    try {
      localStorage.setItem(key, v)
    } catch {
      /* ignora */
    }
  }
  return (
    <div className="cookie" role="dialog" aria-label="Cookies">
      <span style={{ flex: '1 1 240px' }}>Usamos cookies para medir visitas e melhorar nossos anúncios. Você aceita?</span>
      <button className="sbtn" onClick={() => set('yes')}>
        Aceitar
      </button>
      <button className="sbtn light" onClick={() => set('no')}>
        Recusar
      </button>
    </div>
  )
}

export function StoreShell({ children, overBanner, cartOpen, setCartOpen }: { children: ReactNode; overBanner: boolean; cartOpen: boolean; setCartOpen: (v: boolean) => void }) {
  const { store, theme, preview } = useStore()
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  useEffect(() => loadFont(theme.font), [theme.font])
  const open = openState(store.settings.hours)
  const loc = useLocation()
  const ownWhatsApp = /\/(p|checkout|pedido)(\/|$)/.test(loc.pathname)
  return (
    <div
      className={themeClasses(theme)}
      style={themeStyle(theme)}
      onClickCapture={(e) => {
        // Na prévia do editor, os links não saem da página.
        if (preview && (e.target as HTMLElement).closest('a')) e.preventDefault()
      }}
    >
      <Announcement />
      {!open.open && <div className="closed-bar">{open.message}</div>}
      <Header onMenu={() => setMenu(true)} onSearch={() => setSearch((s) => !s)} overBanner={overBanner} />
      {search && <SearchBar onClose={() => setSearch(false)} />}
      <main>{children}</main>
      <Footer />
      {theme.whatsapp_button && !ownWhatsApp && (
        <a className="wa-float" href={waLink(store.whatsapp, `Olá, ${store.name}! Vim pela loja online.`)} target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp">
          <Icon name="whatsapp" />
        </a>
      )}
      {menu && <MobileMenu onClose={() => setMenu(false)} />}
      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
      <LeadPopup />
      <TrackingConsent />
    </div>
  )
}
