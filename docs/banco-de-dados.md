# Banco de dados (Supabase)

Tudo o que o site precisa no banco está em `supabase/migrations/0001_init.sql`: tabelas, regras de acesso (RLS), funções do servidor (pedido, cupom, situação do pedido, admin) e a pasta de imagens.

## 1. Aplicar a migração

1. Crie um projeto novo em [supabase.com](https://supabase.com).
2. Abra **SQL Editor > New query**, cole o conteúdo de `supabase/migrations/0001_init.sql` e clique em **Run**. Rode o arquivo inteiro, de uma vez, em um projeto vazio.
3. Se houver outras migrações em `supabase/migrations` (por exemplo `0002_payments.sql`), rode-as depois, em ordem de número.
4. Em **Project Settings > API**, copie a *Project URL* e a chave *anon public* para o `.env` do site (`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`).

Quem usa a Supabase CLI pode rodar `supabase db push` no lugar dos passos 2 e 3.

## 2. Virar admin da plataforma

O painel do admin exige duas coisas: estar na tabela `platform_admins` **e** ter entrado com verificação em duas etapas.

1. Crie sua conta pelo próprio site (tela **Entrar**).
2. No SQL Editor, rode (troque o e-mail):

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'voce@exemplo.com';
   ```

3. Abra `/admin` no site: ele pede para ativar a verificação em duas etapas (aplicativo autenticador, como Google Authenticator). Escaneie o QR code e digite o código.
4. A cada novo login, o admin pede o código de novo. Sem o código, as funções do admin respondem "Acesso restrito ao admin.".

Para tirar alguém do admin: `delete from public.platform_admins where user_id = '...';`

## 3. Tarefa agendada (`supabase/cron.sql`)

Pedidos pagos por Pix ou Mercado Pago que ficam **24 horas** sem confirmação de pagamento são cancelados automaticamente, o estoque volta e o histórico do pedido recebe a nota "Pagamento não confirmado em 24 horas". Pedidos em dinheiro, cartão na entrega ou WhatsApp não são tocados.

Para ligar: ative a extensão **pg_cron** (Database > Extensions) e rode `supabase/cron.sql` no SQL Editor. Ele agenda `public.expire_pending_orders()` a cada 15 minutos e pode ser rodado de novo sem duplicar o agendamento.

## O que o banco garante

- Cada lojista só vê e altera os dados da própria loja. O visitante só lê a vitrine (lojas no ar, produtos não bloqueados, conteúdos publicados, avaliações aprovadas) e só grava visitas, contatos e avisos de estoque.
- O lojista não consegue mudar plano, situação, datas de teste/pagamento nem o dono da loja; não desbloqueia produto bloqueado pelo admin e não altera "unidades vendidas".
- A situação do pedido só muda por `set_order_status` (que devolve o estoque ao cancelar e não reabre pedido cancelado).
- `place_order` recalcula tudo pelos preços do banco (o valor enviado pelo navegador é ignorado), trava estoque e numeração para não vender o mesmo item duas vezes e só aceita Mercado Pago quando a loja conectou a conta.
- Chaves de pagamento ficam em `store_secrets`, que nenhum usuário lê pela API.

## Testes

`npm test` roda os testes em `tests/sql` num Postgres de verdade (PGlite, dentro do Node), com uma imitação mínima do Supabase em `tests/sql/supabase-stub.sql`. Eles conferem que o banco calcula os pedidos exatamente como `src/lib/pricing.ts` e segue as mesmas regras do modo demonstração.
