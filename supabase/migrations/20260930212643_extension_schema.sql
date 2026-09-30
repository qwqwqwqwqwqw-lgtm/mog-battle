-- pg_net was introduced in this release. Its request/response queues and result outbox are empty.
-- Use the recommended extension schema; net.http_post keeps the same qualified name.
do $$ begin
 if exists(select 1 from net.http_request_queue) or exists(select 1 from public.game_result_outbox where delivered_at is null) then raise exception 'worker_queue_must_be_empty';end if;
end $$;
drop extension pg_net;
create extension pg_net with schema extensions;
