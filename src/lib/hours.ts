import type { StoreSettings } from './types'

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Dia da semana (0 = domingo) e "HH:MM" no horário de Brasília. */
export function brasiliaClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { day, time: `${get('hour')}:${get('minute')}` }
}

export function openState(hours: StoreSettings['hours'], now = new Date()): { open: boolean; message: string } {
  if (hours.paused) return { open: false, message: 'A loja está pausada no momento.' }
  if (!hours.enabled) return { open: true, message: '' }
  const { day, time } = brasiliaClock(now)
  const today = hours.days[day]
  if (today?.open && time >= today.from && time < today.to) return { open: true, message: '' }
  for (let i = 0; i < 7; i++) {
    const d = (day + i) % 7
    const h = hours.days[d]
    if (!h?.open) continue
    if (i === 0 && time >= h.from) continue
    const when = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : WEEKDAYS[d].toLowerCase()
    return { open: false, message: `Estamos fechados agora. Abrimos ${when} às ${h.from}.` }
  }
  return { open: false, message: 'Estamos fechados agora.' }
}
