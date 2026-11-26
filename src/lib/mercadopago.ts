// Pagamento online pelo Mercado Pago (cada lojista conecta a própria conta).
// As chamadas vão para as Edge Functions em supabase/functions. No modo demonstração
// não há servidor: a conexão não acontece e o pagamento é simulado.
import { db } from './api'
import { supabaseClient } from './db-supabase'

async function invoke<T>(fn: string, body: unknown): Promise<T> {
  if (!supabaseClient) throw new Error('Pagamento online indisponível no momento.')
  const { data, error } = await supabaseClient.functions.invoke(fn, { body: body as Record<string, unknown> })
  if (error) {
    // Erros das funções vêm como { error: "mensagem em português" }.
    const ctx = (error as { context?: Response }).context
    let message = ''
    try {
      if (ctx && typeof ctx.json === 'function') message = ((await ctx.json()) as { error?: string }).error ?? ''
    } catch {
      /* resposta sem JSON */
    }
    throw new Error(message || 'Não foi possível falar com o Mercado Pago agora. Tente de novo em instantes.')
  }
  return data as T
}

/**
 * Link da página do Mercado Pago onde o lojista autoriza a loja a receber pagamentos.
 * No modo demonstração devolve '' (a tela mostra um aviso).
 */
export async function connectMercadoPago(): Promise<string> {
  if (db.demo) return ''
  const { url } = await invoke<{ url: string }>('mp-oauth-start', {})
  return url
}

/**
 * Link para onde mandar o cliente pagar o pedido (Checkout Pro: Pix, cartão, boleto).
 * No modo demonstração devolve a própria página do pedido, marcada como simulada.
 */
export async function startMercadoPagoCheckout(orderId: string, token: string, slug: string): Promise<string> {
  if (db.demo) return `/${slug}/pedido/${orderId}?t=${encodeURIComponent(token)}&simulado=1`
  const { url } = await invoke<{ url: string }>('mp-create-preference', { order_id: orderId, token })
  return url
}

export async function isMercadoPagoConnected(storeId: string): Promise<boolean> {
  const r = await db.rpc('payment_connections', { store_id: storeId })
  return !!r?.mercadopago
}
