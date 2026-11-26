import { describe, expect, it } from 'vitest'
import { escapeHtml, injectMeta, loadMeta, parseRoute, safeJson, type PageMeta } from '../../functions/_lib/meta'
import { onRequest } from '../../functions/[[path]]'

const PID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const CID = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const INDEX = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Vitrine — sua loja online</title>
    <meta name="description" content="velha" />
    <meta property="og:title" content="velho" />
  </head>
  <body><div id="root"></div></body>
</html>`

const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon' }

function supabase(rows: Record<string, unknown[]>) {
  const calls: URL[] = []
  const f = async (input: string, init?: RequestInit) => {
    const u = new URL(input)
    calls.push(u)
    expect((init?.headers as Record<string, string>).apikey).toBe('anon')
    const table = u.pathname.replace('/rest/v1/', '')
    return new Response(JSON.stringify(rows[table] ?? []), { status: 200 })
  }
  return { f, calls }
}

const storeRow = { id: 's1', slug: 'doces', name: 'Doces <da> "Ana"', description: '**Doces** caseiros & bolos', logo_url: '/logo.png', status: 'active' }

describe('rotas com prévia', () => {
  it('reconhece loja, produto, categoria e post', () => {
    expect(parseRoute('/doces')).toEqual({ kind: 'store', slug: 'doces' })
    expect(parseRoute('/doces/')).toEqual({ kind: 'store', slug: 'doces' })
    expect(parseRoute(`/doces/p/${PID}`)).toEqual({ kind: 'product', slug: 'doces', id: PID })
    expect(parseRoute(`/doces/c/${CID}`)).toEqual({ kind: 'category', slug: 'doces', id: CID })
    expect(parseRoute('/doces/blog/receita-de-bolo')).toEqual({ kind: 'post', slug: 'doces', postSlug: 'receita-de-bolo' })
  })

  it('ignora arquivos, rotas do app e caminhos desconhecidos', () => {
    for (const p of ['/', '/favicon.ico', '/assets/index-abc.js', '/entrar', '/painel', '/painel/pedidos', '/admin', '/doces/carrinho', '/doces/p/nao-uuid', '/doces/p/x/y', '/Doces', '/%E0%A4%A'])
      expect(parseRoute(p), p).toBeNull()
  })
})

describe('injeção das meta tags', () => {
  const meta: PageMeta = {
    title: 'Bolo "especial" <script>alert(1)</script>',
    description: "Feito com amor & carinho, d'Ana",
    image: 'https://cdn.example/b.jpg?a=1&b=2',
    url: 'https://vitrine.example/doces/p/1',
    siteName: 'Doces',
    type: 'product',
    product: { name: 'Bolo </script><script>x()</script>', description: 'd', images: ['https://cdn.example/b.jpg'], price_cents: 8990, available: true, sku: 'B1' },
  }

  it('escapa tudo e troca as tags antigas', () => {
    const html = injectMeta(INDEX, meta)
    expect(html).toContain('<title>Bolo &quot;especial&quot; &lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(html).toContain('<meta name="description" content="Feito com amor &amp; carinho, d&#39;Ana" />')
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/b.jpg?a=1&amp;b=2" />')
    expect(html).toContain('<meta property="og:url" content="https://vitrine.example/doces/p/1" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(html).not.toContain('velha')
    expect(html).not.toContain('velho')
    expect(html).not.toContain('<script>alert')
    expect(html.match(/<title>/g)).toHaveLength(1)
    // O JSON-LD não pode fechar a tag <script>.
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)!
    expect(ld[1]).not.toMatch(/<|>/)
    const data = JSON.parse(ld[1])
    expect(data).toMatchObject({ '@type': 'Product', name: 'Bolo </script><script>x()</script>', sku: 'B1' })
    expect(data.offers).toMatchObject({ priceCurrency: 'BRL', price: '89.90', availability: 'https://schema.org/InStock' })
    expect(html).toContain('<div id="root"></div>')
  })

  it('helpers de escape', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
    expect(safeJson({ a: '</script>\u2028' })).toBe('{"a":"\\u003c/script\\u003e\\u2028"}')
  })

  it('sem </head> devolve o HTML como veio', () => {
    expect(injectMeta('<p>oi</p>', meta)).toBe('<p>oi</p>')
  })
})

describe('busca dos dados', () => {
  it('loja', async () => {
    const { f, calls } = supabase({ stores: [storeRow] })
    const m = await loadMeta({ kind: 'store', slug: 'doces' }, env, f, 'https://vitrine.example/doces')
    expect(m).toMatchObject({ title: 'Doces <da> "Ana"', description: 'Doces caseiros & bolos', image: 'https://vitrine.example/logo.png', type: 'website' })
    expect(calls[0].searchParams.get('slug')).toBe('eq.doces')
  })

  it('produto com promoção, sem estoque', async () => {
    const product = {
      name: 'Bolo',
      description: 'Bolo de chocolate',
      images: ['https://cdn.example/bolo.jpg'],
      price_cents: 10000,
      promo_price_cents: 8990,
      promo_ends_at: null,
      available: true,
      blocked: false,
      track_stock: true,
      stock: 0,
      sku: '',
      seo: { title: '', description: '' },
    }
    const { f, calls } = supabase({ stores: [storeRow], products: [product] })
    const m = await loadMeta({ kind: 'product', slug: 'doces', id: PID }, env, f, `https://vitrine.example/doces/p/${PID}`)
    expect(m?.title).toBe('Bolo | Doces <da> "Ana"')
    expect(m?.image).toBe('https://cdn.example/bolo.jpg')
    expect(m?.product).toMatchObject({ price_cents: 8990, available: false })
    expect(calls[1].searchParams.get('store_id')).toBe('eq.s1')
    expect(calls[1].searchParams.get('id')).toBe(`eq.${PID}`)
  })

  it('produto bloqueado, loja suspensa ou inexistente → sem prévia', async () => {
    expect(await loadMeta({ kind: 'product', slug: 'doces', id: PID }, env, supabase({ stores: [storeRow], products: [{ blocked: true }] }).f, 'https://x/doces')).toBeNull()
    expect(await loadMeta({ kind: 'store', slug: 'doces' }, env, supabase({ stores: [{ ...storeRow, status: 'suspended' }] }).f, 'https://x/doces')).toBeNull()
    expect(await loadMeta({ kind: 'store', slug: 'doces' }, env, supabase({}).f, 'https://x/doces')).toBeNull()
  })

  it('post publicado', async () => {
    const { f, calls } = supabase({ stores: [storeRow], contents: [{ title: 'Receita', body: '# Título\nPasso a passo', cover_url: 'https://cdn/c.jpg', seo: null }] })
    const m = await loadMeta({ kind: 'post', slug: 'doces', postSlug: 'receita' }, env, f, 'https://vitrine.example/doces/blog/receita')
    expect(m).toMatchObject({ title: 'Receita | Doces <da> "Ana"', description: 'Título Passo a passo', image: 'https://cdn/c.jpg', type: 'article' })
    expect(calls[1].searchParams.get('status')).toBe('eq.published')
    expect(calls[1].searchParams.get('kind')).toBe('eq.post')
  })
})

