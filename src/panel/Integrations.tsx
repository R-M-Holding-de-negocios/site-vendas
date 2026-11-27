import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db } from '../lib/api'
import { connectMercadoPago, isMercadoPagoConnected } from '../lib/mercadopago'
import { normalizePixKey } from '../lib/pix'
import { can } from '../lib/plans'
import type { StoreSettings } from '../lib/types'
import { Badge, ErrorBox, Field, PageHead, toast, Toggle, Upsell } from '../ui/kit'
import { usePanel } from './PanelApp'

export default function Integrations() {
  const { store, saveStore } = usePanel()
  const [params, setParams] = useSearchParams()
  const [s, setS] = useState<StoreSettings>(store.settings)
  const [mp, setMp] = useState<boolean | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setS(store.settings), [store.settings])
  useEffect(() => {
    isMercadoPagoConnected(store.id).then(setMp, () => setMp(false))
  }, [store.id, store.settings.payments.mercadopago.enabled])
  useEffect(() => {
    const r = params.get('mp')
    if (!r) return
    if (r === 'conectado') {
      toast('Mercado Pago conectado')
      saveStore({ settings: { ...store.settings, payments: { ...store.settings.payments, mercadopago: { enabled: true } } } })
    } else setErr('Não foi possível conectar o Mercado Pago. Tente de novo.')
    setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const p = s.payments
  const setP = (patch: Partial<StoreSettings['payments']>) => setS({ ...s, payments: { ...p, ...patch } })
  const dirty = JSON.stringify(s) !== JSON.stringify(store.settings)

  async function save() {
    setErr('')
    if (p.pix.enabled && !p.pix.key.trim()) return setErr('Informe a chave Pix.')
    if (p.pix.enabled && (!p.pix.holder.trim() || !p.pix.city.trim())) return setErr('Informe o nome do titular e a cidade da conta Pix: o banco do cliente mostra esses dados.')
    setBusy(true)
    try {
      await saveStore({ settings: s })
      toast('Salvo')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function connect() {
    setErr('')
    try {
      if (db.demo) {
        setP({ mercadopago: { enabled: true } })
        toast('No modo demonstração a conexão é simulada. Salve para ativar.')
        return
      }
      const url = await connectMercadoPago()
      if (url) location.href = url
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (!can(store, 'checkout'))
    return (
      <div className="stack">
        <PageHead title="Integrações" />
        <Upsell feature="pix">Receba por Pix e cartão, ofereça pagamento na entrega e conecte ferramentas de anúncio no plano Loja.</Upsell>
      </div>
    )

  return (
    <div className="stack">
      <PageHead title="Integrações" sub="Formas de pagamento, entrega e ferramentas de anúncio." />

      <section className="card form-section">
        <div className="card-head">
          <h2>Pix direto na sua conta</h2>
          <Badge tone={p.pix.enabled ? 'ok' : ''}>{p.pix.enabled ? 'Ligado' : 'Desligado'}</Badge>
        </div>
        <p className="muted small">O cliente recebe o QR code e o código copia e cola com o valor certo. Você confere no banco e confirma o pagamento no pedido. Sem taxa da plataforma.</p>
        <Toggle checked={p.pix.enabled} onChange={(v) => setP({ pix: { ...p.pix, enabled: v } })} label="Aceitar Pix" />
        {p.pix.enabled && (
          <div className="grid2">
            <Field label="Chave Pix" hint={p.pix.key && `Será usada como: ${normalizePixKey(p.pix.key)}`}>
              <input value={p.pix.key} onChange={(e) => setP({ pix: { ...p.pix, key: e.target.value } })} />
            </Field>
            <Field label="Nome do titular"><input value={p.pix.holder} onChange={(e) => setP({ pix: { ...p.pix, holder: e.target.value } })} /></Field>
            <Field label="Cidade da conta"><input value={p.pix.city} onChange={(e) => setP({ pix: { ...p.pix, city: e.target.value } })} /></Field>
            <Field label="Desconto no Pix (%)"><input type="number" min={0} max={30} value={p.pix.discount_percent} onChange={(e) => setP({ pix: { ...p.pix, discount_percent: +e.target.value } })} /></Field>
          </div>
        )}
      </section>

      <section className="card form-section">
        <div className="card-head">
          <h2>Mercado Pago</h2>
          <Badge tone={mp ? 'ok' : ''}>{mp == null ? '…' : mp ? 'Conectado' : 'Não conectado'}</Badge>
        </div>
        <p className="muted small">Cartão de crédito em até 12x e Pix, com confirmação automática do pedido. O dinheiro cai na sua conta do Mercado Pago; a taxa do Mercado Pago e a taxa da plataforma são descontadas em cada venda.</p>
        {mp ? (
          <>
            <Toggle checked={p.mercadopago.enabled} onChange={(v) => setP({ mercadopago: { enabled: v } })} label="Oferecer o Mercado Pago no fechamento do pedido" />
            <Field label="Parcelas no cartão" hint="Máximo mostrado na página do produto.">
              <select value={s.max_installments} onChange={(e) => setS({ ...s, max_installments: +e.target.value })}>
                {[1, 2, 3, 4, 5, 6, 10, 12].map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `Até ${n}x`}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <button className="btn" style={{ justifySelf: 'start' }} onClick={connect}>Conectar minha conta do Mercado Pago</button>
        )}
      </section>

      <section className="card form-section">
        <h2>Na entrega ou retirada</h2>
        <Toggle checked={p.cash.enabled} onChange={(v) => setP({ cash: { enabled: v } })} label="Dinheiro" hint="O cliente pode informar para quanto precisa de troco." />
        <Toggle checked={p.card_on_delivery.enabled} onChange={(v) => setP({ card_on_delivery: { enabled: v } })} label="Cartão na maquininha" />
        <Toggle checked={p.whatsapp.enabled} onChange={(v) => setP({ whatsapp: { enabled: v } })} label="Combinar o pagamento pelo WhatsApp" />
      </section>

      <section className="card form-section">
        <div className="card-head">
          <h2>Frete por transportadora</h2>
          <Badge>Em breve</Badge>
        </div>
        <p className="muted small">Cotação dos Correios e de transportadoras pelo CEP do cliente, compra de etiqueta com desconto e rastreio automático, pelo Melhor Envio. Enquanto isso, use retirada, entrega por bairro ou taxa fixa em Configurações &gt; Entregas.</p>
      </section>

      <section className="card form-section">
        <h2>Ferramentas de anúncio</h2>
        <p className="muted small">Informe só o código de cada ferramenta. Elas só são carregadas depois que o visitante aceita os cookies.</p>
        {can(store, 'tracking_pixels') ? (
          <div className="grid2">
            <Field label="Google Analytics" hint="Começa com G-"><input placeholder="G-XXXXXXX" value={s.tracking.ga4} onChange={(e) => setS({ ...s, tracking: { ...s.tracking, ga4: e.target.value.trim().toUpperCase() } })} /></Field>
            <Field label="Pixel da Meta (Facebook e Instagram)" hint="Só números"><input inputMode="numeric" value={s.tracking.meta_pixel} onChange={(e) => setS({ ...s, tracking: { ...s.tracking, meta_pixel: e.target.value.replace(/\D/g, '') } })} /></Field>
            <Field label="Pixel do TikTok"><input value={s.tracking.tiktok_pixel} onChange={(e) => setS({ ...s, tracking: { ...s.tracking, tiktok_pixel: e.target.value.trim().toUpperCase() } })} /></Field>
          </div>
        ) : (
          <Upsell feature="tracking_pixels" />
        )}
      </section>

      {err && <ErrorBox message={err} />}
      <div className="form-actions">
        <button className="btn" disabled={busy || !dirty} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </div>
  )
}
