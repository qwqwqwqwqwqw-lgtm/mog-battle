-- Server-only checks; all fixtures, points and campaign changes are rolled back.
begin;
do $$
declare p uuid; c uuid; slug text:='qa_'||replace(gen_random_uuid()::text,'-',''); r jsonb; r2 jsonb;
begin
  insert into public.players(telegram_id,first_name,mogg_points,mogg_score)
  values(9000000000000+floor(random()*1000000)::bigint,'PARTNER QA ROLLBACK',20,1234) returning id into p;
  insert into public.game_campaigns(slug,label) values(slug,'QA ROLLBACK');
  insert into public.partner_campaigns(slug,title,username,reward_points,is_active)
  values(slug,'QA ROLLBACK','fixture_channel',100,true) returning id into c;
  r:=public.claim_partner_points_v1(p,c);
  r2:=public.claim_partner_points_v1(p,c);
  if(r->>'replayed')::boolean or not(r2->>'replayed')::boolean then raise exception 'claim replay failed';end if;
  if(select mogg_points from public.players where id=p)<>120 then raise exception 'double reward';end if;
  if(select mogg_score from public.players where id=p)<>1234 then raise exception 'rating changed';end if;
  if(select count(*) from public.partner_claims where campaign_id=c and player_id=p)<>1 then raise exception 'duplicate claim';end if;
  update public.partner_campaigns set is_active=false where id=c;
  begin
    perform public.claim_partner_points_v1(p,c);
    raise exception 'inactive campaign accepted';
  exception when others then if sqlerrm<>'partner_inactive' then raise;end if;end;
  if has_function_privilege('anon','public.claim_partner_points_v1(uuid,uuid)','execute') or
    has_function_privilege('authenticated','public.claim_partner_points_v1(uuid,uuid)','execute') then raise exception 'public reward RPC';end if;
  if has_table_privilege('anon','public.partner_claims','select') or
    has_table_privilege('authenticated','public.partner_campaigns','insert') then raise exception 'public partner table';end if;
  if exists(select 1 from pg_class where oid in('public.partner_campaigns'::regclass,'public.partner_claims'::regclass) and not relrowsecurity)
    then raise exception 'missing RLS';end if;
end $$;
select 'PASS: one award, replay, unchanged rating, inactive campaign, role grants and RLS' as result;
rollback;
