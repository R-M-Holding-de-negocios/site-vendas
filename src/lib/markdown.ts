// Formatação simples para páginas e posts. Todo o texto é escapado antes,
// então o lojista não consegue inserir HTML ou scripts.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const safeUrl = (u: string, image = false) => {
  const url = u.trim()
  if (/^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('#')) return url
  if (!image && /^(mailto:|tel:)/i.test(url)) return url
  if (image && /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(url)) return url
  return ''
}

function inline(text: string) {
  let s = esc(text)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'), true)
    return u ? `<img src="${esc(u)}" alt="${alt}" loading="lazy">` : ''
  })
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'))
    return u ? `<a href="${esc(u)}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>` : label
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>')
  return s
}

export function renderMarkdown(src: string): string {
  const out: string[] = []
  const lines = src.replace(/\r/g, '').split('\n')
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
  }
  const closeList = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (!line.trim()) {
      flush()
      closeList()
    } else if (h) {
      flush()
      closeList()
      const level = h[1].length + 1
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
    } else if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      if (list !== kind) {
        closeList()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`)
    } else {
      closeList()
      para.push(line)
    }
  }
  flush()
  closeList()
  return out.join('\n')
}

export const plainText = (src: string) =>
  src
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
