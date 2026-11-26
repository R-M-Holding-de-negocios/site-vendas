// Prévia de links (WhatsApp, Instagram, Facebook, Google): o app é uma SPA, então os
// robôs que não rodam JavaScript veriam sempre o mesmo index.html. Esta função
// descobre a loja/produto/categoria/post pela URL e escreve as meta tags certas no HTML.
// Só Web APIs; o `fetch` é recebido como parâmetro (testável no Node).

export type Route =
  | { kind: 'store'; slug: string }
  | { kind: 'product'; slug: string; id: string }
  | { kind: 'category'; slug: string; id: string }
  | { kind: 'post'; slug: string; postSlug: string }

const RESERVED = new Set(['entrar', 'painel', 'admin', 'api', 'assets', 'static'])
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const POST_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/i

export function parseRoute(pathname: string): Route | null {
  let parts: string[]
  try {
    parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  if (!parts.length || parts.length > 3) return null
  if (parts.some((p) => /\.[a-z0-9]+$/i.test(p))) return null // arquivo (tem extensão)
  const [slug, section, id] = parts
  if (!SLUG.test(slug) || RESERVED.has(slug)) return null
  if (parts.length === 1) return { kind: 'store', slug }
  if (parts.length !== 3) return null
  if (section === 'p' && UUID.test(id)) return { kind: 'product', slug, id }
  if (section === 'c' && UUID.test(id)) return { kind: 'category', slug, id }
  if (section === 'blog' && POST_SLUG.test(id)) return { kind: 'post', slug, postSlug: id }
  return null
}

export interface ProductLd {
  name: string
  description: string
  images: string[]
  price_cents: number
  available: boolean
  sku: string
}

export interface PageMeta {
  title: string
  description: string
  image: string
  url: string
  siteName: string
  type: 'website' | 'product' | 'article'
  product?: ProductLd
}

// ---------- Escrita no HTML ----------

export function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** JSON seguro dentro de <script>: não deixa fechar a tag nem abrir comentário. */
export function safeJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** Remove a formatação simples do texto (markdown leve) para usar como descrição. */
export const plainText = (s: string) =>
  clip(
    String(s ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/[*_`~]+/g, ''),
    200,
  )

export function productJsonLd(p: ProductLd, url: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.images.length ? { image: p.images } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'BRL',
      price: (p.price_cents / 100).toFixed(2),
      availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  }
}

export function injectMeta(html: string, m: PageMeta): string {
  if (!/<\/head>/i.test(html)) return html
  const e = escapeHtml
  const tags = [
    `<title>${e(m.title)}</title>`,
    `<meta name="description" content="${e(m.description)}" />`,
    `<link rel="canonical" href="${e(m.url)}" />`,
    `<meta property="og:type" content="${m.type === 'article' ? 'article' : m.type === 'product' ? 'product' : 'website'}" />`,
    `<meta property="og:site_name" content="${e(m.siteName)}" />`,
    `<meta property="og:title" content="${e(m.title)}" />`,
    `<meta property="og:description" content="${e(m.description)}" />`,
    `<meta property="og:url" content="${e(m.url)}" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    ...(m.image ? [`<meta property="og:image" content="${e(m.image)}" />`, `<meta name="twitter:image" content="${e(m.image)}" />`] : []),
    `<meta name="twitter:card" content="${m.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${e(m.title)}" />`,
    `<meta name="twitter:description" content="${e(m.description)}" />`,
    ...(m.product ? [`<script type="application/ld+json">${safeJson(productJsonLd(m.product, m.url))}</script>`] : []),
  ]
  const cleaned = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\s+(?:name|property)=["'](?:description|og:[^"']*|twitter:[^"']*)["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
  return cleaned.replace(/<\/head>/i, `    ${tags.join('\n    ')}\n  </head>`)
}

// ---------- Busca dos dados (Supabase REST com a chave anônima) ----------

export interface MetaEnv {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

interface StoreRow {
  id: string
  slug: string
  name: string
  description: string
  logo_url: string
  status: string
}

async function rest<T>(f: Fetch, env: MetaEnv, table: string, query: Record<string, string>): Promise<T | null> {
  const u = new URL(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  u.searchParams.set('limit', '1')
  const res = await f(u.toString(), { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, accept: 'application/json' } })
  if (!res.ok) throw new Error(`Supabase ${res.status} em ${table}`)
  const rows = (await res.json()) as T[]
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

const absolute = (u: string, origin: string) => {
  if (!u) return ''
  try {
    const abs = new URL(u, origin)
    return abs.protocol === 'https:' || abs.protocol === 'http:' ? abs.toString() : ''
  } catch {
    return ''
  }
}

const promoActive = (p: { promo_price_cents: number | null; promo_ends_at: string | null }, now: Date) =>
  p.promo_price_cents != null && (p.promo_ends_at == null || new Date(p.promo_ends_at) > now)

/** Dados da página, ou null se não existir (aí o HTML vai sem mudança). */
export async function loadMeta(route: Route, env: MetaEnv, f: Fetch, pageUrl: string, now = new Date()): Promise<PageMeta | null> {
  const origin = new URL(pageUrl).origin
  const store = await rest<StoreRow>(f, env, 'stores', { slug: `eq.${route.slug}`, select: 'id,slug,name,description,logo_url,status' })
  if (!store || store.status === 'suspended' || store.status === 'closed') return null
  const base: PageMeta = {
    title: store.name,
    description: plainText(store.description) || `Conheça ${store.name} e faça seu pedido online.`,
    image: absolute(store.logo_url, origin),
    url: pageUrl,
    siteName: store.name,
    type: 'website',
  }
  if (route.kind === 'store') return base

  if (route.kind === 'product') {
    const p = await rest<{
      name: string
      description: string
      images: string[] | null
      price_cents: number
      promo_price_cents: number | null
      promo_ends_at: string | null
      available: boolean
      blocked: boolean
      track_stock: boolean
      stock: number
      sku: string | null
      seo: { title?: string; description?: string } | null
    }>(f, env, 'products', {
      id: `eq.${route.id}`,
      store_id: `eq.${store.id}`,
      select: 'name,description,images,price_cents,promo_price_cents,promo_ends_at,available,blocked,track_stock,stock,sku,seo',
    })
    if (!p || p.blocked) return null
    const images = (p.images ?? []).map((i) => absolute(i, origin)).filter(Boolean)
    const description = plainText(p.seo?.description || p.description) || base.description
    return {
      ...base,
      title: p.seo?.title || `${p.name} | ${store.name}`,
      description,
      image: images[0] || base.image,
      type: 'product',
      product: {
        name: p.name,
        description,
        images,
        price_cents: promoActive(p, now) ? p.promo_price_cents! : p.price_cents,
        available: !!p.available && (!p.track_stock || p.stock > 0),
        sku: p.sku ?? '',
      },
    }
  }

  if (route.kind === 'category') {
    const c = await rest<{ name: string; image_url: string; seo: { title?: string; description?: string } | null }>(f, env, 'categories', {
      id: `eq.${route.id}`,
      store_id: `eq.${store.id}`,
      select: 'name,image_url,seo',
    })
    if (!c) return null
    return {
      ...base,
      title: c.seo?.title || `${c.name} | ${store.name}`,
      description: plainText(c.seo?.description ?? '') || base.description,
      image: absolute(c.image_url, origin) || base.image,
    }
  }

  const post = await rest<{ title: string; body: string; cover_url: string; seo: { title?: string; description?: string } | null }>(f, env, 'contents', {
    store_id: `eq.${store.id}`,
    kind: 'eq.post',
    slug: `eq.${route.postSlug}`,
    status: 'eq.published',
    publish_at: `lte.${now.toISOString()}`,
    select: 'title,body,cover_url,seo',
  })
  if (!post) return null
  return {
    ...base,
    title: post.seo?.title || `${post.title} | ${store.name}`,
    description: plainText(post.seo?.description || post.body) || base.description,
    image: absolute(post.cover_url, origin) || base.image,
    type: 'article',
  }
}
