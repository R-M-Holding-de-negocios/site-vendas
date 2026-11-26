// Editor de aparência: o lojista monta a loja com seções prontas e opções de estilo,
// vendo o resultado ao vivo. Nada vai ao ar até publicar.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { db, normalizeStore, storeUrl } from '../lib/api'
import { can, planAtLeast, planName, type Feature } from '../lib/plans'
import { FONT_PAIRS, loadFont, newSection, PRESETS, SECTION_INFO } from '../lib/theme'
import type { Category, Content, MenuItem, Product, Section, SectionType, Theme } from '../lib/types'
import { fmtDateTime } from '../lib/util'
import { Ctx } from '../store/context'
import { HomePage } from '../store/pages'
import { useStoreCtx } from '../store/StoreApp'
import { StoreShell } from '../store/StoreShell'
import '../styles/store.css'
import { ICON_CHOICES } from '../ui/icons'
import { Badge, Field, ImagePicker, Loading, Modal, toast, Toggle } from '../ui/kit'
import { usePanel } from './PanelApp'

type Kind = 'text' | 'area' | 'image' | 'link' | 'select' | 'toggle' | 'number' | 'datetime' | 'category' | 'product' | 'products' | 'categories' | 'icon' | 'list'
interface Spec {
  key: string
  label: string
  kind: Kind
  options?: [string, string][]
  item?: Spec[]
  hint?: string
  when?: (p: Section['props']) => boolean
}

const BANNER_FIELDS: Spec[] = [
  { key: 'image', label: 'Imagem (computador)', kind: 'image', hint: 'Ideal: 1600 × 700 pixels' },
  { key: 'image_mobile', label: 'Imagem para celular (opcional)', kind: 'image', hint: 'Ideal: 800 × 1000 pixels' },
  { key: 'title', label: 'Título', kind: 'text' },
  { key: 'text', label: 'Texto', kind: 'text' },
  { key: 'button', label: 'Texto do botão', kind: 'text' },
  { key: 'link', label: 'Botão leva para', kind: 'link' },
]

const SPECS: Record<SectionType, Spec[]> = {
  banner: [
    ...BANNER_FIELDS,
    { key: 'align', label: 'Posição do texto', kind: 'select', options: [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']] },
    { key: 'overlay', label: 'Escurecer a imagem (%)', kind: 'number', hint: 'Ajuda a ler o texto sobre fotos claras' },
    { key: 'height', label: 'Altura', kind: 'select', options: [['s', 'Baixa'], ['m', 'Média'], ['l', 'Alta']] },
  ],
  carousel: [
    { key: 'slides', label: 'Banners', kind: 'list', item: BANNER_FIELDS },
    { key: 'height', label: 'Altura', kind: 'select', options: [['s', 'Baixa'], ['m', 'Média'], ['l', 'Alta']] },
  ],
  video: [
    { key: 'url', label: 'Link do YouTube', kind: 'text' },
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'text', label: 'Texto', kind: 'area' },
  ],
  categories: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'ids', label: 'Categorias (vazio = todas)', kind: 'categories' },
    { key: 'shape', label: 'Formato', kind: 'select', options: [['circle', 'Círculo'], ['card', 'Cartão']] },
  ],
  products: [
    { key: 'title', label: 'Título', kind: 'text' },
    {
      key: 'source',
      label: 'Quais produtos',
      kind: 'select',
      options: [['featured', 'Destaques'], ['best_sellers', 'Mais vendidos'], ['new', 'Novidades'], ['promo', 'Em promoção'], ['category', 'De uma categoria'], ['manual', 'Escolher um a um'], ['all', 'Todos']],
    },
    { key: 'category_id', label: 'Categoria', kind: 'category', when: (p) => p.source === 'category' },
    { key: 'ids', label: 'Produtos', kind: 'products', when: (p) => p.source === 'manual' },
    { key: 'layout', label: 'Formato', kind: 'select', options: [['grid', 'Grade'], ['carousel', 'Carrossel (desliza para o lado)']] },
    { key: 'limit', label: 'Quantos mostrar', kind: 'number' },
  ],
  featured_product: [
    { key: 'product_id', label: 'Produto', kind: 'product' },
    { key: 'title', label: 'Chamada (acima do nome)', kind: 'text' },
    { key: 'text', label: 'Texto (vazio = descrição do produto)', kind: 'area' },
  ],
  image_text: [
    { key: 'image', label: 'Imagem', kind: 'image' },
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'text', label: 'Texto', kind: 'area' },
    { key: 'button', label: 'Texto do botão', kind: 'text' },
    { key: 'link', label: 'Botão leva para', kind: 'link' },
    { key: 'reverse', label: 'Imagem do lado direito', kind: 'toggle' },
  ],
  text: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'text', label: 'Texto', kind: 'area' },
    { key: 'align', label: 'Alinhamento', kind: 'select', options: [['left', 'Esquerda'], ['center', 'Centro']] },
  ],
  gallery: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'images', label: 'Imagens', kind: 'list', item: [{ key: 'url', label: 'Imagem', kind: 'image' }, { key: 'link', label: 'Link ao clicar (opcional)', kind: 'link' }] },
    { key: 'columns', label: 'Colunas no computador', kind: 'select', options: [['2', '2'], ['3', '3'], ['4', '4']] },
  ],
  testimonials: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'items', label: 'Depoimentos', kind: 'list', item: [{ key: 'name', label: 'Nome', kind: 'text' }, { key: 'text', label: 'Depoimento', kind: 'area' }, { key: 'rating', label: 'Nota (1 a 5)', kind: 'number' }, { key: 'photo', label: 'Foto', kind: 'image' }] },
  ],
  benefits: [{ key: 'items', label: 'Vantagens', kind: 'list', item: [{ key: 'icon', label: 'Ícone', kind: 'icon' }, { key: 'text', label: 'Frase', kind: 'text' }] }],
  faq: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'items', label: 'Perguntas', kind: 'list', item: [{ key: 'q', label: 'Pergunta', kind: 'text' }, { key: 'a', label: 'Resposta', kind: 'area' }] },
  ],
  map: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'address', label: 'Endereço (vazio = endereço de retirada)', kind: 'text' },
    { key: 'show_hours', label: 'Mostrar horários', kind: 'toggle' },
  ],
  countdown: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'ends_at', label: 'Termina em', kind: 'datetime' },
    { key: 'button', label: 'Texto do botão', kind: 'text' },
    { key: 'link', label: 'Botão leva para', kind: 'link' },
  ],
  posts: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'limit', label: 'Quantos mostrar', kind: 'number' },
  ],
  lead: [
    { key: 'title', label: 'Título', kind: 'text' },
    { key: 'text', label: 'Texto', kind: 'text' },
    { key: 'button', label: 'Texto do botão', kind: 'text' },
  ],
}

