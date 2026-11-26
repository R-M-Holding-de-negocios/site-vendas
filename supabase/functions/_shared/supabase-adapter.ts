// PaymentsDb em cima de um cliente supabase-js criado com a service role.
// Recebe o cliente pronto, para não importar supabase-js aqui (fica nos index.ts).
import type { MpSecret, OAuthState, Order, OrderStatus, PaymentsDb, StoreLite } from './types.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

const STORE_COLS = 'id, owner_id, slug, name, plan, status, settings'

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

export function supabasePaymentsDb(sb: Client): PaymentsDb {
  return {
    async storeByOwner(userId) {
      return check(await sb.from('stores').select(STORE_COLS).eq('owner_id', userId).limit(1).maybeSingle()) as StoreLite | null
    },
    async store(id) {
      return check(await sb.from('stores').select(STORE_COLS).eq('id', id).maybeSingle()) as StoreLite | null
    },
    async insertState(row) {
      // Aproveita para limpar states vencidos (mais de 1 dia).
      await sb.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 86400_000).toISOString())
      check(await sb.from('oauth_states').insert(row))
    },
    async takeState(state) {
      const rows = check(await sb.from('oauth_states').delete().eq('state', state).select('*')) as OAuthState[] | null
      return rows?.[0] ?? null
    },
    async getSecret(storeId) {
      const row = check(
        await sb.from('store_secrets').select('data').eq('store_id', storeId).eq('provider', 'mercadopago').maybeSingle(),
      ) as { data: MpSecret } | null
      return row?.data ?? null
    },
    async saveSecret(storeId, data) {
      check(await sb.from('store_secrets').upsert({ store_id: storeId, provider: 'mercadopago', data }, { onConflict: 'store_id,provider' }))
    },
    async order(id) {
      return check(await sb.from('orders').select('*').eq('id', id).maybeSingle()) as Order | null
    },
    async updateOrderIf(id: string, from: OrderStatus[], patch: Partial<Order>) {
      const rows = check(await sb.from('orders').update(patch).eq('id', id).in('status', from).select('id')) as { id: string }[] | null
      return !!rows?.length
    },
  }
}
