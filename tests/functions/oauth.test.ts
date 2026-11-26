import { describe, expect, it } from 'vitest'
import { finishOAuth, startOAuth, stateIsValid } from '../../supabase/functions/_shared/oauth'
import { FakeDb, NOW, STORE_ID, env, fakeFetch, makeDeps, store } from './fakes'

const OK = 'https://vitrine.example/painel/integracoes?mp=conectado'
const ERR = 'https://vitrine.example/painel/integracoes?mp=erro'

describe('conexão OAuth do Mercado Pago', () => {
  it('início: cria um state e devolve a URL de autorização', async () => {
    const db = new FakeDb()
    const { url } = await startOAuth(makeDeps(db, fakeFetch({}).fetch), 'user-1')
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://auth.mercadopago.com.br/authorization')
    expect(u.searchParams.get('client_id')).toBe('123456')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('platform_id')).toBe('mp')
    expect(u.searchParams.get('redirect_uri')).toBe(env.MP_REDIRECT_URI)
    expect(db.states).toHaveLength(1)
    expect(u.searchParams.get('state')).toBe(db.states[0].state)
    expect(db.states[0].state).toMatch(/^[0-9a-f]{48}$/)
    expect(db.states[0]).toMatchObject({ store_id: STORE_ID, user_id: 'user-1' })
  })

  it('início: exige login, loja e plano com pagamento online', async () => {
    const db = new FakeDb()
    const deps = makeDeps(db, fakeFetch({}).fetch)
    await expect(startOAuth(deps, null)).rejects.toThrow('Entre na sua conta')
    await expect(startOAuth(deps, 'sem-loja')).rejects.toThrow('Crie sua loja')
    db.stores = [store({ plan: 'vitrine' })]
    await expect(startOAuth(deps, 'user-1')).rejects.toThrow('plano Loja')
  })

  it('state vale por menos de 1 hora', () => {
    const row = (created_at: string) => ({ state: 's', store_id: STORE_ID, user_id: 'u', created_at })
    expect(stateIsValid(row('2026-11-26T11:30:00Z'), NOW)).toBe(true)
    expect(stateIsValid(row('2026-11-26T11:00:00Z'), NOW)).toBe(false)
    expect(stateIsValid(row('lixo'), NOW)).toBe(false)
    expect(stateIsValid(null, NOW)).toBe(false)
  })

  it('volta: troca o código, guarda os tokens e usa o state uma vez só', async () => {
    const db = new FakeDb()
    db.secrets.clear()
    db.states.push({ state: 'abc', store_id: STORE_ID, user_id: 'user-1', created_at: '2026-11-26T11:55:00Z' })
    const { fetch, calls } = fakeFetch({
      'POST /oauth/token': () => ({ access_token: 'APP_USR-a', refresh_token: 'TG-r', user_id: 777, public_key: 'APP_USR-pk', expires_in: 100, live_mode: true }),
    })
    const deps = makeDeps(db, fetch)
    expect(await finishOAuth(deps, new URLSearchParams({ code: 'TG-code', state: 'abc' }))).toBe(OK)
    expect(calls[0].body).toEqual({
      client_id: '123456',
      client_secret: 'segredo-app',
      grant_type: 'authorization_code',
      code: 'TG-code',
      redirect_uri: env.MP_REDIRECT_URI,
    })
    expect(db.secrets.get(STORE_ID)).toEqual({
      access_token: 'APP_USR-a',
      refresh_token: 'TG-r',
      user_id: 777,
      public_key: 'APP_USR-pk',
      expires_at: new Date(NOW.getTime() + 100_000).toISOString(),
    })
    // Reusar o mesmo state falha.
    expect(await finishOAuth(deps, new URLSearchParams({ code: 'TG-code', state: 'abc' }))).toBe(ERR)
    expect(calls).toHaveLength(1)
  })

  it('volta: state vencido, desconhecido, sem código ou erro do Mercado Pago → erro', async () => {
    const db = new FakeDb()
    db.states.push({ state: 'velho', store_id: STORE_ID, user_id: 'user-1', created_at: '2026-11-26T10:00:00Z' })
    db.states.push({ state: 'bom', store_id: STORE_ID, user_id: 'user-1', created_at: '2026-11-26T11:59:00Z' })
    const { fetch } = fakeFetch({ 'POST /oauth/token': () => new Response('{"error":"invalid_grant"}', { status: 400 }) })
    const deps = makeDeps(db, fetch)
    expect(await finishOAuth(deps, new URLSearchParams({ code: 'c', state: 'velho' }))).toBe(ERR)
    expect(await finishOAuth(deps, new URLSearchParams({ code: 'c', state: 'nao-existe' }))).toBe(ERR)
    expect(await finishOAuth(deps, new URLSearchParams({ error: 'access_denied', state: 'bom' }))).toBe(ERR)
    expect(await finishOAuth(deps, new URLSearchParams({ code: 'c', state: 'bom' }))).toBe(ERR)
    expect(db.secrets.get(STORE_ID)?.access_token).toBe('APP_USR-seller')
  })
})
