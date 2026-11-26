// Cloudflare Pages Function: escreve título, descrição e imagem de cada loja/produto/
// categoria/post no index.html, para a prévia do link no WhatsApp, Instagram e Google.
// Qualquer outro caminho, ou qualquer erro, segue para os arquivos do site sem mudança.
import { injectMeta, loadMeta, parseRoute, type MetaEnv } from './_lib/meta'

interface Env extends MetaEnv {
  ASSETS: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> }
}

interface Context {
  request: Request
  env: Env
  next(): Promise<Response>
}

export const onRequest = async ({ request, env, next }: Context): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next()
  const url = new URL(request.url)
  const route = parseRoute(url.pathname)
  if (!route || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return next()
  try {
    const [asset, meta] = await Promise.all([
      env.ASSETS.fetch(new URL('/', url)),
      loadMeta(route, env, (i, init) => fetch(i, init), url.origin + url.pathname),
    ])
    if (!meta || !asset.ok || !(asset.headers.get('content-type') ?? '').includes('text/html')) return next()
    const html = injectMeta(await asset.text(), meta)
    const headers = new Headers(asset.headers)
    headers.delete('content-length')
    headers.delete('etag')
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers })
  } catch {
    return next()
  }
}
