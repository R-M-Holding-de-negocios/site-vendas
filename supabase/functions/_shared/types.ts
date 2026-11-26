// Tipos mínimos usados pelas funções de pagamento. Espelham src/lib/types.ts,
// mas ficam aqui para que as funções não dependam de arquivos fora de supabase/functions
// (o deploy das Edge Functions só empacota o que está nesta pasta).

export type OrderStatus = 'pending' | 'paid' | 'preparing' | 'ready' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'

export interface OrderItem {
  product_id: string
  name: string
  variant_label: string
  unit_price_cents: number
  qty: number
  image: string
}

export interface Order {
  id: string
  store_id: string
  number: number
  status: OrderStatus
  token: string
  customer: { name: string; phone: string; email: string }
  shipping: { method: string; label: string; fee_cents: number }
  payment: { method: string; status: 'pending' | 'paid' | 'refunded'; provider_ref: string; change_for_cents: number }
  items: OrderItem[]
  subtotal_cents: number
  discount_cents: number
  shipping_cents: number
  total_cents: number
  platform_fee_cents: number
  history: { status: OrderStatus; at: string; note: string }[]
  paid_at: string | null
}

export interface StoreLite {
  id: string
  owner_id: string
  slug: string
  name: string
  plan: string
  status: string
  settings?: { max_installments?: number } | null
}

/** O que fica em store_secrets.data para provider 'mercadopago'. */
export interface MpSecret {
  access_token: string
  refresh_token: string
  user_id: number | string
  public_key: string
  /** ISO 8601 */
  expires_at: string
}

export interface OAuthState {
  state: string
  store_id: string
  user_id: string
  created_at: string
}

/** Acesso ao banco com a service role. Implementado em supabase-adapter.ts e por dublês nos testes. */
export interface PaymentsDb {
  storeByOwner(userId: string): Promise<StoreLite | null>
  store(id: string): Promise<StoreLite | null>
  insertState(row: OAuthState): Promise<void>
  /** Lê e apaga o state (uso único). */
  takeState(state: string): Promise<OAuthState | null>
  getSecret(storeId: string): Promise<MpSecret | null>
  saveSecret(storeId: string, data: MpSecret): Promise<void>
  order(id: string): Promise<Order | null>
  /**
   * Atualiza o pedido só se o status atual estiver em `from` (evita processar duas vezes).
   * Devolve true se alguma linha mudou.
   */
  updateOrderIf(id: string, from: OrderStatus[], patch: Partial<Order>): Promise<boolean>
}

export interface Env {
  MP_CLIENT_ID: string
  MP_CLIENT_SECRET: string
  MP_REDIRECT_URI: string
  MP_WEBHOOK_SECRET: string
  SITE_URL: string
  /** URL pública das funções, ex.: https://xyz.supabase.co/functions/v1 */
  FUNCTIONS_URL: string
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface Deps {
  fetch: Fetch
  db: PaymentsDb
  env: Env
  now: () => Date
}
