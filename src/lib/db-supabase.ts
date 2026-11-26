import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Db, Query, TableName, Tables } from './db'

const PAGE = 1000
const WRITE_ONLY: string[] = ['events', 'leads', 'stock_alerts'] // limite de linhas por requisição do Supabase

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
    let r = sb.from(table).select(q.columns ?? '*')
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

  return {
    demo: false,
    async list<T extends TableName>(table: T, q: Query = {}) {
      if (q.limit) {
        const { data, error } = await build(table, q)
        if (error) throw translate(error)
        return data as Tables[T][]
      }
      const out: Tables[T][] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(table, { ...q, order: q.order ?? ['id', 'asc'] }, from, from + PAGE - 1)
        if (error) throw translate(error)
        out.push(...(data as Tables[T][]))
        if (data.length < PAGE) return out
      }
    },
    async get(table, id) {
      const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle()
      if (error) throw translate(error)
      return data
    },
    async insert(table, row) {
      // Visitantes podem gravar estes registros, mas não lê-los de volta.
      if (WRITE_ONLY.includes(table) && !(await sb.auth.getSession()).data.session) {
        const { error } = await sb.from(table).insert(row as never)
        if (error) throw translate(error)
        return row as never
      }
      const { data, error } = await sb.from(table).insert(row as never).select('*').single()
      if (error) throw translate(error)
      return data
    },
    async update(table, id, patch) {
      const { data, error } = await sb.from(table).update(patch as never).eq('id', id).select('*').single()
      if (error) throw translate(error)
      return data
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
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/entrar' })
        if (error) throw new Error(error.message)
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
