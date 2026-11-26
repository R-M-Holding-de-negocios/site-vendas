import { useState } from 'react'
import { db, storeUrl } from '../lib/api'
import { encodeCart } from '../lib/cart'
import { downloadFile, toCsv } from '../lib/csv'
import { can, type Feature } from '../lib/plans'
import type { Coupon } from '../lib/types'
import { addDays, brl, fmtDate, fmtDateTime, formatPhone, slugify, waLink } from '../lib/util'
import { Badge, CopyButton, Empty, ErrorBox, Field, Loading, Modal, MoneyInput, PageHead, Tabs, toast, Toggle, Upsell, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

type Tab = 'coupons' | 'carts' | 'links' | 'leads' | 'alerts' | 'reviews'

function CouponForm({ initial, onClose, onSaved }: { initial: Partial<Coupon>; onClose: () => void; onSaved: () => void }) {
  const { store } = usePanel()
  const [c, setC] = useState(initial)
  const [err, setErr] = useState('')
  async function save() {
    const code = (c.code ?? '').trim().toUpperCase().replace(/\s+/g, '')
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return setErr('Use de 3 a 20 letras ou números, sem espaços.')
    if (c.type !== 'free_shipping' && !(Number(c.value) > 0)) return setErr('Informe o valor do desconto.')
    const fields = { code, type: c.type!, value: Number(c.value) || 0, min_order_cents: c.min_order_cents ?? 0, max_uses: c.max_uses ?? null, starts_at: c.starts_at ?? null, ends_at: c.ends_at ?? null, active: c.active ?? true }
    try {
      if (c.id) await db.update('coupons', c.id, fields)
      else await db.insert('coupons', { ...fields, store_id: store.id, uses: 0 })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Modal title={c.id ? 'Editar cupom' : 'Novo cupom'} onClose={onClose}>
      <Field label="Código" hint="É o que o cliente digita. Ex.: BEMVINDO10">
        <input value={c.code ?? ''} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} />
      </Field>
      <Field label="Tipo">
        <select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value as Coupon['type'], value: 0 })}>
          <option value="percent">Percentual</option>
          <option value="fixed">Valor fixo</option>
          <option value="free_shipping">Frete grátis</option>
        </select>
      </Field>
      {c.type === 'percent' && (
        <Field label="Desconto (%)">
          <input type="number" min={1} max={100} value={c.value || ''} onChange={(e) => setC({ ...c, value: +e.target.value })} />
        </Field>
      )}
      {c.type === 'fixed' && (
        <Field label="Desconto">
          <MoneyInput value={c.value || null} onChange={(v) => setC({ ...c, value: v ?? 0 })} />
        </Field>
      )}
      <div className="grid2">
        <Field label="Compra mínima">
          <MoneyInput value={c.min_order_cents || null} onChange={(v) => setC({ ...c, min_order_cents: v ?? 0 })} />
        </Field>
        <Field label="Limite de usos" hint="Vazio = sem limite">
          <input type="number" min={1} value={c.max_uses ?? ''} onChange={(e) => setC({ ...c, max_uses: e.target.value ? +e.target.value : null })} />
        </Field>
        <Field label="Começa em">
          <input type="date" value={c.starts_at?.slice(0, 10) ?? ''} onChange={(e) => setC({ ...c, starts_at: e.target.value ? new Date(e.target.value + 'T00:00:00-03:00').toISOString() : null })} />
        </Field>
        <Field label="Termina em">
          <input type="date" value={c.ends_at?.slice(0, 10) ?? ''} onChange={(e) => setC({ ...c, ends_at: e.target.value ? new Date(e.target.value + 'T23:59:59-03:00').toISOString() : null })} />
        </Field>
      </div>
      <Toggle checked={c.active ?? true} onChange={(v) => setC({ ...c, active: v })} label="Ativo" />
      {err && <ErrorBox message={err} />}
      <div className="row end">
        <button className="btn" onClick={save}>Salvar cupom</button>
      </div>
    </Modal>
  )
}

