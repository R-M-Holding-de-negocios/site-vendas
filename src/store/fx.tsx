// Efeitos visuais da loja: títulos animados, fundos animados das seções, efeitos nos
// cartões e botões, faíscas no clique, barra de rolagem, contadores e faixa rolante.
//
// Implementação própria, leve e sem bibliotecas (só CSS, um pouco de JS e canvas 2D).
// A ideia dos efeitos é comum na web; o código não foi copiado de nenhuma biblioteca.
// Tudo respeita "Animações: desligadas" no editor e a opção "reduzir movimento" do aparelho.
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BgFx, TextFx, Theme } from '../lib/types'
import { useStore } from './context'
import '../styles/fx.css'

// ---------- utilidades ----------

export function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Fica true na primeira vez que o elemento aparece na tela. */
export function useInView<T extends Element>(rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T>(null)
  const [inView, setIn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    if (!('IntersectionObserver' in window)) return setIn(true)
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setIn(true), io.disconnect()), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [inView, rootMargin])
  return [ref, inView] as const
}

/** "Bolos {de festa|para presente}" -> partes fixas e opções que alternam. */
export function parseRotating(text: string): { before: string; words: string[]; after: string } | null {
  const m = text.match(/^(.*?)\{([^}]+)\}(.*)$/)
  if (!m) return null
  const words = m[2].split('|').map((w) => w.trim()).filter(Boolean)
  return words.length ? { before: m[1], words, after: m[3] } : null
}

/** Texto sem as chaves de "palavras que trocam" (para leitores de tela, SEO e efeitos que não alternam). */
export function plainTitle(text: string) {
  const r = parseRotating(text)
  return r ? `${r.before}${r.words[0]}${r.after}` : text
}

const motionOff = (theme: Theme) => theme.animations.intensity === 'off' || prefersReducedMotion()

// ---------- títulos ----------

type Tag = 'h1' | 'h2' | 'h3' | 'span' | 'p'

export function FxText({ text, as = 'h2', className = '', fx }: { text: string; as?: Tag; className?: string; fx?: TextFx }) {
  const { theme } = useStore()
  const effect: TextFx = motionOff(theme) ? 'none' : (fx ?? theme.animations.title ?? 'none')
  const plain = plainTitle(text)
  const cls = (extra: string) => [className, extra].filter(Boolean).join(' ')
  switch (effect) {
    case 'split':
      return createElement(as, { className: cls('fx-t fx-split'), 'aria-label': plain }, <SplitWords text={plain} unit="char" />)
    case 'blur':
      return createElement(as, { className: cls('fx-t fx-blur'), 'aria-label': plain }, <SplitWords text={plain} unit="word" />)
    case 'shiny':
      return createElement(as, { className: cls('fx-shiny') }, plain)
    case 'gradient':
      return createElement(as, { className: cls('fx-gradient') }, plain)
    case 'typewriter':
      return createElement(as, { className: cls('fx-type'), 'aria-label': plain }, <Typewriter text={plain} />)
    case 'decrypt':
      return createElement(as, { className: cls('fx-decrypt'), 'aria-label': plain }, <Decrypt text={plain} />)
    case 'rotate': {
      const r = parseRotating(text)
      return createElement(as, { className: cls('fx-rotate'), 'aria-label': plain }, r ? <Rotating {...r} /> : plain)
    }
    default:
      return createElement(as, { className: className || undefined }, plain)
  }
}

