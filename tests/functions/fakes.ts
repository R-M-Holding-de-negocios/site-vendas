// Dublês para testar as funções de pagamento sem Supabase nem Mercado Pago.
import type { Deps, Env, MpSecret, OAuthState, Order, PaymentsDb, StoreLite } from '../../supabase/functions/_shared/types'

export const STORE_ID = '11111111-1111-4111-8111-111111111111'
export const ORDER_ID = '22222222-2222-4222-8222-222222222222'
export const NOW = new Date('2026-11-26T12:00:00Z')

export const env: Env = {
  MP_CLIENT_ID: '123456',
  MP_CLIENT_SECRET: 'segredo-app',
  MP_REDIRECT_URI: 'https://proj.supabase.co/functions/v1/mp-oauth-callback',
  MP_WEBHOOK_SECRET: 'segredo-webhook',
  SITE_URL: 'https://vitrine.example',
  FUNCTIONS_URL: 'https://proj.supabase.co/functions/v1',
}

export const store = (p: Partial<StoreLite> = {}): StoreLite => ({
  id: STORE_ID,
  owner_id: 'user-1',
  slug: 'doces-da-ana',
  name: 'Doces da Ána & Cia',
  plan: 'loja',
  status: 'active',
  settings: { max_installments: 6 },
  ...p,
})

export const order = (p: Partial<Order> = {}): Order => ({
  id: ORDER_ID,
  store_id: STORE_ID,
  number: 42,
  status: 'pending',
  token: 'tok123',
  customer: { name: 'Maria da Silva Souza', phone: '(11) 98765-4321', email: 'maria@example.com' },
  shipping: { method: 'zone', label: 'Centro', fee_cents: 800 },
  payment: { method: 'mercadopago', status: 'pending', provider_ref: '', change_for_cents: 0 },
  items: [
    { product_id: 'p1', name: 'Brigadeiro', variant_label: '', unit_price_cents: 350, qty: 10, image: 'https://cdn.example/b.jpg' },
    { product_id: 'p2', name: 'Bolo', variant_label: 'Chocolate / G', unit_price_cents: 8990, qty: 1, image: '' },
  ],
  subtotal_cents: 12490,
  discount_cents: 0,
  shipping_cents: 800,
  total_cents: 13290,
  platform_fee_cents: 266,
  history: [{ status: 'pending', at: '2026-11-26T11:00:00Z', note: '' }],
  paid_at: null,
  ...p,
})

export const secret = (p: Partial<MpSecret> = {}): MpSecret => ({
  access_token: 'APP_USR-seller',
  refresh_token: 'TG-refresh',
  user_id: 999,
  public_key: 'APP_USR-pk',
  expires_at: '2027-05-01T00:00:00Z',
  ...p,
})

export class FakeDb implements PaymentsDb {
  stores: StoreLite[] = [store()]
  orders: Order[] = [order()]
  states: OAuthState[] = []
  secrets = new Map<string, MpSecret>([[STORE_ID, secret()]])
  updates = 0

  async storeByOwner(userId: string) {
    return this.stores.find((s) => s.owner_id === userId) ?? null
  }
  async store(id: string) {
    return this.stores.find((s) => s.id === id) ?? null
  }
  async insertState(row: OAuthState) {
    this.states.push(row)
  }
  async takeState(state: string) {
    const i = this.states.findIndex((s) => s.state === state)
    return i < 0 ? null : this.states.splice(i, 1)[0]
  }
  async getSecret(storeId: string) {
    return this.secrets.get(storeId) ?? null
  }
  async saveSecret(storeId: string, data: MpSecret) {
    this.secrets.set(storeId, data)
  }
  async order(id: string) {
    const o = this.orders.find((x) => x.id === id)
    return o ? structuredClone(o) : null
  }
  async updateOrderIf(id: string, from: Order['status'][], patch: Partial<Order>) {
    const o = this.orders.find((x) => x.id === id)
    if (!o || !from.includes(o.status)) return false
    Object.assign(o, structuredClone(patch))
    this.updates++
    return true
  }
}

export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** fetch falso: responde conforme `routes` (chave "MÉTODO caminho"). */
export function fakeFetch(routes: Record<string, (c: Call) => unknown>) {
  const calls: Call[] = []
  const f = async (input: string, init: RequestInit = {}) => {
    const u = new URL(input)
    const c: Call = {
      url: input,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(c)
    const h = routes[`${c.method} ${u.pathname}`]
    if (!h) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    const out = h(c)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch: f, calls }
}

export const makeDeps = (db: FakeDb, f: Deps['fetch'], now = NOW): Deps => ({ db, fetch: f, env, now: () => now })
