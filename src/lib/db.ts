// Acesso a dados. O app fala só com esta interface; existem duas implementações:
// - db-supabase.ts: banco real (Supabase), com as regras de segurança no próprio banco.
// - db-demo.ts: modo demonstração, tudo guardado no navegador (usado quando não há .env).
//
// Operações que precisam ser confiáveis (preço do pedido, estoque, ações do admin)
// são funções do servidor ("rpc"). Os nomes e argumentos abaixo são o contrato
// seguido pelas duas implementações e por supabase/migrations.
import type {
  AdminStoreRow,
  Announcement,
  AuditEntry,
  Category,
  CheckoutDraft,
  Content,
  Coupon,
  Customer,
  Invoice,
  Lead,
  Media,
  Order,
  OrderStatus,
  PayMethod,
  PlanId,
  PlanRow,
  Product,
  Review,
  ShipMethod,
  StockAlert,
  Store,
  StoreEvent,
  StoreSettings,
  StoreStatus,
  Theme,
  TrafficSource,
  Address,
  Variant,
} from './types'
import type { CartLine } from './pricing'

export interface Tables {
  stores: Store
  categories: Category
  products: Product
  variants: Variant
  orders: Order
  customers: Customer
  coupons: Coupon
  contents: Content
  events: StoreEvent
  checkouts: CheckoutDraft
  stock_alerts: StockAlert
  leads: Lead
  reviews: Review
  media: Media
  invoices: Invoice
  announcements: Announcement
  plans: PlanRow
}
export type TableName = keyof Tables

export interface Query {
  eq?: Record<string, string | number | boolean | null>
  in?: [string, (string | number)[]]
  gte?: [string, string | number]
  lt?: [string, string | number]
  order?: [string, 'asc' | 'desc']
  limit?: number
  /** Colunas a ler (padrão: todas). A loja pública não lê o custo dos produtos. */
  columns?: string
}

export interface PlaceOrderArgs {
  store_id: string
  lines: CartLine[]
  customer: { name: string; phone: string; email: string }
  shipping: { method: ShipMethod; zone?: string; address: Address | null }
  payment: { method: PayMethod; change_for_cents?: number }
  coupon: string
  notes: string
  source: TrafficSource | null
  checkout_id: string | null
  /** Pedido registrado pelo lojista no painel (venda feita por fora). */
  manual?: boolean
  /** Só para pedido manual: já entra como pago. */
  paid?: boolean
}
export interface PlacedOrder {
  id: string
  number: number
  token: string
  total_cents: number
  status: OrderStatus
}

export interface Rpc {
  create_store(a: { name: string; slug: string; whatsapp: string; settings: StoreSettings; theme: Theme }): Promise<Store>
  place_order(a: PlaceOrderArgs): Promise<PlacedOrder>
  /** Cupom ativo com esse código, ou null. Não valida datas nem valor mínimo (isso é do pricing). */
  check_coupon(a: { store_id: string; code: string }): Promise<Coupon | null>
  /** Pedido para a página de acompanhamento; sem custo, taxa nem anotações internas. */
  get_public_order(a: { id: string; token: string }): Promise<Order | null>
  set_order_status(a: { order_id: string; status: OrderStatus; note: string }): Promise<Order>
  save_checkout(a: {
    id: string | null
    store_id: string
    session_id: string
    customer: CheckoutDraft['customer']
    items: CheckoutDraft['items']
    total_cents: number
  }): Promise<{ id: string }>
  submit_review(a: { order_id: string; token: string; product_id: string; rating: number; comment: string; name: string }): Promise<void>
  delete_my_store(a: Record<string, never>): Promise<void>
  is_admin(a: Record<string, never>): Promise<boolean>
  admin_list_stores(a: Record<string, never>): Promise<AdminStoreRow[]>
  admin_update_store(a: {
    store_id: string
    plan?: PlanId
    status?: StoreStatus
    trial_ends_at?: string | null
    paid_until?: string | null
    notes?: string
  }): Promise<void>
  admin_register_payment(a: { store_id: string; amount_cents: number; months: number; method: string; note: string }): Promise<Invoice>
  admin_set_product_blocked(a: { product_id: string; blocked: boolean }): Promise<void>
  admin_log(a: { store_id: string; action: string }): Promise<void>
  admin_audit_list(a: { store_id: string | null }): Promise<AuditEntry[]>
  admin_update_plan(a: { id: PlanId; price_cents: number; fee_percent: number }): Promise<void>
  admin_announce(a: { title: string; body: string }): Promise<void>
  /** Contas de pagamento online conectadas pela loja (nunca devolve os tokens). */
  payment_connections(a: { store_id: string }): Promise<{ mercadopago: boolean }>
  /** Custo dos produtos da própria loja (ou de qualquer loja, para o admin): { id: centavos }. */
  product_costs(a: { ids: string[] }): Promise<Record<string, number>>
}

export interface User {
  id: string
  email: string
}

export interface Db {
  readonly demo: boolean
  list<T extends TableName>(table: T, q?: Query): Promise<Tables[T][]>
  get<T extends TableName>(table: T, id: string): Promise<Tables[T] | null>
  insert<T extends TableName>(table: T, row: Partial<Tables[T]>): Promise<Tables[T]>
  update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): Promise<Tables[T]>
  remove(table: TableName, id: string): Promise<void>
  rpc<K extends keyof Rpc>(fn: K, args: Parameters<Rpc[K]>[0]): ReturnType<Rpc[K]>
  /** Envia uma imagem já reduzida e devolve a URL pública. */
  upload(file: Blob, storeId: string): Promise<string>
  auth: {
    user(): Promise<User | null>
    /** false = conta criada, falta confirmar o e-mail. */
    signUp(email: string, password: string): Promise<boolean>
    signIn(email: string, password: string): Promise<void>
    signOut(): Promise<void>
    resetPassword(email: string): Promise<void>
    /** Troca a senha de quem entrou pelo link de recuperação (ou já está logado). */
    updatePassword(password: string): Promise<void>
    /** Verificação em duas etapas (usada no painel do admin). */
    mfa: {
      status(): Promise<{ verified: boolean; factorId: string | null }>
      enroll(): Promise<{ factorId: string; qr: string; secret: string }>
      verify(factorId: string, code: string): Promise<void>
    }
  }
}
