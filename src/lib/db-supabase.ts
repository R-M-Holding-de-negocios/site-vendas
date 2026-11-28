import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Db, Query, TableName, Tables } from './db'

const PAGE = 1000 // limite de linhas por requisição do Supabase
const WRITE_ONLY: string[] = ['events', 'leads', 'stock_alerts']

/** Colunas de products que qualquer um pode ler; o custo vem à parte (migração 0004). */
export const PRODUCT_COLUMNS =
  'id,store_id,name,description,price_cents,promo_price_cents,promo_ends_at,images,category_ids,available,featured,position,sku,track_stock,stock,weight_g,height_cm,width_cm,length_cm,options,qty_discounts,video_url,seo,blocked,sold_count,created_at'
/** Colunas de stores que qualquer um pode ler; rascunho do tema, histórico e datas de cobrança vêm à parte (migração 0007). */
export const STORE_COLUMNS = 'id,owner_id,slug,name,whatsapp,description,logo_url,plan,status,settings,theme,created_at'
const STORE_PRIVATE_DEFAULTS = { trial_ends_at: null, paid_until: null, theme_draft: null, theme_history: [], plan_before_downgrade: null }
const cols = (table: string) => (table === 'products' ? PRODUCT_COLUMNS : table === 'stores' ? STORE_COLUMNS : '*') as '*' // o tipo '*' mantém o retorno sem inferência de colunas

const translate = (e: { message: string; code?: string }) => {
  if (e.code === '23505') return new Error('Esse endereço ou código já está em uso. Escolha outro.')
  if (e.code === '42501') return new Error('Você não tem permissão para fazer isso.')
  // Erros levantados pelas funções do banco já vêm em português.
  return new Error(e.message)
}

/** Cliente criado por supabaseDb; usado para chamar as Edge Functions (lib/mercadopago.ts). */
export let supabaseClient: Pick<SupabaseClient, 'functions'> | null = null

