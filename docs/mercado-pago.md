# Pagamento online com Mercado Pago (e prévia dos links)

Este guia é para quem administra a plataforma Vitrine. Não precisa saber programar:
basta seguir os passos na ordem.

## Como funciona

- Cada lojista conecta **a própria conta do Mercado Pago** no painel (Painel → Integrações →
  "Conectar Mercado Pago"). Ele entra na conta dele e autoriza a Vitrine.
- Na loja, o cliente escolhe "Mercado Pago" e é levado para a página de pagamento do
  Mercado Pago (Checkout Pro), onde paga com **Pix, cartão parcelado ou boleto**.
- O dinheiro cai **direto na conta do lojista**. A taxa da plataforma (a porcentagem do plano,
  ex.: 2% no plano Loja) é separada automaticamente pelo Mercado Pago e cai na conta da
  Vitrine. O dinheiro nunca passa pela plataforma.
- Quando o pagamento é aprovado, o Mercado Pago avisa a Vitrine e o pedido muda sozinho
  para **Pago**. Se houver devolução ou contestação, o pedido muda para **Reembolsado**.

## 1. Criar a aplicação no Mercado Pago

Use a conta do Mercado Pago **da plataforma** (é nela que a taxa vai cair).

1. Acesse <https://www.mercadopago.com.br/developers/panel/app> e clique em **Criar aplicação**.
2. Dê um nome (ex.: "Vitrine"), escolha **Pagamentos online** e o produto **Checkout Pro**.
   Quando perguntar o modelo de integração, escolha **Marketplace**.
3. Em **Detalhes da aplicação / Editar**, preencha a **URL de redirecionamento** (Redirect URL):

   ```
   https://SEU-PROJETO.supabase.co/functions/v1/mp-oauth-callback
   ```

   (troque `SEU-PROJETO` pelo endereço do seu projeto no Supabase: Supabase → Project
   Settings → API → Project URL). Deixe o **PKCE desligado** — a Vitrine não usa PKCE.
4. Anote o **Client ID** (também chamado de "App ID") e o **Client Secret** em
   **Credenciais de produção**.
5. Em **Webhooks → Configurar notificações**:
   - URL de produção: `https://SEU-PROJETO.supabase.co/functions/v1/mp-webhook`
   - Eventos: marque **Pagamentos**.
   - Salve e clique em **revelar a assinatura secreta**. Anote: é o `MP_WEBHOOK_SECRET`.

   Observação: cada pagamento também informa ao Mercado Pago o endereço de aviso com o
   código da loja (`mp-webhook?store_id=...`). É esse aviso que a Vitrine usa; a URL
   configurada no painel serve de reserva.

## 2. Configurar os segredos no Supabase

No Supabase: **Edge Functions → Secrets** (ou pelo terminal com `supabase secrets set`).

| Nome | O que colocar |
| --- | --- |
| `MP_CLIENT_ID` | Client ID da aplicação |
| `MP_CLIENT_SECRET` | Client Secret da aplicação |
| `MP_REDIRECT_URI` | `https://SEU-PROJETO.supabase.co/functions/v1/mp-oauth-callback` (igual à cadastrada no Mercado Pago, letra por letra) |
| `MP_WEBHOOK_SECRET` | A assinatura secreta dos Webhooks |
| `SITE_URL` | Endereço do site, sem barra no fim. Ex.: `https://vitrine.com.br` |

Opcional: `MP_WEBHOOK_TOLERANCE_S` (padrão 900 = 15 minutos) — por quanto tempo um aviso
do Mercado Pago é aceito depois de assinado.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente nas funções.

Pelo terminal:

```bash
supabase secrets set MP_CLIENT_ID=... MP_CLIENT_SECRET=... \
  MP_REDIRECT_URI=https://SEU-PROJETO.supabase.co/functions/v1/mp-oauth-callback \
  MP_WEBHOOK_SECRET=... SITE_URL=https://vitrine.com.br
```

## 3. Variável do site (front end)

No Cloudflare Pages (Settings → Environment variables) e no seu `.env` local:

| Nome | O que colocar |
| --- | --- |
| `VITE_MP_CLIENT_ID` | O mesmo Client ID (só serve para mostrar no painel que o Mercado Pago está disponível) |

Depois de mudar variáveis do site, faça um novo deploy.

## 4. Aplicar o banco e publicar as funções

