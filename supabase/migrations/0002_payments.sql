-- Pagamento online pelo Mercado Pago (modelo marketplace).
-- Cada lojista conecta a própria conta por OAuth; os tokens ficam em store_secrets
-- (criada em 0001, sem acesso pelo navegador) e só as funções do servidor
-- (supabase/functions, com a chave service role) leem ou gravam.

-- Defensivo: 0001 já cria esta tabela.
create table if not exists public.store_secrets (
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (store_id, provider)
);
alter table public.store_secrets enable row level security;

-- "state" do OAuth: liga a volta do Mercado Pago ao lojista que iniciou a conexão.
-- Vale por 1 hora e é apagado ao ser usado.
create table if not exists public.oauth_states (
  state text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
-- RLS ligado e nenhuma política: ninguém acessa pelo navegador, só a service role.
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

create index if not exists oauth_states_created_at_idx on public.oauth_states (created_at);

-- Contrato do app (src/lib/db.ts, Rpc.payment_connections): diz se a loja tem
-- conta de pagamento conectada. Só devolve verdadeiro/falso, nunca os tokens.
create or replace function public.payment_connections(a jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'mercadopago',
    exists (
      select 1 from public.store_secrets s
      where s.store_id = (a->>'store_id')::uuid
        and s.provider = 'mercadopago'
        and coalesce(s.data->>'access_token', '') <> ''
    )
  );
$$;
revoke all on function public.payment_connections(jsonb) from public;
grant execute on function public.payment_connections(jsonb) to anon, authenticated;