export function supabaseDb(url: string, key: string): Db {
  const sb = createClient(url, key)
  supabaseClient = sb

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function build(table: string, q: Query = {}, from?: number, to?: number): any {
    let r = sb.from(table).select(q.columns ?? cols(table))
    for (const [k, v] of Object.entries(q.eq ?? {})) r = v === null ? r.is(k, null) : r.eq(k, v)
    if (q.in) r = r.in(q.in[0], q.in[1])
    if (q.gte) r = r.gte(q.gte[0], q.gte[1])
    if (q.lt) r = r.lt(q.lt[0], q.lt[1])
    if (q.order) r = r.order(q.order[0], { ascending: q.order[1] === 'asc' })
    if (q.limit) r = r.limit(q.limit)
    else if (from !== undefined) r = r.range(from, to!)
    return r
  }

  const user = async () => {
    const u = (await sb.auth.getSession()).data.session?.user
    return u ? { id: u.id, email: u.email ?? '' } : null
  }

  /** Completa cost_cents dos produtos do próprio lojista (para os outros, fica null). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function withCosts<R>(table: string, rows: R[]): Promise<R[]> {
    if (table === 'stores') return withStorePrivate(rows)
    if (table !== 'products' || !rows.length) return rows
    const costs: Record<string, number> = {}
    if ((await sb.auth.getSession()).data.session) {
      const ids = rows.map((r) => (r as { id: string }).id)
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await sb.rpc('product_costs', { a: { ids: ids.slice(i, i + 500) } })
        if (error) throw translate(error)
        Object.assign(costs, data)
      }
    }
    return rows.map((r) => ({ ...r, cost_cents: costs[(r as { id: string }).id] ?? null }))
  }

  /** Completa as colunas internas das lojas do próprio lojista (ou de qualquer uma, para o admin). */
  async function withStorePrivate<R>(rows: R[]): Promise<R[]> {
    let extra: Record<string, object> = {}
    if (rows.length && (await sb.auth.getSession()).data.session) {
      const { data, error } = await sb.rpc('store_private', { a: { ids: rows.map((r) => (r as { id: string }).id) } })
      if (error) throw translate(error)
      extra = data ?? {}
    }
    return rows.map((r) => ({ ...r, ...STORE_PRIVATE_DEFAULTS, ...extra[(r as { id: string }).id] }))
  }

  return {
    demo: false,
    async list<T extends TableName>(table: T, q: Query = {}) {
      if (q.limit) {
        const { data, error } = await build(table, q)
        if (error) throw translate(error)
        return (q.columns ? data : await withCosts(table, data)) as Tables[T][]
      }
      const out: Tables[T][] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(table, { ...q, order: q.order ?? ['id', 'asc'] }, from, from + PAGE - 1)
        if (error) throw translate(error)
        out.push(...(data as Tables[T][]))
        if (data.length < PAGE) return (q.columns ? out : await withCosts(table, out)) as Tables[T][]
      }
    },
    async get(table, id) {
      const { data, error } = await sb.from(table).select(cols(table)).eq('id', id).maybeSingle()
      if (error) throw translate(error)
      return data ? (await withCosts(table, [data]))[0] : data
    },
    async insert(table, row) {
      // Visitantes (inclusive quem está logado e visita outra loja) podem gravar estes registros,
      // mas não lê-los de volta: pedir a linha de volta faria o banco recusar a gravação.
      if (WRITE_ONLY.includes(table)) {
        const { error } = await sb.from(table).insert(row as never)
        if (error) throw translate(error)
        return row as never
      }
      const { data, error } = await sb.from(table).insert(row as never).select(cols(table)).single()
      if (error) throw translate(error)
      return (await withCosts(table, [data]))[0]
    },
    async update(table, id, patch) {
      const { data, error } = await sb.from(table).update(patch as never).eq('id', id).select(cols(table)).single()
      if (error) throw translate(error)
      return (await withCosts(table, [data]))[0]
    },
    async remove(table, id) {
      const { error } = await sb.from(table).delete().eq('id', id)
      if (error) throw translate(error)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (async (fn: string, args: unknown) => {
      const { data, error } = await sb.rpc(fn, { a: args })
      if (error) throw translate(error)
      return data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    async upload(file, storeId) {
      const path = `${storeId}/${crypto.randomUUID()}.jpg`
      const { error } = await sb.storage.from('media').upload(path, file, { contentType: file.type || 'image/jpeg' })
      if (error) throw translate(error)
      return sb.storage.from('media').getPublicUrl(path).data.publicUrl
    },
    auth: {
      user,
      async signUp(email, password) {
        const { data, error } = await sb.auth.signUp({ email, password })
        if (error) throw new Error(error.message)
        return !!data.session
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw new Error('E-mail ou senha incorretos.')
      },
      async signOut() {
        await sb.auth.signOut()
      },
      async resetPassword(email) {
        // O link do e-mail abre a tela de nova senha (o Supabase entra com a sessão de recuperação).
        const redirectTo = `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/entrar?nova-senha=1`
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo })
        if (error) throw new Error(error.message)
      },
      async updatePassword(password) {
        const { error } = await sb.auth.updateUser({ password })
        if (error) throw new Error(/session/i.test(error.message) ? 'O link expirou. Peça um novo em "Esqueci a senha".' : error.message)
      },
      mfa: {
        async status() {
          const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
          const factors = await sb.auth.mfa.listFactors()
          const totp = factors.data?.totp.find((f) => f.status === 'verified')
          return { verified: aal.data?.currentLevel === 'aal2', factorId: totp?.id ?? null }
        },
        async enroll() {
          const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' })
          if (error) throw new Error(error.message)
          return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
        },
        async verify(factorId, code) {
          const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code })
          if (error) throw new Error('Código inválido. Confira o horário do celular e tente de novo.')
        },
      },
    },
  }
}
