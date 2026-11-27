// Regras de acesso (RLS, permissões por coluna, storage e admin com aal2).
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/lib/theme'
import { TestDb, anon, errorOf, superuser, user, type Who } from './harness'

let db: TestDb
let A: Awaited<ReturnType<TestDb['merchant']>>
let B: Awaited<ReturnType<TestDb['merchant']>>
const ids: Record<string, string> = {}

const count = async (who: Who, sql: string, params: unknown[] = []) => (await db.q(who, sql, params)).length

beforeAll(async () => {
  db = await TestDb.create()
  A = await db.merchant('loja-a')
  B = await db.merchant('loja-b')
  for (const [k, m] of [['a', A], ['b', B]] as const) {
    const sid = m.storeId
    ids[k + 'product'] = (await db.insert<{ id: string }>('products', { store_id: sid, name: 'P', price_cents: 1000, cost_cents: 400 })).id
    ids[k + 'unavailable'] = (await db.insert<{ id: string }>('products', { store_id: sid, name: 'Esgotado', price_cents: 1000, available: false })).id
    ids[k + 'blocked'] = (await db.insert<{ id: string }>('products', { store_id: sid, name: 'Bloq', price_cents: 1000, blocked: true })).id
    ids[k + 'customer'] = (await db.insert<{ id: string }>('customers', { store_id: sid, name: 'C', phone: '19999999999' })).id
    ids[k + 'coupon'] = (await db.insert<{ id: string }>('coupons', { store_id: sid, code: 'DEZ', type: 'percent', value: 10 })).id
    await db.insert('categories', { store_id: sid, name: 'Cat' })
    await db.insert('contents', { store_id: sid, slug: 'pub', title: 'Pub', status: 'published', publish_at: '2020-01-01T00:00:00Z' })
    await db.insert('contents', { store_id: sid, slug: 'rascunho', title: 'R', status: 'draft' })
    await db.insert('contents', { store_id: sid, slug: 'agendado', title: 'A', status: 'published', publish_at: '2999-01-01T00:00:00Z' })
    await db.insert('leads', { store_id: sid, contact: 'x@y.com' })
    await db.insert('media', { store_id: sid, url: 'u' })
    await db.insert('invoices', { store_id: sid, plan: 'pro', amount_cents: 9900 })
    await db.insert('checkouts', { store_id: sid, session_id: 's' })
    const order = await db.rpc<{ id: string; token: string }>(anon, 'place_order', {
      store_id: sid, lines: [{ product_id: ids[k + 'product'], variant_id: null, qty: 1 }],
      customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
      payment: { method: 'whatsapp' }, coupon: '', notes: '', source: null, checkout_id: null,
    })
    ids[k + 'order'] = order.id
    await db.insert('reviews', { store_id: sid, product_id: ids[k + 'product'], order_id: order.id, name: 'Ana', rating: 5, approved: true })
    await db.insert('events', { store_id: sid, type: 'visit' })
  }
})

