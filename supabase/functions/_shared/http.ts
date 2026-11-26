// Respostas HTTP comuns às funções.

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}

export function json(body: unknown, status = 200, cors = false) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(cors ? CORS_HEADERS : {}) },
  })
}

export function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })
}

/** Resposta ao "preflight" do navegador, ou null se não for OPTIONS. */
export function preflight(req: Request) {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS_HEADERS }) : null
}

/** Erro com mensagem que pode ser mostrada ao usuário (em português). */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Envolve um handler das funções chamadas pelo navegador: CORS + erros em JSON. */
export async function browserHandler(req: Request, run: () => Promise<unknown>) {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405, true)
  try {
    return json(await run(), 200, true)
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status, true)
    console.error(e)
    return json({ error: 'Não foi possível falar com o Mercado Pago agora. Tente de novo em instantes.' }, 502, true)
  }
}

export const randomState = (bytes = 24) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
