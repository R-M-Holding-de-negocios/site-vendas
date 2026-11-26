import type { OrderStatus } from './types'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Aguardando pagamento',
  paid: 'Pago',
  preparing: 'Em preparo',
  ready: 'Pronto para retirada',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  refunded: 'Devolvido',
}
