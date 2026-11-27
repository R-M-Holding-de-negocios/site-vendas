-- Tarefas agendadas. Rode depois de todas as migrações (supabase/migrations, em ordem).
-- Precisa da extensão pg_cron (Supabase: Database > Extensions > pg_cron, ou o comando abaixo).
-- Pode ser rodado de novo sem duplicar os agendamentos.

create extension if not exists pg_cron;

-- Remove agendamentos anteriores com os mesmos nomes.
select cron.unschedule(jobid) from cron.job where jobname in ('vitrine-expirar-pedidos', 'vitrine-tolerancia-planos');

-- A cada 15 minutos: cancela pedidos com Mercado Pago que ficaram 24 horas sem pagamento.
select cron.schedule('vitrine-expirar-pedidos', '*/15 * * * *', $$select public.expire_pending_orders()$$);

-- A cada hora: lojas com teste ou mensalidade vencidos há mais de 7 dias passam para o
-- plano Vitrine (migração 0005). O pagamento registrado pelo admin devolve o plano.
select cron.schedule('vitrine-tolerancia-planos', '7 * * * *', $$select public.downgrade_lapsed_stores()$$);
