import type { Db } from './db'
import { demoDb } from './db-demo'
import { supabaseDb } from './db-supabase'
import { defaultSettings, defaultTheme, withDefaults } from './theme'
import type { Store, TrafficSource } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Sem Supabase configurado, o app roda em modo demonstração. */
export const db: Db = url && key ? supabaseDb(url, key) : demoDb()

export const HASH_ROUTER = import.meta.env.VITE_HASH_ROUTER === '1'
export const SUPPORT_WHATSAPP = (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined) ?? ''
export const PLATFORM_PIX = (import.meta.env.VITE_PLATFORM_PIX_KEY as string | undefined) ?? ''
export const MP_CLIENT_ID = (import.meta.env.VITE_MP_CLIENT_ID as string | undefined) ?? ''
export const PLATFORM_NAME = 'Vitrine'

/** Garante que lojas antigas tenham todos os campos novos de configuração e aparência. */
export function normalizeStore(s: Store): Store {
  return {
    ...s,
    settings: withDefaults(s.settings, defaultSettings()),
    theme: withDefaults(s.theme, defaultTheme()),
    theme_draft: s.theme_draft ? withDefaults(s.theme_draft, defaultTheme()) : null,
    theme_history: s.theme_history ?? [],
  }
}

export async function myStore(): Promise<Store | null> {
  const u = await db.auth.user()
  if (!u) return null
  const [s] = await db.list('stores', { eq: { owner_id: u.id }, limit: 1 })
  return s ? normalizeStore(s) : null
}

export async function storeBySlug(slug: string): Promise<Store | null> {
  const [s] = await db.list('stores', { eq: { slug }, limit: 1 })
  if (!s || s.status === 'suspended' || s.status === 'closed') return null
  return normalizeStore(s)
}

export function storeUrl(slug: string, path = '') {
  const base = HASH_ROUTER ? `${location.origin}${location.pathname}#/` : `${location.origin}/`
  return base + slug + path
}

// ---------- Imagens ----------

/** Reduz a foto (máx. 1200px, JPEG) antes de enviar. É o que mantém o armazenamento barato. */
export async function shrinkImage(file: File, max = 1200): Promise<Blob> {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  const img = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível ler a imagem.'))), 'image/jpeg', 0.82),
  )
}

export async function uploadImage(file: File, storeId: string) {
  const url = await db.upload(await shrinkImage(file, db.demo ? 700 : 1200), storeId)
  await db.insert('media', { store_id: storeId, url })
  return url
}

// ---------- Visitas e origem ----------

const SESSION_KEY = 'vt_sid'
export function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return 'anon'
  }
}

// Rascunho do checkout (carrinho abandonado) desta visita, por loja.
const draftKey = (storeId: string) => `vt_checkout_${storeId}`
export function checkoutDraftId(storeId: string): string | null {
  try {
    return sessionStorage.getItem(draftKey(storeId))
  } catch {
    return null
  }
}
export function rememberCheckoutDraft(storeId: string, id: string) {
  try {
    sessionStorage.setItem(draftKey(storeId), id)
  } catch {
    /* sem sessionStorage */
  }
}
export function forgetCheckoutDraft(storeId: string) {
  try {
    sessionStorage.removeItem(draftKey(storeId))
  } catch {
    /* sem sessionStorage */
  }
}

/** De onde o visitante veio, guardado no primeiro acesso da sessão. */
export function trafficSource(): TrafficSource {
  try {
    const saved = sessionStorage.getItem('vt_src')
    if (saved) return JSON.parse(saved)
  } catch {
    /* sem sessionStorage */
  }
  const params = new URLSearchParams(location.search || location.hash.split('?')[1] || '')
  const ref = document.referrer
  let source = params.get('utm_source') ?? ''
  if (!source) {
    if (/instagram/i.test(ref) || /instagram/i.test(navigator.userAgent)) source = 'instagram'
    else if (/facebook|fb\./i.test(ref) || /FBAN|FBAV/.test(navigator.userAgent)) source = 'facebook'
    else if (/whatsapp|wa\.me/i.test(ref)) source = 'whatsapp'
    else if (/google\./i.test(ref)) source = 'google'
    else if (/tiktok/i.test(ref)) source = 'tiktok'
    else if (!ref || ref.startsWith(location.origin)) source = 'direto'
    else source = 'outro'
  }
  const src: TrafficSource = {
    source: source.toLowerCase().slice(0, 40),
    medium: (params.get('utm_medium') ?? '').slice(0, 40),
    campaign: (params.get('utm_campaign') ?? '').slice(0, 60),
    device: matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop',
  }
  try {
    sessionStorage.setItem('vt_src', JSON.stringify(src))
  } catch {
    /* sem sessionStorage */
  }
  return src
}

export function track(storeId: string, type: import('./types').EventType, extra: { product_id?: string; data?: Record<string, unknown> } = {}) {
  db.insert('events', {
    store_id: storeId,
    session_id: sessionId(),
    type,
    product_id: extra.product_id ?? null,
    data: { ...trafficSource(), ...extra.data },
  }).catch(() => undefined)
}
