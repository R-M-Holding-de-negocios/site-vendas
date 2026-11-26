import { lazy, useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { db, storeBySlug, track } from '../lib/api'
import { decodeCart, useCart } from '../lib/cart'
import { can, DEFAULT_PLANS } from '../lib/plans'
import type { Theme } from '../lib/types'
import '../styles/store.css'
import { Ctx, type StoreCtx, type StoreData } from './context'
import { BlogPage, ContentPage, HomePage, ListPage, PolicyPage, ProductPage } from './pages'
import { StoreShell } from './StoreShell'

/** Tudo menos o custo, que só o lojista vê (ver supabase/migrations/0003). */
const PUBLIC_PRODUCT_COLUMNS =
  'id,store_id,name,description,price_cents,promo_price_cents,promo_ends_at,images,category_ids,available,featured,position,sku,track_stock,stock,weight_g,height_cm,width_cm,length_cm,options,qty_discounts,video_url,seo,blocked,sold_count,created_at'

const Checkout = lazy(() => import('./Checkout'))
const OrderPage = lazy(() => import('./OrderPage'))

export async function loadStoreData(slug: string): Promise<StoreData | null> {
  const store = await storeBySlug(slug)
  if (!store) return null
  const id = store.id
  const nowIso = new Date().toISOString()
  const [products, variants, categories, contents, reviews, plans] = await Promise.all([
    db.list('products', { eq: { store_id: id, blocked: false }, columns: PUBLIC_PRODUCT_COLUMNS }).then((ps) => ps.map((p) => ({ ...p, cost_cents: null }))),
    db.list('variants', { eq: { store_id: id } }),
    db.list('categories', { eq: { store_id: id }, order: ['position', 'asc'] }),
    db.list('contents', { eq: { store_id: id, status: 'published' } }),
    can(store, 'reviews') ? db.list('reviews', { eq: { store_id: id, approved: true } }) : Promise.resolve([]),
    db.list('plans').catch(() => DEFAULT_PLANS),
  ])
  const data = {
    store,
    products,
    variants,
    categories,
    contents: contents.filter((c) => c.publish_at <= nowIso && (c.kind === 'page' ? can(store, 'pages') : can(store, 'posts'))),
    reviews,
  }
  feeCache[id] = (plans.length ? plans : DEFAULT_PLANS).find((p) => p.id === store.plan)?.fee_percent ?? 0
  return data
}
const feeCache: Record<string, number> = {}

/** Contexto da loja; usado pela loja publicada e pela prévia do editor. */
export function useStoreCtx(data: StoreData, theme: Theme, preview: boolean): StoreCtx & { cartOpen: boolean; setCartOpen: (v: boolean) => void } {
  const cart = useCart(data.store.id)
  const [cartOpen, setCartOpen] = useState(false)
  const slug = data.store.slug
  return useMemo(
    () => ({
      ...data,
      theme,
      preview,
      cart,
      cartOpen,
      setCartOpen,
      openCart: () => setCartOpen(true),
      path: (p = '') => `/${slug}${p}`,
      feePercent: feeCache[data.store.id] ?? 0,
    }),
    [data, theme, preview, cart, cartOpen, slug],
  )
}

function Loaded({ data }: { data: StoreData }) {
  const ctx = useStoreCtx(data, data.store.theme, false)
  const loc = useLocation()
  const [params] = useSearchParams()
  useEffect(() => {
    scrollTo(0, 0)
  }, [loc.pathname])
  useEffect(() => {
    const key = `vt_visit_${data.store.id}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      /* ignora */
    }
    track(data.store.id, 'visit', { data: { path: loc.pathname } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Link de recuperação de carrinho: ?carrinho=...
  useEffect(() => {
    const c = params.get('carrinho')
    if (c) {
      const lines = decodeCart(c).filter((l) => data.products.some((p) => p.id === l.product_id))
      if (lines.length) {
        ctx.cart.replace(lines)
        ctx.setCartOpen(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const first = data.store.theme.sections.find((s) => s.enabled)
  const isHome = loc.pathname.replace(/\/$/, '') === `/${data.store.slug}`
  return (
    <Ctx.Provider value={ctx}>
      <StoreShell overBanner={isHome && (first?.type === 'banner' || first?.type === 'carousel')} cartOpen={ctx.cartOpen} setCartOpen={ctx.setCartOpen}>
        <div className="page-wrap" key={loc.pathname}>
          <Routes>
            <Route index element={<HomePage />} />
            <Route path="p/:id" element={<ProductPage />} />
            <Route path="c/:id" element={<ListPage mode="category" />} />
            <Route path="busca" element={<ListPage mode="search" />} />
            <Route path="produtos" element={<ListPage mode="all" />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="pedido/:id" element={<OrderPage />} />
            <Route path="pagina/:slug" element={<ContentPage kind="page" />} />
            <Route path="blog" element={<BlogPage />} />
            <Route path="blog/:slug" element={<ContentPage kind="post" />} />
            <Route path="politicas/:kind" element={<PolicyPage />} />
            <Route path="*" element={<ListPage mode="all" />} />
          </Routes>
        </div>
      </StoreShell>
    </Ctx.Provider>
  )
}

export default function StoreApp() {
  const { slug = '' } = useParams()
  const [data, setData] = useState<StoreData | null | undefined>(undefined)
  useEffect(() => {
    setData(undefined)
    loadStoreData(slug).then(setData, () => setData(null))
  }, [slug])
  if (data === undefined)
    return (
      <div className="main">
        <div className="loading">
          <span className="spinner" /> Carregando a loja…
        </div>
      </div>
    )
  if (!data)
    return (
      <div className="auth" style={{ textAlign: 'center' }}>
        <h1>Loja não encontrada</h1>
        <p className="muted">Confira se o endereço está correto. A loja também pode estar temporariamente indisponível.</p>
        <Link to="/">Conhecer a plataforma</Link>
      </div>
    )
  return <Loaded data={data} />
}
