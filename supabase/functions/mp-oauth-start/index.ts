// POST (com o JWT do lojista) → { url } da página de autorização do Mercado Pago.
import { browserHandler } from '../_shared/http.ts'
import { startOAuth } from '../_shared/oauth.ts'
import { callerId, deps } from '../_shared/deno.ts'

Deno.serve((req) => browserHandler(req, async () => startOAuth(deps(), await callerId(req))))
