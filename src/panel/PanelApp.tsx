import { createContext, lazy, useContext, useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { db, myStore, normalizeStore, PLATFORM_NAME, storeUrl } from '../lib/api'
import { validSlug } from '../lib/demo-rpc'
import { can } from '../lib/plans'
import { SEGMENTS, starterTheme } from '../lib/starter'
import { defaultSettings } from '../lib/theme'
import type { Store } from '../lib/types'
import { slugify } from '../lib/util'
import { ErrorBox, Field, Loading, toast } from '../ui/kit'
import '../styles/panel.css'
import { BillingNotice } from './BillingNotice'

const Home = lazy(() => import('./Home'))
const Products = lazy(() => import('./Products'))
const ProductForm = lazy(() => import('./ProductForm'))
const Categories = lazy(() => import('./Categories'))
const Orders = lazy(() => import('./Orders'))
const OrderDetail = lazy(() => import('./OrderDetail'))
const ManualOrder = lazy(() => import('./ManualOrder'))
const Customers = lazy(() => import('./Customers'))
const Marketing = lazy(() => import('./Marketing'))
const Contents = lazy(() => import('./Contents'))
const ContentEditor = lazy(() => import('./ContentEditor'))
const Appearance = lazy(() => import('./Appearance'))
const Integrations = lazy(() => import('./Integrations'))
const Settings = lazy(() => import('./Settings'))
const Billing = lazy(() => import('./Billing'))
const ReportsHome = lazy(() => import('./reports').then((m) => ({ default: m.ReportsHome })))
const ReportView = lazy(() => import('./reports').then((m) => ({ default: m.ReportView })))

interface PanelCtx {
  store: Store
  setStore: (s: Store) => void
  /** Salva campos da loja e atualiza a tela. */
  saveStore: (patch: Partial<Store>) => Promise<Store>
  /** Admin vendo o painel de outra pessoa. */
  asAdmin: boolean
}
const Ctx = createContext<PanelCtx | null>(null)
export const usePanel = () => useContext(Ctx)!

const NAV: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: '/painel', label: 'Início', icon: '⌂', end: true },
  { to: '/painel/pedidos', label: 'Pedidos', icon: '🧾' },
  { to: '/painel/produtos', label: 'Produtos', icon: '📦' },
  { to: '/painel/categorias', label: 'Categorias', icon: '🗂' },
  { to: '/painel/clientes', label: 'Clientes', icon: '👥' },
  { to: '/painel/divulgacao', label: 'Divulgação', icon: '📣' },
  { to: '/painel/conteudo', label: 'Páginas e posts', icon: '📝' },
  { to: '/painel/aparencia', label: 'Aparência', icon: '🎨' },
  { to: '/painel/relatorios', label: 'Relatórios', icon: '📊' },
  { to: '/painel/integracoes', label: 'Integrações', icon: '🔌' },
  { to: '/painel/configuracoes', label: 'Configurações', icon: '⚙' },
  { to: '/painel/plano', label: 'Plano', icon: '★' },
]

function beep() {
  try {
    const ac = new AudioContext()
    for (const [i, f] of [880, 1320].entries()) {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.15, ac.currentTime + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.18 + 0.16)
      o.connect(g).connect(ac.destination)
      o.start(ac.currentTime + i * 0.18)
      o.stop(ac.currentTime + i * 0.18 + 0.18)
    }
  } catch {
    /* sem áudio */
  }
}