describe('isolamento entre lojistas', () => {
  const privateTables = ['customers', 'coupons', 'orders', 'checkouts', 'leads', 'media', 'invoices', 'events', 'stock_alerts']

  it('cada lojista só lê os próprios dados privados', async () => {
    for (const t of privateTables) {
      const rows = await db.q<{ store_id: string }>(A.who, `select store_id from public.${t}`)
      expect(rows.every((r) => r.store_id === A.storeId), t).toBe(true)
    }
    expect(await count(A.who, `select 1 from customers where store_id = $1`, [B.storeId])).toBe(0)
    expect(await count(A.who, `select 1 from orders where id = $1`, [ids.border])).toBe(0)
    expect(await count(A.who, `select 1 from orders where id = $1`, [ids.aorder])).toBe(1)
    // rascunhos e avaliações da outra loja não aparecem
    expect(await count(A.who, `select 1 from contents where store_id = $1`, [B.storeId])).toBe(1)
  })

  it('não escreve nos dados de outra loja', async () => {
    expect(await errorOf(db.q(A.who, `insert into categories (store_id, name) values ($1, 'x')`, [B.storeId]))).toMatch(/row-level security/)
    expect(await errorOf(db.q(A.who, `insert into products (store_id, name) values ($1, 'x')`, [B.storeId]))).toMatch(/row-level security/)
    expect(await count(A.who, `update products set price_cents = 1 where id = $1 returning 1`, [ids.bproduct])).toBe(0)
    expect(await count(A.who, `delete from coupons where id = $1 returning 1`, [ids.bcoupon])).toBe(0)
    expect(await count(A.who, `delete from customers where id = $1 returning 1`, [ids.bcustomer])).toBe(0)
    expect(await count(A.who, `update stores set name = 'hack' where id = $1 returning 1`, [B.storeId])).toBe(0)
    expect(await count(A.who, `update orders set internal_notes = 'x' where id = $1 returning 1`, [ids.border])).toBe(0)
    // mover um produto próprio para a outra loja
    expect(await errorOf(db.q(A.who, `update products set store_id = $2 where id = $1`, [ids.aproduct, B.storeId]))).toMatch(/row-level security/)
    const [p] = await db.rows<{ price_cents: number }>(superuser, `select * from products where id = $1`, [ids.bproduct])
    expect(p.price_cents).toBe(1000)
  })

  it('o lojista tem CRUD completo nos próprios dados', async () => {
    const [c] = await db.q<{ id: string }>(A.who, `insert into categories (store_id, name) values ($1, 'Nova') returning id`, [A.storeId])
    expect(await count(A.who, `update categories set name = 'X' where id = $1 returning 1`, [c.id])).toBe(1)
    expect(await count(A.who, `delete from categories where id = $1 returning 1`, [c.id])).toBe(1)
    expect(await count(A.who, `update coupons set value = 15 where id = $1 returning 1`, [ids.acoupon])).toBe(1)
    expect(await count(A.who, `update checkouts set contacted_at = now() where store_id = $1 returning 1`, [A.storeId])).toBe(1)
    expect(await count(A.who, `update reviews set approved = false where store_id = $1 returning 1`, [A.storeId])).toBe(1)
    await db.q(superuser, `update reviews set approved = true where store_id = $1`, [A.storeId])
  })
})

