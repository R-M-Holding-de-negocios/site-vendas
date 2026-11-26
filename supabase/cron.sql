-- Tarefa agendada: cancela pedidos Pix/Mercado Pago que ficaram 24 horas sem pagamento.
-- Rode depois de supabase/migrations/0001_init.sql. Precisa da extensão pg_cron
-- (Supabase: Database > Extensions > pg_cron, ou o comando abaixo).

create extension if not exists pg_cron;

-- Remove um agendamento anterior com o mesmo nome, para poder rodar este arquivo de novo.
select cron.unschedule(jobid) from cron.job where jobname = 'vitrine-expirar-pedidos';

-- A cada 15 minutos.
select cron.schedule('vitrine-expirar-pedidos', '*/15 * * * *', $$select public.expire_pending_orders()$$);
