// Teste de ponta a ponta contra um Supabase de verdade (local ou de produção).
//
//   Local (Docker):  npx supabase start   e depois   npm run test:supabase
//   Outro projeto:   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:supabase
//
// Cria contas e lojas de teste com nomes aleatórios ("e2e-...") e não apaga nada de quem já existe.
// Em produção, apague depois as contas e-mail e2e-*@exemplo.com pelo painel do Supabase.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

function localEnv() {
  try {
    const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return Object.fromEntries(out.split(/\r?\n/).map((l) => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]))
  } catch {
    return {}
  }
}
const local = process.env.SUPABASE_URL ? {} : localEnv()
const URL = process.env.SUPABASE_URL ?? local.API_URL
const ANON = process.env.SUPABASE_ANON_KEY ?? local.ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? local.SERVICE_ROLE_KEY
if (!URL || !ANON) {
  console.error('Defina SUPABASE_URL e SUPABASE_ANON_KEY, ou rode "npx supabase start" antes.')
  process.exit(2)
}

const run = Math.random().toString(36).slice(2, 8)
const client = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const service = SERVICE ? createClient(URL, SERVICE, { auth: { persistSession: false } }) : null
let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('  ok  ', name)
  } catch (e) {
    failures++
    console.log('  FALHOU', name, '→', e.message)
  }
}
const must = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const ok = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}
const fails = async (p, re) => {
  const { error } = await p
  must(error, 'era para falhar e não falhou')
  if (re) must(re.test(error.message), `erro inesperado: ${error.message}`)
}

async function merchant(tag) {
  const sb = client()
  const email = `e2e-${run}-${tag}@exemplo.com`
  const { data, error } = await sb.auth.signUp({ email, password: 'senha-e2e-123' })
  if (error) throw new Error(`cadastro: ${error.message}`)
  must(data.session, 'o cadastro não abriu sessão: desligue "Confirm email" no projeto de teste ou confirme o e-mail')
  const store = ok(await sb.rpc('create_store', { a: { slug: `e2e-${run}-${tag}`, name: `Loja ${tag}`, whatsapp: '19999990000', settings: { delivery: { pickup: { enabled: true, address: '', instructions: '' } }, payments: { whatsapp: { enabled: true }, pix: { enabled: true, key: 'chave@exemplo.com', holder: 'Loja', city: 'Campinas', discount_percent: 0 } }, hours: { enabled: false } }, theme: {} } }))
  return { sb, store, userId: data.user.id }
}

console.log(`Supabase: ${URL} (rodada ${run})`)
const A = await merchant('a')
const B = await merchant('b')
const anon = client()
let product, order

