import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../lib/api'
import { can } from '../lib/plans'
import { basePrice, promoActive } from '../lib/pricing'
import type { Product, Variant } from '../lib/types'
import { brl } from '../lib/util'
import { Icon } from '../ui/icons'
import { ratingOf, useStore } from './context'

export function Reveal({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' }) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setIn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return setIn(true)
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setIn(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`}>
      {children}
    </Tag>
  )
}

export function Stars({ value, count }: { value: number; count?: number }) {
  return (
    <span className="stars" aria-label={`Nota ${value.toFixed(1).replace('.', ',')} de 5${count ? `, ${count} avaliações` : ''}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" filled={i <= Math.round(value)} size={14} />
      ))}
      {count != null && <span className="muted">&nbsp;({count})</span>}
    </span>
  )
}

/** Preço atual e, quando há promoção, o preço antigo riscado. */
export function priceInfo(p: Product, variants: Variant[], now = new Date()) {
  const own = variants.filter((v) => v.product_id === p.id && v.available && v.price_cents != null).map((v) => v.price_cents!)
  const current = basePrice(p, null, now)
  const from = own.length && Math.min(...own) !== current ? Math.min(current, ...own) : null
  const promo = promoActive(p, now) && p.promo_price_cents! < p.price_cents
  return { current: from ?? current, old: promo ? p.price_cents : null, from: from != null, off: promo ? Math.round((1 - p.promo_price_cents! / p.price_cents) * 100) : 0 }
}

export function Price({ p, big }: { p: Product; big?: boolean }) {
  const { variants } = useStore()
  const i = priceInfo(p, variants)
  return (
    <div className="price" style={big ? { fontSize: '1.5rem' } : undefined}>
      {i.from && <span className="muted" style={{ fontWeight: 400, fontSize: '0.85em' }}>a partir de</span>}
      <span>{brl(i.current)}</span>
      {i.old && <s aria-label={`Preço antigo ${brl(i.old)}`}>{brl(i.old)}</s>}
    </div>
  )
}

export function soldOut(p: Product, variants: Variant[]) {
  if (!p.available) return true
  if (!p.track_stock) return false
  if (p.options.length) return !variants.some((v) => v.product_id === p.id && v.available && v.stock > 0)
  return p.stock <= 0
}

export function ProductCard({ p }: { p: Product }) {
  const { theme, path, variants, reviews, store, cart, preview } = useStore()
  const t = theme.product
  const out = soldOut(p, variants)
  const info = priceInfo(p, variants)
  const isNew = Date.now() - new Date(p.created_at).getTime() < 14 * 86400000
  const low = p.track_stock && !p.options.length && p.stock > 0 && p.stock <= 3
  const rating = t.card.rating && can(store, 'reviews') ? ratingOf(reviews, p.id) : null
  const [added, setAdded] = useState(false)
  return (
    <Link to={path(`/p/${p.id}`)} className={`pcard ${out ? 'unavailable' : ''}`}>
      <div className="pimg">
        {t.card.badge && (
          <div className="tags">
            {out ? (
              <span className="tag dark">Esgotado</span>
            ) : (
              <>
                {info.off > 0 && <span className="tag sale">-{info.off}%</span>}
                {low && <span className="tag">Últimas unidades</span>}
                {isNew && !info.off && <span className="tag">Novo</span>}
              </>
            )}
          </div>
        )}
        {p.images[0] ? <img src={p.images[0]} alt={p.name} loading="lazy" /> : <div style={{ width: '100%', height: '100%' }} />}
        {p.images[1] && theme.animations.product_hover === 'swap' && <img className="alt" src={p.images[1]} alt="" loading="lazy" />}
      </div>
      <span className="pname">{p.name}</span>
      {rating && <Stars value={rating.avg} count={rating.count} />}
      <Price p={p} />
      {t.card.installments && store.settings.max_installments > 1 && info.current >= 2000 && (
        <span className="inst">
          ou {store.settings.max_installments}x de {brl(Math.ceil(info.current / store.settings.max_installments))}
        </span>
      )}
      {t.card.add_button && !out && (
        <button
          type="button"
          className="sbtn small buy"
          onClick={(e) => {
            if (p.options.length) return // abre a página para escolher a opção
            e.preventDefault()
            if (preview) return
            cart.add(p.id, null, 1)
            track(store.id, 'add_to_cart', { product_id: p.id })
            setAdded(true)
            setTimeout(() => setAdded(false), 1400)
          }}
        >
          {p.options.length ? 'Escolher' : added ? 'Adicionado ✓' : 'Adicionar'}
        </button>
      )}
    </Link>
  )
}

export function ProductGrid({ products, layout = 'grid' }: { products: Product[]; layout?: 'grid' | 'carousel' }) {
  const { theme } = useStore()
  const style = {
    '--cols-m': theme.product.cols_mobile,
    '--cols-d': theme.product.cols_desktop,
    '--ratio': theme.product.ratio.replace('/', ' / '),
    '--fit': theme.product.fit,
  } as React.CSSProperties
  return (
    <div className={layout === 'carousel' ? 'prow' : 'pgrid'} style={style}>
      {products.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </div>
  )
}

export function QtyStepper({ value, onChange, small, max = 999, label }: { value: number; onChange: (n: number) => void; small?: boolean; max?: number; label: string }) {
  return (
    <div className={`qty ${small ? 'small' : ''}`} role="group" aria-label={`Quantidade de ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} aria-label="Diminuir">
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Aumentar">
        +
      </button>
    </div>
  )
}
