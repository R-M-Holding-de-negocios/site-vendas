import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../data'

export default function Login() {
  const [params] = useSearchParams()
  const [novo, setNovo] = useState(params.has('novo'))
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      if (novo) {
        if (!(await api.signUp(email, senha))) {
          setMsg('Conta criada! Confirme pelo link que enviamos para o seu e-mail e depois entre.')
          setNovo(false)
          return
        }
      } else await api.signIn(email, senha)
      nav('/painel')
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="wrap narrow">
      <Link to="/" className="brand">
        Vitrine
      </Link>
      <h1>{novo ? 'Criar conta' : 'Entrar'}</h1>
      <form onSubmit={submit} className="card form">
        <label>
          E-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Senha
          <input
            type="password"
            required
            minLength={6}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete={novo ? 'new-password' : 'current-password'}
          />
        </label>
        {msg && <p className="msg">{msg}</p>}
        <button className="btn" disabled={busy}>
          {novo ? 'Criar conta' : 'Entrar'}
        </button>
      </form>
      <button className="link" onClick={() => setNovo(!novo)}>
        {novo ? 'Já tenho conta' : 'Ainda não tenho conta'}
      </button>
    </main>
  )
}
