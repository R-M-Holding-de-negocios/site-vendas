// GET vindo do Mercado Pago (?code=&state=) → redireciona para o painel.
// Publicada com --no-verify-jwt: quem chama é o navegador voltando do Mercado Pago.
import { redirect } from '../_shared/http.ts'
import { finishOAuth } from '../_shared/oauth.ts'
import { deps } from '../_shared/deno.ts'

Deno.serve(async (req) => redirect(await finishOAuth(deps(), new URL(req.url).searchParams)))
