import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../lib/api'
import { downloadFile, parseCsv, toCsv } from '../lib/csv'
import { can } from '../lib/plans'
import type { Category, Product } from '../lib/types'
import { brl, moneyInput, parseMoney, uid } from '../lib/util'
import { Badge, Empty, ErrorBox, Loading, Modal, PageHead, toast, Upsell, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

export function blankProduct(storeId: string, position: number): Omit<Product, 'id' | 'created_at'> {
  return {
    store_id: storeId,
    name: '',
    description: '',
    price_cents: 0,
    promo_price_cents: null,
    promo_ends_at: null,
    images: [],
    category_ids: [],
    available: true,
    featured: false,
    position,
    cost_cents: null,
    sku: '',
    track_stock: false,
    stock: 0,
    weight_g: 0,
    height_cm: 0,
    width_cm: 0,
    length_cm: 0,
    options: [],
    qty_discounts: [],
    video_url: '',
    seo: { title: '', description: '' },
    blocked: false,
    sold_count: 0,
  }
}

function Importer({ storeId, categories, count, onDone }: { storeId: string; categories: Category[]; count: number; onDone: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const head = rows?.[0]?.map((h) => h.trim().toLowerCase()) ?? []
  const col = (r: string[], name: string) => r[head.indexOf(name)]?.trim() ?? ''
  async function run() {
    if (!rows) return
    setBusy(true)
    const existing = await db.list('products', { eq: { store_id: storeId } })
    let created = 0
    let updated = 0
    for (const [i, r] of rows.slice(1).entries()) {
      const name = col(r, 'nome')
      if (!name) continue
      const price = parseMoney(col(r, 'preço') || col(r, 'preco'))
      const catNames = col(r, 'categoria').split('|').map((c) => c.trim()).filter(Boolean)
      const category_ids = categories.filter((c) => catNames.some((n) => n.toLowerCase() === c.name.toLowerCase())).map((c) => c.id)
      const sku = col(r, 'código') || col(r, 'codigo')
      const patch: Partial<Product> = {
        name,
        ...(Number.isFinite(price) ? { price_cents: price } : {}),
        ...(col(r, 'descrição') || col(r, 'descricao') ? { description: col(r, 'descrição') || col(r, 'descricao') } : {}),
        ...(category_ids.length ? { category_ids } : {}),
        ...(col(r, 'estoque') !== '' ? { track_stock: true, stock: parseInt(col(r, 'estoque')) || 0 } : {}),
        ...(col(r, 'custo') ? { cost_cents: parseMoney(col(r, 'custo')) } : {}),
        ...(col(r, 'disponível') || col(r, 'disponivel') ? { available: /^s/i.test(col(r, 'disponível') || col(r, 'disponivel')) } : {}),
        ...(col(r, 'imagem') ? { images: [col(r, 'imagem')] } : {}),
        ...(sku ? { sku } : {}),
      }
      const match = existing.find((p) => (sku && p.sku === sku) || p.name.toLowerCase() === name.toLowerCase())
      if (match) {
        await db.update('products', match.id, patch)
        updated++
      } else if (Number.isFinite(price)) {
        await db.insert('products', { ...blankProduct(storeId, count + i), ...patch })
        created++
      }
    }
    toast(`${created} criados, ${updated} atualizados`)
    setBusy(false)
    setRows(null)
    onDone()
  }
  return (
    <>
      <button className="btn ghost small" onClick={() => input.current?.click()}>
        Importar planilha
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) setRows(parseCsv(await f.text()))
          e.target.value = ''
        }}
      />
      {rows && (
        <Modal title="Importar produtos" onClose={() => setRows(null)}>
          <p>
            Encontramos <b>{rows.length - 1}</b> linhas. Produtos com o mesmo código ou nome são atualizados; os outros são criados.
          </p>
          {!head.includes('nome') && <ErrorBox message="A planilha precisa de uma coluna chamada Nome. Baixe o modelo pelo botão Exportar." />}
          <p className="muted small">Colunas aceitas: Nome, Preço, Descrição, Categoria (separe várias com |), Estoque, Custo, Código, Disponível (sim/não), Imagem (link).</p>
          <div className="row end">
            <button className="btn" disabled={busy || !head.includes('nome')} onClick={run}>
              {busy ? 'Importando…' : 'Importar'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

export default function Products() {
  const { store } = usePanel()
  const nav = useNavigate()
  const data = useAsync(
    () => Promise.all([db.list('products', { eq: { store_id: store.id } }), db.list('categories', { eq: { store_id: store.id }, order: ['position', 'asc'] })]),
    [store.id],
  )
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off' | 'low'>('all')
  const [sel, setSel] = useState<string[]>([])
  const [bulk, setBulk] = useState({ action: 'price', value: '' })
  const products = useMemo(() => [...(data.data?.[0] ?? [])].sort((a, b) => a.position - b.position), [data.data])
  const categories = data.data?.[1] ?? []
  const list = products.filter(
    (p) =>
      (!q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase())) &&
      (!cat || p.category_ids.includes(cat)) &&
      (filter === 'all' || (filter === 'on' ? p.available : filter === 'off' ? !p.available : p.track_stock && p.stock <= 3)),
  )
  const pro = can(store, 'bulk_edit')

  async function move(p: Product, dir: number) {
    const i = products.indexOf(p)
    const other = products[i + dir]
    if (!other) return
    await Promise.all([db.update('products', p.id, { position: other.position }), db.update('products', other.id, { position: p.position === other.position ? p.position + dir : p.position })])
    data.reload()
  }
  async function duplicate(p: Product) {
    const { id: _id, created_at: _c, ...rest } = p
    void _id
    void _c
    const copy = await db.insert('products', { ...rest, name: `${p.name} (cópia)`, position: products.length, sold_count: 0 })
    const vs = await db.list('variants', { eq: { product_id: p.id } })
    for (const v of vs) {
      const { id: _vid, ...vr } = v
      void _vid
      await db.insert('variants', { ...vr, id: uid(), product_id: copy.id })
    }
    nav(`/painel/produtos/${copy.id}`)
  }
  async function applyBulk() {
    const items = products.filter((p) => sel.includes(p.id))
    for (const p of items) {
      if (bulk.action === 'price') {
        const pc = parseFloat(bulk.value.replace(',', '.'))
        if (!Number.isFinite(pc)) return toast('Informe o percentual, ex.: 10 ou -10')
        await db.update('products', p.id, { price_cents: Math.round(p.price_cents * (1 + pc / 100)) })
      } else if (bulk.action === 'category') {
        if (!bulk.value) return toast('Escolha a categoria')
        await db.update('products', p.id, { category_ids: [...new Set([...p.category_ids, bulk.value])] })
      } else if (bulk.action === 'on' || bulk.action === 'off') await db.update('products', p.id, { available: bulk.action === 'on' })
      else if (bulk.action === 'delete') await db.remove('products', p.id)
    }
    toast(`${items.length} produtos atualizados`)
    setSel([])
    data.reload()
  }
  function exportCsv() {
    const rows = [
      ['Nome', 'Preço', 'Descrição', 'Categoria', 'Estoque', 'Custo', 'Código', 'Disponível', 'Imagem'],
      ...products.map((p) => [
        p.name,
        moneyInput(p.price_cents),
        p.description,
        categories.filter((c) => p.category_ids.includes(c.id)).map((c) => c.name).join('|'),
        p.track_stock ? p.stock : '',
        moneyInput(p.cost_cents),
        p.sku,
        p.available ? 'sim' : 'não',
        p.images[0]?.startsWith('http') ? p.images[0] : '',
      ]),
    ]
    downloadFile(`produtos-${store.slug}.csv`, toCsv(rows))
  }

  return (
    <div>
      <PageHead
        title="Produtos"
        sub={data.data && `${products.length} produtos`}
        actions={
          <>
            {can(store, 'csv') && (
              <>
                <button className="btn ghost small" onClick={exportCsv}>
                  Exportar
                </button>
                <Importer storeId={store.id} categories={categories} count={products.length} onDone={data.reload} />
              </>
            )}
            <Link className="btn" to="/painel/produtos/novo">
              + Novo produto
            </Link>
          </>
        }
      />
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      {!data.data ? (
        <Loading />
      ) : !products.length ? (
        <Empty title="Nenhum produto ainda" text="Cadastre o primeiro produto com foto, nome e preço." action={<Link className="btn" to="/painel/produtos/novo">Cadastrar produto</Link>} />
      ) : (
        <>
          <div className="toolbar">
            <input type="search" placeholder="Buscar por nome ou código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produtos" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Situação">
              <option value="all">Todos</option>
              <option value="on">À venda</option>
              <option value="off">Indisponíveis</option>
              <option value="low">Estoque baixo</option>
            </select>
          </div>
          {sel.length > 0 && (
            <div className="bulkbar" role="region" aria-label="Edição em massa">
              <b>{sel.length} selecionados</b>
              {pro ? (
                <>
                  <select value={bulk.action} onChange={(e) => setBulk({ action: e.target.value, value: '' })} aria-label="Ação">
                    <option value="price">Mudar preço em %</option>
                    <option value="category">Adicionar à categoria</option>
                    <option value="on">Colocar à venda</option>
                    <option value="off">Marcar indisponível</option>
                    <option value="delete">Excluir</option>
                  </select>
                  {bulk.action === 'price' && <input placeholder="ex.: 10 ou -10" value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} aria-label="Percentual" style={{ width: 110 }} />}
                  {bulk.action === 'category' && (
                    <select value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} aria-label="Categoria">
                      <option value="">Categoria</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button className="btn small" onClick={() => (bulk.action !== 'delete' || confirm(`Excluir ${sel.length} produtos?`)) && applyBulk()}>
                    Aplicar
                  </button>
                </>
              ) : (
                <span className="small">Edição em massa no plano Pro.</span>
              )}
              <button className="link" style={{ color: '#fff' }} onClick={() => setSel([])}>
                Limpar
              </button>
            </div>
          )}
          <div className="list">
            {list.map((p) => (
              <div key={p.id} className="list-row">
                <input type="checkbox" className="check" aria-label={`Selecionar ${p.name}`} checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} style={{ width: 18, height: 18 }} />
                {p.images[0] ? <img className="pic" src={p.images[0]} alt="" /> : <div className="pic" />}
                <Link to={`/painel/produtos/${p.id}`} className="grow" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <b className="block">{p.name}</b>
                  <span className="small muted">
                    {brl(p.price_cents)}
                    {p.promo_price_cents != null && ` → ${brl(p.promo_price_cents)}`}
                    {p.track_stock && ` · ${p.stock} em estoque`}
                    {p.options.length > 0 && ` · ${p.options.map((o) => o.values.length).reduce((a, b) => a * b, 1)} variações`}
                  </span>
                </Link>
                <div className="row" style={{ gap: 4 }}>
                  {p.blocked && <Badge tone="bad">Bloqueado</Badge>}
                  {!p.available && <Badge>Indisponível</Badge>}
                  {p.featured && <Badge tone="info">Destaque</Badge>}
                  <button className="icon-btn" onClick={() => move(p, -1)} aria-label={`Mover ${p.name} para cima`}>
                    ↑
                  </button>
                  <button className="icon-btn" onClick={() => move(p, 1)} aria-label={`Mover ${p.name} para baixo`}>
                    ↓
                  </button>
                  <button className="link small" onClick={() => duplicate(p)}>
                    Duplicar
                  </button>
                </div>
              </div>
            ))}
            {!list.length && <Empty title="Nenhum produto encontrado" />}
          </div>
          {!can(store, 'csv') && (
            <div style={{ marginTop: 16 }}>
              <Upsell feature="csv">Importe e exporte produtos por planilha e edite vários de uma vez no plano Pro.</Upsell>
            </div>
          )}
        </>
      )}
    </div>
  )
}
