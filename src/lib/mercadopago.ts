// Provisório: substituído pela integração completa com o Mercado Pago.
import { db } from './api'
export async function startMercadoPagoCheckout(orderId: string, token: string, slug: string): Promise<string> {
  void db
  return `/${slug}/pedido/${orderId}?t=${token}&simulado=1`
}
export async function connectMercadoPago(): Promise<string> {
  return ''
}
export async function isMercadoPagoConnected(storeId: string): Promise<boolean> {
  void storeId
  return false
}
