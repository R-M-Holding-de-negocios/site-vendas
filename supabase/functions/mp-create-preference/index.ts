// POST { order_id, token } (público: quem chama é o cliente da loja) → { url } do Checkout Pro.
// Publicada com --no-verify-jwt.
import { browserHandler } from '../_shared/http.ts'
import { createCheckout } from '../_shared/preference.ts'
import { deps } from '../_shared/deno.ts'

Deno.serve((req) => browserHandler(req, async () => createCheckout(deps(), await req.json().catch(() => ({})))))
