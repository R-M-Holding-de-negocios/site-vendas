// Painel do dono da plataforma: lojas, mensalidades, avisos, planos e registro de ações.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { db } from '../lib/api'
import type { User } from '../lib/db'
import { CopyButton, ErrorBox, Field, Loading } from '../ui/kit'
import './admin.css'
import { AuditPage, AnnouncementsPage, PlansPage } from './Extras'
import { BillingPage } from './Billing'
import { HomePage } from './Home'
import { StoreDetailPage } from './StoreDetail'
import { StoresPage } from './Stores'

type Gate =
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'login' }
  | { step: 'denied'; user: User }
  | { step: 'mfa'; user: User; factorId: string | null }
  | { step: 'ok'; user: User }

async function check(): Promise<Gate> {
  const user = await db.auth.user()
  if (!user) return { step: 'login' }
  if (!(await db.rpc('is_admin', {}))) return { step: 'denied', user }
  const mfa = await db.auth.mfa.status()
  if (!mfa.verified) return { step: 'mfa', user, factorId: mfa.factorId }
  return { step: 'ok', user }
}

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>({ step: 'loading' })
  const recheck = useCallback(() => {
    setGate({ step: 'loading' })
    check().then(setGate, (e: Error) => setGate({ step: 'error', message: e.message }))
  }, [])
  useEffect(() => {
    document.title = 'Admin · Vitrine'
    recheck()
  }, [recheck])

  const signOut = async () => {
    await db.auth.signOut().catch(() => undefined)
    setGate({ step: 'login' })
  }

  switch (gate.step) {
    case 'loading':
      return (
        <div className="auth">
          <Loading label="Verificando acesso…" />
        </div>
      )
    case 'error':
      return (
        <div className="auth">
          <ErrorBox message={gate.message} onRetry={recheck} />
        </div>
      )
    case 'login':
      return <AdminLogin onDone={recheck} />
    case 'denied':
      return (
        <AuthBox title="Acesso restrito">
          <p>
            A conta <b>{gate.user.email}</b> não tem acesso ao painel do admin. Esta área é só para a equipe da plataforma.
          </p>
          <p className="muted">
            Se você tem uma loja, use o <Link to="/painel">painel da sua loja</Link>.
          </p>
          <button className="btn ghost" onClick={signOut}>
            Sair e entrar com outra conta
          </button>
        </AuthBox>
      )
    case 'mfa':
      return <MfaStep factorId={gate.factorId} onDone={recheck} onSignOut={signOut} />
    case 'ok':
      return <Shell email={gate.user.email} onSignOut={signOut} />
  }
}

function AuthBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <span className="brand">
        Vitrine <span className="admin-tag">admin</span>
      </span>
      <div className="card stack">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  )
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await db.auth.signIn(email.trim(), password)
      onDone()
    } catch (x) {
      setErr((x as Error).message)
      setBusy(false)
    }
  }
  return (
    <AuthBox title="Entrar no admin">
      <form className="stack" onSubmit={submit}>
        <Field label="E-mail">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Senha">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {err && (
          <div className="alert error" role="alert">
            {err}
          </div>
        )}
        <button className="btn full" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="muted small">
        É lojista? Entre pelo <Link to="/entrar">acesso das lojas</Link>.
      </p>
    </AuthBox>
  )
}

