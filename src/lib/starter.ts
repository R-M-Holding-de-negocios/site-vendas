// Ponto de partida da loja conforme o ramo escolhido na criação: visual e textos do banner.
// Tudo pode ser mudado depois em Aparência.
import { defaultTheme, PRESETS } from './theme'
import type { Theme } from './types'

export interface Segment {
  id: string
  label: string
  preset: string
  title: string
  text: string
  button: string
}

export const SEGMENTS: Segment[] = [
  { id: 'comida', label: 'Doces e comida', preset: 'doce', title: 'Feito com carinho, todo dia', text: 'Faça sua encomenda pelo site', button: 'Ver o cardápio' },
  { id: 'moda', label: 'Roupas e acessórios', preset: 'moda', title: 'Novidades da coleção', text: 'Peças escolhidas a dedo para você', button: 'Ver as peças' },
  { id: 'artesanato', label: 'Artesanato e decoração', preset: 'artesanal', title: 'Feito à mão, peça por peça', text: 'Cada item é único', button: 'Conhecer as peças' },
  { id: 'beleza', label: 'Beleza e bem-estar', preset: 'natural', title: 'Cuidado que faz bem', text: 'Produtos selecionados para a sua rotina', button: 'Ver os produtos' },
  { id: 'tech', label: 'Eletrônicos e acessórios', preset: 'tech', title: 'Tecnologia com bom preço', text: 'Envio rápido e atendimento pelo WhatsApp', button: 'Ver os produtos' },
  { id: 'outro', label: 'Outro', preset: 'classico', title: 'Bem-vindo à nossa loja', text: 'Confira as novidades', button: 'Ver produtos' },
]

export function starterTheme(segmentId: string): Theme {
  const seg = SEGMENTS.find((s) => s.id === segmentId) ?? SEGMENTS[SEGMENTS.length - 1]
  const preset = PRESETS.find((p) => p.id === seg.preset) ?? PRESETS[0]
  const t = preset.apply(defaultTheme())
  return {
    ...t,
    sections: t.sections.map((s) => (s.type === 'banner' ? { ...s, props: { ...s.props, title: seg.title, text: seg.text, button: seg.button } } : s)),
  }
}
