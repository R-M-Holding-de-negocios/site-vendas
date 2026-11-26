// Dados de exemplo do modo demonstração: uma confeitaria com 90 dias de vendas,
// para que o painel e os relatórios já mostrem algo ao abrir.
import type { DemoStore } from './db-demo'
import { DEFAULT_PLANS, TRIAL_DAYS } from './plans'
import { availableStock, basePrice, qtyDiscountPercent, variantLabel } from './pricing'
import { defaultSettings, defaultTheme, newSection } from './theme'
import type { Order, OrderItem, OrderStatus, PayMethod, Product, StoreEvent, TrafficSource, Variant } from './types'
import { addDays, uid } from './util'

/** Imagem de exemplo: fundo colorido com um emoji grande. */
export function placeholderImage(emoji: string, bg: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${bg}"/><circle cx="200" cy="215" r="120" fill="#ffffff" opacity=".35"/><text x="200" y="250" font-size="150" text-anchor="middle">${emoji}</text></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
export function bannerImage(bg: string, bg2: string, emojis: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 500"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="1200" height="500" fill="url(#g)"/><text x="980" y="330" font-size="220" text-anchor="middle" opacity=".9">${emojis}</text></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

export function seedDemo(s: DemoStore) {
  const rand = rng(42)
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const weighted = <T>(xs: [T, number][]) => {
    let r = rand() * xs.reduce((a, [, w]) => a + w, 0)
    for (const [x, w] of xs) if ((r -= w) <= 0) return x
    return xs[0][0]
  }

  for (const p of DEFAULT_PLANS) s.insert('plans', p)
  const owner = s.addUser('demo@exemplo.com', '123456')
  s.addUser('admin@exemplo.com', '123456')
  const now = new Date()

  // ---------- Loja ----------
  const settings = defaultSettings()
  settings.instagram = 'docesdaana'
  settings.legal = { name: 'Ana Souza Doces ME', document: '12.345.678/0001-90', address: 'Rua das Flores, 120 - Centro, Campinas - SP' }
  settings.hours.enabled = true
  settings.min_order_cents = 2000
  settings.free_shipping_above_cents = 15000
  settings.goal_cents = 600000
  settings.delivery.pickup = { enabled: true, address: 'Rua das Flores, 120 - Centro', instructions: 'Retirada de segunda a sábado, das 9h às 18h.' }
  settings.delivery.zones = {
    enabled: true,
    items: [
      { name: 'Centro', fee_cents: 600 },
      { name: 'Cambuí', fee_cents: 800 },
      { name: 'Taquaral', fee_cents: 1000 },
      { name: 'Barão Geraldo', fee_cents: 1500 },
    ],
  }
  settings.payments.pix = { enabled: true, key: 'pix@docesdaana.com.br', holder: 'Ana Souza', city: 'Campinas', discount_percent: 5 }
  settings.payments.cash.enabled = true
  settings.payments.card_on_delivery.enabled = true
  settings.lead_popup = { enabled: true, text: 'Ganhe 10% de desconto na primeira compra', coupon: 'BEMVINDO10', delay_s: 20 }

  const theme = defaultTheme()
  theme.preset = 'doce'
  theme.colors = { primary: '#b8466b', background: '#fff7f4', surface: '#ffffff', text: '#3a2229', muted: '#8a6d74', accent: '#f2b84b' }
  theme.font = 'quicksand'
  theme.radius = 'pill'
  theme.announcement = { enabled: true, messages: ['Frete grátis acima de R$ 150', '5% de desconto no Pix'], link: '' }
  theme.animations.announcement = 'rotate'
  const banner = newSection('banner')
  banner.props = {
    ...banner.props,
    image: bannerImage('#f7c6d4', '#fbe3c0', '🧁🍰'),
    title: 'Doces feitos à mão, todo dia',
    text: 'Encomende hoje e receba amanhã em Campinas',
    button: 'Ver os doces',
    align: 'left',
    overlay: 0,
  }
  const benefits = newSection('benefits')
  const testimonials = newSection('testimonials')
  const faq = newSection('faq')
  theme.sections = [
    banner,
    benefits,
    newSection('categories'),
    { ...newSection('products'), props: { title: 'Mais pedidos', source: 'best_sellers', category_id: '', ids: [], layout: 'carousel', limit: 8 } },
    { ...newSection('products'), props: { title: 'Todos os doces', source: 'all', category_id: '', ids: [], layout: 'grid', limit: 24 } },
    testimonials,
    faq,
  ]

  theme.menu = [
    { label: 'Início', type: 'home', target: '', children: [] },
    { label: 'Blog', type: 'blog', target: '', children: [] },
  ]

  const store = s.insert('stores', {
    owner_id: owner.id,
    slug: 'doces-da-ana',
    name: 'Doces da Ana',
    whatsapp: '(19) 99876-5432',
    description: 'Brigadeiros, bolos e presentes feitos à mão em Campinas',
    logo_url: placeholderImage('🧁', '#f7c6d4'),
    plan: 'pro',
    status: 'active',
    trial_ends_at: addDays(now, -60).toISOString(),
    paid_until: addDays(now, 18).toISOString(),
    settings,
    theme,
    theme_draft: null,
    theme_history: [],
    created_at: addDays(now, -95).toISOString(),
  })

  // ---------- Categorias e produtos ----------
  const cats = ['Brigadeiros', 'Bolos', 'Presentes', 'Salgados'].map((name, i) =>
    s.insert('categories', { store_id: store.id, name, position: i, image_url: '', seo: { title: '', description: '' } }),
  )
  const catImg = ['🍫', '🎂', '🎁', '🥐']
  cats.forEach((c, i) => s.update('categories', c.id, { image_url: placeholderImage(catImg[i], ['#f3d9c9', '#f7c6d4', '#e3d4f5', '#fbe3c0'][i]) }))

  type P = [string, number, number, string, string, number, Partial<Product>?]
  const data: P[] = [
    ['Brigadeiro tradicional', 350, 90, '🍫', '#f3d9c9', 0, { qty_discounts: [{ min_qty: 25, percent: 10 }], featured: true }],
    ['Brigadeiro de pistache', 550, 160, '💚', '#dcefd2', 0, { featured: true }],
    ['Beijinho', 350, 85, '🥥', '#fff1e0', 0],
    ['Caixa com 12 brigadeiros', 3900, 1100, '📦', '#f3d9c9', 0, { featured: true, promo_price_cents: 3490, promo_ends_at: addDays(now, 6).toISOString() }],
    ['Bolo de pote', 1400, 450, '🍮', '#fbe3c0', 1, { featured: true }],
    ['Bolo de chocolate', 7500, 2600, '🎂', '#f7c6d4', 1],
    ['Fatia de bolo red velvet', 1600, 520, '🍰', '#f9d0d6', 1],
    ['Cesta de café da manhã', 15900, 7000, '🧺', '#e3d4f5', 2, { featured: true }],
    ['Kit presente pequeno', 6900, 2800, '🎁', '#e3d4f5', 2],
    ['Coxinha (cento)', 9000, 3800, '🥐', '#fbe3c0', 3],
    ['Empada de frango', 800, 280, '🥧', '#fff1e0', 3],
    ['Ovo de colher', 5900, 2100, '🥚', '#f3d9c9', 0, { available: false }],
  ]
  const products: Product[] = data.map(([name, price, cost, emoji, bg, cat, extra], i) =>
    s.insert('products', {
      store_id: store.id,
      name,
      description:
        'Feito artesanalmente com ingredientes selecionados, no dia da entrega. Conserve em local fresco e consuma em até 3 dias.',
      price_cents: price,
      promo_price_cents: null,
      promo_ends_at: null,
      images: [placeholderImage(emoji, bg), placeholderImage('✨', bg)],
      category_ids: [cats[cat].id],
      available: true,
      featured: false,
      position: i,
      cost_cents: cost,
      sku: `DA-${String(i + 1).padStart(3, '0')}`,
      track_stock: i === 7 || i === 8 || i === 5,
      stock: i === 7 ? 3 : i === 8 ? 14 : 6,
      weight_g: 300,
      height_cm: 10,
      width_cm: 15,
      length_cm: 15,
      options: [],
      qty_discounts: [],
      video_url: '',
      seo: { title: '', description: '' },
      blocked: false,
      created_at: addDays(now, i === 1 ? -5 : -90).toISOString(),
      ...extra,
    }),
  )
  // Bolo de chocolate com tamanhos
  const bolo = products[5]
  s.update('products', bolo.id, { options: [{ name: 'Tamanho', values: ['P (10 fatias)', 'M (20 fatias)', 'G (30 fatias)'] }] })
  bolo.options = [{ name: 'Tamanho', values: ['P (10 fatias)', 'M (20 fatias)', 'G (30 fatias)'] }]
  const variants: Variant[] = [
    ['P (10 fatias)', 7500, 4],
    ['M (20 fatias)', 12900, 3],
    ['G (30 fatias)', 17900, 1],
  ].map(([size, price, stock]) =>
    s.insert('variants', {
      store_id: store.id,
      product_id: bolo.id,
      values: { Tamanho: size as string },
      price_cents: price as number,
      stock: stock as number,
      sku: '',
      image: '',
      available: true,
    }),
  )

  // ---------- Clientes, pedidos e eventos ----------
  const first = ['Mariana', 'Juliana', 'Carlos', 'Fernanda', 'Rafael', 'Patrícia', 'Lucas', 'Camila', 'Bruno', 'Aline', 'Diego', 'Larissa', 'Paulo', 'Renata', 'Thiago', 'Beatriz', 'Gustavo', 'Vanessa', 'Rodrigo', 'Tatiane']
  const last = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Almeida', 'Ribeiro', 'Martins']
  const customers = Array.from({ length: 46 }, (_, i) =>
    s.insert('customers', {
      store_id: store.id,
      name: `${pick(first)} ${pick(last)}`,
      phone: `1999${String(1000000 + i * 7919).slice(0, 7)}`,
      email: i % 3 === 0 ? `cliente${i}@email.com` : '',
      tags: i < 4 ? ['VIP'] : i % 11 === 0 ? ['Atacado'] : [],
      notes: '',
      created_at: addDays(now, -90 + i).toISOString(),
    }),
  )
  // Alguns clientes compram com frequência
  const loyalty = customers.map((_, i) => (i < 6 ? 6 : i < 16 ? 2.5 : 1))

  const sources: [TrafficSource['source'], number][] = [
    ['instagram', 45],
    ['whatsapp', 25],
    ['google', 12],
    ['direto', 13],
    ['facebook', 5],
  ]
  const events: StoreEvent[] = []
  const orders: Order[] = []
  let number = 1000
  const searches = ['brigadeiro', 'bolo', 'cesta', 'presente', 'torta de limão', 'pistache', 'sem açúcar', 'coxinha']

  for (let d = 89; d >= 0; d--) {
    const day = addDays(now, -d)
    const dow = day.getDay()
    const growth = 1 + (89 - d) / 120
    const visits = Math.round((dow === 0 ? 12 : dow === 5 || dow === 6 ? 38 : 26) * growth * (0.8 + rand() * 0.4))
    for (let v = 0; v < visits; v++) {
      const hour = weighted<number>([[9, 2], [10, 3], [11, 4], [12, 5], [13, 4], [14, 3], [15, 3], [16, 3], [17, 4], [18, 5], [19, 7], [20, 8], [21, 6], [22, 3]])
      const at = new Date(day)
      at.setHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), 0)
      if (at > now) continue
      const t = (min: number) => new Date(at.getTime() + min * 60000).toISOString()
      const session = uid()
      const src: TrafficSource = {
        source: weighted(sources),
        medium: '',
        campaign: rand() < 0.15 ? 'stories-semana' : '',
        device: rand() < 0.82 ? 'mobile' : 'desktop',
      }
      const ev = (type: StoreEvent['type'], min: number, product_id: string | null = null, data: StoreEvent['data'] = {}) =>
        events.push({ id: uid(), store_id: store.id, session_id: session, type, product_id, data: { ...src, ...data }, created_at: t(min) })
      ev('visit', 0, null, { path: '/' })
      if (rand() < 0.12) {
        const q = pick(searches)
        ev('search', 1, null, { q, results: q === 'torta de limão' || q === 'sem açúcar' ? 0 : 3 })
      }
      if (rand() > 0.62) continue
      const viewed = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => products[Math.floor(Math.pow(rand(), 1.6) * 11)])
      viewed.forEach((p, i) => ev('product_view', 2 + i, p.id))
      if (rand() > 0.34) continue
      const cart = viewed.slice(0, 1 + Math.floor(rand() * viewed.length))
      cart.forEach((p, i) => ev('add_to_cart', 4 + i, p.id))
      if (rand() > 0.62) continue
      ev('checkout_start', 8)
      const buys = rand() < 0.62
      const cust = customers[Math.floor(Math.pow(rand(), 1.4) * customers.length)]
      const lines: OrderItem[] = cart.map((p) => {
        const variant = p.id === bolo.id ? pick(variants) : null
        const qty = p.price_cents < 1000 ? weighted<number>([[10, 3], [20, 3], [30, 2], [50, 1]]) : weighted<number>([[1, 6], [2, 2], [3, 1]])
        const base = basePrice(p, variant, at)
        const unit = base - Math.floor((base * qtyDiscountPercent(p, qty)) / 100)
        return {
          product_id: p.id,
          variant_id: variant?.id ?? null,
          name: p.name,
          variant_label: variantLabel(variant),
          list_price_cents: variant?.price_cents ?? p.price_cents,
          unit_price_cents: unit,
          cost_cents: p.cost_cents,
          qty: Math.min(qty, availableStock(p, variant) === Infinity ? qty : 50),
          image: p.images[0],
        }
      })
      const subtotal = lines.reduce((a, l) => a + l.unit_price_cents * l.qty, 0)
      if (!buys || subtotal < settings.min_order_cents) {
        if (rand() < 0.7)
          s.rows('checkouts').push({
            id: uid(),
            store_id: store.id,
            session_id: session,
            customer: { name: cust.name, phone: cust.phone },
            items: lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, qty: l.qty, name: l.name, unit_price_cents: l.unit_price_cents })),
            total_cents: subtotal,
            order_id: null,
            contacted_at: d > 20 && rand() < 0.4 ? t(200) : null,
            created_at: t(9),
            updated_at: t(9),
          })
        continue
      }
      // Clientes fiéis compram mais vezes: repete o comprador às vezes
      const buyer = rand() < 0.35 ? customers[Math.floor(rand() * 6)] : cust
      void loyalty
      const ship = weighted<'pickup' | 'zone'>([['pickup', 4], ['zone', 6]])
      const zone = pick(settings.delivery.zones.items)
      const pay = weighted<PayMethod>([['pix', 6], ['cash', 2], ['card_on_delivery', 2]])
      const shipFee = ship === 'zone' && subtotal < settings.free_shipping_above_cents ? zone.fee_cents : 0
      const coupon = rand() < 0.08 ? 'BEMVINDO10' : ''
      const couponOff = coupon ? Math.floor(subtotal * 0.1) : 0
      const pixOff = pay === 'pix' ? Math.floor(((subtotal - couponOff) * 5) / 100) : 0
      const total = subtotal - couponOff - pixOff + shipFee
      const age = d
      const status: OrderStatus =
        rand() < 0.05 ? 'cancelled' : age > 2 ? 'delivered' : age === 2 ? weighted([['shipped', 1], ['ready', 1]]) : age === 1 ? 'preparing' : weighted([['pending', 1], ['paid', 2]])
      const paidAt = status === 'pending' || status === 'cancelled' ? null : t(20)
      const history: Order['history'] = [{ status: 'pending', at: t(10), note: 'Pedido feito na loja' }]
      const flow: OrderStatus[] = ['paid', 'preparing', ship === 'pickup' ? 'ready' : 'shipped', 'delivered']
      if (status === 'cancelled') history.push({ status: 'cancelled', at: t(300), note: 'Cliente desistiu' })
      else for (const [i, st] of flow.entries()) {
        if (flow.indexOf(status) < i) break
        history.push({ status: st, at: t(20 + i * (st === 'delivered' ? 1500 : 240 + rand() * 600)), note: '' })
      }
      ev('order_placed', 10, null, { value_cents: total })
      orders.push({
        id: uid(),
        store_id: store.id,
        number: ++number,
        status,
        token: uid().replace(/-/g, ''),
        customer_id: buyer.id,
        customer: { name: buyer.name, phone: buyer.phone, email: buyer.email },
        shipping: {
          method: ship,
          label: ship === 'pickup' ? 'Retirar na loja' : `Entrega em ${zone.name}`,
          fee_cents: shipFee,
          address:
            ship === 'zone'
              ? { cep: '13010-000', street: 'Rua Barão de Jaguara', number: String(100 + Math.floor(rand() * 900)), complement: '', district: zone.name, city: 'Campinas', state: 'SP' }
              : null,
        },
        payment: { method: pay, status: paidAt ? 'paid' : 'pending', provider_ref: '', change_for_cents: 0 },
        items: lines,
        subtotal_cents: subtotal,
        discount_cents: couponOff + pixOff,
        shipping_cents: shipFee,
        total_cents: total,
        platform_fee_cents: 0,
        coupon_code: coupon,
        notes: rand() < 0.2 ? 'Sem cartão de presente, por favor.' : '',
        internal_notes: '',
        tracking_code: '',
        source: src,
        history,
        manual: false,
        created_at: t(10),
        paid_at: paidAt,
      })
    }
  }
  s.rows('events').push(...events)
  s.save('events')
  s.save('checkouts')
  s.rows('orders').push(...orders)
  s.save('orders')

  s.insert('coupons', {
    store_id: store.id,
    code: 'BEMVINDO10',
    type: 'percent',
    value: 10,
    min_order_cents: 3000,
    max_uses: null,
    uses: orders.filter((o) => o.coupon_code).length,
    starts_at: null,
    ends_at: null,
    active: true,
  })
  s.insert('coupons', {
    store_id: store.id,
    code: 'FRETEGRATIS',
    type: 'free_shipping',
    value: 0,
    min_order_cents: 8000,
    max_uses: 50,
    uses: 0,
    starts_at: null,
    ends_at: addDays(now, 10).toISOString(),
    active: true,
  })

  // Avaliações de pedidos entregues
  for (const o of orders.filter((o) => o.status === 'delivered').slice(0, 14)) {
    const it = o.items[0]
    s.insert('reviews', {
      store_id: store.id,
      product_id: it.product_id,
      order_id: o.id,
      name: o.customer.name.split(' ')[0],
      rating: rand() < 0.8 ? 5 : 4,
      comment: pick(['Maravilhoso, todo mundo amou!', 'Chegou certinho e muito bem embalado.', 'Super recomendo.', 'Muito saboroso, vou pedir de novo.']),
      approved: rand() < 0.85,
      created_at: o.created_at,
    })
  }

  s.insert('contents', {
    store_id: store.id,
    kind: 'page',
    slug: 'nossa-historia',
    title: 'Nossa história',
    body: '## Como tudo começou\n\nA Ana começou fazendo brigadeiros para festas de amigos em **2019**. Hoje são mais de 30 sabores.\n\n- Ingredientes selecionados\n- Feito no dia da entrega\n- Embalagens para presente',
    cover_url: '',
    product_ids: [],
    show_in_menu: true,
    position: 0,
    status: 'published',
    publish_at: addDays(now, -80).toISOString(),
    seo: { title: '', description: '' },
  })
  for (const [i, title] of ['5 ideias de presente para o Dia das Mães', 'Como conservar brigadeiros por mais tempo'].entries())
    s.insert('contents', {
      store_id: store.id,
      kind: 'post',
      slug: title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''),
      title,
      body: 'Separamos algumas dicas para você.\n\n## Dica 1\n\nGuarde em pote bem fechado, longe do sol.\n\n## Dica 2\n\nNa geladeira, duram até 5 dias.',
      cover_url: placeholderImage(i ? '🍫' : '💐', i ? '#f3d9c9' : '#e3d4f5'),
      product_ids: [products[3].id, products[7].id],
      show_in_menu: false,
      position: i,
      status: 'published',
      publish_at: addDays(now, -30 + i * 14).toISOString(),
      seo: { title: '', description: '' },
    })

  for (let i = 0; i < 9; i++) s.insert('leads', { store_id: store.id, contact: `(19) 9${String(81234567 + i * 913).slice(0, 4)}-${String(1000 + i * 37)}`, created_at: addDays(now, -i * 4).toISOString() })
  s.insert('stock_alerts', { store_id: store.id, product_id: products[11].id, variant_id: null, contact: '(19) 98765-1111', notified: false })
  s.insert('stock_alerts', { store_id: store.id, product_id: products[11].id, variant_id: null, contact: '(19) 99654-2222', notified: false })
  for (let m = 3; m >= 1; m--)
    s.insert('invoices', { store_id: store.id, plan: 'pro', amount_cents: 9900, months: 1, method: 'Pix', note: '', paid_at: addDays(now, -m * 30 + 18).toISOString() })
  s.insert('announcements', {
    title: 'Novidade: relatórios de clientes',
    body: 'Agora você vê quem são seus melhores clientes e quem não compra há algum tempo, em Relatórios > Clientes.',
    created_at: addDays(now, -3).toISOString(),
  })

  // Outras lojas, para o painel do admin ter o que listar
  const others: [string, string, 'vitrine' | 'loja' | 'pro', 'trial' | 'active' | 'overdue' | 'suspended', number][] = [
    ['Ateliê da Bia', 'atelie-da-bia', 'loja', 'active', 40],
    ['Brechó Vintage', 'brecho-vintage', 'vitrine', 'overdue', 70],
    ['Casa do Café', 'casa-do-cafe', 'pro', 'trial', 5],
    ['Tech Cases', 'tech-cases', 'loja', 'suspended', 120],
  ]
  for (const [name, slug, plan, status, age] of others) {
    const u = s.addUser(`${slug}@exemplo.com`, '123456')
    const st = s.insert('stores', {
      owner_id: u.id,
      slug,
      name,
      whatsapp: '(11) 99999-0000',
      description: '',
      logo_url: '',
      plan,
      status,
      trial_ends_at: addDays(now, -age + TRIAL_DAYS).toISOString(),
      paid_until: status === 'active' ? addDays(now, 4).toISOString() : status === 'overdue' ? addDays(now, -3).toISOString() : null,
      settings: defaultSettings(),
      theme: defaultTheme(),
      theme_draft: null,
      theme_history: [],
      created_at: addDays(now, -age).toISOString(),
    })
    s.insert('products', {
      ...products[0],
      id: uid(),
      store_id: st.id,
      name: 'Produto de exemplo',
      category_ids: [],
      images: [placeholderImage('🛍️', '#e5e7eb')],
      track_stock: false,
    })
  }
}
