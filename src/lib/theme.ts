import type { BgFx, TextFx, DayHours, MenuItem, Section, SectionType, StoreSettings, Theme } from './types'
import { uid } from './util'

export const FONT_PAIRS: { id: string; name: string; head: string; body: string }[] = [
  { id: 'system', name: 'Padrão do aparelho', head: 'system-ui', body: 'system-ui' },
  { id: 'inter', name: 'Inter', head: 'Inter', body: 'Inter' },
  { id: 'poppins', name: 'Poppins', head: 'Poppins', body: 'Poppins' },
  { id: 'montserrat', name: 'Montserrat e Open Sans', head: 'Montserrat', body: 'Open Sans' },
  { id: 'playfair', name: 'Playfair e Lato', head: 'Playfair Display', body: 'Lato' },
  { id: 'dmserif', name: 'DM Serif e DM Sans', head: 'DM Serif Display', body: 'DM Sans' },
  { id: 'fraunces', name: 'Fraunces e Work Sans', head: 'Fraunces', body: 'Work Sans' },
  { id: 'nunito', name: 'Nunito', head: 'Nunito', body: 'Nunito' },
  { id: 'quicksand', name: 'Quicksand e Mulish', head: 'Quicksand', body: 'Mulish' },
  { id: 'oswald', name: 'Oswald e Roboto', head: 'Oswald', body: 'Roboto' },
  { id: 'bebas', name: 'Bebas Neue e Rubik', head: 'Bebas Neue', body: 'Rubik' },
  { id: 'cormorant', name: 'Cormorant e Raleway', head: 'Cormorant Garamond', body: 'Raleway' },
  { id: 'spacegrotesk', name: 'Space Grotesk e IBM Plex Sans', head: 'Space Grotesk', body: 'IBM Plex Sans' },
  { id: 'pacifico', name: 'Pacifico e Nunito', head: 'Pacifico', body: 'Nunito' },
  { id: 'josefin', name: 'Josefin Sans e Karla', head: 'Josefin Sans', body: 'Karla' },
]

export function fontStack(name: string, serif = false) {
  return name === 'system-ui'
    ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    : `'${name}', ${serif ? 'Georgia, serif' : 'system-ui, sans-serif'}`
}

