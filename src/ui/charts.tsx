// Gráficos simples em SVG, feitos à mão (sem biblioteca).
// - Responsivos: medem a largura do contêiner e desenham com viewBox na largura real (width 100%),
//   então o texto continua legível no celular.
// - Acessíveis: role="img" + aria-label com o resumo dos dados; a tabela abaixo do gráfico é a
//   alternativa completa. Navegação por teclado (setas) mostra o mesmo que o mouse.
// - Cores: uma cor por série (azul), período anterior em cinza claro, sequencial azul no mapa de calor.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface ChartPoint {
  label: string
  value: number
}

const C = {
  series: '#257de0',
  seriesWash: 'rgba(37, 125, 224, 0.10)',
  second: '#f47230',
  prev: '#b4b2ab',
  grid: '#e7e6e1',
  axis: '#c2c0b8',
  ink: '#1d1d1b',
  muted: '#66655f',
  surface: '#ffffff',
  empty: '#f1f0ec',
  ramp: ['#cce3fd', '#84b9f3', '#338ced', '#2370cd', '#1757ac', '#0e3d7e'],
}
const FONT = 12
const CHAR = 6.6 // largura média de um caractere a 12px

function useWidth(initial = 600) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(Math.max(240, Math.floor(el.clientWidth)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Corta o texto para caber em `px` pixels. */
export function fit(text: string, px: number) {
  const max = Math.max(3, Math.floor(px / CHAR))
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…'
}

/** Marcas "redondas" do eixo: 0, 250, 500… */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

interface Tip {
  x: number
  y: number
  title: string
  rows: { key?: 'line' | 'prev' | 'bar' | 'second'; label: string; value: string }[]
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null
  const left = Math.min(Math.max(8, tip.x + 12), width - 188)
  return (
    <div className="chart-tip" style={{ left, top: Math.max(0, tip.y - 8) }} aria-hidden>
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="chart-tip-row">
          {r.key && <span className={`chart-key ${r.key}`} />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

function Frame({ boxRef, children, legend }: { boxRef: React.RefObject<HTMLDivElement | null>; children: ReactNode; legend?: ReactNode }) {
  return (
    <div className="chart" ref={boxRef}>
      {legend && <div className="chart-legend">{legend}</div>}
      {children}
    </div>
  )
}

function useArrowIndex(n: number) {
  const [i, setI] = useState<number | null>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    if (!n) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setI((x) => (x == null ? 0 : Math.min(n - 1, x + 1)))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setI((x) => (x == null ? n - 1 : Math.max(0, x - 1)))
    else if (e.key === 'Escape') setI(null)
    else return
    e.preventDefault()
  }
  return { i, setI, onKeyDown, onBlur: () => setI(null) }
}

/** Barra com a ponta arredondada (4px) e a base reta. */
function hBarPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, w, h / 2)
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`
}
function vBarPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

// ---------- Linha ----------

export function LineChart({
  points,
  prev,
  name,
  prevName = 'Período anterior',
  format,
  formatAxis = format,
  label,
  height = 220,
}: {
  points: ChartPoint[]
  prev?: ChartPoint[]
  name: string
  prevName?: string
  format: (n: number) => string
  formatAxis?: (n: number) => string
  label: string
  height?: number
}) {
  const [ref, W] = useWidth()
  const nav = useArrowIndex(points.length)
  const max = Math.max(0, ...points.map((p) => p.value), ...(prev ?? []).map((p) => p.value))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const padL = Math.max(...ticks.map((t) => formatAxis(t).length)) * CHAR + 10
  const padR = 12
  const padT = 10
  const padB = 26
  const pw = W - padL - padR
  const ph = height - padT - padB
  const n = points.length
  const x = (i: number) => padL + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw)
  const y = (v: number) => padT + ph - (v / top) * ph
  const path = (ps: ChartPoint[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const maxLabels = Math.max(2, Math.floor(pw / 64))
  const step = Math.max(1, Math.ceil(n / maxLabels))
  const xLabels = points.map((_, i) => i).filter((i) => i % step === 0)
  if (n > 1 && xLabels[xLabels.length - 1] !== n - 1) {
    if (n - 1 - xLabels[xLabels.length - 1] < step * 0.6) xLabels.pop()
    xLabels.push(n - 1)
  }
  const hi = nav.i
  const total = points.reduce((a, p) => a + p.value, 0)
  const peak = points.reduce((a, p) => (p.value > a.value ? p : a), points[0] ?? { label: '', value: 0 })
  const aria = `${label}. ${n} pontos, de ${points[0]?.label ?? ''} a ${points[n - 1]?.label ?? ''}. Total ${format(total)}${
    prev ? `, contra ${format(prev.reduce((a, p) => a + p.value, 0))} no período anterior` : ''
  }. Maior valor: ${format(peak.value)} em ${peak.label}.`

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    nav.setI(n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - padL) / pw) * (n - 1)))))
  }
  const tip: Tip | null =
    hi == null
      ? null
      : {
          x: x(hi),
          y: padT,
          title: points[hi].label,
          rows: [
            { key: 'line', label: name, value: format(points[hi].value) },
            ...(prev?.[hi] ? [{ key: 'prev' as const, label: prevName, value: format(prev[hi].value) }] : []),
          ],
        }

  return (
    <Frame
      boxRef={ref}
      legend={
        prev && (
          <>
            <span>
              <span className="chart-key line" /> {name}
            </span>
            <span>
              <span className="chart-key prev" /> {prevName}
            </span>
          </>
        )
      }
    >
      <svg
        viewBox={`0 0 ${W} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={aria}
        tabIndex={0}
        onKeyDown={nav.onKeyDown}
        onBlur={nav.onBlur}
        onPointerMove={onMove}
        onPointerLeave={() => nav.setI(null)}
        style={{ touchAction: 'pan-y' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t ? C.grid : C.axis} strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={FONT} fill={C.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatAxis(t)}
            </text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={FONT} fill={C.muted}>
            {points[i].label}
          </text>
        ))}
        {prev && prev.length > 0 && <path d={path(prev)} fill="none" stroke={C.prev} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {n > 1 && <path d={`${path(points)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={C.seriesWash} />}
        <path d={path(points)} fill="none" stroke={C.series} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {n > 0 && <circle cx={x(n - 1)} cy={y(points[n - 1].value)} r={4} fill={C.series} stroke={C.surface} strokeWidth={2} />}
        {hi != null && (
          <g pointerEvents="none">
            <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + ph} stroke={C.axis} strokeWidth={1} />
            {prev?.[hi] && <circle cx={x(hi)} cy={y(prev[hi].value)} r={4} fill={C.prev} stroke={C.surface} strokeWidth={2} />}
            <circle cx={x(hi)} cy={y(points[hi].value)} r={5} fill={C.series} stroke={C.surface} strokeWidth={2} />
          </g>
        )}
      </svg>
      <Tooltip tip={tip} width={W} />
    </Frame>
  )
}

// ---------- Barras horizontais ----------

export function BarChart({ items, format, label, color = C.series }: { items: ChartPoint[]; format: (n: number) => string; label: string; color?: string }) {
  const [ref, W] = useWidth()
  const nav = useArrowIndex(items.length)
  const barH = 16
  const values = items.map((d) => format(d.value))
  const valW = Math.max(...values.map((v) => v.length), 1) * CHAR + 10
  const longest = Math.max(...items.map((d) => d.label.length), 4) * CHAR + 16
  // Em tela estreita, nomes longos vão para cima da barra em vez de serem cortados.
  const stacked = longest > W * 0.42 && W < 560
  const rowH = stacked ? 44 : 32
  const labelW = stacked ? 0 : Math.min(W * 0.42, longest)
  const max = Math.max(0, ...items.map((d) => d.value)) || 1
  const pw = Math.max(20, W - labelW - valW - 4)
  const H = items.length * rowH + 4
  const hi = nav.i
  const aria = `${label}. ${items
    .slice(0, 5)
    .map((d, i) => `${d.label}: ${values[i]}`)
    .join('; ')}${items.length > 5 ? `; e mais ${items.length - 5}` : ''}.`
  return (
    <Frame boxRef={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={aria} tabIndex={0} onKeyDown={nav.onKeyDown} onBlur={nav.onBlur} onPointerLeave={() => nav.setI(null)}>
        <line x1={labelW} x2={labelW} y1={stacked ? 18 : 0} y2={H} stroke={C.axis} strokeWidth={1} />
        {items.map((d, i) => {
          const y0 = i * rowH + 2
          const w = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * pw)
          const by = stacked ? y0 + 20 : y0 + (rowH - barH) / 2
          return (
            <g key={i} onPointerEnter={() => nav.setI(i)} opacity={hi == null || hi === i ? 1 : 0.55}>
              <rect x={0} y={y0} width={W} height={rowH} fill="transparent" />
              <text x={stacked ? 0 : labelW - 8} y={stacked ? y0 + 13 : y0 + rowH / 2 + 4} textAnchor={stacked ? 'start' : 'end'} fontSize={FONT} fill={C.ink}>
                {fit(d.label, stacked ? W : labelW - 8)}
              </text>
              {w > 0 && <path d={hBarPath(labelW + 1, by, w, barH)} fill={color} />}
              <text x={labelW + 1 + w + 6} y={by + barH / 2 + 4} fontSize={FONT} fill={C.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {values[i]}
              </text>
            </g>
          )
        })}
      </svg>
      <Tooltip tip={hi == null ? null : { x: labelW, y: hi * rowH + rowH, title: items[hi].label, rows: [{ key: 'bar', label: '', value: values[hi] }] }} width={W} />
    </Frame>
  )
}

// ---------- Mapa de calor (7 dias × 24 horas) ----------

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DAYS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export function Heatmap({ values, format, label }: { values: number[][]; format: (n: number) => string; label: string }) {
  const [ref, W] = useWidth()
  const [cell, setCell] = useState<[number, number] | null>(null)
  const padL = 34
  const padT = 18
  const cw = (W - padL) / 24
  const ch = Math.max(18, Math.min(28, cw))
  const H = padT + 7 * ch + 34
  const max = Math.max(0, ...values.flat())
  const color = (v: number) => (v <= 0 ? C.empty : C.ramp[Math.min(C.ramp.length - 1, Math.floor((v / max) * C.ramp.length - 1e-9))])
  const hourStep = cw < 18 ? 6 : 3
  let best: [number, number] = [0, 0]
  values.forEach((r, d) => r.forEach((v, h) => v > values[best[0]][best[1]] && (best = [d, h])))
  const aria = max
    ? `${label}. Maior movimento: ${DAYS_FULL[best[0]].toLowerCase()} às ${best[1]}h, com ${format(max)}. A tabela abaixo traz os números por dia e turno.`
    : `${label}. Sem dados no período.`
  const onKeyDown = (e: KeyboardEvent) => {
    const [d, h] = cell ?? [0, 0]
    const moves: Record<string, [number, number]> = { ArrowRight: [d, Math.min(23, h + 1)], ArrowLeft: [d, Math.max(0, h - 1)], ArrowDown: [Math.min(6, d + 1), h], ArrowUp: [Math.max(0, d - 1), h] }
    if (moves[e.key]) {
      e.preventDefault()
      setCell(cell ? moves[e.key] : [0, 0])
    } else if (e.key === 'Escape') setCell(null)
  }
  return (
    <Frame boxRef={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={aria} tabIndex={0} onKeyDown={onKeyDown} onBlur={() => setCell(null)} onPointerLeave={() => setCell(null)}>
        {Array.from({ length: 24 }, (_, h) =>
          h % hourStep === 0 ? (
            <text key={h} x={padL + h * cw + 1} y={12} fontSize={11} fill={C.muted}>
              {h}h
            </text>
          ) : null,
        )}
        {values.map((row, d) => (
          <g key={d}>
            <text x={0} y={padT + d * ch + ch / 2 + 4} fontSize={FONT} fill={C.ink}>
              {DAYS[d]}
            </text>
            {row.map((v, h) => {
              const on = cell && cell[0] === d && cell[1] === h
              return (
                <rect
                  key={h}
                  x={padL + h * cw + 1}
                  y={padT + d * ch + 1}
                  width={Math.max(1, cw - 2)}
                  height={ch - 2}
                  rx={2}
                  fill={color(v)}
                  stroke={on ? C.ink : 'none'}
                  strokeWidth={on ? 1.5 : 0}
                  onPointerEnter={() => setCell([d, h])}
                />
              )
            })}
          </g>
        ))}
        <g transform={`translate(${padL}, ${padT + 7 * ch + 12})`}>
          <text x={0} y={10} fontSize={11} fill={C.muted}>
            menos
          </text>
          {[C.empty, ...C.ramp].map((c, i) => (
            <rect key={i} x={40 + i * 16} y={1} width={14} height={12} rx={2} fill={c} />
          ))}
          <text x={40 + (C.ramp.length + 1) * 16 + 4} y={10} fontSize={11} fill={C.muted}>
            mais (até {format(max)})
          </text>
        </g>
      </svg>
      <Tooltip
        tip={cell ? { x: padL + cell[1] * cw, y: padT + (cell[0] + 1) * ch, title: `${DAYS_FULL[cell[0]]}, ${cell[1]}h às ${cell[1] + 1}h`, rows: [{ label: '', value: format(values[cell[0]][cell[1]]) }] } : null}
        width={W}
      />
    </Frame>
  )
}

// ---------- Funil ----------

export function Funnel({ steps, format, label }: { steps: ChartPoint[]; format: (n: number) => string; label: string }) {
  const [ref, W] = useWidth()
  const nav = useArrowIndex(steps.length)
  const labelH = 20
  const barH = 24
  const gap = 22
  const rowH = labelH + barH + gap
  const H = steps.length * rowH - gap + 4
  const max = steps[0]?.value || 1
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const widthOf = (v: number) => Math.max(v > 0 ? 4 : 0, (v / max) * W)
  const hi = nav.i
  const aria = `${label}. ${steps.map((s, i) => `${s.label}: ${format(s.value)}${i ? ` (${pct(s.value, steps[i - 1].value)} da etapa anterior)` : ''}`).join('; ')}.`
  return (
    <Frame boxRef={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={aria} tabIndex={0} onKeyDown={nav.onKeyDown} onBlur={nav.onBlur} onPointerLeave={() => nav.setI(null)}>
        {steps.map((s, i) => {
          const y0 = i * rowH
          const w = widthOf(s.value)
          const x0 = (W - w) / 2
          const next = steps[i + 1]
          const nw = next ? widthOf(next.value) : 0
          const right = `${format(s.value)} · ${pct(s.value, max)}`
          return (
            <g key={i} onPointerEnter={() => nav.setI(i)} opacity={hi == null || hi === i ? 1 : 0.6}>
              <rect x={0} y={y0} width={W} height={labelH + barH} fill="transparent" />
              <text x={0} y={y0 + 14} fontSize={FONT + 1} fill={C.ink} fontWeight={600}>
                {fit(s.label, W - right.length * CHAR - 16)}
              </text>
              <text x={W} y={y0 + 14} textAnchor="end" fontSize={FONT} fill={C.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {right}
              </text>
              {w > 0 && <rect x={x0} y={y0 + labelH} width={w} height={barH} rx={4} fill={C.series} />}
              {next && (
                <>
                  <path
                    d={`M${x0},${y0 + labelH + barH + 2}L${x0 + w},${y0 + labelH + barH + 2}L${(W + nw) / 2},${y0 + rowH + labelH - 2}L${(W - nw) / 2},${y0 + rowH + labelH - 2}Z`}
                    fill={C.seriesWash}
                  />
                  <text x={W / 2} y={y0 + labelH + barH + 15} textAnchor="middle" fontSize={11} fill={C.muted}>
                    {s.value ? `${pct(s.value - next.value, s.value)} param aqui` : ''}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>
      <Tooltip
        tip={
          hi == null
            ? null
            : {
                x: W / 2 - 90,
                y: hi * rowH + labelH + barH,
                title: steps[hi].label,
                rows: [
                  { key: 'bar', label: 'visitas', value: format(steps[hi].value) },
                  ...(hi ? [{ label: 'seguiram da etapa anterior', value: pct(steps[hi].value, steps[hi - 1].value) }] : []),
                ],
              }
        }
        width={W}
      />
    </Frame>
  )
}

// ---------- Pareto (barras de participação + linha acumulada, no mesmo eixo de 0 a 100%) ----------

export function Pareto({ items, format, label, height = 240 }: { items: ChartPoint[]; format: (n: number) => string; label: string; height?: number }) {
  const [ref, W] = useWidth()
  const nav = useArrowIndex(items.length)
  const total = items.reduce((a, d) => a + d.value, 0) || 1
  let acc = 0
  const rows = items.map((d) => {
    const before = acc / total
    acc += d.value
    return { ...d, share: d.value / total, cum: acc / total, cls: before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C' }
  })
  const padL = 40
  const padR = 8
  const padT = 22
  const padB = 22
  const pw = W - padL - padR
  const ph = height - padT - padB
  const n = rows.length
  const band = n ? pw / n : pw
  const bw = Math.max(2, Math.min(24, band - 2))
  const cx = (i: number) => padL + band * i + band / 2
  const y = (v: number) => padT + ph - v * ph
  const hi = nav.i
  const nA = rows.filter((r) => r.cls === 'A').length
  const aria = `${label}. ${n} produtos; ${nA} deles (classe A) somam 80% da receita. O mais vendido, ${rows[0]?.label ?? ''}, tem ${Math.round((rows[0]?.share ?? 0) * 100)}%.`
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    nav.setI(n ? Math.max(0, Math.min(n - 1, Math.floor((px - padL) / band))) : null)
  }
  const boundaries = rows.map((r, i) => (i > 0 && r.cls !== rows[i - 1].cls ? i : -1)).filter((i) => i > 0)
  const regions = (['A', 'B', 'C'] as const)
    .map((k) => ({ k, first: rows.findIndex((r) => r.cls === k), count: rows.filter((r) => r.cls === k).length }))
    .filter((r) => r.count)
  return (
    <Frame
      boxRef={ref}
      legend={
        <>
          <span>
            <span className="chart-key bar" /> Participação na receita
          </span>
          <span>
            <span className="chart-key second" /> % acumulado
          </span>
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label={aria} tabIndex={0} onKeyDown={nav.onKeyDown} onBlur={nav.onBlur} onPointerMove={onMove} onPointerLeave={() => nav.setI(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t ? C.grid : C.axis} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={FONT} fill={C.muted}>
              {t * 100}%
            </text>
          </g>
        ))}
        {boundaries.map((i) => (
          <line key={i} x1={padL + band * i} x2={padL + band * i} y1={padT - 4} y2={padT + ph} stroke={C.axis} strokeWidth={1} />
        ))}
        {regions.map((r) => {
          const mid = padL + band * (r.first + r.count / 2)
          return r.count * band >= 16 ? (
            <text key={r.k} x={mid} y={12} textAnchor="middle" fontSize={FONT} fill={C.muted} fontWeight={600}>
              {r.count * band >= 70 ? `Classe ${r.k}` : r.k}
            </text>
          ) : null
        })}
        {rows.map((r, i) => (
          <path key={i} d={vBarPath(cx(i) - bw / 2, y(r.share), bw, Math.max(1, r.share * ph))} fill={C.series} opacity={hi == null || hi === i ? 1 : 0.55} />
        ))}
        {n > 0 && <path d={rows.map((r, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(r.cum).toFixed(1)}`).join('')} fill="none" stroke={C.second} strokeWidth={2} strokeLinejoin="round" />}
        {rows.map((r, i) => (n <= 24 || i === hi ? <circle key={i} cx={cx(i)} cy={y(r.cum)} r={hi === i ? 5 : 3} fill={C.second} stroke={C.surface} strokeWidth={2} /> : null))}
        {band >= 16 &&
          rows.map((_, i) => (
            <text key={i} x={cx(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={C.muted}>
              {i + 1}
            </text>
          ))}
      </svg>
      <Tooltip
        tip={
          hi == null
            ? null
            : {
                x: cx(hi),
                y: padT,
                title: `${hi + 1}. ${rows[hi].label} (classe ${rows[hi].cls})`,
                rows: [
                  { key: 'bar', label: format(rows[hi].value), value: `${Math.round(rows[hi].share * 1000) / 10}%`.replace('.', ',') },
                  { key: 'second', label: 'acumulado', value: `${Math.round(rows[hi].cum * 1000) / 10}%`.replace('.', ',') },
                ],
              }
        }
        width={W}
      />
    </Frame>
  )
}
