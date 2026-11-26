// Montagem comum das funções no Deno (Supabase Edge Runtime). Não é usado nos testes.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { readEnv } from './env.ts'
import { supabasePaymentsDb } from './supabase-adapter.ts'
import type { Deps } from './types.ts'

const getEnv = (k: string) => Deno.env.get(k)

export const admin = () =>
  createClient(getEnv('SUPABASE_URL')!, getEnv('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

export function deps(): Deps {
  return { fetch: (i, init) => fetch(i, init), db: supabasePaymentsDb(admin()), env: readEnv(getEnv), now: () => new Date() }
}

/** Id do usuário dono do JWT enviado em Authorization, ou null. */
export async function callerId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data, error } = await admin().auth.getUser(jwt)
  return error ? null : (data.user?.id ?? null)
}
