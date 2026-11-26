import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db, storeUrl } from '../lib/api'
import { renderMarkdown } from '../lib/markdown'
import { can } from '../lib/plans'
import type { Content, Product } from '../lib/types'
import { slugify } from '../lib/util'
import { ErrorBox, Field, ImagePicker, Loading, PageHead, toast, Toggle } from '../ui/kit'
import { usePanel } from './PanelApp'

type Draft = Omit<Content, 'id' | 'created_at'> & { id?: string }

function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  const wrap = (before: string, after = before, placeholder = 'texto') => {
    const t = ref.current!
    const sel = value.slice(t.selectionStart, t.selectionEnd) || placeholder
    const next = value.slice(0, t.selectionStart) + before + sel + after + value.slice(t.selectionEnd)
    onChange(next)
    requestAnimationFrame(() => t.focus())
  }
  const line = (prefix: string) => {
    const t = ref.current!
    const start = value.lastIndexOf('\n', t.selectionStart - 1) + 1
    onChange(value.slice(0, start) + prefix + value.slice(start))
  }
  return (
    <div className="stack tight">
      <div className="md-toolbar" role="toolbar" aria-label="Formatação">
        <button type="button" onClick={() => line('## ')}>Título</button>
        <button type="button" onClick={() => wrap('**')}><b>N</b></button>
        <button type="button" onClick={() => wrap('_')}><i>I</i></button>
        <button type="button" onClick={() => line('- ')}>• Lista</button>
        <button type="button" onClick={() => line('1. ')}>1. Lista</button>
        <button type="button" onClick={() => { const url = prompt('Endereço do link (https://...)'); if (url) wrap('[', `](${url})`, 'texto do link') }}>Link</button>
        <button type="button" onClick={() => { const url = prompt('Endereço da imagem (https://...)'); if (url) wrap('![', `](${url})`, 'descrição') }}>Imagem</button>
        <button type="button" onClick={() => setPreview(!preview)} aria-pressed={preview}>{preview ? 'Editar' : 'Ver como fica'}</button>
      </div>
      {preview ? (
        <div className="card" style={{ minHeight: 240 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
      ) : (
        <textarea ref={ref} rows={14} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Texto" />
      )}
    </div>
  )
}

export default function ContentEditor() {
  const { id = '' } = useParams()
  const { store } = usePanel()
  const nav = useNavigate()
  const fresh = id === 'nova-pagina' || id === 'novo-post'
  const [c, setC] = useState<Draft | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [err, setErr] = useState('')
  const [slugTouched, setSlugTouched] = useState(!fresh)

  useEffect(() => {
    db.list('products', { eq: { store_id: store.id } }).then(setProducts)
    if (fresh)
      setC({ store_id: store.id, kind: id === 'novo-post' ? 'post' : 'page', slug: '', title: '', body: '', cover_url: '', product_ids: [], show_in_menu: id === 'nova-pagina', position: 0, status: 'published', publish_at: new Date().toISOString(), seo: { title: '', description: '' } })
    else db.get('contents', id).then((x) => (x ? setC(x) : setErr('Conteúdo não encontrado.')))
  }, [id, fresh, store.id])

  if (err && !c) return <ErrorBox message={err} />
  if (!c) return <Loading />
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setC({ ...c, [k]: v })
  const isPost = c.kind === 'post'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    const slug = slugify(c!.slug || c!.title, 60)
    if (!c!.title.trim() || !slug) return setErr('Informe o título.')
    const others = await db.list('contents', { eq: { store_id: store.id, kind: c!.kind, slug } })
    if (others.some((o) => o.id !== c!.id)) return setErr('Já existe outro conteúdo com esse endereço.')
    const { id: cid, ...fields } = { ...c!, slug }
    try {
      if (cid) await db.update('contents', cid, fields)
      else await db.insert('contents', fields)
      toast('Salvo')
      nav('/painel/conteudo')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <PageHead
        back="/painel/conteudo"
        title={fresh ? (isPost ? 'Novo post' : 'Nova página') : c.title}
        actions={c.id && <a className="btn ghost small" target="_blank" rel="noreferrer" href={storeUrl(store.slug, isPost ? `/blog/${c.slug}` : `/pagina/${c.slug}`)}>Ver na loja ↗</a>}
      />
      <div className="split">
        <section className="card form-section">
          <Field label="Título">
            <input required value={c.title} onChange={(e) => setC({ ...c, title: e.target.value, slug: slugTouched ? c.slug : slugify(e.target.value, 60) })} />
          </Field>
          <Field label="Endereço" hint={storeUrl(store.slug, `${isPost ? '/blog' : '/pagina'}/${c.slug || '...'}`).replace(/^https?:\/\//, '')}>
            <input value={c.slug} onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value, 60)) }} />
          </Field>
          <MarkdownEditor value={c.body} onChange={(v) => set('body', v)} />
        </section>
        <div className="stack">
          <section className="card form-section">
            <Field label="Situação">
              <select value={c.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
                <option value="published">Publicado</option>
                <option value="draft">Rascunho</option>
              </select>
            </Field>
            {isPost && (
              <Field label="Data de publicação" hint="Uma data futura agenda o post.">
                <input type="datetime-local" value={new Date(new Date(c.publish_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => e.target.value && set('publish_at', new Date(e.target.value).toISOString())} />
              </Field>
            )}
            {!isPost && <Toggle checked={c.show_in_menu} onChange={(v) => set('show_in_menu', v)} label="Mostrar no menu da loja" />}
          </section>
          {isPost && (
            <section className="card form-section">
              <ImagePicker storeId={store.id} value={c.cover_url ? [c.cover_url] : []} onChange={(v) => set('cover_url', v[0] ?? '')} label="Imagem de capa" />
              <fieldset>
                <legend className="field-label">Produtos do post</legend>
                <span className="hint">Aparecem no fim do post com botão de comprar.</span>
                <div className="chips" style={{ marginTop: 8 }}>
                  {products.map((p) => (
                    <button type="button" key={p.id} className={`chip ${c.product_ids.includes(p.id) ? 'on' : ''}`} aria-pressed={c.product_ids.includes(p.id)} onClick={() => set('product_ids', c.product_ids.includes(p.id) ? c.product_ids.filter((x) => x !== p.id) : [...c.product_ids, p.id])}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            </section>
          )}
          {can(store, 'seo') && (
            <section className="card form-section">
              <h2>Google</h2>
              <Field label="Título"><input value={c.seo.title} placeholder={c.title} onChange={(e) => set('seo', { ...c.seo, title: e.target.value })} /></Field>
              <Field label="Descrição"><textarea rows={3} maxLength={170} value={c.seo.description} onChange={(e) => set('seo', { ...c.seo, description: e.target.value })} /></Field>
            </section>
          )}
        </div>
      </div>
      {err && <ErrorBox message={err} />}
      <div className="form-actions">
        {c.id && <button type="button" className="btn danger" onClick={() => confirm('Excluir?') && db.remove('contents', c.id!).then(() => nav('/painel/conteudo'))}>Excluir</button>}
        <button className="btn">Salvar</button>
      </div>
    </form>
  )
}
