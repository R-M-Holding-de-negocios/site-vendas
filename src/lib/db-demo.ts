// Modo demonstração: tudo fica no localStorage deste navegador.
// Serve para conhecer e testar o sistema sem configurar o banco.
import type { Db, Query, TableName, Tables, User } from './db'
import { demoRpc } from './demo-rpc'
import { seedDemo } from './seed'
import { nowIso, uid } from './util'

const PREFIX = 'vt_'
export const DEMO_ADMINS = ['admin@exemplo.com']

type Row = Record<string, unknown> & { id: string }

export class DemoStore {
  private cache = new Map<string, Row[]>()

  rows<T extends TableName>(table: T): Tables[T][] {
    if (!this.cache.has(table)) {
      let rows: Row[] = []
      try {
        rows = JSON.parse(localStorage.getItem(PREFIX + table) ?? '[]')
      } catch {
        rows = []
      }
      this.cache.set(table, rows)
    }
    return this.cache.get(table) as unknown as Tables[T][]
  }

  save(table: TableName) {
    try {
      localStorage.setItem(PREFIX + table, JSON.stringify(this.cache.get(table) ?? []))
    } catch {
      // Sem espaço: as mudanças valem até recarregar a página.
    }
  }

  insert<T extends TableName>(table: T, row: Partial<Tables[T]>): Tables[T] {
    const full = { id: uid(), created_at: nowIso(), ...row } as unknown as Tables[T]
    this.rows(table).push(full)
    this.save(table)
    return structuredClone(full)
  }

  update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): Tables[T] {
    const rows = this.rows(table) as unknown as Row[]
    const i = rows.findIndex((r) => r.id === id)
    if (i < 0) throw new Error('Registro não encontrado.')
    rows[i] = { ...rows[i], ...(patch as object), id }
    this.save(table)
    return structuredClone(rows[i]) as unknown as Tables[T]
  }

  remove(table: TableName, id: string) {
    const rows = this.rows(table) as unknown as Row[]
    const i = rows.findIndex((r) => r.id === id)
    if (i >= 0) rows.splice(i, 1)
    this.save(table)
  }

  get user(): User | null {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + 'session') ?? 'null')
    } catch {
      return null
    }
  }
  set user(u: User | null) {
    if (u) localStorage.setItem(PREFIX + 'session', JSON.stringify(u))
    else localStorage.removeItem(PREFIX + 'session')
  }

  users(): (User & { password: string })[] {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + 'users') ?? '[]')
    } catch {
      return []
    }
  }
  addUser(email: string, password: string): User {
    const u = { id: uid(), email: email.toLowerCase(), password }
    localStorage.setItem(PREFIX + 'users', JSON.stringify([...this.users(), u]))
    return { id: u.id, email: u.email }
  }

  isAdmin() {
    return !!this.user && DEMO_ADMINS.includes(this.user.email)
  }
}

function matches(row: Record<string, unknown>, q: Query) {
  for (const [k, v] of Object.entries(q.eq ?? {})) if ((row[k] ?? null) !== v) return false
  if (q.in && !q.in[1].includes(row[q.in[0]] as string)) return false
  if (q.gte && !((row[q.gte[0]] as string | number) >= q.gte[1])) return false
  if (q.lt && !((row[q.lt[0]] as string | number) < q.lt[1])) return false
  return true
}

export function demoDb(): Db {
  const s = new DemoStore()
  if (!localStorage.getItem(PREFIX + 'seeded')) {
    seedDemo(s)
    localStorage.setItem(PREFIX + 'seeded', '1')
  }
  const rpc = demoRpc(s)
  const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 30))

  return {
    demo: true,
    async list(table, q = {}) {
      let rows = s.rows(table).filter((r) => matches(r as unknown as Record<string, unknown>, q))
      if (q.order) {
        const [k, dir] = q.order
        rows = [...rows].sort((a, b) => {
          const x = (a as unknown as Record<string, string>)[k]
          const y = (b as unknown as Record<string, string>)[k]
          return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'asc' ? 1 : -1)
        })
      }
      if (q.limit) rows = rows.slice(0, q.limit)
      return delay(structuredClone(rows))
    },
    async get(table, id) {
      const r = s.rows(table).find((r) => (r as unknown as Row).id === id)
      return delay(r ? structuredClone(r) : null)
    },
    async insert(table, row) {
      return delay(s.insert(table, row))
    },
    async update(table, id, patch) {
      return delay(s.update(table, id, patch))
    },
    async remove(table, id) {
      s.remove(table, id)
      await delay(null)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (async (fn: string, args: any) => {
      await delay(null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return structuredClone(await (rpc as any)[fn](args))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    upload: (file) =>
      new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.readAsDataURL(file)
      }),
    auth: {
      user: async () => s.user,
      async signUp(email, password) {
        if (s.users().some((u) => u.email === email.toLowerCase())) throw new Error('Já existe uma conta com este e-mail.')
        s.user = s.addUser(email, password)
        return true
      },
      async signIn(email, password) {
        const u = s.users().find((u) => u.email === email.toLowerCase() && u.password === password)
        if (!u) throw new Error('E-mail ou senha incorretos.')
        s.user = { id: u.id, email: u.email }
      },
      async signOut() {
        s.user = null
      },
      async resetPassword() {
        throw new Error('No modo demonstração não há envio de e-mail.')
      },
      async updatePassword() {
        throw new Error('No modo demonstração a senha não pode ser trocada.')
      },
      mfa: {
        status: async () => ({ verified: true, factorId: null }),
        enroll: async () => ({ factorId: 'demo', qr: '', secret: '' }),
        verify: async () => undefined,
      },
    },
  }
}

export function resetDemo() {
  for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  location.reload()
}
