import { describe, expect, it } from 'vitest'
import { db } from '../../src/lib/api'
import { connectMercadoPago, mercadoPagoStatus, startMercadoPagoCheckout } from '../../src/lib/mercadopago'
import type { Store } from '../../src/lib/types'

describe('lib/mercadopago no modo demonstração', () => {
  it('não chama servidor', async () => {
    expect(db.demo).toBe(true)
    expect(await connectMercadoPago()).toBe('')
    expect(await startMercadoPagoCheckout('o1', 'tok', 'doces-da-ana')).toBe('/doces-da-ana/pedido/o1?t=tok&simulado=1')
  })

  it('mercadoPagoStatus segue a configuração da loja', async () => {
    const [store] = (await db.list('stores', { eq: { slug: 'doces-da-ana' }, limit: 1 })) as Store[]
    expect(store).toBeTruthy()
    expect(await mercadoPagoStatus(store.id)).toEqual({ connected: store.settings.payments.mercadopago.enabled, lost: false })
    expect((await mercadoPagoStatus('nao-existe')).connected).toBe(false)
  })
})