describe('visitante (anon)', () => {
  it('não lê pedidos, clientes, cupons, carrinhos, contatos nem eventos', async () => {
    for (const t of ['orders', 'customers', 'coupons', 'checkouts', 'leads', 'events', 'stock_alerts', 'media', 'invoices', 'store_secrets', 'platform_admins', 'audit_log', 'announcements'])
      expect(await errorOf(db.q(anon, `select * from public.${t}`)), t).toMatch(/permission denied/)
  })

  it('lê a vitrine: produtos (inclusive esgotados), sem os bloqueados; conteúdo publicado; avaliações aprovadas', async () => {
    const prods = await db.q<{ id: string }>(anon, `select id from products where store_id = $1`, [A.storeId])
    expect(prods.map((p) => p.id).sort()).toEqual([ids.aproduct, ids.aunavailable].sort())
    const contents = await db.q<{ slug: string }>(anon, `select slug from contents where store_id = $1`, [A.storeId])
    expect(contents.map((c) => c.slug)).toEqual(['pub'])
    expect(await count(anon, `select 1 from reviews where store_id = $1`, [A.storeId])).toBe(1)
    await db.q(superuser, `update reviews set approved = false where store_id = $1`, [A.storeId])
    expect(await count(anon, `select 1 from reviews where store_id = $1`, [A.storeId])).toBe(0)
    await db.q(superuser, `update reviews set approved = true where store_id = $1`, [A.storeId])
    expect(await count(anon, `select 1 from categories where store_id = $1`, [A.storeId])).toBe(1)
    expect(await count(anon, `select 1 from plans`)).toBe(3)
  })

  it('não vê lojas suspensas nem o que há nelas', async () => {
    const m = await db.merchant('suspensa')
    await db.insert('products', { store_id: m.storeId, name: 'P' })
    await db.q(superuser, `update stores set status = 'suspended' where id = $1`, [m.storeId])
    expect(await count(anon, `select 1 from stores where id = $1`, [m.storeId])).toBe(0)
    expect(await count(anon, `select 1 from products where store_id = $1`, [m.storeId])).toBe(0)
    // o dono continua vendo a própria loja
    expect(await count(m.who, `select 1 from stores where id = $1`, [m.storeId])).toBe(1)
    expect(await errorOf(db.q(anon, `insert into events (store_id, type) values ($1, 'visit')`, [m.storeId]))).toMatch(/row-level security/)
    expect(await errorOf(db.q(anon, `insert into leads (store_id, contact) values ($1, 'a')`, [m.storeId]))).toMatch(/row-level security/)
  })

  it('registra eventos, contatos e avisos de estoque em lojas no ar', async () => {
    await db.q(anon, `insert into events (store_id, session_id, type, data) values ($1, 's', 'product_view', '{}')`, [A.storeId])
    await db.q(anon, `insert into leads (store_id, contact) values ($1, '19999990000')`, [A.storeId])
    await db.q(anon, `insert into stock_alerts (store_id, product_id, contact) values ($1, $2, 'x@y.com')`, [A.storeId, ids.aunavailable])
    expect(await errorOf(db.q(anon, `insert into events (store_id, type) values ($1, 'hack')`, [A.storeId]))).toMatch(/check constraint/)
    // mas não lê o que gravou (o cliente precisa inserir sem pedir a linha de volta)
    expect(await errorOf(db.q(anon, `insert into leads (store_id, contact) values ($1, 'x') returning *`, [A.storeId]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(anon, `insert into orders (store_id, number, token) values ($1, 1, 'x')`, [A.storeId]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(anon, `update products set price_cents = 1 where id = $1`, [ids.aproduct]))).toMatch(/permission denied/)
  })

  it('não chama funções que exigem login nem as internas', async () => {
    for (const fn of ['create_store', 'set_order_status', 'delete_my_store', 'admin_list_stores', 'admin_update_store'])
      expect(await errorOf(db.rpc(anon, fn, {})), fn).toMatch(/permission denied/)
    expect(await errorOf(db.q(anon, `select public.expire_pending_orders()`))).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `select public.expire_pending_orders()`))).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `select private.random_token()`))).toMatch(/permission denied/)
  })
})

describe('colunas protegidas', () => {
  it('lojista não muda plano, situação, datas nem dono da loja', async () => {
    for (const set of [`plan = 'pro'`, `status = 'active'`, `trial_ends_at = now()`, `paid_until = now() + interval '1 year'`, `owner_id = '${B.ownerId}'`, `created_at = now()`])
      expect(await errorOf(db.q(A.who, `update stores set ${set} where id = $1`, [A.storeId])), set).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `insert into stores (owner_id, slug) values ($1, 'nova-loja')`, [A.ownerId]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `delete from stores where id = $1`, [A.storeId]))).toBe('(não falhou)')
    expect(await count(superuser, `select 1 from stores where id = $1`, [A.storeId])).toBe(1)
    const s = defaultSettings()
    expect(await count(A.who, `update stores set name = 'Nova', slug = 'loja-a2', settings = $2 where id = $1 returning 1`, [A.storeId, JSON.stringify(s)])).toBe(1)
    expect(await errorOf(db.q(A.who, `update stores set slug = 'admin' where id = $1`, [A.storeId]))).toMatch(/stores_slug_valid/)
    expect(await errorOf(db.q(A.who, `update stores set slug = 'loja-b' where id = $1`, [A.storeId]))).toMatch(/duplicate key/)
  })

  it('situação do pedido só muda por set_order_status; anotações e rastreio podem', async () => {
    expect(await errorOf(db.q(A.who, `update orders set status = 'paid' where id = $1`, [ids.aorder]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `update orders set total_cents = 1 where id = $1`, [ids.aorder]))).toMatch(/permission denied/)
    expect(await count(A.who, `update orders set internal_notes = 'ligar', tracking_code = 'BR1' where id = $1 returning 1`, [ids.aorder])).toBe(1)
    expect(await errorOf(db.q(A.who, `delete from orders where id = $1 returning 1`, [ids.aorder]))).toBe('(não falhou)')
    expect(await count(superuser, `select 1 from orders where id = $1`, [ids.aorder])).toBe(1)
  })

  it('lojista não desbloqueia produto nem mexe em "vendidos"', async () => {
    await db.q(A.who, `update products set blocked = false, sold_count = 999, name = 'Renomeado' where id = $1`, [ids.ablocked])
    const [p] = await db.rows<{ blocked: boolean; sold_count: number; name: string }>(superuser, `select * from products where id = $1`, [ids.ablocked])
    expect(p).toMatchObject({ blocked: true, sold_count: 0, name: 'Renomeado' })
    const [n] = await db.q<{ blocked: boolean; sold_count: number }>(A.who, `insert into products (store_id, name, blocked, sold_count) values ($1, 'N', true, 50) returning blocked, sold_count`, [A.storeId])
    expect(n).toMatchObject({ blocked: false, sold_count: 0 })
  })

  it('checkouts e avaliações: só as colunas liberadas', async () => {
    expect(await errorOf(db.q(A.who, `update checkouts set total_cents = 1 where store_id = $1`, [A.storeId]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `update reviews set rating = 1 where store_id = $1`, [A.storeId]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `insert into reviews (store_id, product_id, order_id, rating) values ($1, $2, $3, 5)`, [A.storeId, ids.aproduct, ids.aorder]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(A.who, `select * from store_secrets`))).toMatch(/permission denied/)
  })
})

