// Gera o "Pix copia e cola" (BR Code estático) com a chave e o valor do pedido.
// Formato definido pelo Banco Central (Manual de Padrões para Iniciação do Pix).

const field = (id: string, value: string) => id + String(value.length).padStart(2, '0') + value

export function crc16(payload: string) {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

const clean = (s: string, max: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .trim()
    .slice(0, max) || 'NA'

/** Normaliza a chave: telefone vira +55..., CPF/CNPJ só dígitos, e-mail e aleatória ficam como estão. */
export function normalizePixKey(key: string) {
  const k = key.trim()
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(k)) return k.toLowerCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase()
  const digits = k.replace(/\D/g, '')
  if (k.startsWith('+')) return '+' + digits
  if (digits.length === 11 && /^\d{2}9/.test(digits) && !/[.-]/.test(k)) return '+55' + digits // celular sem formatação
  if (/^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(k)) return '+55' + digits // celular formatado
  return digits // CPF ou CNPJ
}

export function pixPayload(opts: { key: string; name: string; city: string; amountCents: number; txid?: string }) {
  const account = field('00', 'br.gov.bcb.pix') + field('01', normalizePixKey(opts.key))
  const txid = (opts.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  const body =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (opts.amountCents > 0 ? field('54', (opts.amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', clean(opts.name, 25)) +
    field('60', clean(opts.city, 15)) +
    field('62', field('05', txid)) +
    '6304'
  return body + crc16(body)
}
