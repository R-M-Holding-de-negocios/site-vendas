import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <main className="wrap home">
      <header className="top">
        <strong className="brand">Vitrine</strong>
        <Link to="/entrar">Entrar</Link>
      </header>
      <h1>Tem o que vender, mas não tem loja?</h1>
      <p className="lead">
        Monte sua loja online em minutos. Cadastre seus produtos, compartilhe o link e receba os pedidos direto no seu
        WhatsApp.
      </p>
      <Link className="btn big" to="/entrar?novo=1">
        Criar minha loja
      </Link>
      <ol className="steps">
        <li>
          <b>Crie sua conta</b>
          <span>Só e-mail e senha.</span>
        </li>
        <li>
          <b>Cadastre os produtos</b>
          <span>Foto, nome e preço.</span>
        </li>
        <li>
          <b>Compartilhe o link</b>
          <span>O cliente escolhe e o pedido chega pronto no WhatsApp.</span>
        </li>
      </ol>
    </main>
  )
}
