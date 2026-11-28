// Chamadas à API do Mercado Pago. Só Web APIs: recebe `fetch` como parâmetro.
import type { Deps, Env, Fetch, MpSecret } from './types.ts'

export const MP_API = 'https://api.mercadopago.com'
export const MP_AUTH = 'https://auth.mercadopago.com.br/authorization'

export class MpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
  }
}

async function call(f: Fetch, path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.json !== undefined) headers['content-type'] = 'application/json'
  const res = await f(MP_API + path, {
    method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* corpo não é JSON */
  }
  if (!res.ok) throw new MpError(`Mercado Pago respondeu ${res.status} em ${path}`, res.status, body)
  return body as Record<string, unknown>
}

/** Página onde o lojista entra na conta dele e autoriza a plataforma. */
export function authorizationUrl(env: Pick<Env, 'MP_CLIENT_ID' | 'MP_REDIRECT_URI'>, state: string) {
  const u = new URL(MP_AUTH)
  u.searchParams.set('client_id', env.MP_CLIENT_ID)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('platform_id', 'mp')
  u.searchParams.set('state', state)
  u.searchParams.set('redirect_uri', env.MP_REDIRECT_URI)
  return u.toString()
}

function toSecret(body: Record<string, unknown>, now: Date, previous?: MpSecret): MpSecret {
  const access = String(body.access_token ?? '')
  if (!access) throw new MpError('Resposta do Mercado Pago sem access_token', 200, body)
  const expiresIn = Number(body.expires_in ?? 15552000) // padrão documentado: 180 dias
  return {
    access_token: access,
    refresh_token: String(body.refresh_token ?? previous?.refresh_token ?? ''),
    user_id: (body.user_id as number | string | undefined) ?? previous?.user_id ?? '',
    public_key: String(body.public_key ?? previous?.public_key ?? ''),
    expires_at: new Date(now.getTime() + expiresIn * 1000).toISOString(),
  }
}

export async function exchangeCode(deps: Pick<Deps, 'fetch' | 'env' | 'now'>, code: string): Promise<MpSecret> {
  const body = await call(deps.fetch, '/oauth/token', {
    json: {
      client_id: deps.env.MP_CLIENT_ID,
      client_secret: deps.env.MP_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: deps.env.MP_REDIRECT_URI,
    },
  })
  return toSecret(body, deps.now())
}

export async function refreshToken(deps: Pick<Deps, 'fetch' | 'env' | 'now'>, secret: MpSecret): Promise<MpSecret> {
  const body = await call(deps.fetch, '/oauth/token', {
    json: {
      client_id: deps.env.MP_CLIENT_ID,
      client_secret: deps.env.MP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: secret.refresh_token,
    },
  })
  return toSecret(body, deps.now(), secret)
}

const REFRESH_MARGIN_MS = 24 * 3600 * 1000

/** Token do lojista válido, renovando (e salvando) se estiver vencido ou perto de vencer. */
export async function sellerToken(deps: Deps, storeId: string): Promise<string | null> {
  const secret = await deps.db.getSecret(storeId)
  if (!secret?.access_token) return null
  const exp = Date.parse(secret.expires_at)
  if (Number.isFinite(exp) && exp - deps.now().getTime() > REFRESH_MARGIN_MS) return secret.access_token
  if (!secret.refresh_token) return secret.access_token
  let fresh: MpSecret
  try {
    fresh = await refreshToken(deps, secret)
  } catch (e) {
    // Outra chamada (webhook e checkout ao mesmo tempo) pode ter renovado primeiro;
    // aí o refresh_token antigo deixa de valer, mas o novo token já está salvo.
    const latest = await deps.db.getSecret(storeId)
    if (latest?.access_token && latest.access_token !== secret.access_token) return latest.access_token
    // O Mercado Pago recusou a renovação (lojista desautorizou o app, refresh vencido):
    // a conexão é guardada como caída e a loja deixa de oferecer Mercado Pago.
    if (e instanceof MpError && (e.status === 400 || e.status === 401)) {
      await deps.db.revokeSecret(storeId, deps.now())
      return null
    }
    // Falha passageira (rede, 5xx): segue com o token atual enquanto ele ainda vale.
    if (Number.isFinite(exp) && exp > deps.now().getTime()) return secret.access_token
    throw e
  }
  await deps.db.saveSecret(storeId, fresh)
  return fresh.access_token
}

export function createPreference(f: Fetch, token: string, payload: unknown) {
  return call(f, '/checkout/preferences', { json: payload, token })
}

export interface MpPayment {
  id: number | string
  status: string
  status_detail?: string
  external_reference?: string | null
  transaction_amount?: number
  currency_id?: string
  date_approved?: string | null
}

export async function getPayment(f: Fetch, token: string, id: string) {
  return (await call(f, `/v1/payments/${encodeURIComponent(id)}`, { token })) as unknown as MpPayment
}