describe('Pages Function', () => {
  const ctx = (path: string, rows: Record<string, unknown[]>) => {
    const original = globalThis.fetch
    const { f } = supabase(rows)
    globalThis.fetch = f as typeof fetch
    let nextCalled = 0
    const c = {
      request: new Request('https://vitrine.example' + path),
      env: {
        ...env,
        ASSETS: { fetch: async () => new Response(INDEX, { headers: { 'content-type': 'text/html; charset=utf-8' } }) },
      },
      next: async () => {
        nextCalled++
        return new Response('asset')
      },
    }
    return { c, restore: () => (globalThis.fetch = original), nexts: () => nextCalled }
  }

  it('injeta na página da loja', async () => {
    const t = ctx('/doces', { stores: [storeRow] })
    try {
      const res = await onRequest(t.c)
      const html = await res.text()
      expect(html).toContain('<meta property="og:title" content="Doces &lt;da&gt; &quot;Ana&quot;" />')
      expect(t.nexts()).toBe(0)
    } finally {
      t.restore()
    }
  })

  it('erro ou caminho de arquivo → asset sem mudança', async () => {
    const t = ctx('/assets/app.js', { stores: [storeRow] })
    const t2 = ctx('/doces', {})
    try {
      expect(await (await onRequest(t.c)).text()).toBe('asset')
      globalThis.fetch = (async () => {
        throw new Error('rede')
      }) as typeof fetch
      expect(await (await onRequest(t2.c)).text()).toBe('asset')
    } finally {
      t2.restore()
      t.restore()
    }
  })
})