describe('admin da plataforma', () => {
  let adminId: string
  beforeAll(async () => {
    adminId = await db.createUser('admin@vitrine.com')
    await db.makeAdmin(adminId)
  })

  it('sem verificação em duas etapas (aal1) é recusado', async () => {
    const who = user(adminId, 'aal1')
    expect(await db.rpc(who, 'is_admin')).toBe(false)
    for (const fn of ['admin_list_stores', 'admin_update_store', 'admin_register_payment', 'admin_set_product_blocked', 'admin_log', 'admin_audit_list', 'admin_update_plan', 'admin_announce'])
      expect(await errorOf(db.rpc(who, fn, { store_id: A.storeId })), fn).toBe('Acesso restrito ao admin.')
    expect(await count(who, `select 1 from orders`)).toBe(0)
  })

  it('quem não está em platform_admins é recusado mesmo com aal2', async () => {
    expect(await db.rpc(user(A.ownerId, 'aal2'), 'is_admin')).toBe(false)
    expect(await errorOf(db.rpc(user(A.ownerId, 'aal2'), 'admin_list_stores'))).toBe('Acesso restrito ao admin.')
  })

  it('com aal2 lista lojas, altera, registra pagamento, bloqueia produto e tudo vai para o registro', async () => {
    const who = user(adminId, 'aal2')
    expect(await db.rpc(who, 'is_admin')).toBe(true)
    // lê tudo
    expect(await count(who, `select 1 from orders`)).toBeGreaterThanOrEqual(2)
    expect(await count(who, `select 1 from customers`)).toBeGreaterThanOrEqual(2)

    const list = await db.rpc<{ store: { id: string }; email: string; last_sign_in_at: string | null; product_count: number; orders_30d: number; notes: string }[]>(who, 'admin_list_stores')
    const rowA = list.find((r) => r.store.id === A.storeId)!
    expect(rowA).toMatchObject({ email: 'loja-a@exemplo.com', product_count: expect.any(Number), orders_30d: 1, notes: '' })
    expect(rowA.product_count).toBeGreaterThanOrEqual(3)
    expect(rowA.last_sign_in_at).toBeTruthy()

    await db.rpc(who, 'admin_update_store', { store_id: A.storeId, plan: 'loja', status: 'overdue', paid_until: null, notes: 'ligar dia 5' })
    const [st] = await db.rows<{ plan: string; status: string }>(superuser, `select * from stores where id = $1`, [A.storeId])
    expect(st).toMatchObject({ plan: 'loja', status: 'overdue' })
    const list2 = await db.rpc<{ store: { id: string }; notes: string }[]>(who, 'admin_list_stores')
    expect(list2.find((r) => r.store.id === A.storeId)!.notes).toBe('ligar dia 5')

    // pagamento: soma meses a partir de hoje (vencido) ou do vencimento futuro
    const inv = await db.rpc<{ months: number; plan: string; amount_cents: number }>(who, 'admin_register_payment', { store_id: A.storeId, amount_cents: 4900, months: 2, method: 'Pix', note: '' })
    expect(inv).toMatchObject({ months: 2, plan: 'loja', amount_cents: 4900 })
    const [{ months, status }] = await db.q<{ months: number; status: string }>(superuser,
      `select round(extract(epoch from paid_until - now()) / 86400)::int as months, status from stores where id = $1`, [A.storeId])
    expect(status).toBe('active')
    expect(months).toBeGreaterThanOrEqual(59)
    expect(months).toBeLessThanOrEqual(62)
    await db.q(superuser, `update stores set paid_until = '2999-01-15T12:00:00Z' where id = $1`, [A.storeId])
    await db.rpc(who, 'admin_register_payment', { store_id: A.storeId, amount_cents: 4900, months: 1, method: 'Pix', note: '' })
    const [{ paid_until }] = await db.rows<{ paid_until: string }>(superuser, `select paid_until from stores where id = $1`, [A.storeId])
    expect(new Date(paid_until).toISOString()).toBe('2999-02-15T12:00:00.000Z')

    await db.rpc(who, 'admin_set_product_blocked', { product_id: ids.aproduct, blocked: true })
    expect(await count(anon, `select 1 from products where id = $1`, [ids.aproduct])).toBe(0)
    await db.rpc(who, 'admin_set_product_blocked', { product_id: ids.aproduct, blocked: false })
    expect(await count(anon, `select 1 from products where id = $1`, [ids.aproduct])).toBe(1)

    await db.rpc(who, 'admin_update_plan', { id: 'loja', price_cents: 5900, fee_percent: 1.5 })
    const [plan] = await db.rows<{ price_cents: number; fee_percent: number }>(anon, `select * from plans where id = 'loja'`)
    expect(plan).toMatchObject({ price_cents: 5900, fee_percent: 1.5 })
    await db.rpc(who, 'admin_announce', { title: 'Novidade', body: 'Texto' })
    expect(await count(A.who, `select 1 from announcements`)).toBe(1)
    expect(await errorOf(db.q(A.who, `insert into announcements (title) values ('x')`))).toMatch(/row-level security/)
    await db.rpc(who, 'admin_log', { store_id: A.storeId, action: 'Abriu a ficha' })

    const audit = await db.rpc<{ admin_email: string; store_id: string | null; action: string }[]>(who, 'admin_audit_list', { store_id: A.storeId })
    expect(audit.map((e) => e.action)).toEqual([
      'Abriu a ficha',
      'Desbloqueou o produto "P"',
      'Bloqueou o produto "P"',
      'Pagamento registrado: 1 mês(es)',
      'Pagamento registrado: 2 mês(es)',
      'Alterou plano para loja, situação para overdue, vencimento, anotações',
    ])
    expect(audit.every((e) => e.admin_email === 'admin@vitrine.com')).toBe(true)
    const all = await db.rpc<{ action: string }[]>(who, 'admin_audit_list', { store_id: null })
    expect(all.map((e) => e.action)).toContain('Publicou o aviso "Novidade"')
    expect(all.map((e) => e.action)).toContain('Alterou o plano Loja: R$ 59,00, taxa de 1.5%')
    // o lojista não lê o registro
    expect(await count(A.who, `select 1 from audit_log`)).toBe(0)
  })
})

