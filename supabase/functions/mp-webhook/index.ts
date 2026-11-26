// POST do Mercado Pago (notificações de pagamento). Publicada com --no-verify-jwt.
import { handleWebhook } from '../_shared/webhook.ts'
import { deps } from '../_shared/deno.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  const tolerance = Number(Deno.env.get('MP_WEBHOOK_TOLERANCE_S') ?? '') || undefined
  try {
    const r = await handleWebhook(deps(), { url: req.url, headers: req.headers, body: await req.text() }, tolerance)
    console.log('mp-webhook', r.outcome)
    return new Response(r.outcome, { status: r.status })
  } catch (e) {
    // Falha inesperada (ex.: API do Mercado Pago fora do ar): 500 para o Mercado Pago tentar de novo.
    console.error('mp-webhook', e)
    return new Response('erro', { status: 500 })
  }
})
