# Vitrine

Plataforma onde qualquer pessoa cria a própria loja online, cadastra produtos e recebe os pedidos pelo WhatsApp.

## O que já existe

- **Página inicial** (`/`) — apresenta a plataforma e chama para criar a loja.
- **Conta** (`/entrar`) — cadastro e login com e-mail e senha.
- **Painel do lojista** (`/painel`) — dados da loja (nome, endereço, WhatsApp) e cadastro de produtos com foto, preço e disponibilidade.
- **Loja pública** (`/nome-da-loja`) — vitrine com carrinho; o pedido é enviado pronto para o WhatsApp do lojista.

Não há pagamento online: o lojista combina Pix/entrega pelo WhatsApp.

## Rodar no computador

```bash
npm install
npm run dev
```

Sem configurar nada, o app abre em **modo demonstração** (dados salvos só no navegador), bom para ver funcionando.

## Colocar no ar

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. No **SQL Editor**, rode o conteúdo de `supabase/schema.sql`.
3. Copie `.env.example` para `.env` e preencha a URL e a chave `anon` (Project Settings > API).
4. Publique no Cloudflare Pages (ou Vercel/Netlify): comando de build `npm run build`, pasta `dist`, e as duas variáveis do `.env` configuradas lá.

Por padrão o Supabase exige confirmação de e-mail no cadastro. Para desligar: Authentication > Sign In / Providers > Email > "Confirm email".

## Administração (você, dono da plataforma)

Para suspender a loja de quem não pagou: no Supabase, tabela `stores`, mude `active` para `false`. A loja some do ar, mas o lojista não perde os dados.

## Estrutura

- `src/data.ts` — todo o acesso a dados (Supabase ou modo demonstração).
- `src/pages/` — as quatro telas.
- `supabase/schema.sql` — tabelas e regras de segurança.