describe('armazenamento de imagens', () => {
  const put = (who: Who, name: string) => db.q(who, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [name])

  it('lojista só envia e apaga na pasta da própria loja', async () => {
    await put(A.who, `${A.storeId}/foto.jpg`)
    expect(await errorOf(put(A.who, `${B.storeId}/foto.jpg`))).toMatch(/row-level security/)
    expect(await errorOf(put(A.who, `foto.jpg`))).toMatch(/row-level security/)
    expect(await errorOf(put(A.who, `${A.storeId}/../${B.storeId}/x.jpg`))).toBe('(não falhou)') // primeira pasta é a da loja A
    expect(await errorOf(put(anon, `${A.storeId}/anon.jpg`))).toMatch(/row-level security/)
    expect(await errorOf(db.q(A.who, `insert into storage.objects (bucket_id, name) values ('outro', $1)`, [`${A.storeId}/x.jpg`]))).toMatch(/row-level security|foreign key/)
    await put(B.who, `${B.storeId}/b.jpg`)
    expect(await count(A.who, `delete from storage.objects where name = $1 returning 1`, [`${B.storeId}/b.jpg`])).toBe(0)
    expect(await count(A.who, `delete from storage.objects where name = $1 returning 1`, [`${A.storeId}/foto.jpg`])).toBe(1)
    const [bucket] = await db.q<{ public: boolean }>(superuser, `select public from storage.buckets where id = 'media'`)
    expect(bucket.public).toBe(true)
  })
})