interface Lists {
  categories: Category[]
  products: Product[]
  pages: Content[]
}

function LinkInput({ value, onChange, lists }: { value: string; onChange: (v: string) => void; lists: Lists }) {
  const quick: [string, string][] = [
    ['#produtos', 'Lista de produtos da página'],
    ['/produtos', 'Todos os produtos'],
    ...lists.categories.map((c) => [`/c/${c.id}`, `Categoria: ${c.name}`] as [string, string]),
    ...lists.pages.map((p) => [`/pagina/${p.slug}`, `Página: ${p.title}`] as [string, string]),
    ...lists.products.slice(0, 40).map((p) => [`/p/${p.id}`, `Produto: ${p.name}`] as [string, string]),
  ]
  return (
    <div className="stack tight">
      <select value={quick.some(([v]) => v === value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Outro endereço…</option>
        {quick.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {!quick.some(([v]) => v === value) && <input placeholder="https://… ou /p/…" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  )
}

function SpecFields({ specs, value, onChange, storeId, lists }: { specs: Spec[]; value: Section['props']; onChange: (v: Section['props']) => void; storeId: string; lists: Lists }) {
  return (
    <>
      {specs
        .filter((sp) => !sp.when || sp.when(value))
        .map((sp) => {
          const v = value[sp.key]
          const set = (x: unknown) => onChange({ ...value, [sp.key]: x })
          switch (sp.kind) {
            case 'text':
              return <Field key={sp.key} label={sp.label} hint={sp.hint}><input value={v ?? ''} onChange={(e) => set(e.target.value)} /></Field>
            case 'area':
              return <Field key={sp.key} label={sp.label}><textarea rows={3} value={v ?? ''} onChange={(e) => set(e.target.value)} /></Field>
            case 'number':
              return <Field key={sp.key} label={sp.label} hint={sp.hint}><input type="number" value={v ?? 0} onChange={(e) => set(+e.target.value)} /></Field>
            case 'toggle':
              return <Toggle key={sp.key} checked={!!v} onChange={set} label={sp.label} />
            case 'datetime':
              return <Field key={sp.key} label={sp.label}><input type="datetime-local" value={v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(e) => set(e.target.value ? new Date(e.target.value).toISOString() : '')} /></Field>
            case 'select':
              return (
                <Field key={sp.key} label={sp.label}>
                  <select value={String(v ?? '')} onChange={(e) => set(/^\d+$/.test(e.target.value) && sp.key === 'columns' ? +e.target.value : e.target.value)}>
                    {sp.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
              )
            case 'image':
              return <ImagePicker key={sp.key} storeId={storeId} label={sp.label} value={v ? [v] : []} onChange={(x) => set(x[0] ?? '')} />
            case 'link':
              return <Field key={sp.key} label={sp.label}><LinkInput value={v ?? ''} onChange={set} lists={lists} /></Field>
            case 'icon':
              return (
                <Field key={sp.key} label={sp.label}>
                  <select value={v} onChange={(e) => set(e.target.value)}>
                    {ICON_CHOICES.map((i) => <option key={i} value={i}>{ICON_NAMES[i] ?? i}</option>)}
                  </select>
                </Field>
              )
            case 'category':
              return (
                <Field key={sp.key} label={sp.label}>
                  <select value={v ?? ''} onChange={(e) => set(e.target.value)}>
                    <option value="">Escolha</option>
                    {lists.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )
            case 'product':
              return (
                <Field key={sp.key} label={sp.label}>
                  <select value={v ?? ''} onChange={(e) => set(e.target.value)}>
                    <option value="">Primeiro destaque</option>
                    {lists.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              )
            case 'products':
            case 'categories': {
              const items = sp.kind === 'products' ? lists.products : lists.categories
              const sel: string[] = v ?? []
              return (
                <fieldset key={sp.key}>
                  <legend className="field-label">{sp.label}</legend>
                  <div className="chips">
                    {items.map((x) => (
                      <button type="button" key={x.id} className={`chip ${sel.includes(x.id) ? 'on' : ''}`} aria-pressed={sel.includes(x.id)} onClick={() => set(sel.includes(x.id) ? sel.filter((y) => y !== x.id) : [...sel, x.id])}>
                        {x.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )
            }
            case 'list': {
              const arr: Section['props'][] = v ?? []
              const setArr = (a: Section['props'][]) => set(a)
              return (
                <div key={sp.key} className="stack tight">
                  <span className="field-label">{sp.label}</span>
                  <div className="item-list">
                    {arr.map((it, i) => (
                      <div key={i} className="item-box">
                        <div className="row between">
                          <b className="small">#{i + 1}</b>
                          <div className="row" style={{ gap: 2 }}>
                            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => { const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setArr(a) }} aria-label="Subir">↑</button>
                            <button type="button" className="icon-btn" disabled={i === arr.length - 1} onClick={() => { const a = [...arr]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setArr(a) }} aria-label="Descer">↓</button>
                            <button type="button" className="icon-btn" onClick={() => setArr(arr.filter((_, j) => j !== i))} aria-label="Remover">✕</button>
                          </div>
                        </div>
                        <SpecFields specs={sp.item!} value={it} onChange={(x) => setArr(arr.map((y, j) => (j === i ? x : y)))} storeId={storeId} lists={lists} />
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn ghost small" style={{ justifySelf: 'start' }} onClick={() => setArr([...arr, Object.fromEntries(sp.item!.map((f) => [f.key, f.kind === 'number' ? 5 : f.kind === 'icon' ? 'check' : '']))])}>
                    + Adicionar
                  </button>
                </div>
              )
            }
          }
        })}
    </>
  )
}

const ICON_NAMES: Record<string, string> = { truck: 'Caminhão', shield: 'Escudo', chat: 'Conversa', star: 'Estrela', heart: 'Coração', gift: 'Presente', clock: 'Relógio', leaf: 'Folha', check: 'Confere', card: 'Cartão', pix: 'Pix', pin: 'Local', box: 'Caixa', tag: 'Etiqueta', sparkle: 'Brilho' }

function Locked({ feature, children }: { feature: Feature; children: ReactNode }) {
  const { store } = usePanel()
  if (can(store, feature)) return <>{children}</>
  return (
    <div className="upsell">
      <span className="badge plan">Plano {feature === 'hide_branding' || feature === 'pro_sections' ? 'Pro' : 'Loja'}</span>
      <p className="small">Disponível em um plano superior.</p>
      <Link to="/painel/plano" className="btn small">Ver planos</Link>
    </div>
  )
}

function Group({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="panel-group" open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  )
}

function MenuEditor({ menu, onChange, lists }: { menu: MenuItem[]; onChange: (m: MenuItem[]) => void; lists: Lists }) {
  const targets: [string, string][] = [
    ['home|', 'Início'],
    ['blog|', 'Blog'],
    ...lists.categories.map((c) => [`category|${c.id}`, `Categoria: ${c.name}`] as [string, string]),
    ...lists.pages.map((p) => [`page|${p.id}`, `Página: ${p.title}`] as [string, string]),
    ['url|', 'Link externo'],
  ]
  const row = (m: MenuItem, set: (x: MenuItem | null) => void, child: boolean) => (
    <div className="item-box" style={child ? { marginLeft: 16 } : undefined}>
      <div className="row">
        <input className="grow" style={{ width: 'auto' }} value={m.label} aria-label="Nome no menu" onChange={(e) => set({ ...m, label: e.target.value })} />
        <button type="button" className="icon-btn" onClick={() => set(null)} aria-label="Remover">✕</button>
      </div>
      <select
        value={`${m.type}|${m.type === 'url' ? '' : m.target}`}
        onChange={(e) => {
          const [type, target] = e.target.value.split('|')
          const label = targets.find(([k]) => k === e.target.value)?.[1].replace(/^(Categoria|Página): /, '') ?? m.label
          set({ ...m, type: type as MenuItem['type'], target, label: m.label || label })
        }}
      >
        {targets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {m.type === 'url' && <input placeholder="https://…" value={m.target} onChange={(e) => set({ ...m, target: e.target.value })} />}
      {!child && (
        <>
          {m.children.map((c, j) => (
            <div key={j}>{row(c, (x) => set({ ...m, children: x ? m.children.map((y, k) => (k === j ? x : y)) : m.children.filter((_, k) => k !== j) }), true)}</div>
          ))}
          <button type="button" className="link small" style={{ justifySelf: 'start' }} onClick={() => set({ ...m, children: [...m.children, { label: '', type: 'home', target: '', children: [] }] })}>+ Subitem</button>
        </>
      )}
    </div>
  )
  return (
    <div className="item-list">
      {menu.map((m, i) => (
        <div key={i}>{row(m, (x) => onChange(x ? menu.map((y, j) => (j === i ? x : y)) : menu.filter((_, j) => j !== i)), false)}</div>
      ))}
      <button type="button" className="btn ghost small" style={{ justifySelf: 'start' }} onClick={() => onChange([...menu, { label: 'Novo item', type: 'home', target: '', children: [] }])}>+ Item do menu</button>
      <p className="hint">Com só o item Início, a loja monta o menu sozinha com as categorias e páginas.</p>
    </div>
  )
}

export default function Appearance() {
  const { store, setStore } = usePanel()
  const [data, setData] = useState<Lists & { variants: import('../lib/types').Variant[]; contents: Content[]; reviews: import('../lib/types').Review[] } | null>(null)
  const [theme, setTheme] = useState<Theme>(store.theme_draft ?? store.theme)
  const [undo, setUndo] = useState<Theme[]>([])
  const [device, setDevice] = useState<'mobile' | 'desktop'>(matchMedia('(min-width: 980px)').matches ? 'desktop' : 'mobile')
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const saved = store.theme_draft ?? store.theme
  const dirty = JSON.stringify(theme) !== JSON.stringify(saved)
  const unpublished = JSON.stringify(theme) !== JSON.stringify(store.theme)

  useEffect(() => {
    Promise.all([
      db.list('categories', { eq: { store_id: store.id }, order: ['position', 'asc'] }),
      db.list('products', { eq: { store_id: store.id } }),
      db.list('variants', { eq: { store_id: store.id } }),
      db.list('contents', { eq: { store_id: store.id } }),
      db.list('reviews', { eq: { store_id: store.id, approved: true } }),
    ]).then(([categories, products, variants, contents, reviews]) =>
      setData({ categories, products: products.filter((p) => !p.blocked), variants, contents: contents.filter((c) => c.status === 'published'), pages: contents.filter((c) => c.kind === 'page'), reviews }),
    )
  }, [store.id])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    for (const f of FONT_PAIRS.slice(1, 6)) loadFont(f.id)
  }, [])

  const update = (t: Theme) => {
    setUndo((u) => [...u.slice(-29), theme])
    setTheme(t)
  }
  const patch = <K extends keyof Theme>(k: K, v: Theme[K]) => update({ ...theme, [k]: v })
  const setSection = (id: string, s: Section | null) => update({ ...theme, sections: s ? theme.sections.map((x) => (x.id === id ? s : x)) : theme.sections.filter((x) => x.id !== id) })

  async function saveDraft() {
    setBusy(true)
    try {
      setStore(normalizeStore(await db.update('stores', store.id, { theme_draft: theme })))
      toast('Rascunho salvo')
    } finally {
      setBusy(false)
    }
  }
  async function publish() {
    setBusy(true)
    try {
      const historyList = [{ at: new Date().toISOString(), theme: store.theme }, ...store.theme_history].slice(0, 5)
      setStore(normalizeStore(await db.update('stores', store.id, { theme, theme_draft: null, theme_history: historyList })))
      toast('Publicado! A loja já está com o novo visual.')
    } finally {
      setBusy(false)
    }
  }

  const previewData = useMemo(() => (data ? { store: { ...store, theme }, products: data.products, variants: data.variants, categories: data.categories, contents: data.contents, reviews: data.reviews } : null), [data, store, theme])
  const editingSection = theme.sections.find((s) => s.id === editing)
  const vitrine = !can(store, 'sections')

  return (
    <div className="editor">
      <div className="editor-top">
        <Link to="/painel" className="btn ghost small">← Painel</Link>
        <b className="grow">Aparência {dirty ? <Badge tone="warn">Alterações não salvas</Badge> : unpublished ? <Badge tone="info">Rascunho</Badge> : null}</b>
        <div className="row" role="group" aria-label="Tamanho da prévia">
          <button className={`chip ${device === 'mobile' ? 'on' : ''}`} onClick={() => setDevice('mobile')} aria-pressed={device === 'mobile'}>Celular</button>
          <button className={`chip ${device === 'desktop' ? 'on' : ''}`} onClick={() => setDevice('desktop')} aria-pressed={device === 'desktop'}>Computador</button>
        </div>
        <button className="btn ghost small" disabled={!undo.length} onClick={() => { setTheme(undo.at(-1)!); setUndo(undo.slice(0, -1)) }}>Desfazer</button>
        <button className="btn ghost small" onClick={() => setHistory(true)}>Versões</button>
        <a className="btn ghost small" href={storeUrl(store.slug)} target="_blank" rel="noreferrer">Ver loja ↗</a>
        <button className="btn ghost small" disabled={!dirty || busy} onClick={saveDraft}>Salvar rascunho</button>
        <button className="btn small" disabled={!unpublished || busy} onClick={publish}>Publicar</button>
      </div>
      <div className="editor-mobile-tabs tabs" style={{ background: 'var(--surface)' }}>
        <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}>Editar</button>
        <button className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>Prévia</button>
      </div>
      <div className="editor-body" data-view={view}>
        <aside className="editor-side" aria-label="Opções de aparência">
          {editingSection ? (
            <div className="stack">
              <button className="link" style={{ justifySelf: 'start' }} onClick={() => setEditing(null)}>← Todas as seções</button>
              <h2>{SECTION_INFO[editingSection.type].name}</h2>
              {data && (
                <SpecFields specs={SPECS[editingSection.type]} value={editingSection.props} onChange={(props) => setSection(editingSection.id, { ...editingSection, props })} storeId={store.id} lists={data} />
              )}
              {!vitrine && (
                <Group title="Estilo da seção">
                  <div className="color-row">
                    <span>Cor de fundo</span>
                    <div className="row">
                      <input type="color" value={editingSection.style.bg || '#ffffff'} onChange={(e) => setSection(editingSection.id, { ...editingSection, style: { ...editingSection.style, bg: e.target.value } })} aria-label="Cor de fundo" />
                      {editingSection.style.bg && <button className="link small" onClick={() => setSection(editingSection.id, { ...editingSection, style: { ...editingSection.style, bg: '' } })}>Padrão</button>}
                    </div>
                  </div>
                  <Field label="Largura">
                    <select value={editingSection.style.width} onChange={(e) => setSection(editingSection.id, { ...editingSection, style: { ...editingSection.style, width: e.target.value as 'full' } })}>
                      <option value="contained">Alinhada ao conteúdo</option>
                      <option value="full">Tela inteira</option>
                    </select>
                  </Field>
                  <Field label="Espaço acima e abaixo">
                    <select value={editingSection.style.pad} onChange={(e) => setSection(editingSection.id, { ...editingSection, style: { ...editingSection.style, pad: e.target.value as 's' } })}>
                      <option value="s">Pequeno</option>
                      <option value="m">Médio</option>
                      <option value="l">Grande</option>
                    </select>
                  </Field>
                  <Field label="Mostrar em">
                    <select value={editingSection.style.device} onChange={(e) => setSection(editingSection.id, { ...editingSection, style: { ...editingSection.style, device: e.target.value as 'all' } })}>
                      <option value="all">Celular e computador</option>
                      <option value="mobile">Só no celular</option>
                      <option value="desktop">Só no computador</option>
                    </select>
                  </Field>
                </Group>
              )}
            </div>
          ) : (
            <>
              <Group title="Tema" open>
                <Locked feature="themes">
                  <div className="swatches">
                    {PRESETS.map((p) => {
                      const t = p.apply(theme)
                      return (
                        <button key={p.id} className={`swatch ${theme.preset === p.id ? 'on' : ''}`} onClick={() => confirm(`Aplicar o tema ${p.name}? Cores, fontes e formato mudam; produtos, textos e seções continuam.`) && update(t)}>
                          <span className="dots">{[t.colors.primary, t.colors.background, t.colors.accent, t.colors.text].map((c) => <span key={c} style={{ background: c }} />)}</span>
                          <b>{p.name}</b>
                          <span className="hint">{p.for}</span>
                        </button>
                      )
                    })}
                  </div>
                </Locked>
              </Group>
              <Group title="Cores">
                {(
                  [
                    ['primary', 'Principal (botões e destaques)'],
                    ['background', 'Fundo'],
                    ['surface', 'Cartões e cabeçalho'],
                    ['text', 'Texto'],
                    ['muted', 'Texto secundário'],
                    ['accent', 'Detalhes e etiquetas'],
                  ] as [keyof Theme['colors'], string][]
                ).map(([k, l]) => (
                  <label key={k} className="color-row">
                    <span>{l}</span>
                    <input type="color" value={theme.colors[k]} onChange={(e) => patch('colors', { ...theme.colors, [k]: e.target.value })} />
                  </label>
                ))}
                <ContrastWarning theme={theme} />
              </Group>
              <Group title="Fontes e formato">
                <Locked feature="fonts">
                  <Field label="Fontes">
                    <select value={theme.font} onChange={(e) => { loadFont(e.target.value); patch('font', e.target.value) }}>
                      {FONT_PAIRS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Cantos">
                    <select value={theme.radius} onChange={(e) => patch('radius', e.target.value as Theme['radius'])}>
                      <option value="square">Retos</option>
                      <option value="rounded">Arredondados</option>
                      <option value="pill">Bem redondos</option>
                    </select>
                  </Field>
                  <Field label="Espaçamento">
                    <select value={theme.spacing} onChange={(e) => patch('spacing', e.target.value as Theme['spacing'])}>
                      <option value="compact">Compacto</option>
                      <option value="normal">Normal</option>
                      <option value="wide">Amplo</option>
                    </select>
                  </Field>
                </Locked>
              </Group>
              <Group title="Barra de aviso">
                <Toggle checked={theme.announcement.enabled} onChange={(v) => patch('announcement', { ...theme.announcement, enabled: v })} label="Mostrar barra no topo" />
                {theme.announcement.messages.map((m, i) => (
                  <div key={i} className="row">
                    <input className="grow" style={{ width: 'auto' }} value={m} aria-label={`Frase ${i + 1}`} onChange={(e) => patch('announcement', { ...theme.announcement, messages: theme.announcement.messages.map((x, j) => (j === i ? e.target.value : x)) })} />
                    {i > 0 && <button className="icon-btn" onClick={() => patch('announcement', { ...theme.announcement, messages: theme.announcement.messages.filter((_, j) => j !== i) })} aria-label="Remover frase">✕</button>}
                  </div>
                ))}
                {can(store, 'animations') && <button className="link small" style={{ justifySelf: 'start' }} onClick={() => patch('announcement', { ...theme.announcement, messages: [...theme.announcement.messages, ''] })}>+ Outra frase (alterna sozinha)</button>}
                {data && <Field label="Ao clicar, leva para"><LinkInput value={theme.announcement.link} onChange={(v) => patch('announcement', { ...theme.announcement, link: v })} lists={data} /></Field>}
              </Group>
              <Group title="Seções da página inicial" open>
                <div className="item-list">
                  {theme.sections.map((s, i) => {
                    const allowed = planAtLeast(store.plan, SECTION_INFO[s.type].plan)
                    const editable = allowed && (!vitrine || s.type === 'banner')
                    return (
                      <div key={s.id} className={`sec-item ${s.enabled && allowed ? '' : 'off'}`}>
                        <span className="grow" role="button" tabIndex={0} onClick={() => editable && setEditing(s.id)} onKeyDown={(e) => e.key === 'Enter' && editable && setEditing(s.id)}>
                          {SECTION_INFO[s.type].name}
                          {s.props.title ? <span className="hint block">{s.props.title}</span> : null}
                          {!allowed && <span className="hint block">Plano {planName(SECTION_INFO[s.type].plan)}</span>}
                        </span>
                        {!vitrine && (
                          <>
                            <button className="icon-btn" disabled={i === 0} onClick={() => { const a = [...theme.sections]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; patch('sections', a) }} aria-label="Subir seção">↑</button>
                            <button className="icon-btn" disabled={i === theme.sections.length - 1} onClick={() => { const a = [...theme.sections]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; patch('sections', a) }} aria-label="Descer seção">↓</button>
                            <button className="icon-btn" onClick={() => setSection(s.id, { ...s, enabled: !s.enabled })} aria-label={s.enabled ? 'Esconder seção' : 'Mostrar seção'} title={s.enabled ? 'Esconder' : 'Mostrar'}>{s.enabled ? '◉' : '○'}</button>
                            <button className="icon-btn" onClick={() => { const copy = { ...structuredClone(s), id: crypto.randomUUID() }; const a = [...theme.sections]; a.splice(i + 1, 0, copy); patch('sections', a) }} aria-label="Duplicar seção" title="Duplicar">⧉</button>
                            <button className="icon-btn" onClick={() => confirm('Remover esta seção?') && setSection(s.id, null)} aria-label="Remover seção" title="Remover">✕</button>
                          </>
                        )}
                        {editable && vitrine && <button className="link small" onClick={() => setEditing(s.id)}>Editar</button>}
                      </div>
                    )
                  })}
                </div>
                {vitrine ? (
                  <Locked feature="sections"><span /></Locked>
                ) : (
                  <button className="btn ghost small" style={{ justifySelf: 'start' }} onClick={() => setAdding(true)}>+ Adicionar seção</button>
                )}
              </Group>
              <Group title="Cabeçalho e menu">
                <Locked feature="layout">
                  <Field label="Logo">
                    <select value={theme.header.logo_align} onChange={(e) => patch('header', { ...theme.header, logo_align: e.target.value as 'left' })}>
                      <option value="left">À esquerda</option>
                      <option value="center">No centro</option>
                    </select>
                  </Field>
                  <Field label={`Tamanho do logo: ${theme.header.logo_size}px`}>
                    <input type="range" min={24} max={80} value={theme.header.logo_size} onChange={(e) => patch('header', { ...theme.header, logo_size: +e.target.value })} />
                  </Field>
                  <Toggle checked={theme.header.sticky} onChange={(v) => patch('header', { ...theme.header, sticky: v })} label="Fixo ao rolar a página" />
                  <Toggle checked={theme.header.transparent} onChange={(v) => patch('header', { ...theme.header, transparent: v })} label="Transparente sobre o banner" />
                  <p className="hint">O logo é enviado em Configurações &gt; Loja.</p>
                </Locked>
                {data && (
                  <Locked feature="menu">
                    <MenuEditor menu={theme.menu} onChange={(m) => patch('menu', m)} lists={data} />
                  </Locked>
                )}
              </Group>
              <Group title="Produtos">
                <Locked feature="layout">
                  <Field label="Formato das fotos">
                    <select value={theme.product.ratio} onChange={(e) => patch('product', { ...theme.product, ratio: e.target.value as '1/1' })}>
                      <option value="1/1">Quadrada</option>
                      <option value="4/5">Retrato</option>
                      <option value="3/2">Paisagem</option>
                    </select>
                  </Field>
                  <Field label="Encaixe">
                    <select value={theme.product.fit} onChange={(e) => patch('product', { ...theme.product, fit: e.target.value as 'cover' })}>
                      <option value="cover">Preencher (pode cortar)</option>
                      <option value="contain">Mostrar a foto inteira</option>
                    </select>
                  </Field>
                  <div className="grid2">
                    <Field label="Colunas no celular">
                      <select value={theme.product.cols_mobile} onChange={(e) => patch('product', { ...theme.product, cols_mobile: +e.target.value as 1 })}>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                      </select>
                    </Field>
                    <Field label="No computador">
                      <select value={theme.product.cols_desktop} onChange={(e) => patch('product', { ...theme.product, cols_desktop: +e.target.value as 3 })}>
                        <option value={3}>3</option>
                        <option value={4}>4</option>
                        <option value={5}>5</option>
                      </select>
                    </Field>
                  </div>
                  <Toggle checked={theme.product.card.add_button} onChange={(v) => patch('product', { ...theme.product, card: { ...theme.product.card, add_button: v } })} label="Botão de adicionar no cartão" />
                  <Toggle checked={theme.product.card.badge} onChange={(v) => patch('product', { ...theme.product, card: { ...theme.product.card, badge: v } })} label="Etiquetas (novo, promoção, esgotado)" />
                  <Toggle checked={theme.product.card.installments} onChange={(v) => patch('product', { ...theme.product, card: { ...theme.product.card, installments: v } })} label="Parcelamento no cartão" />
                  <Toggle checked={theme.product.card.rating} onChange={(v) => patch('product', { ...theme.product, card: { ...theme.product.card, rating: v } })} label="Nota das avaliações" />
                  <Field label="Galeria na página do produto">
                    <select value={theme.product.gallery} onChange={(e) => patch('product', { ...theme.product, gallery: e.target.value as 'below' })}>
                      <option value="below">Miniaturas abaixo</option>
                      <option value="side">Miniaturas ao lado</option>
                      <option value="stacked">Fotos empilhadas</option>
                    </select>
                  </Field>
                  <Field label="Texto do botão de comprar">
                    <input value={theme.product.buy_label} onChange={(e) => patch('product', { ...theme.product, buy_label: e.target.value })} />
                  </Field>
                  <fieldset className="stack tight">
                    <legend className="field-label">Blocos da página do produto</legend>
                    {theme.product.blocks.map((b, i) => (
                      <div key={b.id} className="sec-item">
                        <label className="check grow">
                          <input type="checkbox" checked={b.enabled} onChange={(e) => patch('product', { ...theme.product, blocks: theme.product.blocks.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} />
                          {{ stock: 'Estoque restante', shipping: 'Cálculo de entrega', share: 'Compartilhar', related: 'Produtos relacionados', reviews: 'Avaliações' }[b.id]}
                        </label>
                      </div>
                    ))}
                  </fieldset>
                </Locked>
              </Group>
              <Group title="Rodapé">
                <Locked feature="footer">
                  <Field label="Texto do rodapé"><textarea rows={2} value={theme.footer.text} onChange={(e) => patch('footer', { ...theme.footer, text: e.target.value })} /></Field>
                  <Toggle checked={theme.footer.show_payments} onChange={(v) => patch('footer', { ...theme.footer, show_payments: v })} label="Mostrar formas de pagamento" />
                  {data &&
                    theme.footer.columns.map((c, i) => (
                      <div key={i} className="item-box">
                        <div className="row">
                          <input className="grow" style={{ width: 'auto' }} value={c.title} aria-label="Título da coluna" onChange={(e) => patch('footer', { ...theme.footer, columns: theme.footer.columns.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                          <button className="icon-btn" onClick={() => patch('footer', { ...theme.footer, columns: theme.footer.columns.filter((_, j) => j !== i) })} aria-label="Remover coluna">✕</button>
                        </div>
                        <MenuEditor menu={c.links} onChange={(links) => patch('footer', { ...theme.footer, columns: theme.footer.columns.map((x, j) => (j === i ? { ...x, links } : x)) })} lists={data} />
                      </div>
                    ))}
                  {theme.footer.columns.length < 3 && <button className="link small" style={{ justifySelf: 'start' }} onClick={() => patch('footer', { ...theme.footer, columns: [...theme.footer.columns, { title: 'Links', links: [] }] })}>+ Coluna de links</button>}
                  <p className="hint">Os dados legais, as políticas e o contato aparecem sempre.</p>
                </Locked>
              </Group>
              <Group title="Animações">
                <Locked feature="animations">
                  <Field label="Intensidade geral">
                    <select value={theme.animations.intensity} onChange={(e) => patch('animations', { ...theme.animations, intensity: e.target.value as 'soft' })}>
                      <option value="off">Desligadas</option>
                      <option value="soft">Suaves</option>
                      <option value="normal">Normais</option>
                    </select>
                  </Field>
                  {theme.animations.intensity !== 'off' && (
                    <>
                      <Field label="Entrada das seções ao rolar">
                        <select value={theme.animations.sections} onChange={(e) => patch('animations', { ...theme.animations, sections: e.target.value as 'fade' })}>
                          <option value="none">Nenhuma</option>
                          <option value="fade">Surgir</option>
                          <option value="slide-up">Deslizar de baixo</option>
                          <option value="slide-side">Deslizar do lado</option>
                          <option value="zoom">Ampliar</option>
                        </select>
                      </Field>
                      <Field label="Foto do produto ao passar o dedo ou o mouse">
                        <select value={theme.animations.product_hover} onChange={(e) => patch('animations', { ...theme.animations, product_hover: e.target.value as 'zoom' })}>
                          <option value="none">Nenhuma</option>
                          <option value="zoom">Ampliar</option>
                          <option value="swap">Trocar pela segunda foto</option>
                          <option value="shadow">Sombra</option>
                        </select>
                      </Field>
                      <div className="grid2">
                        <Field label="Carrossel">
                          <select value={theme.animations.carousel} onChange={(e) => patch('animations', { ...theme.animations, carousel: e.target.value as 'slide' })}>
                            <option value="slide">Deslizar</option>
                            <option value="fade">Esmaecer</option>
                          </select>
                        </Field>
                        <Field label="Troca a cada (s)">
                          <input type="number" min={2} max={20} value={theme.animations.carousel_seconds} onChange={(e) => patch('animations', { ...theme.animations, carousel_seconds: +e.target.value })} />
                        </Field>
                      </div>
                      <Field label="Botão de comprar">
                        <select value={theme.animations.buy_button} onChange={(e) => patch('animations', { ...theme.animations, buy_button: e.target.value as 'none' })}>
                          <option value="none">Nenhuma</option>
                          <option value="pulse">Pulsar de leve</option>
                          <option value="shine">Brilho ao passar</option>
                        </select>
                      </Field>
                      <Field label="Cabeçalho ao rolar">
                        <select value={theme.animations.header} onChange={(e) => patch('animations', { ...theme.animations, header: e.target.value as 'none' })}>
                          <option value="none">Nenhuma</option>
                          <option value="shrink">Encolher</option>
                          <option value="hide">Esconder ao descer, voltar ao subir</option>
                        </select>
                      </Field>
                      <Field label="Barra de aviso">
                        <select value={theme.animations.announcement} onChange={(e) => patch('animations', { ...theme.animations, announcement: e.target.value as 'static' })}>
                          <option value="static">Parada</option>
                          <option value="rotate">Trocando as frases</option>
                          <option value="marquee">Texto correndo</option>
                        </select>
                      </Field>
                      <Field label="Troca de página">
                        <select value={theme.animations.page} onChange={(e) => patch('animations', { ...theme.animations, page: e.target.value as 'none' })}>
                          <option value="none">Nenhuma</option>
                          <option value="fade">Esmaecer</option>
                        </select>
                      </Field>
                      <Toggle checked={theme.animations.cart_bounce} onChange={(v) => patch('animations', { ...theme.animations, cart_bounce: v })} label="Número do carrinho salta ao adicionar" />
                    </>
                  )}
                  <p className="hint">Quem configurou o aparelho para reduzir movimento vê a loja sem animações.</p>
                </Locked>
              </Group>
              <Group title="Outros">
                <Toggle checked={theme.whatsapp_button} onChange={(v) => patch('whatsapp_button', v)} label="Botão flutuante do WhatsApp" />
                <Locked feature="hide_branding">
                  <Toggle checked={theme.hide_branding} onChange={(v) => patch('hide_branding', v)} label="Remover a marca da plataforma do rodapé" />
                </Locked>
              </Group>
            </>
          )}
        </aside>
        <div className="editor-stage">
          {!previewData ? (
            <Loading />
          ) : (
            <div className={`preview-frame ${device}`}>
              <Preview data={previewData} theme={theme} />
            </div>
          )}
        </div>
      </div>
      {adding && (
        <Modal title="Adicionar seção" onClose={() => setAdding(false)} wide>
          <div className="swatches">
            {(Object.keys(SECTION_INFO) as SectionType[]).map((t) => {
              const ok = planAtLeast(store.plan, SECTION_INFO[t].plan)
              return (
                <button
                  key={t}
                  className="swatch"
                  disabled={!ok}
                  onClick={() => {
                    const s = newSection(t)
                    update({ ...theme, sections: [...theme.sections, s] })
                    setAdding(false)
                    setEditing(s.id)
                  }}
                >
                  <b>{SECTION_INFO[t].name}</b>
                  <span className="hint">{SECTION_INFO[t].help}</span>
                  {!ok && <span className="badge plan">Plano {planName(SECTION_INFO[t].plan)}</span>}
                </button>
              )
            })}
          </div>
        </Modal>
      )}
      {history && (
        <Modal title="Versões publicadas" onClose={() => setHistory(false)}>
          {!store.theme_history.length ? (
            <p className="muted">Quando você publicar, as versões anteriores ficam guardadas aqui (as 5 últimas).</p>
          ) : (
            <div className="list">
              {store.theme_history.map((h, i) => (
                <div key={i} className="list-row">
                  <span className="grow">Versão de {fmtDateTime(h.at)}</span>
                  <button className="btn ghost small" onClick={() => { update(h.theme); setHistory(false); toast('Versão carregada na prévia. Publique para voltar a ela.') }}>Usar esta</button>
                </div>
              ))}
            </div>
          )}
          <button className="link" style={{ justifySelf: 'start' }} onClick={() => { update(store.theme); setHistory(false) }}>Descartar rascunho e voltar ao que está no ar</button>
        </Modal>
      )}
    </div>
  )
}

function Preview({ data, theme }: { data: import('../store/context').StoreData; theme: Theme }) {
  const ctx = useStoreCtx(data, theme, true)
  const first = theme.sections.find((s) => s.enabled)
  return (
    <Ctx.Provider value={ctx}>
      <StoreShell overBanner={first?.type === 'banner' || first?.type === 'carousel'} cartOpen={ctx.cartOpen} setCartOpen={ctx.setCartOpen}>
        <HomePage />
      </StoreShell>
    </Ctx.Provider>
  )
}

function luminance(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0)
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

function ContrastWarning({ theme }: { theme: Theme }) {
  const c = theme.colors
  const problems = [
    contrast(c.text, c.background) < 4.5 && 'o texto sobre o fundo',
    contrast(c.text, c.surface) < 4.5 && 'o texto sobre os cartões',
    contrast(c.muted, c.background) < 3 && 'o texto secundário',
  ].filter(Boolean)
  return problems.length ? <p className="alert warn small">Pode ficar difícil de ler {problems.join(', ')}. Escolha cores com mais diferença entre si.</p> : null
}
