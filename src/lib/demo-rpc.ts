// Funções do servidor no modo demonstração. Fazem o mesmo que as funções SQL
// em supabase/migrations; os testes em tests/sql comparam os dois.
import type { DemoStore } from './db-demo'
import type { PlacedOrder, Rpc } from './db'
import { openState } from './hours'
import { DEFAULT_PLANS, TRIAL_DAYS, can } from './plans'
import { quote } from './pricing'
import type { Customer, Order, OrderStatus, PlanRow, Store } from './types'
import { addDays, nowIso, onlyDigits, randomToken } from './util'

const RESERVED = ['entrar', 'painel', 'admin', 'api', 'loja', 'lojas', 'planos', 'ajuda', 'demo', 'assets', 'static']

export function validSlug(slug: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED.includes(slug)
}

export function demoRpc(s: DemoStore): Rpc {
  const me = () => {
    if (!s.user) throw new Error('Entre na sua conta.')
    return s.user
  }
  const ownStore = (storeId: string) => {
    const st = s.rows('stores').find((x) => x.id === storeId)
    if (!st || (st.owner_id !== me().id && !s.isAdmin())) throw new Error('Você não tem permissão para fazer isso.')
    return st
  }
  const admin = () => {
    if (!s.isAdmin()) throw new Error('Acesso restrito ao admin.')
    return s.user!
  }
  const plans = (): PlanRow[] => (s.rows('plans').length ? s.rows('plans') : DEFAULT_PLANS)

  const restock = (order: Order) => {
    for (const it of order.items) {
      const p = s.rows('products').find((x) => x.id === it.product_id)
      if (!p?.track_stock) continue
      if (it.variant_id) {
        const v = s.rows('variants').find((x) => x.id === it.variant_id)
        if (v) s.update('variants', v.id, { stock: v.stock + it.qty })
      } else s.update('products', p.id, { stock: p.stock + it.qty })
    }
  }

  return {
    async create_store(a) {
      const u = me()
      if (s.rows('stores').some((x) => x.owner_id === u.id)) throw new Error('Você já tem uma loja.')
      if (!validSlug(a.slug)) throw new Error('Escolha outro endereço: use de 3 a 40 letras, números ou hífens.')
      if (s.rows('stores').some((x) => x.slug === a.slug)) throw new Error('Esse endereço já está em uso. Escolha outro.')
      return s.insert('stores', {
        owner_id: u.id,
        slug: a.slug,
        name: a.name.trim(),
        whatsapp: a.whatsapp,
        description: '',
        logo_url: '',
        plan: 'pro',
        status: 'trial',
        trial_ends_at: addDays(new Date(), TRIAL_DAYS).toISOString(),
        paid_until: null,
        settings: a.settings,
        theme: a.theme,
        theme_draft: null,
        theme_history: [],
      })
    },

    async place_order(a): Promise<PlacedOrder> {
      const store = s.rows('stores').find((x) => x.id === a.store_id)
      if (!store || store.status === 'suspended' || store.status === 'closed') throw new Error('Esta loja não está recebendo pedidos.')
      if (a.manual) ownStore(store.id)
      if (!can(store, 'saved_orders')) throw new Error('Esta loja recebe pedidos pelo WhatsApp.')
      if (!a.manual) {
        const open = openState(store.settings.hours)
        if (store.settings.hours.paused || (!open.open && store.settings.hours.outside === 'block')) throw new Error(open.message)
      }
      if (!a.customer.name.trim() || onlyDigits(a.customer.phone).length < 10) throw new Error('Informe seu nome e WhatsApp com DDD.')
      const needsAddress = a.shipping.method === 'zone' || a.shipping.method === 'fixed'
      if (needsAddress && (!a.shipping.address?.street || !a.shipping.address?.number)) throw new Error('Informe o endereço de entrega.')

      // Cupom só vale no plano Pro; nos outros planos o código é ignorado (não conta uso nem fica no pedido).
      const code = can(store, 'coupons') ? a.coupon.trim().toUpperCase() : ''
      const coupon = code ? (s.rows('coupons').find((c) => c.store_id === store.id && c.code === code && c.active) ?? null) : null
      if (code && !coupon) throw new Error('Cupom inválido.')
      const fee = plans().find((p) => p.id === store.plan)!.fee_percent
      const ids = a.lines.map((l) => l.product_id)
      const q = quote({
        store,
        lines: a.lines,
        products: s.rows('products').filter((p) => p.store_id === store.id && ids.includes(p.id)),
        variants: s.rows('variants').filter((v) => v.store_id === store.id && ids.includes(v.product_id)),
        shipping: { method: a.shipping.method, zone: a.shipping.zone },
        payment: a.payment.method,
        coupon,
        feePercent: fee,
        now: new Date(),
      })
      const errors = a.manual ? q.errors.filter((e) => !e.startsWith('O pedido mínimo')) : q.errors
      if (errors.length) throw new Error(errors[0])
      if (coupon && q.coupon_error) throw new Error(q.coupon_error)

      // Cliente: um por telefone em cada loja.
      const phone = onlyDigits(a.customer.phone)
      let customer: Customer | undefined = s.rows('customers').find((c) => c.store_id === store.id && c.phone === phone)
      if (!customer)
        customer = s.insert('customers', {
          store_id: store.id,
          name: a.customer.name.trim(),
          phone,
          email: a.customer.email.trim(),
          tags: [],
          notes: '',
        })
      else if (a.customer.email && !customer.email) s.update('customers', customer.id, { email: a.customer.email.trim() })

      for (const it of q.items) {
        const p = s.rows('products').find((x) => x.id === it.product_id)!
        s.update('products', p.id, { sold_count: (p.sold_count ?? 0) + it.qty })
        if (!p.track_stock) continue
        if (it.variant_id) {
          const v = s.rows('variants').find((x) => x.id === it.variant_id)!
          s.update('variants', v.id, { stock: v.stock - it.qty })
        } else s.update('products', p.id, { stock: p.stock - it.qty })
      }
      if (coupon) s.update('coupons', coupon.id, { uses: coupon.uses + 1 })

      const number = Math.max(1000, ...s.rows('orders').filter((o) => o.store_id === store.id).map((o) => o.number)) + 1
      const now = nowIso()
      const paid = !!(a.manual && a.paid)
      const status: OrderStatus = paid ? 'paid' : 'pending'
      const order = s.insert('orders', {
        store_id: store.id,
        number,
        status,
        token: randomToken(),
        customer_id: customer.id,
        customer: { name: a.customer.name.trim(), phone, email: a.customer.email.trim() },
        shipping: { method: a.shipping.method, label: q.shipping_label, fee_cents: q.shipping_cents, address: needsAddress ? a.shipping.address : null },
        payment: { method: a.payment.method, status: paid ? 'paid' : 'pending', provider_ref: '', change_for_cents: a.payment.change_for_cents ?? 0 },
        items: q.items,
        subtotal_cents: q.subtotal_cents,
        discount_cents: q.discount_cents,
        shipping_cents: q.shipping_cents,
        total_cents: q.total_cents,
        platform_fee_cents: q.platform_fee_cents,
        coupon_code: coupon && !q.coupon_error ? coupon.code : '',
        notes: a.notes.trim(),
        internal_notes: '',
        tracking_code: '',
        source: a.source,
        history: [{ status, at: now, note: a.manual ? 'Pedido registrado no painel' : 'Pedido feito na loja' }],
        manual: !!a.manual,
        paid_at: paid ? now : null,
      })
      if (a.checkout_id) {
        const c = s.rows('checkouts').find((x) => x.id === a.checkout_id && x.store_id === store.id)
        if (c) s.update('checkouts', c.id, { order_id: order.id })
      }
      return { id: order.id, number: order.number, token: order.token, total_cents: order.total_cents, status: order.status }
    },

    async check_coupon(a) {
      const code = a.code.trim().toUpperCase()
      return s.rows('coupons').find((c) => c.store_id === a.store_id && c.code === code && c.active) ?? null
    },

    async get_public_order(a) {
      const o = s.rows('orders').find((x) => x.id === a.id && x.token === a.token)
      if (!o) return null
      return { ...o, internal_notes: '', platform_fee_cents: 0, items: o.items.map((i) => ({ ...i, cost_cents: null })) }
    },

    async set_order_status(a) {
      const o = s.rows('orders').find((x) => x.id === a.order_id)
      if (!o) throw new Error('Pedido não encontrado.')
      ownStore(o.store_id)
      if (o.status === a.status) return o
      const wasClosed = o.status === 'cancelled' || o.status === 'refunded'
      const closing = a.status === 'cancelled' || a.status === 'refunded'
      if (wasClosed && !closing) throw new Error('Um pedido cancelado não pode ser reaberto. Registre um novo pedido.')
      if (closing && !wasClosed) restock(o)
      const now = nowIso()
      const becamePaid = !o.paid_at && ['paid', 'preparing', 'ready', 'shipped', 'delivered'].includes(a.status)
      return s.update('orders', o.id, {
        status: a.status,
        paid_at: becamePaid ? now : o.paid_at,
        payment: {
          ...o.payment,
          status: a.status === 'refunded' ? 'refunded' : becamePaid || o.payment.status === 'paid' ? 'paid' : o.payment.status,
        },
        history: [...o.history, { status: a.status, at: now, note: a.note }],
      })
    },

    async save_checkout(a) {
      const now = nowIso()
      const existing = a.id ? s.rows('checkouts').find((c) => c.id === a.id && c.store_id === a.store_id && !c.order_id) : null
      if (existing) {
        s.update('checkouts', existing.id, { customer: a.customer, items: a.items, total_cents: a.total_cents, updated_at: now })
        return { id: existing.id }
      }
      const c = s.insert('checkouts', {
        store_id: a.store_id,
        session_id: a.session_id,
        customer: a.customer,
        items: a.items,
        total_cents: a.total_cents,
        order_id: null,
        contacted_at: null,
        updated_at: now,
      })
      return { id: c.id }
    },

    async submit_review(a) {
      const o = s.rows('orders').find((x) => x.id === a.order_id && x.token === a.token)
      if (!o || o.status !== 'delivered') throw new Error('Só é possível avaliar pedidos entregues.')
      if (!o.items.some((i) => i.product_id === a.product_id)) throw new Error('Este produto não faz parte do pedido.')
      if (s.rows('reviews').some((r) => r.order_id === o.id && r.product_id === a.product_id)) throw new Error('Você já avaliou este produto.')
      s.insert('reviews', {
        store_id: o.store_id,
        product_id: a.product_id,
        order_id: o.id,
        name: a.name.trim().slice(0, 60) || o.customer.name.split(' ')[0],
        rating: Math.min(5, Math.max(1, Math.round(a.rating))),
        comment: a.comment.trim().slice(0, 1000),
        approved: false,
      })
    },

    async delete_my_store() {
      const u = me()
      const st = s.rows('stores').find((x) => x.owner_id === u.id)
      if (!st) return
      for (const t of ['categories', 'products', 'variants', 'orders', 'customers', 'coupons', 'contents', 'events', 'checkouts', 'stock_alerts', 'leads', 'reviews', 'media', 'invoices'] as const)
        for (const r of s.rows(t).filter((r) => (r as { store_id?: string }).store_id === st.id)) s.remove(t, r.id)
      s.remove('stores', st.id)
    },

    async is_admin() {
      return s.isAdmin()
    },

    async admin_list_stores() {
      admin()
      const since = addDays(new Date(), -30).toISOString()
      const notes = JSON.parse(localStorage.getItem('vt_admin_notes') ?? '{}') as Record<string, string>
      return s.rows('stores').map((st) => {
        const owner = s.users().find((u) => u.id === st.owner_id)
        return {
          store: st,
          email: owner?.email ?? 'demo@exemplo.com',
          last_sign_in_at: st.created_at,
          product_count: s.rows('products').filter((p) => p.store_id === st.id).length,
          orders_30d: s.rows('orders').filter((o) => o.store_id === st.id && o.created_at >= since).length,
          notes: notes[st.id] ?? '',
        }
      })
    },

    async admin_update_store(a) {
      admin()
      const patch: Partial<Store> = {}
      if (a.plan) patch.plan = a.plan
      if (a.status) patch.status = a.status
      if (a.trial_ends_at !== undefined) patch.trial_ends_at = a.trial_ends_at
      if (a.paid_until !== undefined) patch.paid_until = a.paid_until
      if (Object.keys(patch).length) s.update('stores', a.store_id, patch)
      if (a.notes !== undefined) {
        const notes = JSON.parse(localStorage.getItem('vt_admin_notes') ?? '{}')
        notes[a.store_id] = a.notes
        localStorage.setItem('vt_admin_notes', JSON.stringify(notes))
      }
      log(a.store_id, describe(a))
    },

    async admin_register_payment(a) {
      admin()
      const st = s.rows('stores').find((x) => x.id === a.store_id)!
      const base = st.paid_until && new Date(st.paid_until) > new Date() ? new Date(st.paid_until) : new Date()
      const until = new Date(base)
      until.setMonth(until.getMonth() + a.months)
      s.update('stores', st.id, { paid_until: until.toISOString(), status: 'active' })
      log(st.id, `Pagamento registrado: ${a.months} mês(es)`)
      return s.insert('invoices', {
        store_id: st.id,
        plan: st.plan,
        amount_cents: a.amount_cents,
        months: a.months,
        method: a.method,
        note: a.note,
        paid_at: nowIso(),
      })
    },

    async admin_set_product_blocked(a) {
      admin()
      const p = s.update('products', a.product_id, { blocked: a.blocked })
      log(p.store_id, `${a.blocked ? 'Bloqueou' : 'Desbloqueou'} o produto "${p.name}"`)
    },

    async admin_log(a) {
      admin()
      log(a.store_id, a.action)
    },

    async admin_audit_list(a) {
      admin()
      const all = JSON.parse(localStorage.getItem('vt_audit') ?? '[]') as ReturnType<typeof entry>[]
      return all.filter((e) => !a.store_id || e.store_id === a.store_id).reverse()
    },

    async admin_update_plan(a) {
      admin()
      if (!s.rows('plans').length) for (const p of DEFAULT_PLANS) s.insert('plans', p)
      s.update('plans', a.id, { price_cents: a.price_cents, fee_percent: a.fee_percent })
    },

    async admin_announce(a) {
      admin()
      s.insert('announcements', { title: a.title, body: a.body })
    },

    async payment_connections(a) {
      const st = s.rows('stores').find((x) => x.id === a.store_id)
      return { mercadopago: !!st?.settings?.payments?.mercadopago?.enabled }
    },
  }

  function entry(storeId: string, action: string) {
    return { id: crypto.randomUUID(), admin_email: s.user?.email ?? '', store_id: storeId, action, created_at: nowIso() }
  }
  function log(storeId: string, action: string) {
    const all = JSON.parse(localStorage.getItem('vt_audit') ?? '[]')
    all.push(entry(storeId, action))
    localStorage.setItem('vt_audit', JSON.stringify(all.slice(-500)))
  }
  function describe(a: Parameters<Rpc['admin_update_store']>[0]) {
    const parts = []
    if (a.plan) parts.push(`plano para ${a.plan}`)
    if (a.status) parts.push(`situação para ${a.status}`)
    if (a.trial_ends_at !== undefined) parts.push('fim do teste')
    if (a.paid_until !== undefined) parts.push('vencimento')
    if (a.notes !== undefined) parts.push('anotações')
    return `Alterou ${parts.join(', ')}`
  }
}

