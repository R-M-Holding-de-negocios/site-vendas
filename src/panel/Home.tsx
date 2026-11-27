import QRCode from 'qrcode'
import { Link } from 'react-router-dom'
import { db, storeUrl } from '../lib/api'
import { can, planName } from '../lib/plans'
import type { Announcement, Order, Product } from '../lib/types'
import { addDays, brl, fmtDate, plural } from '../lib/util'
import { Badge, CopyButton, Loading, PageHead, QrImage, Stat, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'
import { situation } from '../admin/logic'

export default function Home() {
  const { store } = usePanel()
  const url = storeUrl(store.slug)
  const data = useAsync(async () => {
    const [products, orders, announcements, contents] = await Promise.all([
      db.list('products', { eq: { store_id: store.id } }),
      can(store, 'saved_orders') ? db.list('orders', { eq: { store_id: store.id }, gte: ['created_at', addDays(new Date(), -2).toISOString()] }) : Promise.resolve([] as Order[]),
      db.list('announcements', { order: ['created_at', 'desc'], limit: 3 }).catch(() => [] as Announcement[]),
      db.list('contents', { eq: { store_id: store.id }, limit: 1 }),
    ])
    const open = can(store, 'saved_orders') ? await db.list('orders', { eq: { store_id: store.id }, in: ['status', ['pending', 'paid', 'preparing']] }) : []
    return { products, orders, announcements, contents, open }
  }, [store.id])

  const s = store.settings
  const t = store.theme
  const products = data.data?.products ?? []
  const steps = [
    { done: !!store.name && !!store.whatsapp, label: 'Informar nome, WhatsApp e endereço da loja', to: '/painel/configuracoes' },
    { done: !!store.logo_url, label: 'Enviar o logo e escolher as cores', to: '/painel/aparencia' },
    { done: products.length >= 3, label: `Cadastrar os três primeiros produtos (${Math.min(products.length, 3)}/3)`, to: '/painel/produtos/novo' },
    {
      done: s.delivery.pickup.enabled || s.delivery.zones.enabled || s.delivery.fixed.enabled || !can(store, 'checkout'),
      label: 'Definir como entrega e como recebe',
      to: '/painel/configuracoes?aba=entregas',
    },
    { done: !!s.legal.name && !!s.legal.document, label: 'Preencher os dados legais e as políticas', to: '/painel/configuracoes?aba=legal' },
    { done: localStorage.getItem(`vt_testorder_${store.id}`) === '1', label: 'Fazer um pedido de teste', to: '' },
    { done: localStorage.getItem(`vt_shared_${store.id}`) === '1', label: 'Compartilhar o link da loja', to: '' },
  ]
  const doneCount = steps.filter((x) => x.done).length
  const today = new Date().toISOString().slice(0, 10)
  const paidToday = (data.data?.orders ?? []).filter((o) => o.paid_at?.slice(0, 10) === today && o.status !== 'cancelled' && o.status !== 'refunded')
  const lowStock = products.filter((p: Product) => p.track_stock && !p.options.length && p.stock <= 3)
  const trialDays = store.status === 'trial' && store.trial_ends_at ? Math.ceil((new Date(store.trial_ends_at).getTime() - Date.now()) / 86400000) : null
  // Mesma regra do painel do admin: o vencimento conta mesmo que ninguém tenha mudado o status.
  const sit = situation(store)
  const billingWarning =
    sit === 'suspended'
      ? 'Sua loja está suspensa: o link não abre para os clientes. Regularize o plano ou fale com o suporte.'
      : sit === 'overdue'
        ? 'Sua mensalidade está em atraso. Regularize para a loja não ser suspensa.'
        : sit === 'trial_expired'
          ? 'Seu teste grátis terminou. Escolha um plano para continuar vendendo.'
          : trialDays != null && trialDays <= 3
            ? 'Seu teste grátis está acabando. Escolha um plano para continuar vendendo.'
            : ''

  async function downloadQr() {
    const a = document.createElement('a')
    a.href = await QRCode.toDataURL(url, { width: 1000, margin: 2 })
    a.download = `qrcode-${store.slug}.png`
    a.click()
  }
  const markShared = () => localStorage.setItem(`vt_shared_${store.id}`, '1')

  return (
    <div className="stack">
      <PageHead title={`Olá, ${store.name}`} sub={<>Plano {planName(store.plan)}{trialDays != null && ` · teste grátis: ${trialDays > 0 ? plural(trialDays, 'dia restante', 'dias restantes') : 'terminou'}`}</>} />
      {billingWarning && (
        <div className="alert warn" role="status">
          {billingWarning}
          <Link to="/painel/plano">Ver plano</Link>
        </div>
      )}

      <section className="card link-card">
        <div className="stack tight">
          <span className="muted small">Link da sua loja</span>
          <a className="store-link" href={url} target="_blank" rel="noreferrer">
            {url.replace(/^https?:\/\//, '')}
          </a>
          <div className="row">
            <CopyButton text={url} label="Copiar link" className="btn small" />
            <a className="btn ghost small" href={`https://wa.me/?text=${encodeURIComponent(`Conheça a ${store.name}: ${url}`)}`} target="_blank" rel="noreferrer" onClick={markShared}>
              Enviar no WhatsApp
            </a>
            {'share' in navigator && (
              <button className="btn ghost small" onClick={() => navigator.share({ title: store.name, url }).then(markShared, () => undefined)}>
                Compartilhar
              </button>
            )}
            <button className="btn ghost small" onClick={downloadQr}>
              Baixar QR code
            </button>
          </div>
        </div>
        <QrImage text={url} size={120} label="QR code da loja" />
      </section>

      {doneCount < steps.length && (
        <section className="card">
          <div className="card-head">
            <h2>Primeiros passos</h2>
            <span className="muted small">
              {doneCount} de {steps.length}
            </span>
          </div>
          <div className="progress" style={{ margin: '10px 0' }}>
            <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ul className="checklist">
            {steps.map((st) => (
              <li key={st.label} className={st.done ? 'done' : ''}>
                <span className="dot">{st.done ? '✓' : ''}</span>
                <span className="t grow">{st.label}</span>
                {!st.done && st.to && (
                  <Link to={st.to} className="small">
                    Fazer agora
                  </Link>
                )}
                {!st.done && st.label.startsWith('Fazer um pedido') && (
                  <a className="small" href={url} target="_blank" rel="noreferrer" onClick={() => localStorage.setItem(`vt_testorder_${store.id}`, '1')}>
                    Abrir loja
                  </a>
                )}
                {!st.done && st.label.startsWith('Compartilhar') && (
                  <button className="link small" onClick={() => navigator.clipboard?.writeText(url).then(markShared)}>
                    Copiar link
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!data.data ? (
        <Loading />
      ) : (
        can(store, 'saved_orders') && (
          <section className="stats">
            <Stat label="Vendas de hoje" value={brl(paidToday.reduce((a, o) => a + o.total_cents, 0))} hint={plural(paidToday.length, 'pedido pago', 'pedidos pagos')} />
            <Stat label="Pedidos a preparar" value={(data.data.open ?? []).filter((o) => o.status !== 'pending').length} hint={<Link to="/painel/pedidos">Ver pedidos</Link>} />
            <Stat label="Aguardando pagamento" value={(data.data.open ?? []).filter((o) => o.status === 'pending').length} />
            <Stat label="Estoque baixo" value={lowStock.length} hint={lowStock.length ? lowStock.slice(0, 2).map((p) => p.name).join(', ') : 'Tudo certo'} />
          </section>
        )
      )}

      {!can(store, 'saved_orders') && (
        <section className="card">
          <h2>Seus pedidos chegam no WhatsApp</h2>
          <p className="muted">
            No plano Vitrine o cliente monta o carrinho e envia a mensagem pronta para o seu WhatsApp. Para guardar os pedidos aqui, receber por Pix e cartão e ver relatórios, conheça o <Link to="/painel/plano">plano Loja</Link>.
          </p>
        </section>
      )}

      {(data.data?.announcements ?? []).length > 0 && (
        <section className="card">
          <h2>Avisos da plataforma</h2>
          <ul className="stack" style={{ marginTop: 10 }}>
            {data.data!.announcements.map((a) => (
              <li key={a.id}>
                <b>{a.title}</b> <Badge>{fmtDate(a.created_at)}</Badge>
                <p className="muted small">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {t.sections.length === 0 && null}
    </div>
  )
}
