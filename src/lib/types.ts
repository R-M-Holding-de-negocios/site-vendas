// Modelo de dados compartilhado pelo site, pelo modo demonstração e pelo banco (supabase/migrations).
// Valores em dinheiro são sempre centavos inteiros. Datas são strings ISO 8601.

export type PlanId = 'vitrine' | 'loja' | 'pro'
export type StoreStatus = 'trial' | 'active' | 'overdue' | 'suspended' | 'closed'

export interface PlanRow {
  id: PlanId
  name: string
  price_cents: number
  /** Taxa da plataforma sobre pedidos pagos online, em pontos percentuais (ex.: 2 = 2%). */
  fee_percent: number
}

export interface Store {
  id: string
  owner_id: string
  slug: string
  name: string
  whatsapp: string
  description: string
  logo_url: string
  plan: PlanId
  status: StoreStatus
  trial_ends_at: string | null
  paid_until: string | null
  /** Plano que volta quando o pagamento for registrado; preenchido quando a loja passou da tolerância (ver lib/billing.ts). */
  plan_before_downgrade?: PlanId | null
  settings: StoreSettings
  theme: Theme
  theme_draft: Theme | null
  theme_history: { at: string; theme: Theme }[]
  created_at: string
}

export interface DayHours {
  open: boolean
  from: string // "09:00"
  to: string // "18:00"
}

export interface DeliveryZone {
  name: string
  fee_cents: number
}

export interface StoreSettings {
  instagram: string
  facebook: string
  tiktok: string
  email: string
  legal: { name: string; document: string; address: string }
  policies: { exchange: string; shipping: string; privacy: string }
  hours: { enabled: boolean; days: DayHours[]; outside: 'accept' | 'block'; paused: boolean }
  min_order_cents: number
  prep_days: number
  free_shipping_above_cents: number
  max_installments: number
  goal_cents: number
  delivery: {
    pickup: { enabled: boolean; address: string; instructions: string }
    zones: { enabled: boolean; items: DeliveryZone[] }
    fixed: { enabled: boolean; fee_cents: number; label: string }
    arrange: { enabled: boolean }
  }
  payments: {
    whatsapp: { enabled: boolean }
    pix: { enabled: boolean; key: string; holder: string; city: string; discount_percent: number }
    cash: { enabled: boolean }
    card_on_delivery: { enabled: boolean }
    mercadopago: { enabled: boolean }
  }
  tracking: { ga4: string; meta_pixel: string; tiktok_pixel: string }
  notifications: { sound: boolean }
  lead_popup: { enabled: boolean; text: string; coupon: string; delay_s: number }
}

export interface Seo {
  title: string
  description: string
}

export interface Category {
  id: string
  store_id: string
  name: string
  position: number
  image_url: string
  seo: Seo
}

export interface ProductOption {
  name: string
  values: string[]
}

export interface Product {
  id: string
  store_id: string
  name: string
  description: string
  price_cents: number
  promo_price_cents: number | null
  promo_ends_at: string | null
  images: string[]
  category_ids: string[]
  available: boolean
  featured: boolean
  position: number
  cost_cents: number | null
  sku: string
  track_stock: boolean
  stock: number
  weight_g: number
  height_cm: number
  width_cm: number
  length_cm: number
  options: ProductOption[]
  qty_discounts: { min_qty: number; percent: number }[]
  video_url: string
  seo: Seo
  /** Bloqueado pelo admin da plataforma (conteúdo proibido). */
  blocked: boolean
  /** Unidades vendidas (atualizado pelo servidor a cada pedido); usado para ordenar por mais vendidos. */
  sold_count: number
  created_at: string
}

export interface Variant {
  id: string
  store_id: string
  product_id: string
  /** Ex.: { Tamanho: "M", Cor: "Azul" } */
  values: Record<string, string>
  /** Preço próprio; null usa o preço do produto (com promoção). */
  price_cents: number | null
  stock: number
  sku: string
  image: string
  available: boolean
}

export type OrderStatus = 'pending' | 'paid' | 'preparing' | 'ready' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
export type ShipMethod = 'pickup' | 'zone' | 'fixed' | 'arrange'
export type PayMethod = 'whatsapp' | 'pix' | 'cash' | 'card_on_delivery' | 'mercadopago'

export interface Address {
  cep: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
}

export interface OrderItem {
  product_id: string
  variant_id: string | null
  name: string
  variant_label: string
  /** Preço de tabela da unidade (sem promoção nem desconto por quantidade). */
  list_price_cents: number
  /** Preço cobrado por unidade. */
  unit_price_cents: number
  cost_cents: number | null
  qty: number
  image: string
}

export interface TrafficSource {
  source: string // instagram, whatsapp, google, facebook, direto, outro, ou utm_source
  medium: string
  campaign: string
  device: 'mobile' | 'desktop'
}

export interface Order {
  id: string
  store_id: string
  number: number
  status: OrderStatus
  /** Segredo do link de acompanhamento enviado ao cliente. */
  token: string
  customer_id: string | null
  customer: { name: string; phone: string; email: string }
  shipping: { method: ShipMethod; label: string; fee_cents: number; address: Address | null }
  payment: { method: PayMethod; status: 'pending' | 'paid' | 'refunded'; provider_ref: string; change_for_cents: number }
  items: OrderItem[]
  subtotal_cents: number
  discount_cents: number
  shipping_cents: number
  total_cents: number
  platform_fee_cents: number
  coupon_code: string
  notes: string
  internal_notes: string
  tracking_code: string
  source: TrafficSource | null
  history: { status: OrderStatus; at: string; note: string }[]
  manual: boolean
  created_at: string
  paid_at: string | null
}

