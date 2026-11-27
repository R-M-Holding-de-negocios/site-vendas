-- Tolerância de 7 dias para teste grátis e mensalidade vencidos (27/11/2026).
-- Regra igual à de src/lib/billing.ts:
--   * vencido há até 7 dias: a loja funciona normalmente e o painel avisa todo dia;
--   * passou de 7 dias: a loja vira plano Vitrine (pedido só pelo WhatsApp) e guarda o plano
--     anterior em plan_before_downgrade; nada do que foi cadastrado é apagado;
--   * pagamento registrado pelo admin: volta ao plano anterior.
-- A função downgrade_lapsed_stores() roda pela tarefa agendada (supabase/cron.sql).

alter table public.stores add column if not exists plan_before_downgrade text
  check (plan_before_downgrade is null or plan_before_downgrade in ('vitrine', 'loja', 'pro'));

create or replace function public.downgrade_lapsed_stores() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.stores;
  n int := 0;
begin
  for s in
    select * from public.stores
    where plan <> 'vitrine'
      and plan_before_downgrade is null
      and status not in ('suspended', 'closed')
      and (case when status = 'trial' then trial_ends_at else paid_until end) < now() - interval '7 days'
    for update skip locked
  loop
    update public.stores set
      plan_before_downgrade = s.plan,
      plan = 'vitrine',
      status = 'overdue'
    where id = s.id;
    insert into public.audit_log (admin_id, admin_email, store_id, action)
    values (null, 'sistema', s.id,
            format('Plano %s mudou para Vitrine: pagamento não confirmado em 7 dias após o vencimento', s.plan));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.downgrade_lapsed_stores() from public, anon, authenticated;
grant execute on function public.downgrade_lapsed_stores() to service_role;

-- Registrar pagamento devolve o plano anterior.
create or replace function public.admin_register_payment(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.stores;
  v_months int := coalesce(private.num(a -> 'months'), 0)::int;
  v_plan text;
  inv public.invoices;
begin
  perform private.assert_admin();
  select * into s from public.stores where id::text = a ->> 'store_id' for update;
  if not found then raise exception 'Loja não encontrada.'; end if;
  if v_months < 1 then raise exception 'Informe quantos meses foram pagos.'; end if;
  v_plan := coalesce(s.plan_before_downgrade, s.plan);
  update public.stores set
    paid_until = greatest(now(), coalesce(s.paid_until, now())) + make_interval(months => v_months),
    status = 'active',
    plan = v_plan,
    plan_before_downgrade = null
  where id = s.id;
  perform private.audit(s.id, format('Pagamento registrado: %s mês(es)', v_months));
  insert into public.invoices (store_id, plan, amount_cents, months, method, note, paid_at)
  values (s.id, v_plan, coalesce(private.num(a -> 'amount_cents'), 0)::int, v_months,
          coalesce(a ->> 'method', ''), coalesce(a ->> 'note', ''), now())
  returning * into inv;
  return to_jsonb(inv);
end $$;
revoke execute on function public.admin_register_payment(jsonb) from public, anon;
grant execute on function public.admin_register_payment(jsonb) to authenticated;

-- Se o admin muda o plano à mão (para um plano pago), o rebaixamento deixa de valer.
create or replace function private.clear_downgrade() returns trigger
language plpgsql as $$
begin
  if new.plan is distinct from old.plan and new.plan <> 'vitrine' then
    new.plan_before_downgrade := null;
  end if;
  return new;
end $$;
drop trigger if exists stores_clear_downgrade on public.stores;
create trigger stores_clear_downgrade before update of plan on public.stores
  for each row execute function private.clear_downgrade();
revoke execute on function private.clear_downgrade() from public;