function MfaStep({ factorId, onDone, onSignOut }: { factorId: string | null; onDone: () => void; onSignOut: () => void }) {
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [enrollErr, setEnrollErr] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const started = useRef(false)

  const startEnroll = useCallback(() => {
    setEnrollErr('')
    db.auth.mfa.enroll().then(setEnroll, (e: Error) => setEnrollErr(e.message))
  }, [])
  useEffect(() => {
    if (!factorId && !started.current) {
      started.current = true
      startEnroll()
    }
  }, [factorId, startEnroll])

  const id = factorId ?? enroll?.factorId ?? null
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    setBusy(true)
    setErr('')
    try {
      await db.auth.mfa.verify(id, code)
      onDone()
    } catch (x) {
      setErr((x as Error).message || 'Código incorreto. Confira o aplicativo e tente de novo.')
      setBusy(false)
    }
  }

  const codeForm = (
    <form className="stack" onSubmit={submit}>
      <Field label="Código de 6 dígitos">
        <input
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          autoFocus
        />
      </Field>
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}
      <button className="btn full" disabled={busy || code.length !== 6 || !id}>
        {busy ? 'Conferindo…' : 'Confirmar'}
      </button>
    </form>
  )

  return (
    <AuthBox title="Verificação em duas etapas">
      {factorId ? (
        <p>Abra o aplicativo autenticador no seu celular e digite o código que aparece para a Vitrine.</p>
      ) : (
        <>
          <p>O painel do admin exige verificação em duas etapas. Configure uma vez e depois é só digitar o código ao entrar.</p>
          <ol className="mfa-steps">
            <li>Instale um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar).</li>
            <li>No aplicativo, leia o QR code abaixo ou digite a chave manualmente.</li>
            <li>Digite o código de 6 dígitos que aparecer.</li>
          </ol>
          {enrollErr ? (
            <ErrorBox message={enrollErr} onRetry={startEnroll} />
          ) : !enroll ? (
            <Loading label="Gerando QR code…" />
          ) : (
            <div className="mfa-qr">
              {enroll.qr && <img src={enroll.qr} width={180} height={180} alt="QR code para configurar o aplicativo autenticador" />}
              {enroll.secret && (
                <div className="stack tight">
                  <span className="field-label">Chave para digitar</span>
                  <code className="secret">{enroll.secret}</code>
                  <CopyButton text={enroll.secret} label="Copiar chave" />
                </div>
              )}
            </div>
          )}
        </>
      )}
      {codeForm}
      <button className="link" onClick={onSignOut}>
        Sair
      </button>
    </AuthBox>
  )
}

const NAV = [
  { to: '/admin', label: 'Números do negócio', end: true },
  { to: '/admin/lojas', label: 'Lojas' },
  { to: '/admin/mensalidades', label: 'Mensalidades' },
  { to: '/admin/avisos', label: 'Avisos' },
  { to: '/admin/planos', label: 'Planos' },
  { to: '/admin/registro', label: 'Registro de ações' },
]

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate}>
          {n.label}
        </NavLink>
      ))}
    </>
  )
}

function Shell({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const drawer = useRef<HTMLElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        menuBtn.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const brand = (
    <Link to="/admin" className="brand">
      Vitrine <span className="admin-tag">admin</span>
    </Link>
  )
  const foot = (
    <div className="side-foot">
      <span className="hint admin-email" title={email}>
        {email}
      </span>
      <button className="link admin-signout" onClick={onSignOut}>
        Sair
      </button>
    </div>
  )

  return (
    <div className="shell admin">
      <nav className="side" aria-label="Menu do admin">
        {brand}
        <NavItems />
        {foot}
      </nav>
      <div className="admin-col">
        <header className="topbar mobile-only">
          {brand}
          <button ref={menuBtn} className="btn ghost small" aria-expanded={open} aria-controls="admin-drawer" onClick={() => setOpen(true)}>
            Menu
          </button>
        </header>
        {open && (
          <>
            <div className="scrim" onClick={() => setOpen(false)} />
            <nav id="admin-drawer" ref={drawer} className="mobile-nav" aria-label="Menu do admin">
              <div className="row between">
                {brand}
                <button className="icon-btn" aria-label="Fechar menu" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>
              <NavItems onNavigate={() => setOpen(false)} />
              {foot}
            </nav>
          </>
        )}
        <main className="main">
          <Routes>
            <Route index element={<HomePage />} />
            <Route path="lojas" element={<StoresPage />} />
            <Route path="lojas/:id" element={<StoreDetailPage />} />
            <Route path="mensalidades" element={<BillingPage />} />
            <Route path="avisos" element={<AnnouncementsPage />} />
            <Route path="planos" element={<PlansPage />} />
            <Route path="registro" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