export interface Customer {
  id: string
  store_id: string
  name: string
  phone: string
  email: string
  tags: string[]
  notes: string
  created_at: string
}

export interface Coupon {
  id: string
  store_id: string
  code: string
  type: 'percent' | 'fixed' | 'free_shipping'
  value: number // percent: 10 = 10%; fixed: centavos
  min_order_cents: number
  max_uses: number | null
  uses: number
  starts_at: string | null
  ends_at: string | null
  active: boolean
  created_at: string
}

export interface Content {
  id: string
  store_id: string
  kind: 'page' | 'post'
  slug: string
  title: string
  /** Texto com formatação simples (ver lib/markdown.ts). */
  body: string
  cover_url: string
  product_ids: string[]
  show_in_menu: boolean
  position: number
  status: 'draft' | 'published'
  /** Data de publicação; no futuro = agendado. */
  publish_at: string
  seo: Seo
  created_at: string
}

export type EventType =
  | 'visit'
  | 'product_view'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'search'
  | 'checkout_start'
  | 'order_placed'
  | 'content_view'

export interface StoreEvent {
  id: string
  store_id: string
  session_id: string
  type: EventType
  product_id: string | null
  data: { q?: string; results?: number; path?: string; value_cents?: number; content_id?: string } & Partial<TrafficSource>
  created_at: string
}

export interface CheckoutDraft {
  id: string
  store_id: string
  session_id: string
  customer: { name: string; phone: string }
  items: { product_id: string; variant_id: string | null; qty: number; name: string; unit_price_cents: number }[]
  total_cents: number
  order_id: string | null
  contacted_at: string | null
  created_at: string
  updated_at: string
}

export interface StockAlert {
  id: string
  store_id: string
  product_id: string
  variant_id: string | null
  contact: string
  notified: boolean
  created_at: string
}

export interface Lead {
  id: string
  store_id: string
  contact: string
  created_at: string
}

export interface Review {
  id: string
  store_id: string
  product_id: string
  order_id: string
  name: string
  rating: number
  comment: string
  approved: boolean
  created_at: string
}

export interface Media {
  id: string
  store_id: string
  url: string
  created_at: string
}

export interface Invoice {
  id: string
  store_id: string
  plan: PlanId
  amount_cents: number
  months: number
  method: string
  note: string
  paid_at: string
  created_at: string
}

export interface Announcement {
  id: string
  title: string
  body: string
  created_at: string
}

/** Linha da lista de lojas do admin (vem da função admin_list_stores). */
export interface AdminStoreRow {
  store: Store
  email: string
  last_sign_in_at: string | null
  product_count: number
  orders_30d: number
  notes: string
}

export interface AuditEntry {
  id: string
  admin_email: string
  store_id: string
  action: string
  created_at: string
}

// ---------- Aparência ----------

export type SectionType =
  | 'banner'
  | 'carousel'
  | 'video'
  | 'categories'
  | 'products'
  | 'featured_product'
  | 'image_text'
  | 'text'
  | 'gallery'
  | 'testimonials'
  | 'benefits'
  | 'faq'
  | 'map'
  | 'countdown'
  | 'posts'
  | 'lead'

export interface Section {
  id: string
  type: SectionType
  enabled: boolean
  // Cada tipo de seção define suas próprias opções (ver store/sections.tsx).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: Record<string, any>
  style: { bg: string; width: 'full' | 'contained'; pad: 's' | 'm' | 'l'; device: 'all' | 'mobile' | 'desktop' }
}

export interface MenuItem {
  label: string
  type: 'home' | 'category' | 'page' | 'blog' | 'url'
  target: string
  children: MenuItem[]
}

export interface Theme {
  preset: string
  colors: { primary: string; background: string; surface: string; text: string; muted: string; accent: string }
  font: string
  radius: 'square' | 'rounded' | 'pill'
  spacing: 'compact' | 'normal' | 'wide'
  header: { logo_align: 'left' | 'center'; sticky: boolean; transparent: boolean; logo_size: number }
  menu: MenuItem[]
  announcement: { enabled: boolean; messages: string[]; link: string }
  sections: Section[]
  product: {
    ratio: '1/1' | '4/5' | '3/2'
    fit: 'cover' | 'contain'
    cols_mobile: 1 | 2
    cols_desktop: 3 | 4 | 5
    card: { add_button: boolean; badge: boolean; installments: boolean; rating: boolean }
    gallery: 'below' | 'side' | 'stacked'
    blocks: { id: 'stock' | 'shipping' | 'share' | 'related' | 'reviews'; enabled: boolean }[]
    buy_label: string
  }
  footer: { text: string; show_payments: boolean; columns: { title: string; links: MenuItem[] }[] }
  animations: {
    intensity: 'off' | 'soft' | 'normal'
    sections: 'none' | 'fade' | 'slide-up' | 'slide-side' | 'zoom'
    product_hover: 'none' | 'zoom' | 'swap' | 'shadow'
    carousel: 'slide' | 'fade'
    carousel_seconds: number
    buy_button: 'none' | 'pulse' | 'shine'
    header: 'none' | 'shrink' | 'hide'
    cart_bounce: boolean
    announcement: 'static' | 'marquee' | 'rotate'
    page: 'none' | 'fade'
  }
  whatsapp_button: boolean
  hide_branding: boolean
}
