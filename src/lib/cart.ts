import { useCallback, useEffect, useState } from 'react'
import type { CartLine } from './pricing'

const key = (storeId: string) => `vt_cart_${storeId}`

function read(storeId: string): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(key(storeId)) ?? '[]')
  } catch {
    return []
  }
}

/** Carrinho guardado no aparelho, para não se perder se o cliente sair e voltar. */
export function useCart(storeId: string) {
  const [lines, setLines] = useState<CartLine[]>(() => read(storeId))
  useEffect(() => setLines(read(storeId)), [storeId])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === key(storeId) && setLines(read(storeId))
    addEventListener('storage', onStorage)
    return () => removeEventListener('storage', onStorage)
  }, [storeId])

  const save = useCallback(
    (next: CartLine[]) => {
      setLines(next)
      try {
        localStorage.setItem(key(storeId), JSON.stringify(next))
      } catch {
        /* sem espaço */
      }
    },
    [storeId],
  )

  const add = (product_id: string, variant_id: string | null, qty = 1) => {
    const i = lines.findIndex((l) => l.product_id === product_id && l.variant_id === variant_id)
    if (i >= 0) save(lines.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l)))
    else save([...lines, { product_id, variant_id, qty }])
  }
  const setQty = (product_id: string, variant_id: string | null, qty: number) =>
    save(
      qty <= 0
        ? lines.filter((l) => !(l.product_id === product_id && l.variant_id === variant_id))
        : lines.map((l) => (l.product_id === product_id && l.variant_id === variant_id ? { ...l, qty } : l)),
    )
  return { lines, add, setQty, clear: () => save([]), replace: save, count: lines.reduce((n, l) => n + l.qty, 0) }
}

/** Link que restaura um carrinho (usado na recuperação de carrinho abandonado). */
export const encodeCart = (lines: CartLine[]) =>
  btoa(JSON.stringify(lines.map((l) => [l.product_id, l.variant_id, l.qty])))
export function decodeCart(s: string): CartLine[] {
  try {
    return (JSON.parse(atob(s)) as [string, string | null, number][]).map(([product_id, variant_id, qty]) => ({ product_id, variant_id, qty }))
  } catch {
    return []
  }
}
