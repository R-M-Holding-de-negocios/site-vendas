import { createClient } from '@supabase/supabase-js'

export type Store = { id: string; slug: string; name: string; whatsapp: string; description: string }
export type StoreInput = Omit<Store, 'id'> & { id?: string }
export type Product = {
  id: string
  store_id: string
  name: string
  price_cents: number
  description: string
  image_url: string
  available: boolean
}
export type ProductInput = Omit<Product, 'id'> & { id?: string }
export type User = { id: string; email: string }

interface Api {
  user(): Promise<User | null>
  /** Retorna false quando a conta foi criada mas falta confirmar o e-mail. */
  signUp(email: string, password: string): Promise<boolean>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  myStore(): Promise<Store | null>
  saveStore(s: StoreInput): Promise<Store>
  storeBySlug(slug: string): Promise<Store | null>
  products(storeId: string): Promise<Product[]>
  saveProduct(p: ProductInput): Promise<void>
  deleteProduct(id: string): Promise<void>
  uploadImage(jpeg: Blob): Promise<string>
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Sem Supabase configurado, tudo fica salvo só neste navegador (para testar). */
export const demo = !url || !key

const SLUG_TAKEN = 'Esse endereço já está em uso. Escolha outro.'

function supabaseApi(): Api {
  const sb = createClient(url!, key!)
  const STORE = 'id, slug, name, whatsapp, description'
  const ok = <T>(r: { data: T; error: { message: string; code?: string } | null }): T => {
    if (r.error) throw new Error(r.error.code === '23505' ? SLUG_TAKEN : r.error.message)
    return r.data
  }
  const user = async () => {
    const u = (await sb.auth.getSession()).data.session?.user
    return u ? { id: u.id, email: u.email ?? '' } : null
  }
  return {
    user,
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password })
      if (error) throw new Error(error.message)
      return !!data.session
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new Error('E-mail ou senha incorretos.')
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async myStore() {
      const u = await user()
      if (!u) return null
      return ok(await sb.from('stores').select(STORE).eq('owner_id', u.id).maybeSingle())
    },
    async saveStore({ id, ...fields }) {
      const q = id ? sb.from('stores').update(fields).eq('id', id) : sb.from('stores').insert(fields)
      return ok(await q.select(STORE).single()) as Store
    },
    async storeBySlug(slug) {
      return ok(await sb.from('stores').select(STORE).eq('slug', slug).eq('active', true).maybeSingle())
    },
    async products(storeId) {
      return ok(await sb.from('products').select('*').eq('store_id', storeId).order('created_at')) ?? []
    },
    async saveProduct({ id, ...fields }) {
      ok(await (id ? sb.from('products').update(fields).eq('id', id) : sb.from('products').insert(fields)))
    },
    async deleteProduct(id) {
      ok(await sb.from('products').delete().eq('id', id))
    },
    async uploadImage(jpeg) {
      const u = await user()
      const path = `${u!.id}/${crypto.randomUUID()}.jpg`
      ok(await sb.storage.from('produtos').upload(path, jpeg, { contentType: 'image/jpeg' }))
      return sb.storage.from('produtos').getPublicUrl(path).data.publicUrl
    },
  }
}

function demoApi(): Api {
  const read = <T>(k: string, fallback: T): T => JSON.parse(localStorage.getItem(k) ?? 'null') ?? fallback
  const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
  type Row = Store & { owner: string }
  const stores = () => read<Row[]>('demo_stores', [])
  const prods = () => read<Product[]>('demo_products', [])
  const strip = ({ owner: _, ...s }: Row): Store => s
  const user = async () => read<User | null>('demo_user', null)
  const login = async (email: string) => write('demo_user', { id: email, email })
  return {
    user,
    async signUp(email) {
      await login(email)
      return true
    },
    signIn: login,
    async signOut() {
      localStorage.removeItem('demo_user')
    },
    async myStore() {
      const u = await user()
      const s = stores().find((s) => s.owner === u?.id)
      return s ? strip(s) : null
    },
    async saveStore(input) {
      const u = await user()
      const all = stores()
      if (all.some((s) => s.slug === input.slug && s.id !== input.id)) throw new Error(SLUG_TAKEN)
      const row: Row = { ...input, id: input.id ?? crypto.randomUUID(), owner: u!.id }
      write('demo_stores', [...all.filter((s) => s.id !== row.id), row])
      return strip(row)
    },
    async storeBySlug(slug) {
      const s = stores().find((s) => s.slug === slug)
      return s ? strip(s) : null
    },
    async products(storeId) {
      return prods().filter((p) => p.store_id === storeId)
    },
    async saveProduct(p) {
      const all = prods()
      const row = { ...p, id: p.id ?? crypto.randomUUID() }
      const i = all.findIndex((x) => x.id === row.id)
      if (i >= 0) all[i] = row
      else all.push(row)
      write('demo_products', all)
    },
    async deleteProduct(id) {
      write('demo_products', prods().filter((p) => p.id !== id))
    },
    uploadImage: (jpeg) =>
      new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.readAsDataURL(jpeg)
      }),
  }
}

export const api: Api = demo ? demoApi() : supabaseApi()

/** Reduz a foto para no máx. 800px em JPEG — é o que mantém o custo de armazenamento baixo. */
export async function shrinkImage(file: File): Promise<Blob> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, 800 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível ler a imagem.'))), 'image/jpeg', 0.8),
  )
}

export const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
