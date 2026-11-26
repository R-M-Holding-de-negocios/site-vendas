// Banco Postgres de verdade (PGlite) com a migração aplicada, e atalhos para
// agir como visitante (anon), lojista (authenticated) ou admin (aal2).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defaultSettings, defaultTheme } from '../../src/lib/theme'
import type { PlanId, StoreSettings } from '../../src/lib/types'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const STUB = read('./supabase-stub.sql')
const MIGRATION = read('../../supabase/migrations/0001_init.sql')

export type Who =
  | { role: 'anon' }
  | { role: 'authenticated'; id: string; email?: string; aal?: 'aal1' | 'aal2' }
  | { role: 'postgres' }

export const anon: Who = { role: 'anon' }
export const superuser: Who = { role: 'postgres' }
export const user = (id: string, aal: 'aal1' | 'aal2' = 'aal1', email?: string): Who => ({ role: 'authenticated', id, aal, email })

export class TestDb {
  constructor(readonly pg: PGlite) {}

  static async create() {
    const pg = new PGlite()
    await pg.exec(STUB)
    await pg.exec(MIGRATION)
    return new TestDb(pg)
  }

  /** Roda uma consulta com o papel e o JWT indicados (como o PostgREST faz). */
  async q<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.pg.transaction(async (tx) => {
      if (who.role !== 'postgres') {
        const claims =
          who.role === 'anon'
            ? { role: 'anon' }
            : { role: 'authenticated', sub: who.id, aal: who.aal ?? 'aal1', email: who.email ?? '' }
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
        await tx.exec(`set local role ${who.role}`)
      }
      const r = await tx.query<T>(sql, params)
      return r.rows
    })
  }

  /** Chama uma função do servidor como o cliente faz: sb.rpc(fn, { a: args }). */
  async rpc<T = unknown>(who: Who, fn: string, args: unknown = {}): Promise<T> {
    const [row] = await this.q<{ r: T }>(who, `select public.${fn}($1::jsonb) as r`, [JSON.stringify(args)])
    return row.r
  }

  /** Insere uma linha (como superusuário) usando só as colunas presentes no objeto. */
  async insert<T = Record<string, unknown>>(table: string, row: Record<string, unknown>): Promise<T> {
    const cols = Object.keys(row).map((c) => `"${c}"`).join(', ')
    const [r] = await this.q<{ r: T }>(
      superuser,
      `insert into public.${table} (${cols}) select ${cols} from jsonb_populate_record(null::public.${table}, $1) returning to_jsonb(${table}.*) as r`,
      [JSON.stringify(row)],
    )
    return r.r
  }

  /** Linhas como JSON (mesmo formato que o cliente recebe). */
  async rows<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.q<{ r: T }>(who, `select to_jsonb(x) as r from (${sql}) x`, params)
    return r.map((x) => x.r)
  }

  async createUser(email: string): Promise<string> {
    const [r] = await this.q<{ id: string }>(superuser, `insert into auth.users (email, last_sign_in_at) values ($1, now()) returning id`, [email])
    return r.id
  }

  async makeAdmin(id: string) {
    await this.q(superuser, `insert into public.platform_admins (user_id) values ($1)`, [id])
  }

  /** Lojista com loja pronta. */
  async merchant(slug: string, plan: PlanId = 'pro', settings: Partial<StoreSettings> = {}) {
    const ownerId = await this.createUser(`${slug}@exemplo.com`)
    const s = { ...defaultSettings(), ...settings }
    s.hours = { ...s.hours, enabled: false }
    const store = await this.insert<{ id: string }>('stores', {
      owner_id: ownerId,
      slug,
      name: slug,
      whatsapp: '19999990000',
      plan,
      status: 'active',
      settings: s,
      theme: defaultTheme(),
    })
    return { ownerId, storeId: store.id, who: user(ownerId) }
  }
}

/** Espera que a promessa falhe com exatamente esta mensagem. */
export async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  return '(não falhou)'
}
