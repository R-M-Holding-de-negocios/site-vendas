// Lê a configuração a partir de uma função (Deno.env.get nas Edge Functions).
import type { Env } from './types.ts'

export function readEnv(get: (k: string) => string | undefined): Env {
  const supabaseUrl = (get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  return {
    MP_CLIENT_ID: get('MP_CLIENT_ID') ?? '',
    MP_CLIENT_SECRET: get('MP_CLIENT_SECRET') ?? '',
    MP_REDIRECT_URI: get('MP_REDIRECT_URI') || `${supabaseUrl}/functions/v1/mp-oauth-callback`,
    MP_WEBHOOK_SECRET: get('MP_WEBHOOK_SECRET') ?? '',
    SITE_URL: (get('SITE_URL') ?? '').replace(/\/+$/, ''),
    FUNCTIONS_URL: get('FUNCTIONS_URL') || `${supabaseUrl}/functions/v1`,
  }
}
