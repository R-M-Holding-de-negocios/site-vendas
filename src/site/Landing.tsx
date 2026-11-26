import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { db, PLATFORM_NAME, storeUrl } from '../lib/api'
import { DEFAULT_PLANS, PLAN_SUMMARY, TRIAL_DAYS } from '../lib/plans'
import type { PlanRow } from '../lib/types'
import { brl } from '../lib/util'
import { useAsync } from '../ui/kit'

export default function Landing() {
  useEffect(() => {
    document.title = `${PLATFORM_NAME} — sua loja online em minutos`
  }, [])
  const plans = useAsync<PlanRow[]>(() => db.list('plans').then((p) => (p.length ? p : DEFAULT_PLANS)), [])
  const list = plans.data ?? DEFAULT_PLANS
  return (
    <div>
      <header className="site-top">
        <span className="brand">{PLATFORM_NAME}</span>
        <Link to="/entrar" className="btn ghost small">
          Entrar
        </Link>
      </header>
      <section className="hero">
        <h1>Tem o que vender, mas não tem loja?</h1>
        <p className="lead">Monte sua loja online em minutos. Cadastre seus produtos, compartilhe o link no Instagram e no WhatsApp e receba os pedidos prontos, com pagamento por Pix ou cartão.</p>
        <div className="row">
          <Link className="btn big" to="/entrar?novo=1">
            Criar minha loja grátis
          </Link>
          {db.demo && (
            <a className="btn big ghost" href={storeUrl('doces-da-ana')}>
              Ver uma loja de exemplo
            </a>
          )}
        </div>
        <p className="muted small">{TRIAL_DAYS} dias grátis com todos os recursos. Sem cartão de crédito.</p>
      </section>
      <section className="section">
        <h2>Como funciona</h2>
        <ol className="steps">
          <li>
            <b>Crie sua conta</b>
            <span className="muted">Só e-mail e senha. A loja fica pronta na hora, com um endereço só seu.</span>
          </li>
          <li>
            <b>Cadastre os produtos</b>
            <span className="muted">Fotos, preço, tamanhos e cores. Escolha as cores e o visual da loja.</span>
          </li>
          <li>
            <b>Compartilhe e venda</b>
            <span className="muted">O cliente escolhe, paga e você acompanha tudo pelo celular.</span>
          </li>
        </ol>
      </section>
      <section className="section" id="planos">
        <h2>Planos</h2>
        <div className="plans">
          {list.map((p) => (
            <div key={p.id} className={`plan ${p.id === 'loja' ? 'featured' : ''}`}>
              <div className="row between">
                <h3 style={{ fontSize: '1.2rem' }}>{p.name}</h3>
                {p.id === 'loja' && <span className="badge ok">Mais escolhido</span>}
              </div>
              <div className="price">
                {brl(p.price_cents)}
                <small>/mês</small>
              </div>
              <p className="muted small">{p.fee_percent > 0 ? `+ ${String(p.fee_percent).replace('.', ',')}% por venda paga online` : 'Sem taxa por venda'}</p>
              <ul>
                {PLAN_SUMMARY[p.id].map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link className={`btn ${p.id === 'loja' ? '' : 'ghost'}`} to="/entrar?novo=1">
                Começar teste grátis
              </Link>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 16 }}>
          As taxas do Pix e do cartão são cobradas pelo meio de pagamento e vão direto para a conta dele. O dinheiro das vendas cai na sua conta, não passa pela plataforma.
        </p>
      </section>
      <footer className="section muted small">
        © {new Date().getFullYear()} {PLATFORM_NAME}
      </footer>
    </div>
  )
}