await check('lojista cria produto com custo e lê o produto de volta (sem a coluna de custo)', async () => {
  product = ok(await A.sb.from('products').insert({ store_id: A.store.id, name: 'Bolo', price_cents: 3000, cost_cents: 1200, track_stock: true, stock: 5 }).select('id,name,stock').single())
  must(product.id && product.stock === 5, 'produto não voltou')
})
await check('select * em produtos é recusado (custo protegido)', () => fails(A.sb.from('products').select('*').eq('id', product.id), /permission denied/))
await check('dono lê o custo pela função product_costs', async () => {
  const c = ok(await A.sb.rpc('product_costs', { a: { ids: [product.id] } }))
  must(c[product.id] === 1200, `custo: ${JSON.stringify(c)}`)
})
await check('outro lojista não lê o custo', async () => {
  await fails(B.sb.from('products').select('cost_cents').eq('id', product.id), /permission denied/)
  const c = ok(await B.sb.rpc('product_costs', { a: { ids: [product.id] } }))
  must(Object.keys(c).length === 0, 'devolveu custo de outra loja')
})
await check('visitante vê a vitrine (colunas públicas) mas não o custo', async () => {
  const rows = ok(await anon.from('products').select('id,name,price_cents').eq('store_id', A.store.id))
  must(rows.length === 1, `linhas: ${rows.length}`)
  await fails(anon.from('products').select('cost_cents').eq('id', product.id))
})
await check('visitante faz pedido pelo WhatsApp; servidor recalcula o preço e baixa o estoque', async () => {
  order = ok(await anon.rpc('place_order', { a: {
    store_id: A.store.id, lines: [{ product_id: product.id, variant_id: null, qty: 2 }],
    customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
    payment: { method: 'whatsapp' }, coupon: '', notes: '', source: null, checkout_id: null,
  } }))
  must(order.total_cents === 6000, `total ${order.total_cents}`)
  const p = ok(await A.sb.from('products').select('stock').eq('id', product.id).single())
  must(p.stock === 3, `estoque ${p.stock}`)
})
await check('pedido: dono vê, outro lojista e visitante não', async () => {
  must(ok(await A.sb.from('orders').select('id').eq('id', order.id)).length === 1, 'dono não vê')
  must(ok(await B.sb.from('orders').select('id').eq('id', order.id)).length === 0, 'outro lojista vê')
  await fails(anon.from('orders').select('id').eq('id', order.id), /permission denied/)
})
await check('cliente acompanha o pedido com o código secreto', async () => {
  const o = ok(await anon.rpc('get_public_order', { a: { id: order.id, token: order.token } }))
  must(o.items[0].cost_cents === null, 'custo apareceu para o cliente')
})
await check('lojista logado consegue deixar contato e aviso de estoque em outra loja', async () => {
  ok(await B.sb.from('leads').insert({ store_id: A.store.id, contact: '(19) 98888-7777' }))
  ok(await B.sb.from('stock_alerts').insert({ store_id: A.store.id, product_id: product.id, contact: '(19) 98888-7777', notified: false }))
  ok(await B.sb.from('events').insert({ store_id: A.store.id, type: 'visit' }))
})
await check('lojista não muda o próprio plano', () => fails(A.sb.from('stores').update({ plan: 'pro' }).eq('id', A.store.id), /permission denied/))

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
await check('envio de imagem JPEG na pasta da própria loja', async () => {
  ok(await A.sb.storage.from('media').upload(`${A.store.id}/${run}.jpg`, jpeg, { contentType: 'image/jpeg' }))
})
await check('envio na pasta de outra loja é recusado', () => fails(A.sb.storage.from('media').upload(`${B.store.id}/${run}.jpg`, jpeg, { contentType: 'image/jpeg' })))
await check('SVG é recusado pela pasta de imagens', () => fails(A.sb.storage.from('media').upload(`${A.store.id}/${run}.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { contentType: 'image/svg+xml' })))

if (service) {
  await check('tarefas agendadas rodam com a chave de serviço', async () => {
    ok(await service.rpc('expire_pending_orders'))
    ok(await service.rpc('downgrade_lapsed_stores'))
  })
  await check('loja vencida há 8 dias vira plano Vitrine e guarda o plano anterior', async () => {
    ok(await service.from('stores').update({ paid_until: new Date(Date.now() - 8 * 86400000).toISOString(), status: 'active' }).eq('id', B.store.id))
    ok(await service.rpc('downgrade_lapsed_stores'))
    const s = ok(await service.from('stores').select('plan,plan_before_downgrade,status').eq('id', B.store.id).single())
    must(s.plan === 'vitrine' && s.plan_before_downgrade === 'pro' && s.status === 'overdue', JSON.stringify(s))
  })
  await check('loja rebaixada não aceita pedido com Pix', async () => {
    const p = ok(await B.sb.from('products').insert({ store_id: B.store.id, name: 'X', price_cents: 1000 }).select('id').single())
    await fails(anon.rpc('place_order', { a: {
      store_id: B.store.id, lines: [{ product_id: p.id, variant_id: null, qty: 1 }],
      customer: { name: 'Ana', phone: '19988887777', email: '' }, shipping: { method: 'pickup', address: null },
      payment: { method: 'pix' }, coupon: '', notes: '', source: null, checkout_id: null,
    } }))
  })
} else console.log('  (sem SUPABASE_SERVICE_ROLE_KEY: pulei as tarefas agendadas)')

console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTudo certo.')
process.exit(failures ? 1 : 0)
