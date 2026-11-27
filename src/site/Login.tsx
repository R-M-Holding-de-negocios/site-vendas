import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { db, PLATFORM_NAME } from '../lib/api'
import { Field } from '../ui/kit'

export default function Login() {
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'in' | 'up' | 'reset' | 'new'>(params.has('nova-senha') ? 'new' : params.has('novo') ? 'up' : 'in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      if (mode === 'new') {
        await db.auth.updatePassword(password)
        nav('/painel')
        return
      }
      if (mode === 'reset') {
        await db.auth.resetPassword(email)
        setMsg('Enviamos um link para redefinir a senha no seu e-mail.')
        return
      }
      if (mode === 'up') {
        if (!(await db.auth.signUp(email, password))) {
          setMsg('Conta criada! Confirme pelo link que enviamos para o seu e-mail e depois entre.')
          setMode('in')
          return
        }
      } else await db.auth.signIn(email, password)
      nav(params.get('voltar') ?? '/painel')
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'up' ? 'Criar sua conta' : mode === 'reset' ? 'Recuperar senha' : mode === 'new' ? 'Nova senha' : 'Entrar'
  return (
    <main className="auth">
      <Link to="/" className="brand">
        {PLATFORM_NAME}
      </Link>
      <h1>{title}</h1>
      {db.demo && (
        <div className="alert">
          <span>
            Demonstração: entre com <b>demo@exemplo.com</b> e senha <b>123456</b> para ver uma loja pronta, ou <b>admin@exemplo.com</b> para o painel do admin.
          </span>
        </div>
      )}
      <form onSubmit={submit} className="card stack">
        {mode !== 'new' && (
          <Field label="E-mail">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
        )}
        {mode !== 'reset' && (
          <Field label={mode === 'new' ? 'Nova senha' : 'Senha'} hint={mode === 'up' || mode === 'new' ? 'Pelo menos 6 caracteres.' : undefined}>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'up' || mode === 'new' ? 'new-password' : 'current-password'} />
          </Field>
        )}
        {msg && (
          <p className="alert" role="status">
            {msg}
          </p>
        )}
        <button className="btn full" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'up' ? 'Criar conta' : mode === 'reset' ? 'Enviar link' : mode === 'new' ? 'Salvar nova senha' : 'Entrar'}
        </button>
      </form>
      <div className="row between">
        <button className="link" onClick={() => setMode(mode === 'up' ? 'in' : 'up')}>
          {mode === 'up' ? 'Já tenho conta' : 'Ainda não tenho conta'}
        </button>
        {mode === 'in' && (
          <button className="link" onClick={() => setMode('reset')}>
            Esqueci a senha
          </button>
        )}
      </div>
    </main>
  )
}