function Coupons() {
  const { store } = usePanel()
  const data = useAsync(() => db.list('coupons', { eq: { store_id: store.id }, order: ['created_at', 'desc'] }), [store.id])
  const [edit, setEdit] = useState<Partial<Coupon> | null>(null)
  const describe = (c: Coupon) => (c.type === 'percent' ? `${c.value}% de desconto` : c.type === 'fixed' ? `${brl(c.value)} de desconto` : 'Frete grátis')
  return (
    <div className="stack">
      <div className="row end">
        <button className="btn" onClick={() => setEdit({ type: 'percent', value: 10, active: true })}>+ Novo cupom</button>
      </div>
      {!data.data ? (
        <Loading />
      ) : !data.data.length ? (
        <Empty title="Nenhum cupom" text="Crie cupons de desconto para divulgar no Instagram e no WhatsApp." />
      ) : (
        <div className="list">
          {data.data.map((c) => {
            const expired = c.ends_at && new Date(c.ends_at) < new Date()
            return (
              <div key={c.id} className="list-row">
                <div className="grow">
                  <b className="block">{c.code} {!c.active ? <Badge>Pausado</Badge> : expired ? <Badge tone="bad">Expirado</Badge> : <Badge tone="ok">Ativo</Badge>}</b>
                  <span className="small muted">
                    {describe(c)}
                    {c.min_order_cents > 0 && ` · acima de ${brl(c.min_order_cents)}`}
                    {c.ends_at && ` · até ${fmtDate(c.ends_at)}`} · usado {c.uses}
                    {c.max_uses != null && ` de ${c.max_uses}`} vezes
                  </span>
                </div>
                <button className="link small" onClick={() => db.update('coupons', c.id, { active: !c.active }).then(data.reload)}>{c.active ? 'Pausar' : 'Ativar'}</button>
                <button className="link small" onClick={() => setEdit(c)}>Editar</button>
                <button className="link danger small" onClick={() => confirm(`Excluir o cupom ${c.code}?`) && db.remove('coupons', c.id).then(data.reload)}>Excluir</button>
              </div>
            )
          })}
        </div>
      )}
      {edit && <CouponForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast('Cupom salvo'); data.reload() }} />}
    </div>
  )
}