describe('custo do produto (migração 0004)', () => {
  it('outro lojista logado não lê o custo, nem com select *', async () => {
    expect(await errorOf(db.q(B.who, `select cost_cents from products where id = $1`, [ids.aproduct]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(B.who, `select * from products where id = $1`, [ids.aproduct]))).toMatch(/permission denied/)
    expect(await errorOf(db.q(anon, `select cost_cents from products`))).toMatch(/permission denied/)
    // mas lê a vitrine com as colunas públicas
    expect(await count(B.who, `select id, name, price_cents from products where id = $1`, [ids.aproduct])).toBe(1)
  })

  it('product_costs devolve o custo só dos produtos do próprio lojista', async () => {
    const both = { ids: [ids.aproduct, ids.bproduct] }
    expect(await db.rpc(A.who, 'product_costs', both)).toEqual({ [ids.aproduct]: 400 })
    expect(await db.rpc(B.who, 'product_costs', both)).toEqual({ [ids.bproduct]: 400 })
    expect(await errorOf(db.rpc(anon, 'product_costs', both))).toMatch(/permission denied/)
  })

  it('o lojista grava o custo e lê o produto de volta sem a coluna', async () => {
    const [r] = await db.q<{ id: string }>(A.who, `update products set cost_cents = 450, name = 'P2' where id = $1 returning id, name`, [ids.aproduct])
    expect(r.id).toBe(ids.aproduct)
    expect(await db.rpc(A.who, 'product_costs', { ids: [ids.aproduct] })).toEqual({ [ids.aproduct]: 450 })
    const [n] = await db.q<{ id: string }>(A.who, `insert into products (store_id, name, cost_cents) values ($1, 'Novo', 10) returning id`, [A.storeId])
    expect(await db.rpc(A.who, 'product_costs', { ids: [n.id] })).toEqual({ [n.id]: 10 })
  })

  it('o admin (aal2) lê o custo pela função', async () => {
    const adminId = await db.createUser('custo-admin@x.com')
    await db.makeAdmin(adminId)
    expect(await db.rpc(user(adminId, 'aal2'), 'product_costs', { ids: [ids.bproduct] })).toEqual({ [ids.bproduct]: 400 })
    expect(await db.rpc(user(adminId, 'aal1'), 'product_costs', { ids: [ids.bproduct] })).toEqual({})
  })
})

describe('imagens (migração 0004)', () => {
  it('a pasta media aceita só imagens comuns de até 5 MB (sem SVG)', async () => {
    const [b] = await db.q<{ file_size_limit: number; allowed_mime_types: string[] }>(superuser, `select file_size_limit, allowed_mime_types from storage.buckets where id = 'media'`)
    expect(Number(b.file_size_limit)).toBe(5 * 1024 * 1024)
    expect(b.allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  })

  it('payment_connections tem search_path fixo com pg_temp', async () => {
    const [f] = await db.q<{ cfg: string[] }>(superuser, `select proconfig cfg from pg_proc where proname = 'payment_connections'`)
    expect(f.cfg).toEqual(['search_path=public, pg_temp'])
  })
})

describe('tempo real', () => {
  it('a tabela de pedidos está na publicação supabase_realtime', async () => {
    expect(await count(superuser, `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders'`)).toBe(1)
  })
})
