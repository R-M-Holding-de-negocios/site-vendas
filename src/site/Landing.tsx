import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { db, PLATFORM_NAME, storeUrl } from '../lib/api'
import { GRACE_DAYS } from '../lib/billing'
import { DEFAULT_PLANS, PLAN_SUMMARY, TRIAL_DAYS } from '../lib/plans'
import type { PlanRow } from '../lib/types'
import { brl } from '../lib/util'
import { Icon } from '../ui/icons'
import { useAsync } from '../ui/kit'
import '../styles/landing.css'

const SEGMENTS = ['Confeitaria', 'Brechó', 'Artesanato', 'Moda', 'Cosméticos', 'Marmitas', 'Plantas', 'Papelaria', 'Acessórios', 'Pet shop', 'Velas e aromas', 'Presentes']

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: 'whatsapp', title: 'Pedido pronto no WhatsApp', text: 'O cliente monta o carrinho e o pedido chega organizado, com itens, entrega e total. Nada de anotar em papel.' },
  { icon: 'pix', title: 'Pix com QR code', text: 'O código Pix sai com o valor exato do pedido e o dinheiro cai direto na sua conta, sem passar pela plataforma.' },
  { icon: 'truck', title: 'Entrega do seu jeito', text: 'Taxa por bairro, retirada na loja, frete grátis acima de um valor ou combinar pelo WhatsApp.' },
  { icon: 'cart', title: 'Painel no celular', text: 'Aviso sonoro de pedido novo, situação de cada pedido, clientes, estoque e cupons, tudo no celular.' },
  { icon: 'sparkle', title: 'Loja com a sua cara', text: 'Cores, fontes, 18 tipos de seção e efeitos animados, com prévia ao vivo. Fica bonita no celular sem esforço.' },
  { icon: 'star', title: 'Relatórios que dizem o que fazer', text: 'O que mais vende, de onde vêm os clientes, quem não volta há tempo e quanto sobra depois dos custos.' },
]