function Carts() {
  const { store } = usePanel()
  const data = useAsync(() => db.list('checkouts', { eq: { store_id: store.id }, gte: ['created_at', addDays(new Date(), -30).toISOString()], order: ['created_at', 'desc'] }), [store.id])
  const [text, setText] = useState('Oi, {nome}! Vi que você separou {itens} na {loja} e não finalizou. Posso ajudar? Seu carrinho está guardado aqui: {link}')
  const hourAgo = addDays(new Date(), -1 / 24).toISOString()
  const abandoned = (data.data ?? []).filter((c) => !c.order_id && c.updated_at < hourAgo)
  const recovered = (data.data ?? []).filter((c) => c.order_id && c.contacted_at)
  const msg = (c: (typeof abandoned)[number]) =>
    text
      .replace('{nome}', c.customer.name.split(' ')[0] || '')
      .replace('{itens}', c.items.map((i) => `${i.qty}x ${i.name}`).join(', '))
      .replace('{loja}', store.name)
      .replace('{link}', storeUrl(store.slug, `?carrinho=${encodeURIComponent(encodeCart(c.items))}`))
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat"><span className="stat-label">Abandonados em 30 dias</span><b className="stat-value">{abandoned.length}</b></div>
        <div className="stat"><span className="stat-label">Valor parado</span><b className="stat-value">{brl(abandoned.reduce((a, c) => a + c.total_cents, 0))}</b></div>
        <div className="stat"><span className="stat-label">Recuperados após contato</span><b className="stat-value">{recovered.length}</b></div>
      </div>
      <Field label="Mensagem de recuperação" hint="Use {nome}, {itens}, {loja} e {link}. O link abre a loja com o carrinho montado.">
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {!data.data ? (
        <Loading />
      ) : !abandoned.length ? (
        <Empty title="Nenhum carrinho abandonado" text="Aparece aqui quem informou o WhatsApp no fechamento do pedido e não concluiu." />
      ) : (
        <div className="list">
          {abandoned.map((c) => (
            <div key={c.id} className="list-row">
              <div className="grow">
                <b className="block">{c.customer.name || 'Sem nome'} · {brl(c.total_cents)}</b>
                <span className="small muted">{fmtDateTime(c.updated_at)} · {c.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</span>
              </div>
              {c.contacted_at && <Badge>Contatado</Badge>}
              <a className="btn wa small" href={waLink(c.customer.phone, msg(c))} target="_blank" rel="noreferrer" onClick={() => db.update('checkouts', c.id, { contacted_at: new Date().toISOString() }).then(data.reload)}>
                Chamar
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CampaignLinks() {
  const { store } = usePanel()
  const [source, setSource] = useState('instagram')
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const campaign = slugify(name, 60)
  const url = storeUrl(store.slug, path) + `?utm_source=${encodeURIComponent(source)}${campaign ? `&utm_campaign=${campaign}` : ''}`
  return (
    <div className="stack">
      <p className="muted">Crie um link para cada divulgação. Nos relatórios você vê quantas visitas e vendas cada link trouxe.</p>
      <div className="grid2">
        <Field label="Onde vai divulgar">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="instagram">Instagram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="facebook">Facebook</option>
            <option value="tiktok">TikTok</option>
            <option value="influenciador">Influenciador</option>
            <option value="panfleto">Panfleto ou QR code</option>
            <option value="email">E-mail</option>
          </select>
        </Field>
        <Field label="Nome da campanha" hint="Ex.: stories dia das mães">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Página (opcional)" hint="Ex.: /c/id-da-categoria ou /p/id-do-produto">
          <input value={path} onChange={(e) => setPath(e.target.value.trim() && !e.target.value.startsWith('/') ? '/' + e.target.value.trim() : e.target.value.trim())} />
        </Field>
      </div>
      <div className="card row between">
        <code className="grow" style={{ wordBreak: 'break-all' }}>{url}</code>
        <CopyButton text={url} label="Copiar link" className="btn small" />
      </div>
    </div>
  )
}

function Leads() {
  const { store } = usePanel()
  const data = useAsync(() => db.list('leads', { eq: { store_id: store.id }, order: ['created_at', 'desc'] }), [store.id])
  return (
    <div className="stack">
      <div className="row between">
        <p className="muted">Contatos deixados na janela de oferta e na seção de captação.</p>
        <button className="btn ghost small" onClick={() => downloadFile(`contatos-${store.slug}.csv`, toCsv([['Contato', 'Data'], ...(data.data ?? []).map((l) => [l.contact, fmtDateTime(l.created_at)])]))}>Exportar</button>
      </div>
      {!data.data ? <Loading /> : !data.data.length ? <Empty title="Nenhum contato ainda" text="Ative a janela de oferta em Configurações > Loja." /> : (
        <div className="list">
          {data.data.map((l) => (
            <div key={l.id} className="list-row">
              <span className="grow">{formatPhone(l.contact)}</span>
              <span className="small muted">{fmtDate(l.created_at)}</span>
              <a className="link small" href={waLink(l.contact, `Olá! Aqui é da ${store.name}.${store.settings.lead_popup.coupon ? ` Seu cupom é ${store.settings.lead_popup.coupon}.` : ''}`)} target="_blank" rel="noreferrer">WhatsApp</a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Alerts() {
  const { store } = usePanel()
  const data = useAsync(() => Promise.all([db.list('stock_alerts', { eq: { store_id: store.id }, order: ['created_at', 'desc'] }), db.list('products', { eq: { store_id: store.id } })]), [store.id])
  if (!data.data) return <Loading />
  const [alerts, products] = data.data
  return alerts.length ? (
    <div className="list">
      {alerts.map((a) => {
        const p = products.find((x) => x.id === a.product_id)
        return (
          <div key={a.id} className="list-row">
            <div className="grow">
              <b className="block">{p?.name ?? 'Produto excluído'}</b>
              <span className="small muted">{formatPhone(a.contact)} · {fmtDate(a.created_at)}</span>
            </div>
            {a.notified ? <Badge tone="ok">Avisado</Badge> : (
              <a className="btn wa small" href={waLink(a.contact, `Olá! ${p?.name} chegou na ${store.name}: ${storeUrl(store.slug, `/p/${a.product_id}`)}`)} target="_blank" rel="noreferrer" onClick={() => db.update('stock_alerts', a.id, { notified: true }).then(data.reload)}>Avisar</a>
            )}
          </div>
        )
      })}
    </div>
  ) : (
    <Empty title="Ninguém pediu aviso ainda" text="Quando um produto esgota, o cliente pode deixar o WhatsApp para ser avisado." />
  )
}

function Reviews() {
  const { store } = usePanel()
  const data = useAsync(() => Promise.all([db.list('reviews', { eq: { store_id: store.id }, order: ['created_at', 'desc'] }), db.list('products', { eq: { store_id: store.id } })]), [store.id])
  if (!data.data) return <Loading />
  const [reviews, products] = data.data
  return reviews.length ? (
    <div className="list">
      {reviews.map((r) => (
        <div key={r.id} className="list-row">
          <div className="grow">
            <b className="block">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} {products.find((p) => p.id === r.product_id)?.name}</b>
            <span className="small">{r.comment || <i className="muted">sem comentário</i>}</span>
            <span className="block small muted">{r.name} · {fmtDate(r.created_at)}</span>
          </div>
          {r.approved ? <Badge tone="ok">Publicada</Badge> : <button className="btn small" onClick={() => db.update('reviews', r.id, { approved: true }).then(data.reload)}>Aprovar</button>}
          <button className="link danger small" onClick={() => confirm('Excluir esta avaliação?') && db.remove('reviews', r.id).then(data.reload)}>Excluir</button>
        </div>
      ))}
    </div>
  ) : (
    <Empty title="Nenhuma avaliação ainda" text="Depois da entrega, o cliente pode avaliar pela página de acompanhamento do pedido." />
  )
}

export default function Marketing() {
  const { store } = usePanel()
  const [tab, setTab] = useState<Tab>('coupons')
  const gate: Record<Tab, Feature> = { coupons: 'coupons', carts: 'abandoned_carts', links: 'campaign_links', leads: 'lead_popup', alerts: 'stock_alert', reviews: 'reviews' }
  const body = { coupons: <Coupons />, carts: <Carts />, links: <CampaignLinks />, leads: <Leads />, alerts: <Alerts />, reviews: <Reviews /> }[tab]
  return (
    <div className="stack">
      <PageHead title="Divulgação" sub="Ferramentas para vender mais." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'coupons', label: 'Cupons' },
          { id: 'carts', label: 'Carrinhos abandonados' },
          { id: 'links', label: 'Links de campanha' },
          { id: 'leads', label: 'Contatos captados' },
          { id: 'alerts', label: 'Avise-me' },
          { id: 'reviews', label: 'Avaliações' },
        ]}
      />
      {can(store, gate[tab]) ? body : <Upsell feature={gate[tab]} />}
    </div>
  )
}
