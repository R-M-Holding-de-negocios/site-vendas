import { Link, useNavigate } from 'react-router-dom'
import { db } from '../lib/api'
import { can } from '../lib/plans'
import { fmtDate } from '../lib/util'
import { Badge, Empty, Loading, PageHead, Upsell, useAsync } from '../ui/kit'
import { usePanel } from './PanelApp'

export default function Contents() {
  const { store } = usePanel()
  const nav = useNavigate()
  const data = useAsync(() => db.list('contents', { eq: { store_id: store.id }, order: ['created_at', 'desc'] }), [store.id])
  if (!can(store, 'pages'))
    return (
      <div>
        <PageHead title="Páginas e posts" />
        <Upsell feature="pages">Crie páginas como Sobre nós, Tabela de medidas e Perguntas frequentes no plano Loja.</Upsell>
      </div>
    )
  const now = new Date().toISOString()
  const pages = (data.data ?? []).filter((c) => c.kind === 'page')
  const posts = (data.data ?? []).filter((c) => c.kind === 'post')
  const state = (c: (typeof pages)[number]) => (c.status === 'draft' ? <Badge>Rascunho</Badge> : c.publish_at > now ? <Badge tone="info">Agendado para {fmtDate(c.publish_at)}</Badge> : <Badge tone="ok">Publicado</Badge>)
  return (
    <div className="stack">
      <PageHead
        title="Páginas e posts"
        actions={
          <>
            <button className="btn ghost" onClick={() => nav('/painel/conteudo/nova-pagina')}>+ Página</button>
            {can(store, 'posts') && <button className="btn" onClick={() => nav('/painel/conteudo/novo-post')}>+ Post</button>}
          </>
        }
      />
      {!data.data ? (
        <Loading />
      ) : (
        <>
          <section className="stack tight">
            <h2>Páginas</h2>
            {pages.length ? (
              <div className="list">
                {pages.map((c) => (
                  <Link key={c.id} to={`/painel/conteudo/${c.id}`} className="list-row">
                    <b className="grow">{c.title}</b>
                    {c.show_in_menu && <Badge>No menu</Badge>}
                    {state(c)}
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="Nenhuma página" text="Ex.: Sobre nós, Tabela de medidas, Como encomendar." />
            )}
          </section>
          <section className="stack tight">
            <h2>Posts</h2>
            {!can(store, 'posts') ? (
              <Upsell feature="posts">Escreva posts com produtos vinculados e agende a publicação no plano Pro.</Upsell>
            ) : posts.length ? (
              <div className="list">
                {posts.map((c) => (
                  <Link key={c.id} to={`/painel/conteudo/${c.id}`} className="list-row">
                    {c.cover_url ? <img className="pic" src={c.cover_url} alt="" /> : <div className="pic" />}
                    <b className="grow">{c.title}</b>
                    {state(c)}
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="Nenhum post" text="Posts ajudam a aparecer no Google e dão assunto para divulgar." />
            )}
          </section>
        </>
      )}
    </div>
  )
}
