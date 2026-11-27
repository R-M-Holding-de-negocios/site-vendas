// Componentes de interface do painel e do admin.
import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { db, uploadImage } from '../lib/api'
import { FEATURES, planName, type Feature } from '../lib/plans'
import type { Media } from '../lib/types'
import { moneyInput, parseMoney } from '../lib/util'

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | undefined; error: string; loading: boolean }>({ data: undefined, error: '', loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fn().then(
      (data) => alive && setState({ data, error: '', loading: false }),
      (e: Error) => alive && setState({ data: undefined, error: e.message, loading: false }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload, setData: (data: T) => setState((s) => ({ ...s, data })) }
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden /> {label}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert error" role="alert">
      {message}
      {onRetry && (
        <button className="link" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  )
}

export function PageHead({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <header className="page-head">
      <div>
        {back && (
          <Link to={back} className="back">
            ← Voltar
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  )
}

export function Field({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      <span>
        {label}
        {hint && <span className="hint block">{hint}</span>}
      </span>
    </label>
  )
}

/** Campo de dinheiro em reais que guarda centavos. */
export function MoneyInput({ value, onChange, placeholder = '0,00', required, id }: { value: number | null; onChange: (cents: number | null) => void; placeholder?: string; required?: boolean; id?: string }) {
  const [text, setText] = useState(moneyInput(value))
  const last = useRef(value)
  useEffect(() => {
    if (value !== last.current) setText(moneyInput(value))
    last.current = value
  }, [value])
  return (
    <span className="money">
      <span aria-hidden>R$</span>
      <input
        id={id}
        inputMode="decimal"
        placeholder={placeholder}
        required={required}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const c = parseMoney(e.target.value)
          last.current = Number.isNaN(c) ? null : c
          onChange(last.current)
        }}
      />
    </span>
  )
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current!
    if (!d.open) d.showModal()
    return () => d.close()
  }, [])
  return (
    <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  )
}

/** Aviso de recurso de plano superior. */
export function Upsell({ feature, children }: { feature: Feature; children?: ReactNode }) {
  return (
    <div className="upsell">
      <span className="badge plan">Plano {planName(FEATURES[feature])}</span>
      <p>{children ?? 'Este recurso faz parte de um plano superior.'}</p>
      <Link to="/painel/plano" className="btn small">
        Ver planos
      </Link>
    </div>
  )
}

export function Badge({ children, tone = '' }: { children: ReactNode; tone?: '' | 'ok' | 'warn' | 'bad' | 'info' | 'plan' }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function QrImage({ text, size = 180, label }: { text: string; size?: number; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(text, { width: size * 2, margin: 1 }).then(setSrc, () => setSrc(''))
  }, [text, size])
  return src ? <img src={src} width={size} height={size} alt={label} className="qr" /> : <div style={{ width: size, height: size }} />
}

export function CopyButton({ text, label = 'Copiar', className = 'btn ghost small' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1800)
        })
      }}
    >
      {done ? 'Copiado' : label}
    </button>
  )
}

let toastSetter: ((m: string) => void) | null = null
export const toast = (m: string) => toastSetter?.(m)
export function ToastHost() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    toastSetter = (m) => {
      setMsg(m)
      setTimeout(() => setMsg((cur) => (cur === m ? '' : cur)), 2600)
    }
    return () => {
      toastSetter = null
    }
  }, [])
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null
}

/** Envio de imagens com biblioteca de mídia da loja. */
export function ImagePicker({ storeId, value, onChange, max = 1, label = 'Imagem' }: { storeId: string; value: string[]; onChange: (urls: string[]) => void; max?: number; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [library, setLibrary] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setErr('')
    try {
      const urls: string[] = []
      for (const f of Array.from(files).slice(0, max - value.length || 1)) urls.push(await uploadImage(f, storeId))
      onChange(max === 1 ? urls.slice(0, 1) : [...value, ...urls].slice(0, max))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  const move = (i: number, d: number) => {
    const next = [...value]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    onChange(next)
  }

  return (
    <div className="image-picker">
      <span className="field-label">{label}</span>
      <div className="thumbs">
        {value.map((u, i) => (
          <figure key={u + i} className="thumb">
            <img src={u} alt="" />
            <div className="thumb-actions">
              {max > 1 && i > 0 && (
                <button type="button" onClick={() => move(i, -1)} aria-label="Mover para antes">
                  ←
                </button>
              )}
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remover imagem">
                ✕
              </button>
            </div>
            {max > 1 && i === 0 && <figcaption>Capa</figcaption>}
          </figure>
        ))}
        {value.length < max && (
          <div className="thumb add">
            <button type="button" className="link" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Enviando…' : '+ Enviar'}
            </button>
            <button type="button" className="link small" onClick={() => setLibrary(true)}>
              Biblioteca
            </button>
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple={max > 1} hidden onChange={(e) => onFiles(e.target.files)} />
      {err && <span className="field-error">{err}</span>}
      {library && (
        <MediaLibrary
          storeId={storeId}
          onClose={() => setLibrary(false)}
          onPick={(u) => {
            onChange(max === 1 ? [u] : [...value, u].slice(0, max))
            setLibrary(false)
          }}
        />
      )}
    </div>
  )
}

function MediaLibrary({ storeId, onClose, onPick }: { storeId: string; onClose: () => void; onPick: (url: string) => void }) {
  const { data } = useAsync<Media[]>(() => db.list('media', { eq: { store_id: storeId }, order: ['created_at', 'desc'], limit: 200 }), [storeId])
  return (
    <Modal title="Biblioteca de imagens" onClose={onClose} wide>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty title="Nenhuma imagem enviada ainda" text="As imagens que você enviar ficam guardadas aqui para reaproveitar." />
      ) : (
        <div className="media-grid">
          {data.map((m) => (
            <button key={m.id} type="button" onClick={() => onPick(m.url)}>
              <img src={m.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function Stat({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: number | null; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {delta != null && Number.isFinite(delta) && (
        <span className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
          {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'} {Math.abs(delta * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
          <span className="sr-only"> em relação ao período anterior</span>
        </span>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}