/** Carrega as fontes do Google Fonts sob demanda. */
export function loadFont(id: string) {
  const pair = FONT_PAIRS.find((f) => f.id === id)
  if (!pair || pair.id === 'system') return
  const href =
    'https://fonts.googleapis.com/css2?' +
    [...new Set([pair.head, pair.body])].map((f) => `family=${f.replace(/ /g, '+')}:wght@400;600;700`).join('&') +
    '&display=swap'
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

export const SECTION_INFO: Record<SectionType, { name: string; plan: 'vitrine' | 'loja' | 'pro'; help: string }> = {
  banner: { name: 'Banner principal', plan: 'vitrine', help: 'Uma imagem grande com texto e botão' },
  carousel: { name: 'Carrossel de banners', plan: 'loja', help: 'Várias imagens que trocam sozinhas' },
  video: { name: 'Vídeo', plan: 'loja', help: 'Vídeo do YouTube com texto' },
  categories: { name: 'Categorias em destaque', plan: 'vitrine', help: 'Atalhos para as categorias' },
  products: { name: 'Vitrine de produtos', plan: 'vitrine', help: 'Grade ou carrossel de produtos' },
  featured_product: { name: 'Produto em destaque', plan: 'loja', help: 'Um produto com foto grande' },
  image_text: { name: 'Imagem com texto', plan: 'loja', help: 'Imagem de um lado, texto do outro' },
  text: { name: 'Texto livre', plan: 'loja', help: 'Título e parágrafo' },
  gallery: { name: 'Galeria de fotos', plan: 'loja', help: 'Grade de imagens' },
  testimonials: { name: 'Depoimentos', plan: 'loja', help: 'O que os clientes dizem' },
  benefits: { name: 'Vantagens', plan: 'loja', help: 'Ícones com frases curtas' },
  faq: { name: 'Perguntas frequentes', plan: 'loja', help: 'Perguntas que abrem e fecham' },
  map: { name: 'Mapa e horário', plan: 'loja', help: 'Endereço, mapa e horários' },
  countdown: { name: 'Contagem regressiva', plan: 'pro', help: 'Relógio até o fim de uma promoção' },
  posts: { name: 'Posts recentes', plan: 'pro', help: 'Os últimos posts da loja' },
  lead: { name: 'Captação de contatos', plan: 'pro', help: 'Campo para o visitante deixar o WhatsApp' },
  marquee: { name: 'Faixa rolante', plan: 'loja', help: 'Frases ou logos passando sem parar' },
  stats: { name: 'Números', plan: 'loja', help: 'Números que contam até o valor (ex.: +500 clientes)' },
}

export function newSection(type: SectionType): Section {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: Record<SectionType, Record<string, any>> = {
    banner: { image: '', image_mobile: '', title: 'Bem-vindo à nossa loja', text: 'Confira as novidades', button: 'Ver produtos', link: '#produtos', align: 'center', overlay: 35, height: 'm' },
    carousel: {
      slides: [
        { image: '', image_mobile: '', title: 'Novidades da semana', text: '', button: 'Comprar', link: '' },
        { image: '', image_mobile: '', title: 'Frete grátis', text: 'Nas compras acima do valor mínimo', button: '', link: '' },
      ],
      height: 'm',
    },
    video: { url: '', title: '', text: '' },
    categories: { title: 'Categorias', ids: [], shape: 'circle' },
    products: { title: 'Destaques', source: 'featured', category_id: '', ids: [], layout: 'grid', limit: 8 },
    featured_product: { product_id: '', title: '', text: '' },
    image_text: { image: '', title: 'Nossa história', text: 'Conte aqui como a loja começou.', button: '', link: '', reverse: false },
    text: { title: 'Sobre nós', text: 'Escreva aqui um texto sobre a loja.', align: 'center' },
    gallery: { title: '', images: [], columns: 3 },
    testimonials: {
      title: 'Quem comprou recomenda',
      items: [
        { name: 'Maria', text: 'Chegou rapidinho e é tudo muito caprichado!', rating: 5, photo: '' },
        { name: 'João', text: 'Atendimento excelente pelo WhatsApp.', rating: 5, photo: '' },
      ],
    },
    benefits: {
      items: [
        { icon: 'truck', text: 'Entrega rápida' },
        { icon: 'shield', text: 'Pagamento seguro' },
        { icon: 'chat', text: 'Atendimento pelo WhatsApp' },
      ],
    },
    faq: {
      title: 'Perguntas frequentes',
      items: [
        { q: 'Qual o prazo de entrega?', a: 'Entregamos em até 2 dias úteis na cidade.' },
        { q: 'Posso trocar?', a: 'Sim, em até 7 dias após o recebimento.' },
      ],
    },
    map: { title: 'Onde estamos', address: '', show_hours: true },
    countdown: { title: 'A promoção termina em', ends_at: '', button: 'Aproveitar', link: '' },
    posts: { title: 'Do nosso blog', limit: 3 },
    lead: { title: 'Ganhe 10% na primeira compra', text: 'Deixe seu WhatsApp e receba o cupom.', button: 'Quero o cupom' },
    marquee: {
      items: [{ text: 'Feito à mão', image: '' }, { text: 'Entrega no mesmo dia', image: '' }, { text: 'Pix com desconto', image: '' }],
      speed: 'normal',
      direction: 'left',
      size: 'm',
    },
    stats: {
      title: '',
      items: [
        { value: 500, prefix: '+', suffix: '', label: 'clientes felizes' },
        { value: 4.9, prefix: '', suffix: '', label: 'nota média' },
        { value: 8, prefix: '', suffix: ' anos', label: 'de experiência' },
      ],
    },
  }
  return {
    id: uid(),
    type,
    enabled: true,
    props: structuredClone(props[type]),
    style: { bg: '', width: 'contained', pad: 'm', device: 'all', fx: 'none' },
  }
}

// ---------- Efeitos (implementação própria em store/fx.tsx, inspirada em efeitos comuns da web) ----------

export const TEXT_FX: [TextFx, string, string][] = [
  ['none', 'Sem efeito', ''],
  ['split', 'Letras subindo', 'As letras aparecem uma a uma, de baixo para cima'],
  ['blur', 'Desfoque', 'As palavras surgem saindo do desfoque'],
  ['shiny', 'Brilho', 'Um reflexo passa pelo texto de tempos em tempos'],
  ['gradient', 'Degradê animado', 'As cores da loja correm pelo texto'],
  ['typewriter', 'Máquina de escrever', 'O texto é digitado com um cursor piscando'],
  ['decrypt', 'Embaralhado', 'Letras sorteadas que se ajeitam no texto certo'],
  ['rotate', 'Palavras que trocam', 'Escreva {opção 1|opção 2|opção 3} no título e elas se alternam'],
]

export const BG_FX: [BgFx, string][] = [
  ['none', 'Nenhum'],
  ['aurora', 'Aurora (manchas de cor em movimento)'],
  ['gradient', 'Degradê que se move'],
  ['dots', 'Pontinhos'],
  ['grid', 'Quadriculado'],
  ['waves', 'Ondas'],
  ['particles', 'Partículas flutuando'],
  ['rays', 'Raios de luz'],
  ['grain', 'Textura granulada'],
]

const homeMenu = (): MenuItem => ({ label: 'Início', type: 'home', target: '', children: [] })

export function defaultTheme(): Theme {
  return {
    preset: 'classico',
    colors: { primary: '#1f5c4a', background: '#fbfaf7', surface: '#ffffff', text: '#1d1d1b', muted: '#6b6a65', accent: '#e8b04a' },
    font: 'system',
    radius: 'rounded',
    spacing: 'normal',
    header: { logo_align: 'left', sticky: true, transparent: false, logo_size: 40 },
    menu: [homeMenu()],
    announcement: { enabled: false, messages: ['Frete grátis nas compras acima de R$ 150'], link: '' },
    sections: [
      newSection('banner'),
      newSection('categories'),
      { ...newSection('products'), props: { title: 'Destaques', source: 'featured', category_id: '', ids: [], layout: 'grid', limit: 8 } },
      { ...newSection('products'), props: { title: 'Todos os produtos', source: 'all', category_id: '', ids: [], layout: 'grid', limit: 24 } },
    ],
    product: {
      ratio: '1/1',
      fit: 'cover',
      cols_mobile: 2,
      cols_desktop: 4,
      card: { add_button: true, badge: true, installments: false, rating: false },
      gallery: 'below',
      blocks: [
        { id: 'stock', enabled: true },
        { id: 'shipping', enabled: true },
        { id: 'share', enabled: true },
        { id: 'related', enabled: true },
        { id: 'reviews', enabled: true },
      ],
      buy_label: 'Adicionar ao carrinho',
    },
    footer: { text: '', show_payments: true, columns: [] },
    animations: {
      intensity: 'soft',
      sections: 'fade',
      product_hover: 'zoom',
      carousel: 'slide',
      carousel_seconds: 5,
      buy_button: 'none',
      header: 'none',
      cart_bounce: true,
      announcement: 'static',
      page: 'none',
      title: 'none',
      click: 'none',
      stagger: true,
      scroll_progress: false,
    },
    whatsapp_button: true,
    hide_branding: false,
  }
}

type Preset = { id: string; name: string; for: string; apply: (t: Theme) => Theme }
export const PRESETS: Preset[] = [
  { id: 'classico', name: 'Clássico', for: 'Qualquer loja', apply: (t) => ({ ...t, preset: 'classico' }) },
  {
    id: 'doce',
    name: 'Doce',
    for: 'Comida e confeitaria',
    apply: (t) => ({
      ...t,
      preset: 'doce',
      colors: { primary: '#b8466b', background: '#fff7f4', surface: '#ffffff', text: '#3a2229', muted: '#8a6d74', accent: '#f2b84b' },
      font: 'quicksand',
      radius: 'pill',
    }),
  },
  {
    id: 'moda',
    name: 'Moda',
    for: 'Roupas e acessórios',
    apply: (t) => ({
      ...t,
      preset: 'moda',
      colors: { primary: '#111111', background: '#ffffff', surface: '#f5f4f2', text: '#111111', muted: '#707070', accent: '#c2410c' },
      font: 'cormorant',
      radius: 'square',
      header: { ...t.header, logo_align: 'center' },
      product: { ...t.product, ratio: '4/5', cols_desktop: 3 },
    }),
  },
  {
    id: 'artesanal',
    name: 'Artesanal',
    for: 'Artesanato e decoração',
    apply: (t) => ({
      ...t,
      preset: 'artesanal',
      colors: { primary: '#7a4b2a', background: '#f7f1e8', surface: '#fffdf9', text: '#2f241c', muted: '#7b6a5c', accent: '#5f7a4a' },
      font: 'fraunces',
      radius: 'rounded',
    }),
  },
  {
    id: 'tech',
    name: 'Tecnologia',
    for: 'Eletrônicos e acessórios',
    apply: (t) => ({
      ...t,
      preset: 'tech',
      colors: { primary: '#2453d6', background: '#f4f6fa', surface: '#ffffff', text: '#0f172a', muted: '#5b6478', accent: '#0ea5a4' },
      font: 'spacegrotesk',
      radius: 'rounded',
      spacing: 'compact',
    }),
  },
  {
    id: 'natural',
    name: 'Natural',
    for: 'Cosméticos e bem-estar',
    apply: (t) => ({
      ...t,
      preset: 'natural',
      colors: { primary: '#3f6b4f', background: '#f6f7f2', surface: '#ffffff', text: '#1f2a22', muted: '#66715f', accent: '#d39b6a' },
      font: 'josefin',
      radius: 'pill',
      spacing: 'wide',
    }),
  },
]

const hours = (open: boolean): DayHours => ({ open, from: '09:00', to: '18:00' })

export function defaultSettings(): StoreSettings {
  return {
    instagram: '',
    facebook: '',
    tiktok: '',
    email: '',
    legal: { name: '', document: '', address: '' },
    policies: {
      exchange:
        'Você pode desistir da compra em até 7 dias após o recebimento, conforme o Código de Defesa do Consumidor. Para trocas por defeito, fale conosco pelo WhatsApp em até 30 dias. O produto deve ser devolvido sem sinais de uso e na embalagem original.',
      shipping:
        'Os pedidos são preparados no prazo informado no fechamento da compra. O prazo de entrega começa a contar após a confirmação do pagamento.',
      privacy:
        'Usamos seu nome, telefone, e-mail e endereço apenas para processar e entregar o pedido e falar com você sobre ele. Não vendemos nem compartilhamos seus dados com terceiros, exceto com as empresas de pagamento e entrega necessárias para concluir a compra. Você pode pedir a exclusão dos seus dados pelo nosso WhatsApp.',
    },
    hours: { enabled: false, days: [hours(false), hours(true), hours(true), hours(true), hours(true), hours(true), hours(true)], outside: 'accept', paused: false },
    min_order_cents: 0,
    prep_days: 1,
    free_shipping_above_cents: 0,
    max_installments: 1,
    goal_cents: 0,
    delivery: {
      pickup: { enabled: true, address: '', instructions: '' },
      zones: { enabled: false, items: [] },
      fixed: { enabled: false, fee_cents: 0, label: 'Entrega' },
      arrange: { enabled: true },
    },
    payments: {
      whatsapp: { enabled: true },
      pix: { enabled: false, key: '', holder: '', city: '', discount_percent: 0 },
      cash: { enabled: false },
      card_on_delivery: { enabled: false },
      mercadopago: { enabled: false },
    },
    tracking: { ga4: '', meta_pixel: '', tiktok_pixel: '' },
    notifications: { sound: true },
    lead_popup: { enabled: false, text: 'Ganhe 10% de desconto na primeira compra', coupon: '', delay_s: 8 },
  }
}

/** Completa objetos salvos com campos novos que surgirem em versões futuras. */
export function withDefaults<T extends object>(value: Partial<T> | null | undefined, defaults: T): T {
  if (!value) return structuredClone(defaults)
  const out = structuredClone(defaults) as Record<string, unknown>
  for (const [k, v] of Object.entries(value)) {
    const d = out[k]
    out[k] = d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v) ? withDefaults(v, d as object) : v
  }
  return out as T
}

