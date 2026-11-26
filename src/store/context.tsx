import { createContext, useContext } from 'react'
import type { useCart } from '../lib/cart'
import type { Category, Content, Product, Review, Store, Theme, Variant } from '../lib/types'

export interface StoreData {
  store: Store
  products: Product[]
  variants: Variant[]
  categories: Category[]
  contents: Content[]
  reviews: Review[]
}

export interface StoreCtx extends StoreData {
  theme: Theme
  /** Monta o caminho dentro da loja: path('/p/123') -> '/doces-da-ana/p/123'. */
  path: (p?: string) => string
  preview: boolean
  cart: ReturnType<typeof useCart>
  openCart: () => void
  feePercent: number
}

export const Ctx = createContext<StoreCtx | null>(null)
export const useStore = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useStore fora da loja')
  return c
}

/** Produtos visíveis na loja, na ordem definida pelo lojista. */
export const visibleProducts = (products: Product[]) =>
  products.filter((p) => !p.blocked).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

export function ratingOf(reviews: Review[], productId: string) {
  const rs = reviews.filter((r) => r.product_id === productId && r.approved)
  if (!rs.length) return null
  return { avg: rs.reduce((a, r) => a + r.rating, 0) / rs.length, count: rs.length }
}

export function youtubeId(url: string) {
  const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(url)
  return m?.[1] ?? ''
}
