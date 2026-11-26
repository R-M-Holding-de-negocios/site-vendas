export const uid = () => crypto.randomUUID()
export const nowIso = () => new Date().toISOString()

export const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** "19,90" ou "1.234,5" -> centavos. Retorna NaN se inválido. */
export function parseMoney(s: string): number {
  const clean = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  if (!clean) return NaN
  return Math.round(parseFloat(clean) * 100)
}
export const moneyInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',')

export const slugify = (s: string, max = 40) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)

export const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** Telefone brasileiro para o formato do wa.me (com 55). */
export function waPhone(phone: string) {
  const d = onlyDigits(phone)
  return d.length <= 11 ? '55' + d : d
}
export const waLink = (phone: string, text: string) => `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`

export function formatPhone(phone: string) {
  const d = onlyDigits(phone).replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return phone
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'
export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000)
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

export const pct = (n: number, digits = 1) =>
  `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

export function groupBy<T, K extends string | number>(list: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const item of list) (out[key(item)] ??= []).push(item)
  return out
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function randomToken(len = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')
}
