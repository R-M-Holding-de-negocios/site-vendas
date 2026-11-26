# Vitrine

Plataforma onde qualquer pessoa cria a própria loja online, cadastra produtos e vende, com três planos:

| Plano | O que tem |
| --- | --- |
| Vitrine | Loja com link próprio, produtos, carrinho e pedido pronto no WhatsApp |
| Loja | Pedidos salvos no painel, Pix com QR code, pagamento na entrega, Mercado Pago, entrega por bairro, temas, seções e animações |
| Pro | Relatórios completos, clientes, estoque, cupons, carrinho abandonado, posts, avaliações, captação de contatos |

O planejamento completo (o que cada parte deve ter e por quê) está no documento de planejamento do projeto. As decisões tomadas durante a construção estão em [docs/decisoes.md](docs/decisoes.md).

## Ver funcionando agora

```bash
npm install
npm run dev
```

Sem configurar nada, o app abre em **modo demonstração**: os dados ficam só no navegador e já existe uma confeitaria de exemplo com 90 dias de vendas.

- Loja de exemplo: `/doces-da-ana`
- Painel do lojista: entre com `demo@exemplo.com` / `123456`
- Painel do admin: `/admin` com `admin@exemplo.com` / `123456`

## Colocar no ar

1. **Banco de dados (Supabase):** crie um projeto e rode, no SQL Editor e nesta ordem, os arquivos de `supabase/migrations/`. Detalhes e como virar admin: [docs/banco-de-dados.md](docs/banco-de-dados.md).
2. **Site (Cloudflare Pages):** comando de build `npm run build`, pasta `dist`. Configure as variáveis do `.env.example`.
3. **Pagamento online (opcional):** [docs/mercado-pago.md](docs/mercado-pago.md).

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `src/lib` | Modelo de dados, regras de preço, acesso ao banco (real e demonstração), Pix, horários |
| `src/store` | Loja pública |
| `src/panel` | Painel do lojista (inclui `reports/` e o editor de aparência) |
| `src/admin` | Painel do dono da plataforma |
| `src/site` | Página inicial da plataforma e login |
| `supabase/migrations` | Tabelas, regras de segurança e funções do servidor |
| `supabase/functions` | Integração com o Mercado Pago |
| `functions` | Prévia de links (foto e preço ao colar o link no WhatsApp) no Cloudflare |
| `tests` | Testes automáticos (`npm test`) |

## Comandos

- `npm run dev` — roda localmente
- `npm test` — testes (regras de preço, banco de dados, segurança, relatórios, pagamentos)
- `npm run typecheck` — confere os tipos
- `npm run build` — gera o site para publicar