function SplitWords({ text, unit }: { text: string; unit: 'char' | 'word' }) {
  const [ref, inView] = useInView<HTMLSpanElement>()
  let i = 0
  return (
    <span ref={ref} aria-hidden className={inView ? 'fx-in' : ''}>
      {text.split(/(\s+)/).map((w, wi) =>
        /^\s+$/.test(w) ? (
          ' '
        ) : unit === 'word' ? (
          <span key={wi} className="fx-u" style={{ '--i': i++ } as React.CSSProperties}>
            {w}
          </span>
        ) : (
          <span key={wi} className="fx-w">
            {[...w].map((c, ci) => (
              <span key={ci} className="fx-u" style={{ '--i': i++ } as React.CSSProperties}>
                {c}
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  )
}

function Typewriter({ text }: { text: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!inView) return
    setN(0)
    const t = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(t), x) : x + 1)), Math.max(28, Math.min(70, 1400 / text.length)))
    return () => clearInterval(t)
  }, [inView, text])
  return (
    <span ref={ref} aria-hidden>
      {/* o texto completo invisível reserva o espaço e evita que a página pule */}
      <span className="fx-ghost">{text}</span>
      <span className="fx-live">
        {text.slice(0, n)}
        <span className="fx-caret" />
      </span>
    </span>
  )
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+?'
function Decrypt({ text }: { text: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>()
  const [out, setOut] = useState(text)
  useEffect(() => {
    if (!inView) return
    let frame = 0
    const total = 18 + text.length
    const t = setInterval(() => {
      frame++
      const fixed = Math.floor((frame / total) * text.length * 1.4)
      setOut([...text].map((c, i) => (i < fixed || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(''))
      if (fixed >= text.length) clearInterval(t)
    }, 40)
    return () => clearInterval(t)
  }, [inView, text])
  return (
    <span ref={ref} aria-hidden>
      {out}
    </span>
  )
}

function Rotating({ before, words, after }: { before: string; words: string[]; after: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % words.length), 2600)
    return () => clearInterval(t)
  }, [words.length])
  return (
    <span aria-hidden>
      {before}
      <span className="fx-rot">
        <span key={i} className="fx-rot-word">
          {words[i]}
        </span>
      </span>
      {after}
    </span>
  )
}

// ---------- fundos animados das seções ----------

export function FxBackground({ kind }: { kind: BgFx | undefined }) {
  if (!kind || kind === 'none') return null
  return (
    <div className={`fx-bg fx-bg-${kind}`} aria-hidden>
      {kind === 'aurora' && (
        <>
          <span />
          <span />
          <span />
        </>
      )}
      {kind === 'waves' && (
        <svg viewBox="0 0 1200 200" preserveAspectRatio="none">
          <path d="M0 120 Q150 70 300 120 T600 120 T900 120 T1200 120 V200 H0Z" />
          <path d="M0 140 Q150 100 300 140 T600 140 T900 140 T1200 140 V200 H0Z" />
          <path d="M0 160 Q150 130 300 160 T600 160 T900 160 T1200 160 V200 H0Z" />
        </svg>
      )}
      {kind === 'particles' && <Particles />}
    </div>
  )
}

function Particles() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const css = getComputedStyle(canvas)
    const colors = [css.getPropertyValue('--st-primary').trim() || '#888', css.getPropertyValue('--st-accent').trim() || '#bbb']
    const reduce = prefersReducedMotion() || !!canvas.closest('.i-off')
    let w = 0
    let h = 0
    let dots: { x: number; y: number; r: number; vx: number; vy: number; c: string; a: number }[] = []
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.round(Math.min(60, (w * h) / 14000))
      dots = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random() * 2.5,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -0.15 - Math.random() * 0.35,
        c: colors[(Math.random() * colors.length) | 0],
        a: 0.25 + Math.random() * 0.45,
      }))
    }
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const d of dots) {
        ctx.globalAlpha = d.a
        ctx.fillStyle = d.c
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    let raf = 0
    let visible = true
    const tick = () => {
      for (const d of dots) {
        d.x += d.vx
        d.y += d.vy
        if (d.y < -5) (d.y = h + 5), (d.x = Math.random() * w)
        if (d.x < -5) d.x = w + 5
        if (d.x > w + 5) d.x = -5
      }
      draw()
      raf = visible && !document.hidden ? requestAnimationFrame(tick) : 0
    }
    resize()
    draw()
    const ro = new ResizeObserver(() => (resize(), draw()))
    ro.observe(canvas)
    // Só anima enquanto a seção está na tela e a aba está aberta.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !raf && !reduce) raf = requestAnimationFrame(tick)
    })
    io.observe(canvas)
    const onVis = () => !document.hidden && visible && !raf && !reduce && (raf = requestAnimationFrame(tick))
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return <canvas ref={ref} />
}

