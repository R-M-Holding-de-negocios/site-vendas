import { useState } from 'react'
import { db } from '../lib/api'
import { can } from '../lib/plans'
import type { Category } from '../lib/types'
import { Empty, ErrorBox, Field, ImagePicker, Loading, Modal, PageHead, toast, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

export default function Categories() {
  const { store } = usePanel()
  const data = useAsync(
    () => Promise.all([db.list('categories', { eq: { store_id: store.id }, order: ['position', 'asc'] }), db.list('products', { eq: { store_id: store.id } })]),
    [store.id],
  )
  const [edit, setEdit] = useState<Partial<Category> | null>(null)
  const [err, setErr] = useState('')
  const cats = data.data?.[0] ?? []
  const products = data.data?.[1] ?? []

  async function save() {
    if (!edit?.name?.trim()) return setErr('Informe o nome.')
    const fields = { name: edit.name.trim(), image_url: edit.image_url ?? '', seo: edit.seo ?? { title: '', description: '' } }
    if (edit.id) await db.update('categories', edit.id, fields)
    else await db.insert('categories', { ...fields, store_id: store.id, position: cats.length })
    setEdit(null)
    toast('Categoria salva')
    data.reload()
  }
  async function remove(c: Category) {
    if (!confirm(`Excluir a categoria "${c.name}"? Os produtos continuam cadastrados.`)) return
    for (const p of products.filter((p) => p.category_ids.includes(c.id))) await db.update('products', p.id, { category_ids: p.category_ids.filter((x) => x !== c.id) })
    await db.remove('categories', c.id)
    data.reload()
  }
  async function move(i: number, dir: number) {
    const a = cats[i]
    const b = cats[i + dir]
    if (!b) return
    await Promise.all([db.update('categories', a.id, { position: i + dir }), db.update('categories', b.id, { position: i })])
    data.reload()
  }

  return (
    <div>
      <PageHead title="Categorias" sub="Organizam os produtos no menu e na página inicial." actions={<button className="btn" onClick={() => { setErr(''); setEdit({ name: '', image_url: '' }) }}>+ Nova categoria</button>} />
      {data.error && <ErrorBox message={data.error} />}
      {!data.data ? (
        <Loading />
      ) : !cats.length ? (
        <Empty title="Nenhuma categoria" text="Ex.: Brigadeiros, Bolos, Presentes." />
      ) : (
        <div className="list">
          {cats.map((c, i) => (
            <div key={c.id} className="list-row">
              {c.image_url ? <img className="pic" src={c.image_url} alt="" /> : <div className="pic" />}
              <div className="grow">
                <b className="block">{c.name}</b>
                <span className="small muted">{products.filter((p) => p.category_ids.includes(c.id)).length} produtos</span>
              </div>
              <button className="icon-btn" onClick={() => move(i, -1)} aria-label={`Mover ${c.name} para cima`}>↑</button>
              <button className="icon-btn" onClick={() => move(i, 1)} aria-label={`Mover ${c.name} para baixo`}>↓</button>
              <button className="link small" onClick={() => { setErr(''); setEdit(c) }}>Editar</button>
              <button className="link danger small" onClick={() => remove(c)}>Excluir</button>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Editar categoria' : 'Nova categoria'} onClose={() => setEdit(null)}>
          <Field label="Nome">
            <input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <ImagePicker storeId={store.id} value={edit.image_url ? [edit.image_url] : []} onChange={(v) => setEdit({ ...edit, image_url: v[0] ?? '' })} label="Imagem (aparece nos atalhos da página inicial)" />
          {can(store, 'seo') && (
            <>
              <Field label="Título no Google">
                <input value={edit.seo?.title ?? ''} onChange={(e) => setEdit({ ...edit, seo: { title: e.target.value, description: edit.seo?.description ?? '' } })} />
              </Field>
              <Field label="Descrição no Google">
                <textarea rows={2} value={edit.seo?.description ?? ''} onChange={(e) => setEdit({ ...edit, seo: { title: edit.seo?.title ?? '', description: e.target.value } })} />
              </Field>
            </>
          )}
          {err && <ErrorBox message={err} />}
          <div className="row end">
            <button className="btn" onClick={save}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
