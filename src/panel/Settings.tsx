import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db, storeUrl } from '../lib/api'
import { downloadFile } from '../lib/csv'
import { validSlug } from '../lib/demo-rpc'
import { WEEKDAYS } from '../lib/hours'
import { can } from '../lib/plans'
import type { Store, StoreSettings } from '../lib/types'
import { slugify } from '../lib/util'
import { ErrorBox, Field, ImagePicker, MoneyInput, PageHead, Tabs, toast, Toggle, Upsell } from '../ui/kit'
import { usePanel } from './PanelApp'

type Tab = 'loja' | 'legal' | 'horario' | 'entregas' | 'avisos' | 'conta'

export default function Settings() {
  const { store, saveStore } = usePanel()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('aba') as Tab) || 'loja'
  const [draft, setDraft] = useState<Store>(store)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(store), [store])
  const s = draft.settings
  const setS = (patch: Partial<StoreSettings>) => setDraft({ ...draft, settings: { ...s, ...patch } })
  const dirty = JSON.stringify(draft) !== JSON.stringify(store)

  async function save() {
    setErr('')
    if (!draft.name.trim()) return setErr('Informe o nome da loja.')
    if (!validSlug(draft.slug)) return setErr('Endereço inválido: use de 3 a 40 letras, números ou hífens.')
    if (draft.whatsapp.replace(/\D/g, '').length < 10) return setErr('Informe o WhatsApp com DDD.')
    setBusy(true)
    try {
      await saveStore({ name: draft.name.trim(), slug: draft.slug, whatsapp: draft.whatsapp, description: draft.description, logo_url: draft.logo_url, settings: draft.settings })
      toast('Configurações salvas')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function exportAll() {
    const tables = ['categories', 'products', 'variants', 'orders', 'customers', 'coupons', 'contents', 'reviews'] as const
    const out: Record<string, unknown> = { store }
    for (const t of tables) out[t] = await db.list(t, { eq: { store_id: store.id } })
    downloadFile(`loja-${store.slug}.json`, JSON.stringify(out, null, 2), 'application/json')
  }
  async function closeStore() {
    const typed = prompt(`Isso apaga a loja e todos os dados para sempre. Baixe seus dados antes. Para confirmar, digite o endereço da loja: ${store.slug}`)
    if (typed !== store.slug) return
    await db.rpc('delete_my_store', {})
    await db.auth.signOut()
    location.href = '/'
  }

  const body: Record<Tab, React.ReactNode> = {
    loja: (
      <section className="card form-section">
        <div className="grid2">
          <Field label="Nome da loja">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="WhatsApp que recebe os pedidos">
            <input type="tel" value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} />
          </Field>
        </div>
        <Field label="Endereço da loja" hint={draft.slug !== store.slug ? 'Atenção: o link antigo deixa de funcionar.' : undefined}>
          <span className="prefix">
            {storeUrl('').replace(/^https?:\/\//, '')}
            <input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })} />
          </span>
        </Field>
        <Field label="Descrição curta" hint="Aparece no rodapé e quando o link é compartilhado.">
          <input value={draft.description} maxLength={160} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
        <ImagePicker storeId={store.id} value={draft.logo_url ? [draft.logo_url] : []} onChange={(v) => setDraft({ ...draft, logo_url: v[0] ?? '' })} label="Logo" />
        <div className="grid2">
          <Field label="Instagram"><input placeholder="@sualoja" value={s.instagram} onChange={(e) => setS({ instagram: e.target.value })} /></Field>
          <Field label="Facebook"><input value={s.facebook} onChange={(e) => setS({ facebook: e.target.value })} /></Field>
          <Field label="TikTok"><input value={s.tiktok} onChange={(e) => setS({ tiktok: e.target.value })} /></Field>
          <Field label="E-mail de contato"><input type="email" value={s.email} onChange={(e) => setS({ email: e.target.value })} /></Field>
        </div>
        {can(store, 'lead_popup') && (
          <div className="stack tight">
            <Toggle checked={s.lead_popup.enabled} onChange={(v) => setS({ lead_popup: { ...s.lead_popup, enabled: v } })} label="Janela de oferta para captar contatos" hint="Aparece uma vez por visitante, oferecendo um cupom em troca do WhatsApp." />
            {s.lead_popup.enabled && (
              <div className="grid2">
                <Field label="Texto"><input value={s.lead_popup.text} onChange={(e) => setS({ lead_popup: { ...s.lead_popup, text: e.target.value } })} /></Field>
                <Field label="Cupom oferecido" hint="Crie o cupom em Divulgação."><input value={s.lead_popup.coupon} onChange={(e) => setS({ lead_popup: { ...s.lead_popup, coupon: e.target.value.toUpperCase() } })} /></Field>
                <Field label="Aparece depois de (segundos)"><input type="number" min={3} value={s.lead_popup.delay_s} onChange={(e) => setS({ lead_popup: { ...s.lead_popup, delay_s: +e.target.value } })} /></Field>
              </div>
            )}
          </div>
        )}
        <Field label="Meta de vendas do mês" hint="Acompanhada nos relatórios.">
          <MoneyInput value={s.goal_cents || null} onChange={(v) => setS({ goal_cents: v ?? 0 })} />
        </Field>
      </section>
    ),
    legal: (
      <section className="card form-section">
        <p className="muted small">A lei exige que a loja mostre quem é o vendedor e as regras de troca. Estes dados aparecem no rodapé e no fechamento do pedido.</p>
        <div className="grid2">
          <Field label="Nome ou razão social"><input value={s.legal.name} onChange={(e) => setS({ legal: { ...s.legal, name: e.target.value } })} /></Field>
          <Field label="CPF ou CNPJ"><input value={s.legal.document} onChange={(e) => setS({ legal: { ...s.legal, document: e.target.value } })} /></Field>
        </div>
        <Field label="Endereço"><input value={s.legal.address} onChange={(e) => setS({ legal: { ...s.legal, address: e.target.value } })} /></Field>
        <Field label="Política de troca e devolução" hint="Mantenha o direito de desistir em 7 dias, previsto no Código de Defesa do Consumidor.">
          <textarea rows={5} value={s.policies.exchange} onChange={(e) => setS({ policies: { ...s.policies, exchange: e.target.value } })} />
        </Field>
        <Field label="Política de entrega"><textarea rows={4} value={s.policies.shipping} onChange={(e) => setS({ policies: { ...s.policies, shipping: e.target.value } })} /></Field>
        <Field label="Política de privacidade"><textarea rows={5} value={s.policies.privacy} onChange={(e) => setS({ policies: { ...s.policies, privacy: e.target.value } })} /></Field>
      </section>
    ),
    horario: (
      <section className="card form-section">
        <Toggle checked={s.hours.paused} onChange={(v) => setS({ hours: { ...s.hours, paused: v } })} label="Pausar a loja agora" hint="Ninguém consegue fazer pedidos enquanto estiver ligado." />
        <Toggle checked={s.hours.enabled} onChange={(v) => setS({ hours: { ...s.hours, enabled: v } })} label="Usar horário de funcionamento" />
        {s.hours.enabled && (
          <>
            {s.hours.days.map((d, i) => (
              <div key={i} className="hours-row">
                <b>{WEEKDAYS[i]}</b>
                <input type="checkbox" checked={d.open} aria-label={`Aberto ${WEEKDAYS[i]}`} style={{ width: 18, height: 18 }} onChange={(e) => setS({ hours: { ...s.hours, days: s.hours.days.map((x, j) => (j === i ? { ...x, open: e.target.checked } : x)) } })} />
                <input type="time" disabled={!d.open} value={d.from} aria-label="Abre às" onChange={(e) => setS({ hours: { ...s.hours, days: s.hours.days.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) } })} />
                <input type="time" disabled={!d.open} value={d.to} aria-label="Fecha às" onChange={(e) => setS({ hours: { ...s.hours, days: s.hours.days.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) } })} />
              </div>
            ))}
            <Field label="Fora do horário">
              <select value={s.hours.outside} onChange={(e) => setS({ hours: { ...s.hours, outside: e.target.value as 'accept' | 'block' } })}>
                <option value="accept">Avisar, mas aceitar pedidos</option>
                <option value="block">Não aceitar pedidos</option>
              </select>
            </Field>
          </>
        )}
        <div className="grid2">
          <Field label="Pedido mínimo"><MoneyInput value={s.min_order_cents || null} onChange={(v) => setS({ min_order_cents: v ?? 0 })} /></Field>
          <Field label="Prazo de preparo (dias úteis)"><input type="number" min={0} value={s.prep_days} onChange={(e) => setS({ prep_days: +e.target.value })} /></Field>
        </div>
      </section>
    ),
    entregas: can(store, 'checkout') ? (
      <section className="card form-section">
        <Toggle checked={s.delivery.pickup.enabled} onChange={(v) => setS({ delivery: { ...s.delivery, pickup: { ...s.delivery.pickup, enabled: v } } })} label="Retirada na loja" />
        {s.delivery.pickup.enabled && (
          <div className="grid2">
            <Field label="Endereço de retirada"><input value={s.delivery.pickup.address} onChange={(e) => setS({ delivery: { ...s.delivery, pickup: { ...s.delivery.pickup, address: e.target.value } } })} /></Field>
            <Field label="Instruções"><input placeholder="Ex.: de segunda a sábado, das 9h às 18h" value={s.delivery.pickup.instructions} onChange={(e) => setS({ delivery: { ...s.delivery, pickup: { ...s.delivery.pickup, instructions: e.target.value } } })} /></Field>
          </div>
        )}
        <Toggle checked={s.delivery.zones.enabled} onChange={(v) => setS({ delivery: { ...s.delivery, zones: { ...s.delivery.zones, enabled: v } } })} label="Entrega própria por bairro" hint="Você define os bairros atendidos e a taxa de cada um." />
        {s.delivery.zones.enabled && (
          <div className="stack tight">
            {s.delivery.zones.items.map((z, i) => (
              <div key={i} className="zone-row">
                <input value={z.name} placeholder="Bairro" aria-label="Bairro" onChange={(e) => setS({ delivery: { ...s.delivery, zones: { ...s.delivery.zones, items: s.delivery.zones.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } } })} />
                <MoneyInput value={z.fee_cents} onChange={(v) => setS({ delivery: { ...s.delivery, zones: { ...s.delivery.zones, items: s.delivery.zones.items.map((x, j) => (j === i ? { ...x, fee_cents: v ?? 0 } : x)) } } })} />
                <button className="link danger" onClick={() => setS({ delivery: { ...s.delivery, zones: { ...s.delivery.zones, items: s.delivery.zones.items.filter((_, j) => j !== i) } } })}>Remover</button>
              </div>
            ))}
            <button className="link" style={{ justifySelf: 'start' }} onClick={() => setS({ delivery: { ...s.delivery, zones: { ...s.delivery.zones, items: [...s.delivery.zones.items, { name: '', fee_cents: 0 }] } } })}>+ Adicionar bairro</button>
          </div>
        )}
        <Toggle checked={s.delivery.fixed.enabled} onChange={(v) => setS({ delivery: { ...s.delivery, fixed: { ...s.delivery.fixed, enabled: v } } })} label="Entrega com taxa fixa" />
        {s.delivery.fixed.enabled && (
          <div className="grid2">
            <Field label="Nome"><input value={s.delivery.fixed.label} onChange={(e) => setS({ delivery: { ...s.delivery, fixed: { ...s.delivery.fixed, label: e.target.value } } })} /></Field>
            <Field label="Taxa"><MoneyInput value={s.delivery.fixed.fee_cents} onChange={(v) => setS({ delivery: { ...s.delivery, fixed: { ...s.delivery.fixed, fee_cents: v ?? 0 } } })} /></Field>
          </div>
        )}
        <Toggle checked={s.delivery.arrange.enabled} onChange={(v) => setS({ delivery: { ...s.delivery, arrange: { enabled: v } } })} label="Combinar a entrega pelo WhatsApp" />
        {can(store, 'free_shipping_bar') && (
          <Field label="Frete grátis acima de" hint="Vale para entrega por bairro e taxa fixa. Deixe vazio para não oferecer.">
            <MoneyInput value={s.free_shipping_above_cents || null} onChange={(v) => setS({ free_shipping_above_cents: v ?? 0 })} />
          </Field>
        )}
        <p className="muted small">Cálculo por transportadora (Correios, Jadlog e outras) com etiqueta: em breve, pelo Melhor Envio.</p>
      </section>
    ) : (
      <Upsell feature="checkout">Retirada, entrega por bairro e frete grátis no plano Loja. No plano Vitrine a entrega é combinada pelo WhatsApp.</Upsell>
    ),
    avisos: (
      <section className="card form-section">
        <Toggle checked={s.notifications.sound} onChange={(v) => setS({ notifications: { sound: v } })} label="Tocar um som quando chegar pedido novo" hint="Funciona com o painel aberto no celular ou computador." />
        <p className="muted small">Avisos por e-mail e por WhatsApp automático chegam numa próxima versão. Enquanto isso, o painel mostra o número de pedidos em aberto no menu.</p>
      </section>
    ),
    conta: (
      <section className="card form-section">
        <h2>Seus dados</h2>
        <p className="muted">Baixe uma cópia completa da loja: produtos, pedidos, clientes e configurações.</p>
        <button className="btn ghost" style={{ justifySelf: 'start' }} onClick={exportAll}>Baixar meus dados</button>
        <h2 style={{ marginTop: 12 }}>Encerrar a loja</h2>
        <p className="muted">Apaga a loja e todos os dados. Não dá para desfazer.</p>
        <button className="btn danger" style={{ justifySelf: 'start' }} onClick={closeStore}>Encerrar loja</button>
      </section>
    ),
  }

  return (
    <div className="stack">
      <PageHead title="Configurações" />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ aba: t })}
        items={[
          { id: 'loja', label: 'Loja' },
          { id: 'legal', label: 'Dados legais' },
          { id: 'horario', label: 'Horário e pedidos' },
          { id: 'entregas', label: 'Entregas' },
          { id: 'avisos', label: 'Avisos' },
          { id: 'conta', label: 'Conta' },
        ]}
      />
      {body[tab]}
      {err && <ErrorBox message={err} />}
      {tab !== 'conta' && (
        <div className="form-actions">
          {dirty && <button className="btn ghost" onClick={() => setDraft(store)}>Descartar</button>}
          <button className="btn" disabled={busy || !dirty} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      )}
    </div>
  )
}
