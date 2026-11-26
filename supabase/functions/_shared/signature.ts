// Validação da assinatura das notificações (Webhooks) do Mercado Pago.
//
// Cabeçalho:  x-signature: ts=1704908010,v1=<hex>
// Manifesto:  id:<data.id>;request-id:<x-request-id>;ts:<ts>;
// Assinatura: HMAC-SHA256(segredo do webhook, manifesto) em hexadecimal, comparada com v1.
// - data.id vem da query string; se for alfanumérico, a documentação manda usar minúsculas.
// - Se algum valor não vier na notificação, o par correspondente é omitido do manifesto.

export function parseSignatureHeader(header: string | null): { ts: string; v1: string } | null {
  if (!header) return null
  let ts = ''
  let v1 = ''
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 'ts') ts = v
    else if (k === 'v1') v1 = v
  }
  return ts && v1 ? { ts, v1 } : null
}

export function signatureManifest(dataId: string | null, requestId: string | null, ts: string) {
  let m = ''
  if (dataId) m += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`
  if (requestId) m += `request-id:${requestId};`
  m += `ts:${ts};`
  return m
}

const enc = new TextEncoder()

export async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type SignatureResult = 'ok' | 'missing' | 'invalid' | 'stale'

/**
 * Confere a assinatura. `toleranceS` limita a idade do ts (protege contra reenvio de
 * notificações antigas capturadas). O ts pode vir em segundos ou milissegundos.
 */
export async function verifySignature(opts: {
  secret: string
  header: string | null
  requestId: string | null
  dataId: string | null
  now: Date
  toleranceS?: number
}): Promise<SignatureResult> {
  const parsed = parseSignatureHeader(opts.header)
  if (!parsed || !opts.secret) return 'missing'
  const expected = await hmacSha256Hex(opts.secret, signatureManifest(opts.dataId, opts.requestId, parsed.ts))
  if (!safeEqual(expected, parsed.v1.toLowerCase())) return 'invalid'
  const n = Number(parsed.ts)
  if (!Number.isFinite(n)) return 'invalid'
  const tsMs = n > 1e12 ? n : n * 1000
  const tolerance = (opts.toleranceS ?? 15 * 60) * 1000
  if (Math.abs(opts.now.getTime() - tsMs) > tolerance) return 'stale'
  return 'ok'
}