/** Confere pedidos novos a cada 25 segundos e avisa com som. */
function useNewOrders(store: Store | null) {
  const [pending, setPending] = useState(0)
  const since = useRef(new Date().toISOString())
  useEffect(() => {
    if (!store || !can(store, 'saved_orders')) return
    let alive = true
    const check = async () => {
      const open = await db.list('orders', { eq: { store_id: store.id }, in: ['status', ['pending', 'paid']] }).catch(() => [])
      if (!alive) return
      setPending(open.length)
      const fresh = open.filter((o) => o.created_at > since.current)
      if (fresh.length) {
        since.current = fresh.map((o) => o.created_at).sort().at(-1)!
        toast(fresh.length === 1 ? `Pedido novo: #${fresh[0].number}` : `${fresh.length} pedidos novos`)
        if (store.settings.notifications.sound) beep()
        document.title = `(${open.length}) Pedidos | ${PLATFORM_NAME}`
      }
    }
    check()
    const t = setInterval(check, 25000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [store])
  return pending
}

function Onboarding({ onCreated }: { onCreated: (s: Store) => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [touched, setTouched] = useState(false)
  const [whatsapp, setWhatsapp] = useState('')
  const [segment, setSegment] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (!validSlug(slug)) return setErr('Escolha outro endereço: use de 3 a 40 letras, números ou hífens.')
    if (whatsapp.replace(/\D/g, '').length < 10) return setErr('Informe o WhatsApp com DDD.')
    setBusy(true)
    try {
      onCreated(normalizeStore(await db.rpc('create_store', { name, slug, whatsapp, settings: defaultSettings(), theme: starterTheme(segment) })))
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <main className="auth">
      <span className="brand">{PLATFORM_NAME}</span>
      <h1>Vamos criar sua loja</h1>
      <p className="muted">Leva menos de um minuto. Você pode mudar tudo depois.</p>
      <form className="card stack" onSubmit={submit}>
        <Field label="Nome da loja">
          <input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (!touched) setSlug(slugify(e.target.value))
            }}
          />
        </Field>
        <Field label="Endereço da loja" hint="É o link que você vai divulgar.">
          <span className="prefix">
            {storeUrl('').replace(/^https?:\/\//, '')}
            <input
              required
              value={slug}
              onChange={(e) => {
                setSlug(slugify(e.target.value))
                setTouched(true)
              }}
            />
          </span>
        </Field>
        <div className="stack tight" role="group" aria-label="O que você vende?">
          <span className="field-label">O que você vende?</span>
          <div className="chips">
            {SEGMENTS.map((s) => (
              <button key={s.id} type="button" className={`chip ${segment === s.id ? 'on' : ''}`} aria-pressed={segment === s.id} onClick={() => setSegment(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <span className="muted small">A loja já começa com cores e textos que combinam. Dá para mudar tudo depois.</span>
        </div>
        <Field label="WhatsApp que recebe os pedidos">
          <input required type="tel" inputMode="tel" placeholder="(11) 99999-9999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </Field>
        {err && <ErrorBox message={err} />}
        <button className="btn full" disabled={busy}>
          {busy ? 'Criando…' : 'Criar minha loja'}
        </button>
      </form>
    </main>
  )
}

function Nav({ pending, onNavigate }: { pending: number; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate}>
          <span aria-hidden style={{ width: 20, textAlign: 'center' }}>
            {n.icon}
          </span>
          {n.label}
          {n.to === '/painel/pedidos' && pending > 0 && (
            <span className="nav-count" aria-label={`${pending} pedidos abertos`}>
              {pending}
            </span>
          )}
        </NavLink>
      ))}
    </>
  )
}

export default function PanelApp() {
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const [state, setState] = useState<{ loading: boolean; store: Store | null; error: string; asAdmin: boolean }>({ loading: true, store: null, error: '', asAdmin: false })
  const [menu, setMenu] = useState(false)
  const asStore = params.get('loja')

  useEffect(() => {
    ;(async () => {
      const u = await db.auth.user()
      if (!u) return nav(`/entrar?voltar=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true })
      try {
        if (asStore) {
          if (!(await db.rpc('is_admin', {}))) throw new Error('Acesso restrito ao admin.')
          const s = await db.get('stores', asStore)
          if (!s) throw new Error('Loja não encontrada.')
          sessionStorage.setItem('vt_as_store', asStore)
          return setState({ loading: false, store: normalizeStore(s), error: '', asAdmin: true })
        }
        const viewing = sessionStorage.getItem('vt_as_store')
        if (viewing && (await db.rpc('is_admin', {}).catch(() => false))) {
          const s = await db.get('stores', viewing)
          if (s) return setState({ loading: false, store: normalizeStore(s), error: '', asAdmin: true })
        }
        setState({ loading: false, store: await myStore(), error: '', asAdmin: false })
      } catch (e) {
        setState({ loading: false, store: null, error: (e as Error).message, asAdmin: false })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asStore])
  const pending = useNewOrders(state.store)
  useEffect(() => setMenu(false), [loc.pathname])

  if (state.loading) return <div className="main"><Loading /></div>
  if (state.error) return <div className="main"><ErrorBox message={state.error} /></div>
  if (!state.store) return <Onboarding onCreated={(s) => setState({ ...state, store: s })} />

  const store = state.store
  const ctx: PanelCtx = {
    store,
    asAdmin: state.asAdmin,
    setStore: (s) => setState((st) => ({ ...st, store: normalizeStore(s) })),
    saveStore: async (patch) => {
      const s = normalizeStore(await db.update('stores', store.id, patch))
      setState((st) => ({ ...st, store: s }))
      return s
    },
  }
  const exitAdmin = () => {
    sessionStorage.removeItem('vt_as_store')
    location.href = '/admin'
  }
  const signOut = () => db.auth.signOut().then(() => nav('/'))
  const fullscreen = loc.pathname.startsWith('/painel/aparencia')

  return (
    <Ctx.Provider value={ctx}>
      {state.asAdmin && (
        <div className="alert warn no-print" style={{ borderRadius: 0, justifyContent: 'center' }}>
          Você está vendo o painel da loja <b>{store.name}</b> como admin.
          <button className="link" onClick={exitAdmin}>
            Voltar ao admin
          </button>
        </div>
      )}
      {fullscreen ? (
        <Routes>
          <Route path="aparencia" element={<Appearance />} />
        </Routes>
      ) : (
        <div className="shell">
          <aside className="side" aria-label="Menu do painel">
            <span className="brand">{PLATFORM_NAME}</span>
            <Nav pending={pending} />
            <div className="side-foot">
              <a href={storeUrl(store.slug)} target="_blank" rel="noreferrer" className="btn ghost small">
                Ver minha loja ↗
              </a>
              <button className="link" onClick={signOut} style={{ justifySelf: 'start' }}>
                Sair
              </button>
            </div>
          </aside>
          <div>
            <div className="topbar mobile-only">
              <span className="brand">{PLATFORM_NAME}</span>
              <div className="row">
                <a href={storeUrl(store.slug)} target="_blank" rel="noreferrer" className="btn ghost small">
                  Ver loja
                </a>
                <button className="btn ghost small" onClick={() => setMenu(true)} aria-expanded={menu}>
                  Menu{pending > 0 ? ` (${pending})` : ''}
                </button>
              </div>
            </div>
            {menu && (
              <>
                <div className="scrim" onClick={() => setMenu(false)} />
                <nav className="mobile-nav" aria-label="Menu do painel">
                  <Nav pending={pending} onNavigate={() => setMenu(false)} />
                  <button className="link" onClick={signOut} style={{ justifySelf: 'start', marginTop: 12 }}>
                    Sair
                  </button>
                </nav>
              </>
            )}
            <main className="main">
              <BillingNotice store={store} asAdmin={!!state.asAdmin} />
              <Routes>
                <Route index element={<Home />} />
                <Route path="produtos" element={<Products />} />
                <Route path="produtos/:id" element={<ProductForm />} />
                <Route path="categorias" element={<Categories />} />
                <Route path="pedidos" element={<Orders />} />
                <Route path="pedidos/novo" element={<ManualOrder />} />
                <Route path="pedidos/:id" element={<OrderDetail />} />
                <Route path="clientes/*" element={<Customers />} />
                <Route path="divulgacao" element={<Marketing />} />
                <Route path="conteudo" element={<Contents />} />
                <Route path="conteudo/:id" element={<ContentEditor />} />
                <Route path="relatorios" element={<ReportsHome store={store} />} />
                <Route path="relatorios/:id" element={<ReportView store={store} />} />
                <Route path="integracoes" element={<Integrations />} />
                <Route path="configuracoes" element={<Settings />} />
                <Route path="plano" element={<Billing />} />
                <Route path="*" element={<Navigate to="/painel" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