export default function Landing() {
  useEffect(() => {
    document.title = `${PLATFORM_NAME} — sua loja online em minutos`
  }, [])
  const plans = useAsync<PlanRow[]>(() => db.list('plans').then((p) => (p.length ? p : DEFAULT_PLANS)), [])
  const list = plans.data ?? DEFAULT_PLANS
  const faq: [string, string][] = [
    ['Preciso ter CNPJ?', 'Não. Dá para vender como pessoa física. O CNPJ só é pedido pelo Mercado Pago se você quiser receber por ele como empresa.'],
    ['Como eu recebo o dinheiro?', 'No Pix, o cliente paga direto para a sua chave. No Mercado Pago, o dinheiro cai na sua conta de lá. Na entrega, você recebe em mãos. A plataforma nunca segura o seu dinheiro.'],
    ['Quanto custa no fim do mês?', 'Só a mensalidade do plano. Nos planos Loja e Pro existe uma pequena taxa apenas nas vendas pagas pelo Mercado Pago; Pix direto e pagamento na entrega não têm taxa da plataforma.'],
    ['E quando o teste grátis acabar?', `Você escolhe um plano e paga por Pix. Se esquecer, a loja continua no ar por mais ${GRACE_DAYS} dias e depois passa para o plano Vitrine (pedidos pelo WhatsApp). Nada do que você cadastrou é apagado.`],
    ['Preciso saber mexer com site?', 'Não. Você cadastra os produtos como num formulário e escolhe o visual entre modelos prontos. Dá para fazer tudo pelo celular.'],
    ['Posso cancelar quando quiser?', 'Sim. Não há fidelidade nem multa.'],
  ]
  return (
    <div className="lp">
      <header className="lp-top">
        <span className="brand">{PLATFORM_NAME}</span>
        <nav aria-label="Seções da página">
          <a href="#recursos">Recursos</a>
          <a href="#como">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#duvidas">Dúvidas</a>
        </nav>
        <div className="row">
          <Link to="/entrar" className="btn ghost small">
            Entrar
          </Link>
          <Link to="/entrar?novo=1" className="btn small lp-hide-m">
            Criar loja
          </Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-kicker">Para quem já vende pelo WhatsApp e Instagram</p>
          <h1>
            Tem o que vender, mas não tem <span className="lp-mark">loja</span>?
          </h1>
          <p className="lead">Monte sua loja online em minutos. Compartilhe o link e receba os pedidos prontos, com Pix, pagamento na entrega ou cartão.</p>
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
          <ul className="lp-proof">
            <li>
              <Icon name="check" size={16} /> {TRIAL_DAYS} dias grátis com tudo liberado
            </li>
            <li>
              <Icon name="check" size={16} /> Sem cartão de crédito
            </li>
            <li>
              <Icon name="check" size={16} /> Pix direto na sua conta
            </li>
          </ul>
        </div>
        <PhoneMock />
      </section>

      <div className="lp-strip" aria-label="Feito para todo tipo de negócio">
        <div className="lp-strip-track">
          {[0, 1].map((k) => (
            <div key={k} className="lp-strip-group" aria-hidden={k === 1 || undefined}>
              {SEGMENTS.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section className="lp-section" id="recursos">
        <h2>Tudo o que uma pequena loja precisa</h2>
        <p className="lp-sub">Sem instalar nada, sem contratar ninguém.</p>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="lp-feature">
              <span className="lp-ico">
                <Icon name={f.icon} size={22} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="como">
        <h2>Como funciona</h2>
        <ol className="steps">
          <li>
            <b>Crie sua conta</b>
            <span className="muted">Só e-mail e senha. A loja fica pronta na hora, com um endereço só seu.</span>
          </li>
          <li>
            <b>Cadastre os produtos</b>
            <span className="muted">Fotos, preço, tamanhos e cores. Escolha o visual da loja.</span>
          </li>
          <li>
            <b>Compartilhe e venda</b>
            <span className="muted">Coloque o link na bio e no status. O pedido chega pronto e você acompanha pelo celular.</span>
          </li>
        </ol>
      </section>

      <section className="lp-section" id="planos">
        <h2>Planos</h2>
        <p className="lp-sub">Comece com {TRIAL_DAYS} dias grátis no plano Pro. Depois, fique no que fizer sentido.</p>
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
              <p className="muted small">{p.fee_percent > 0 ? `+ ${String(p.fee_percent).replace('.', ',')}% só nas vendas pagas pelo Mercado Pago` : 'Sem taxa por venda'}</p>
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
          As tarifas do Pix e do cartão são as do seu banco ou do Mercado Pago. O dinheiro das vendas cai na sua conta, não passa pela plataforma.
        </p>
      </section>

      <section className="lp-section" id="duvidas">
        <h2>Dúvidas comuns</h2>
        <div className="lp-faq">
          {faq.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-cta">
        <h2>Sua loja pode estar no ar hoje.</h2>
        <p>Leva menos tempo do que responder os pedidos de ontem no WhatsApp.</p>
        <Link className="btn big" to="/entrar?novo=1">
          Criar minha loja grátis
        </Link>
      </section>

      <footer className="lp-foot">
        <span className="brand">{PLATFORM_NAME}</span>
        <nav aria-label="Rodapé">
          <a href="#recursos">Recursos</a>
          <a href="#planos">Planos</a>
          <a href="#duvidas">Dúvidas</a>
          <Link to="/entrar">Entrar</Link>
        </nav>
        <span className="muted small">© {new Date().getFullYear()} {PLATFORM_NAME}</span>
      </footer>
    </div>
  )
}

/** Celular com uma loja de exemplo e um pedido chegando (ilustração feita em HTML, sem imagens). */
function PhoneMock() {
  const items: [string, string, string][] = [
    ['🧁', 'Cupcake de morango', 'R$ 9,90'],
    ['🍫', 'Caixa de brigadeiros', 'R$ 34,90'],
    ['🍰', 'Fatia red velvet', 'R$ 16,00'],
    ['🎁', 'Kit presente', 'R$ 69,00'],
  ]
  return (
    <div className="lp-visual" aria-hidden>
      <div className="lp-phone">
        <div className="lp-screen">
          <div className="lp-shop-head">
            <span className="lp-logo">🧁</span>
            <b>Doces da Ana</b>
            <Icon name="cart" size={16} />
          </div>
          <div className="lp-shop-banner">
            <b>Doces feitos à mão</b>
            <span>Entrega em Campinas</span>
          </div>
          <div className="lp-shop-grid">
            {items.map(([e, n, p]) => (
              <div key={n} className="lp-card">
                <span className="lp-card-img">{e}</span>
                <span className="lp-card-name">{n}</span>
                <b>{p}</b>
              </div>
            ))}
          </div>
          <div className="lp-shop-cta">
            <Icon name="whatsapp" size={16} /> Enviar pedido
          </div>
        </div>
      </div>
      <div className="lp-toast lp-toast-1">
        <span className="lp-toast-ico">
          <Icon name="pix" size={18} />
        </span>
        <span>
          <b>Pedido nº 1043 pago</b>
          <small>R$ 72,70 · Pix</small>
        </span>
      </div>
      <div className="lp-toast lp-toast-2">
        <span className="lp-toast-ico wa">
          <Icon name="truck" size={18} />
        </span>
        <span>
          <b>Entrega · Bairro Cambuí</b>
          <small>Taxa R$ 8,00</small>
        </span>
      </div>
    </div>
  )
}