/** Combinações de efeitos com um clique no editor de aparência. */
export const FX_COMBOS: { name: string; help: string; set: Partial<Theme['animations']> }[] = [
  {
    name: 'Discreto',
    help: 'Pouco movimento, bom para qualquer loja',
    set: { intensity: 'soft', title: 'none', sections: 'fade', product_hover: 'zoom', buy_button: 'none', click: 'none', stagger: true, scroll_progress: false },
  },
  {
    name: 'Moderno',
    help: 'Títulos saindo do desfoque, luz nos cartões e borda animada no botão',
    set: { intensity: 'normal', title: 'blur', sections: 'slide-up', product_hover: 'spotlight', buy_button: 'star', click: 'none', stagger: true, scroll_progress: true },
  },
  {
    name: 'Divertido',
    help: 'Letras pulando, cartões que inclinam e faíscas no toque',
    set: { intensity: 'normal', title: 'split', sections: 'zoom', product_hover: 'tilt', buy_button: 'pulse', click: 'spark', stagger: true, scroll_progress: false },
  },
  {
    name: 'Elegante',
    help: 'Brilho suave nos títulos e reflexo nas fotos',
    set: { intensity: 'soft', title: 'shiny', sections: 'blur', product_hover: 'glare', buy_button: 'shine', click: 'none', stagger: true, scroll_progress: false },
  },
]