// ---------- interações (cartões, botão de comprar, faíscas) ----------

/** Um só ouvinte na raiz da loja cuida de todos os cartões e botões. */
export function useFxInteractions(theme: Theme) {
  const a = theme.animations
  const hover = a.product_hover
  const pointerCard = hover === 'tilt' || hover === 'spotlight'
  const magnet = a.buy_button === 'magnet'
  const spark = a.click === 'spark'
  return useMemo(() => {
    if (motionOff(theme) || (!pointerCard && !magnet && !spark)) return {}
    let raf = 0
    return {
      onPointerMove(e: React.PointerEvent) {
        if (e.pointerType !== 'mouse') return
        const target = e.target as HTMLElement
        const x = e.clientX
        const y = e.clientY
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          if (pointerCard) {
            const card = target.closest<HTMLElement>('.pcard')
            if (card) {
              const r = card.getBoundingClientRect()
              const px = (x - r.left) / r.width
              const py = (y - r.top) / r.height
              card.style.setProperty('--mx', `${px * 100}%`)
              card.style.setProperty('--my', `${py * 100}%`)
              card.style.setProperty('--rx', `${(0.5 - py) * 10}deg`)
              card.style.setProperty('--ry', `${(px - 0.5) * 12}deg`)
            }
          }
          if (magnet) {
            const btn = target.closest<HTMLElement>('.buy')
            if (btn) {
              const r = btn.getBoundingClientRect()
              btn.style.transform = `translate(${(x - r.left - r.width / 2) * 0.2}px, ${(y - r.top - r.height / 2) * 0.3}px)`
            }
          }
        })
      },
      onPointerOut(e: React.PointerEvent) {
        const t = e.target as HTMLElement
        const related = e.relatedTarget as Node | null
        const card = t.closest<HTMLElement>('.pcard')
        if (card && !card.contains(related)) for (const v of ['--rx', '--ry']) card.style.removeProperty(v)
        const btn = t.closest<HTMLElement>('.buy')
        if (btn && !btn.contains(related)) btn.style.transform = ''
      },
      onPointerDown(e: React.PointerEvent) {
        if (!spark) return
        const s = document.createElement('div')
        s.className = 'fx-spark'
        s.style.left = `${e.clientX}px`
        s.style.top = `${e.clientY}px`
        for (let i = 0; i < 8; i++) {
          const l = document.createElement('i')
          l.style.setProperty('--a', `${i * 45}deg`)
          s.appendChild(l)
        }
        document.body.appendChild(s)
        setTimeout(() => s.remove(), 600)
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointerCard, magnet, spark, a.intensity])
}

export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight
        ref.current?.style.setProperty('transform', `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`)
      })
    }
    on()
    addEventListener('scroll', on, { passive: true })
    addEventListener('resize', on)
    return () => {
      removeEventListener('scroll', on)
      removeEventListener('resize', on)
      cancelAnimationFrame(raf)
    }
  }, [])
  return <div ref={ref} className="fx-progress" aria-hidden />
}

// ---------- contador e faixa rolante (usados pelas seções "Números" e "Faixa rolante") ----------

export function CountUp({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const { theme } = useStore()
  const [ref, inView] = useInView<HTMLSpanElement>()
  const decimals = (String(value).split('.')[1] ?? '').length
  const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const [shown, setShown] = useState(motionOff(theme) ? value : 0)
  useEffect(() => {
    if (!inView || motionOff(theme)) return setShown(value)
    const start = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 1400)
      setShown(value * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value])
  return (
    <span ref={ref} aria-label={`${prefix}${fmt(value)}${suffix}`}>
      <span aria-hidden>
        {prefix}
        {fmt(shown)}
        {suffix}
      </span>
    </span>
  )
}

export function Marquee({ children, speed, reverse }: { children: ReactNode; speed: 'slow' | 'normal' | 'fast'; reverse: boolean }) {
  return (
    <div className={`fx-marquee sp-${speed} ${reverse ? 'rev' : ''}`}>
      <div className="fx-track">
        <div className="fx-group">{children}</div>
        <div className="fx-group" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  )
}
