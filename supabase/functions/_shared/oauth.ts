// Conexão da conta Mercado Pago do lojista (OAuth, modelo marketplace).
import { UserError, randomState } from './http.ts'
import { authorizationUrl, exchangeCode } from './mp.ts'
import type { Deps, OAuthState } from './types.ts'

export const STATE_MAX_AGE_MS = 3600 * 1000

/** Planos que podem receber pagamento online (ver FEATURES.mercadopago em src/lib/plans.ts). */
const PLANS_WITH_MP = ['loja', 'pro']

/** mp-oauth-start: devolve a URL da página de autorização do Mercado Pago. */
export async function startOAuth(deps: Deps, userId: string | null): Promise<{ url: string }> {
  if (!userId) throw new UserError('Entre na sua conta para conectar o Mercado Pago.', 401)
  const store = await deps.db.storeByOwner(userId)
  if (!store) throw new UserError('Crie sua loja antes de conectar o Mercado Pago.', 404)
  if (!PLANS_WITH_MP.includes(store.plan)) throw new UserError('O pagamento pelo Mercado Pago está disponível a partir do plano Loja.', 403)
  if (!deps.env.MP_CLIENT_ID || !deps.env.MP_REDIRECT_URI) throw new Error('MP_CLIENT_ID/MP_REDIRECT_URI não configurados')
  const state = randomState()
  await deps.db.insertState({ state, store_id: store.id, user_id: userId, created_at: deps.now().toISOString() })
  return { url: authorizationUrl(deps.env, state) }
}

/** O state existe e tem menos de 1 hora? */
export function stateIsValid(row: OAuthState | null, now: Date): row is OAuthState {
  if (!row) return false
  const age = now.getTime() - Date.parse(row.created_at)
  return Number.isFinite(age) && age >= -60_000 && age < STATE_MAX_AGE_MS
}

/** mp-oauth-callback: troca o código pelos tokens e devolve para onde mandar o navegador. */
export async function finishOAuth(deps: Deps, params: URLSearchParams): Promise<string> {
  const back = (result: 'conectado' | 'erro') => `${deps.env.SITE_URL.replace(/\/+$/, '')}/painel/integracoes?mp=${result}`
  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return back('erro')
  try {
    const row = await deps.db.takeState(state)
    if (!stateIsValid(row, deps.now())) return back('erro')
    const secret = await exchangeCode(deps, code)
    await deps.db.saveSecret(row.store_id, secret)
    return back('conectado')
  } catch (e) {
    console.error('mp-oauth-callback', e)
    return back('erro')
  }
}
