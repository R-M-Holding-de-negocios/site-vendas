import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db, storeUrl } from '../lib/api'
import { can } from '../lib/plans'
import type { Category, Product, ProductOption, Variant } from '../lib/types'
import { uid } from '../lib/util'
import { ErrorBox, Field, ImagePicker, Loading, MoneyInput, PageHead, toast, Toggle, Upsell } from '../ui/kit'
import { usePanel } from './PanelApp'
import { blankProduct } from './Products'

type DraftVariant = Omit<Variant, 'id' | 'store_id' | 'product_id'> & { id: string; isNew?: boolean }

const comboKey = (values: Record<string, string>) => JSON.stringify(Object.entries(values).sort())

function combos(options: ProductOption[]): Record<string, string>[] {
  const valid = options.filter((o) => o.name && o.values.length)
  return valid.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v }))), [{}]).filter((c) => Object.keys(c).length)
}

export default function ProductForm() {
  const { id } = useParams()
  const isNew = id === 'novo'
  const { store } = usePanel()
  const nav = useNavigate()
  const [p, setP] = useState<Omit<Product, 'id' | 'created_at'> & { id?: string } | null>(null)
  const [variants, setVariants] = useState<DraftVariant[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [optText, setOptText] = useState<string[]>([])

  useEffect(() => {
    ;(async () => {
      const cats = await db.list('categories', { eq: { store_id: store.id }, order: ['position', 'asc'] })
      setCategories(cats)
      if (isNew) {
        const count = (await db.list('products', { eq: { store_id: store.id } })).length
        setP(blankProduct(store.id, count))
        return
      }
      const prod = await db.get('products', id!)
      if (!prod) return setErr('Produto não encontrado.')
      setP(prod)
      setOptText(prod.options.map((o) => o.values.join(', ')))
      setVariants(await db.list('variants', { eq: { product_id: prod.id } }))
    })().catch((e) => setErr(e.message))
  }, [id, isNew, store.id])

  if (err && !p) return <ErrorBox message={err} />
  if (!p) return <Loading />
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP({ ...p, [k]: v })

  function setOptions(options: ProductOption[]) {
    const next = combos(options)
    const keep = variants.filter((v) => next.some((c) => comboKey(c) === comboKey(v.values)))
    const added = next
      .filter((c) => !variants.some((v) => comboKey(v.values) === comboKey(c)))
      .map((values) => ({ id: uid(), isNew: true, values, price_cents: null, stock: 0, sku: '', image: '', available: true }))
    setRemoved([...removed, ...variants.filter((v) => !keep.includes(v) && !v.isNew).map((v) => v.id)])
    setVariants([...keep, ...added])
    setP({ ...p!, options })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (!p!.name.trim()) return setErr('Informe o nome do produto.')
    if (!(p!.price_cents > 0)) return setErr('Informe o preço.')
    if (p!.promo_price_cents != null && p!.promo_price_cents >= p!.price_cents) return setErr('O preço promocional precisa ser menor que o preço normal.')
    setBusy(true)
    try {
      const { id: pid, ...fields } = p!
      const saved = pid ? await db.update('products', pid, fields) : await db.insert('products', fields)
      for (const vid of removed) await db.remove('variants', vid).catch(() => undefined)
      for (const v of variants) {
        const { id: vid, isNew: fresh, ...vf } = v
        if (fresh) await db.insert('variants', { ...vf, id: vid, store_id: store.id, product_id: saved.id })
        else await db.update('variants', vid, vf)
      }
      toast('Produto salvo')
      nav('/painel/produtos')
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!p!.id || !confirm(`Excluir "${p!.name}"? Os pedidos antigos continuam guardados.`)) return
    for (const v of variants) if (!v.isNew) await db.remove('variants', v.id)
    await db.remove('products', p!.id)
    toast('Produto excluído')
    nav('/painel/produtos')
  }

  const pro = can(store, 'stock')
  const promo = p.promo_price_cents != null

  return (
    <form onSubmit={submit} className="stack">
      <PageHead
        back="/painel/produtos"
        title={isNew ? 'Novo produto' : p.name || 'Produto'}
        actions={
          !isNew && (
            <a className="btn ghost small" href={storeUrl(store.slug, `/p/${p.id}`)} target="_blank" rel="noreferrer">
              Ver na loja ↗
            </a>
          )
        }
      />
      {p.blocked && <ErrorBox message="Este produto foi bloqueado pela plataforma e não aparece na loja. Fale com o suporte." />}
      <div className="split">
        <div className="stack">
          <section className="card form-section">
            <Field label="Nome">
              <input required value={p.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
            </Field>
            <Field label="Descrição" hint="Use **negrito**, listas com - e títulos com ##.">
              <textarea value={p.description} onChange={(e) => set('description', e.target.value)} rows={6} />
            </Field>
            <ImagePicker storeId={store.id} value={p.images} onChange={(v) => set('images', v)} max={8} label="Fotos (até 8; a primeira é a capa)" />
            <Field label="Vídeo do YouTube (opcional)">
              <input type="url" placeholder="https://youtube.com/..." value={p.video_url} onChange={(e) => set('video_url', e.target.value)} />
            </Field>
          </section>

          <section className="card form-section">
            <h2>Preço</h2>
            <div className="grid2">
              <Field label="Preço">
                <MoneyInput required value={p.price_cents || null} onChange={(v) => set('price_cents', v ?? 0)} />
              </Field>
              {can(store, 'cost') ? (
                <Field label="Custo (o cliente não vê)" hint="Usado para calcular o lucro nos relatórios.">
                  <MoneyInput value={p.cost_cents} onChange={(v) => set('cost_cents', v)} />
                </Field>
              ) : null}
            </div>
            {can(store, 'promo_price') ? (
              <>
                <Toggle checked={promo} onChange={(v) => setP({ ...p, promo_price_cents: v ? Math.round(p.price_cents * 0.9) : null, promo_ends_at: v ? p.promo_ends_at : null })} label="Preço promocional" />
                {promo && (
                  <div className="grid2">
                    <Field label="Preço com desconto">
                      <MoneyInput value={p.promo_price_cents} onChange={(v) => set('promo_price_cents', v)} />
                    </Field>
                    <Field label="Termina em (opcional)">
                      <input type="date" value={p.promo_ends_at?.slice(0, 10) ?? ''} onChange={(e) => set('promo_ends_at', e.target.value ? new Date(e.target.value + 'T23:59:59-03:00').toISOString() : null)} />
                    </Field>
                  </div>
                )}
              </>
            ) : (
              <Upsell feature="promo_price">Preço promocional com data de término no plano Loja.</Upsell>
            )}
            {can(store, 'qty_discount') && (
              <div className="stack tight">
                <b>Desconto por quantidade</b>
                <span className="hint">Ex.: levando 3 ou mais, 10% de desconto em cada unidade.</span>
                {p.qty_discounts.map((t, i) => (
                  <div key={i} className="row">
                    <span>A partir de</span>
                    <input type="number" min={2} style={{ width: 80 }} value={t.min_qty} onChange={(e) => set('qty_discounts', p.qty_discounts.map((x, j) => (j === i ? { ...x, min_qty: +e.target.value } : x)))} aria-label="Quantidade mínima" />
                    <span>unidades,</span>
                    <input type="number" min={1} max={90} style={{ width: 80 }} value={t.percent} onChange={(e) => set('qty_discounts', p.qty_discounts.map((x, j) => (j === i ? { ...x, percent: +e.target.value } : x)))} aria-label="Percentual de desconto" />
                    <span>% off</span>
                    <button type="button" className="link danger" onClick={() => set('qty_discounts', p.qty_discounts.filter((_, j) => j !== i))}>
                      Remover
                    </button>
                  </div>
                ))}
                <button type="button" className="link" style={{ justifySelf: 'start' }} onClick={() => set('qty_discounts', [...p.qty_discounts, { min_qty: 3, percent: 10 }])}>
                  + Adicionar faixa
                </button>
              </div>
            )}
          </section>

          <section className="card form-section">
            <h2>Variações</h2>
            {can(store, 'variants') ? (
              <>
                <p className="muted small">Tamanho, cor, sabor… Cada combinação pode ter preço, estoque e foto próprios.</p>
                {p.options.map((o, i) => (
                  <div key={i} className="grid2" style={{ alignItems: 'end' }}>
                    <Field label="Nome da opção">
                      <input value={o.name} placeholder="Ex.: Tamanho" onChange={(e) => setOptions(p.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    </Field>
                    <Field label="Valores separados por vírgula">
                      <input
                        value={optText[i] ?? ''}
                        placeholder="P, M, G"
                        onChange={(e) => setOptText(optText.map((t, j) => (j === i ? e.target.value : t)))}
                        onBlur={() => setOptions(p.options.map((x, j) => (j === i ? { ...x, values: [...new Set((optText[i] ?? '').split(',').map((v) => v.trim()).filter(Boolean))] } : x)))}
                      />
                    </Field>
                    <button
                      type="button"
                      className="link danger"
                      style={{ justifySelf: 'start' }}
                      onClick={() => {
                        setOptText(optText.filter((_, j) => j !== i))
                        setOptions(p.options.filter((_, j) => j !== i))
                      }}
                    >
                      Remover opção
                    </button>
                  </div>
                ))}
                {p.options.length < 3 && (
                  <button
                    type="button"
                    className="btn ghost small"
                    style={{ justifySelf: 'start' }}
                    onClick={() => {
                      setOptText([...optText, ''])
                      setP({ ...p, options: [...p.options, { name: p.options.length ? 'Cor' : 'Tamanho', values: [] }] })
                    }}
                  >
                    + Adicionar opção
                  </button>
                )}
                {variants.length > 0 && (
                  <div className="table-wrap">
                    <table className="table var-table">
                      <thead>
                        <tr>
                          <th>Variação</th>
                          <th>Preço próprio</th>
                          {p.track_stock && <th>Estoque</th>}
                          <th>Código</th>
                          <th>À venda</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variants.map((v, i) => {
                          const up = (patch: Partial<DraftVariant>) => setVariants(variants.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                          return (
                            <tr key={v.id}>
                              <td className="nowrap">{Object.values(v.values).join(' / ')}</td>
                              <td style={{ minWidth: 130 }}>
                                <MoneyInput value={v.price_cents} placeholder="igual" onChange={(c) => up({ price_cents: c })} />
                              </td>
                              {p.track_stock && (
                                <td>
                                  <input type="number" min={0} style={{ width: 80 }} value={v.stock} onChange={(e) => up({ stock: +e.target.value })} aria-label="Estoque" />
                                </td>
                              )}
                              <td>
                                <input style={{ width: 100 }} value={v.sku} onChange={(e) => up({ sku: e.target.value })} aria-label="Código" />
                              </td>
                              <td>
                                <input type="checkbox" checked={v.available} onChange={(e) => up({ available: e.target.checked })} aria-label="À venda" style={{ width: 18, height: 18 }} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <Upsell feature="variants">Tamanhos, cores e sabores com preço e estoque próprios no plano Loja.</Upsell>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card form-section">
            <Toggle checked={p.available} onChange={(v) => set('available', v)} label="À venda" hint="Desligado, o produto aparece como indisponível." />
            <Toggle checked={p.featured} onChange={(v) => set('featured', v)} label="Destaque na página inicial" />
            <fieldset>
              <legend className="field-label">Categorias</legend>
              <div className="chips">
                {categories.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={`chip ${p.category_ids.includes(c.id) ? 'on' : ''}`}
                    aria-pressed={p.category_ids.includes(c.id)}
                    onClick={() => set('category_ids', p.category_ids.includes(c.id) ? p.category_ids.filter((x) => x !== c.id) : [...p.category_ids, c.id])}
                  >
                    {c.name}
                  </button>
                ))}
                {!categories.length && <span className="muted small">Crie categorias em Categorias.</span>}
              </div>
            </fieldset>
          </section>

          <section className="card form-section">
            <h2>Estoque</h2>
            {/* Fora do Pro, quem já controlava estoque (ex.: depois do teste grátis) ainda pode
                repor a quantidade ou desligar o controle; senão o produto ficaria esgotado. */}
            {pro || p.track_stock ? (
              <>
                {!pro && <p className="muted small">O controle de estoque é do plano Pro. Você pode repor a quantidade ou desligar o controle.</p>}
                <Toggle checked={p.track_stock} onChange={(v) => set('track_stock', v)} label="Controlar estoque" hint="A cada venda a quantidade baixa sozinha; no zero, o produto esgota." />
                {p.track_stock && !p.options.length && (
                  <Field label="Quantidade em estoque">
                    <input type="number" min={0} value={p.stock} onChange={(e) => set('stock', +e.target.value)} />
                  </Field>
                )}
                <Field label="Código do produto (opcional)">
                  <input value={p.sku} onChange={(e) => set('sku', e.target.value)} />
                </Field>
              </>
            ) : (
              <Upsell feature="stock">Controle de estoque com baixa automática no plano Pro.</Upsell>
            )}
          </section>

          <section className="card form-section">
            <h2>Peso e medidas</h2>
            <p className="hint">Necessários para calcular frete por transportadora.</p>
            <div className="grid2">
              <Field label="Peso (g)">
                <input type="number" min={0} value={p.weight_g || ''} onChange={(e) => set('weight_g', +e.target.value)} />
              </Field>
              <Field label="Altura (cm)">
                <input type="number" min={0} value={p.height_cm || ''} onChange={(e) => set('height_cm', +e.target.value)} />
              </Field>
              <Field label="Largura (cm)">
                <input type="number" min={0} value={p.width_cm || ''} onChange={(e) => set('width_cm', +e.target.value)} />
              </Field>
              <Field label="Comprimento (cm)">
                <input type="number" min={0} value={p.length_cm || ''} onChange={(e) => set('length_cm', +e.target.value)} />
              </Field>
            </div>
          </section>

          {can(store, 'seo') && (
            <section className="card form-section">
              <h2>Google</h2>
              <Field label="Título" hint={`${(p.seo.title || p.name).length}/60 caracteres`}>
                <input value={p.seo.title} placeholder={p.name} maxLength={70} onChange={(e) => set('seo', { ...p.seo, title: e.target.value })} />
              </Field>
              <Field label="Descrição" hint={`${p.seo.description.length}/160 caracteres`}>
                <textarea value={p.seo.description} maxLength={170} rows={3} onChange={(e) => set('seo', { ...p.seo, description: e.target.value })} />
              </Field>
            </section>
          )}
        </div>
      </div>
      {err && <ErrorBox message={err} />}
      <div className="form-actions">
        {!isNew && (
          <button type="button" className="btn danger" onClick={remove}>
            Excluir
          </button>
        )}
        <button className="btn" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar produto'}
        </button>
      </div>
    </form>
  )
}