Instale a [Supabase CLI](https://supabase.com/docs/guides/cli), entre com `supabase login`
e ligue a pasta ao projeto com `supabase link --project-ref SEU-PROJETO`. Depois:

```bash
# tabelas oauth_states e a função payment_connections
supabase db push

# exige login do lojista (verificação de JWT ligada, que é o padrão)
supabase functions deploy mp-oauth-start

# chamadas sem login: o navegador voltando do Mercado Pago, o cliente da loja
# e os avisos do Mercado Pago. Precisam de --no-verify-jwt.
supabase functions deploy mp-oauth-callback --no-verify-jwt
supabase functions deploy mp-create-preference --no-verify-jwt
supabase functions deploy mp-webhook --no-verify-jwt
```

Essas três funções sem JWT continuam protegidas: o callback só aceita um `state` criado
pelo lojista há menos de 1 hora; a criação do pagamento exige o código secreto do pedido;
o webhook confere a assinatura do Mercado Pago e, além disso, sempre consulta o pagamento
direto na API do Mercado Pago antes de mudar qualquer pedido.

## 5. Testar antes de vender de verdade

O Mercado Pago tem **contas de teste** (Painel do desenvolvedor → sua aplicação → **Contas de
teste**). Crie duas: uma **vendedora** e uma **compradora**.

1. Na Vitrine, crie uma loja de teste (plano Loja ou Pro) e, em Painel → Integrações,
   clique em **Conectar Mercado Pago**. Na página do Mercado Pago, entre com a **conta
   vendedora de teste** (use uma janela anônima para não misturar com a sua conta real).
   Você volta para o painel com a mensagem de conectado.
2. Abra a loja em outra janela anônima, faça um pedido escolhendo Mercado Pago e pague
   com a **conta compradora de teste** usando um
   [cartão de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/integration-test/test-cards)
   (por exemplo, nome do titular `APRO` para aprovado).
3. Em alguns segundos o pedido aparece como **Pago** no painel. Se não mudar, veja os logs
   em Supabase → Edge Functions → mp-webhook → Logs.
4. Para testar a recusa, use o nome do titular `OTHE`.

Dica: no painel do Mercado Pago (Webhooks → Simular) dá para mandar um aviso de teste e ver
se a função responde. Um aviso simulado de um pagamento que não existe é ignorado (resposta
200), o que é o esperado.

## 6. Prévia dos links (WhatsApp, Instagram, Google) no Cloudflare Pages

Quando alguém cola o link de uma loja ou produto no WhatsApp, aparece a foto, o nome e o
preço. Isso é feito pela pasta `functions/` do projeto, que o Cloudflare Pages publica
sozinho junto com o site (Pages Functions).

1. No Cloudflare Pages, o projeto deve ser publicado pelo Git (ou com
   `npx wrangler pages deploy dist`, rodando o comando na pasta do projeto, para a pasta
   `functions/` ir junto). Build: `npm run build`; pasta de saída: `dist`.
2. Em **Settings → Environment variables** (Produção e Prévia), adicione:

   | Nome | O que colocar |
   | --- | --- |
   | `SUPABASE_URL` | O mesmo valor de `VITE_SUPABASE_URL` |
   | `SUPABASE_ANON_KEY` | O mesmo valor de `VITE_SUPABASE_ANON_KEY` |

3. Faça um novo deploy. Para conferir, cole o link de um produto no
   <https://developers.facebook.com/tools/debug/> ou mande para você mesmo no WhatsApp.

Funciona para: `/loja`, `/loja/p/<produto>`, `/loja/c/<categoria>` e `/loja/blog/<post>`.
Qualquer outro endereço (painel, arquivos, páginas desconhecidas) é servido sem mudança.
Lojas suspensas e produtos bloqueados não mostram prévia.

## Perguntas comuns

- **O lojista precisa de conta Mercado Pago?** Sim, uma conta própria (pode ser pessoa
  física ou jurídica). O dinheiro das vendas vai para ela.
- **Quanto o Mercado Pago cobra?** A tarifa do Mercado Pago é descontada do lojista,
  conforme o contrato dele com o Mercado Pago. A taxa da Vitrine é separada depois disso.
- **E se o lojista mudar a senha ou desconectar?** O pagamento online para de funcionar
  para aquela loja até ele conectar de novo no painel. Os tokens são renovados
  automaticamente perto de vencer (validade de 180 dias).
- **O modo demonstração cobra?** Não. Sem Supabase configurado, o pagamento é apenas
  simulado e a página do pedido avisa isso.

## Referências usadas

Documentação oficial usada como base (novembro de 2026). Atenção: na hora de escrever
este guia não foi possível abrir as páginas diretamente, só os trechos que aparecem na
busca; confira os detalhes nelas antes de entrar em produção.

- Webhooks e validação da assinatura `x-signature`:
  <https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks>
  e <https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/additional-content/notifications>
- Marketplace / split de pagamentos com Checkout Pro (`marketplace_fee`):
  <https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace>
  e <https://www.mercadopago.com.br/developers/es/docs/checkout-pro-preferences/how-tos/integrate-marketplace.md>
- OAuth (troca do código e renovação do token, `/oauth/token`):
  <https://www.mercadopago.com.br/developers/pt/reference/authentication/oauth/_oauth_token/post.md>
  e <https://www.mercadopago.com.ar/developers/en/docs/security/oauth>
- Checkout Pro (preferências; endereço não conferido): <https://www.mercadopago.com.br/developers/pt/reference/preferences/_checkout_preferences/post>
- Cartões de teste (endereço não conferido): <https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/integration-test/test-cards>
