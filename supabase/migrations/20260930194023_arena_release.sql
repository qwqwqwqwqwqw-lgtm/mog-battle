-- Arena release: additive changes; existing balances, ratings and inventory stay intact.
create extension if not exists pg_net;
alter table public.star_purchases add column if not exists terms_version text;
create table public.game_daily (
 player_id uuid not null references public.players(id) on delete cascade, day date not null,
 votes integer not null default 0, taps integer not null default 0,
 battles integer not null default 0, visited boolean not null default false,
 primary key(player_id,day)
);
create table public.game_reward_claims (
 player_id uuid not null references public.players(id) on delete cascade, reward_key text not null,
 day date not null, points integer not null default 0, created_at timestamptz not null default now(),
 primary key(player_id,reward_key,day)
);
create table public.game_tap_batches (
 player_id uuid not null references public.players(id) on delete cascade, request_key uuid not null,
 accepted integer not null, created_at timestamptz not null default now(), primary key(player_id,request_key)
);
create table public.game_tap_limits (
 player_id uuid primary key references public.players(id) on delete cascade, tokens numeric not null default 16,
 refreshed_at timestamptz not null default now()
);
create table public.duel_invites (
 token uuid primary key default gen_random_uuid(), player_id uuid not null references public.players(id) on delete cascade,
 accepted_by uuid references public.players(id) on delete cascade, battle_id uuid references public.battles(id) on delete cascade,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours'
);
create index duel_invites_player_created on public.duel_invites(player_id,created_at desc);
create table public.game_campaigns (
 slug text primary key check(slug ~ '^[a-z0-9_]{1,40}$'), label text not null,
 created_at timestamptz not null default now()
);
create table public.game_attribution (
 player_id uuid primary key references public.players(id) on delete cascade, campaign text not null references public.game_campaigns(slug),
 created_at timestamptz not null default now()
);
create table public.game_events (
 id bigint generated always as identity primary key, player_id uuid not null references public.players(id) on delete cascade,
 name text not null, created_at timestamptz not null default now()
);
create index game_events_player_time on public.game_events(player_id,created_at desc);
create index game_events_name_time on public.game_events(name,created_at desc);
create table public.cosmetic_bundle_items (
 bundle_id uuid not null references public.cosmetics(id) on delete cascade, cosmetic_id uuid not null references public.cosmetics(id) on delete cascade,
 primary key(bundle_id,cosmetic_id), check(bundle_id<>cosmetic_id)
);
create table public.game_result_outbox (
 battle_id uuid primary key references public.battles(id) on delete cascade, attempts integer not null default 0,
 leased_until timestamptz, delivered_at timestamptz, last_error text, created_at timestamptz not null default now()
);
create index game_result_outbox_pending on public.game_result_outbox(created_at) where delivered_at is null;
create schema if not exists game_private;
revoke all on schema game_private from public,anon,authenticated;
create table game_private.worker_settings(id boolean primary key default true check(id),secret text not null default gen_random_uuid()::text);
insert into game_private.worker_settings(id) values(true);
alter table game_private.worker_settings enable row level security;

do $$ declare t text; begin
 foreach t in array array['game_daily','game_reward_claims','game_tap_batches','game_tap_limits','duel_invites','game_campaigns','game_attribution','game_events','cosmetic_bundle_items','game_result_outbox'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.game_events_id_seq to service_role;

insert into public.game_campaigns(slug,label) values('organic','Прямые переходы'),('launch','Первый запуск') on conflict do nothing;
insert into public.cosmetics(code,name,kind,rarity,min_rank_tier,is_purchasable,price_points,price_stars,drop_enabled,collection,sort_order,visual_key) values
 ('frame_first_light','FIRST LIGHT','frame','rare',0,false,0,0,false,'first_steps',1,'firstlight'),
 ('frame_afterhours','AFTER HOURS','frame','epic',0,true,0,99,false,'sets',2,'afterhours'),
 ('bg_afterhours','MIDNIGHT','profile_bg','epic',0,false,0,0,false,'set_items',3,'midnight'),
 ('title_afterhours','NIGHT MOGGER','title','epic',0,false,0,0,false,'set_items',4,'nightmogger'),
 ('frame_chromeclub','CHROME CLUB','frame','legendary',0,true,0,249,false,'sets',5,'chromeclub'),
 ('bg_chromeclub','LIQUID CHROME','profile_bg','legendary',0,false,0,0,false,'set_items',6,'liquidchrome'),
 ('title_chromeclub','FACE CARD','title','legendary',0,false,0,0,false,'set_items',7,'chromecard'),
 ('frame_apex','APEX','frame','mythic',0,true,0,399,false,'sets',8,'apex'),
 ('bg_apex','GOLD ROOM','profile_bg','mythic',0,false,0,0,false,'set_items',9,'goldroom'),
 ('title_apex','MAIN CHARACTER','title','mythic',0,false,0,0,false,'set_items',10,'maincharacter')
 on conflict(code) do nothing;
insert into public.cosmetic_bundle_items(bundle_id,cosmetic_id)
select parent.id,child.id from public.cosmetics parent join public.cosmetics child on
 (parent.code='frame_afterhours' and child.code in('bg_afterhours','title_afterhours')) or
 (parent.code='frame_chromeclub' and child.code in('bg_chromeclub','title_chromeclub')) or
 (parent.code='frame_apex' and child.code in('bg_apex','title_apex')) on conflict do nothing;

create function public.game_touch_v1(p_player uuid,p_campaign text default null) returns void language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare d date:=(now() at time zone 'UTC')::date; begin
 perform id from public.players where id=p_player and not is_npc for update;
 if not found then return; end if;
 p_campaign:=case when exists(select 1 from public.game_campaigns where slug=p_campaign) then p_campaign else 'organic' end;
 insert into public.game_daily(player_id,day,visited) values(p_player,d,true) on conflict(player_id,day) do update set visited=true where not public.game_daily.visited;
 if exists(select 1 from public.game_campaigns where slug=coalesce(p_campaign,'organic')) then
  insert into public.game_attribution(player_id,campaign) values(p_player,coalesce(p_campaign,'organic')) on conflict do nothing;
 end if;
 if not exists(select 1 from public.game_events where player_id=p_player and name='session_open' and created_at>now()-interval '30 minutes') then
  insert into public.game_events(player_id,name) values(p_player,'session_open');
 end if;
end $$;
create function public.game_event_v1(p_player uuid,p_name text) returns void language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if p_name not in('shop_open','share_profile','share_result','share_duel','onboarding_open','photo_saved','invoice_open') then raise exception 'invalid_event'; end if;
 perform id from public.players where id=p_player and not is_npc for update;
 if not found then raise exception 'invalid_player'; end if;
 if (select count(*) from public.game_events where player_id=p_player and created_at>now()-interval '1 hour')>=120 then return;end if;
 insert into public.game_events(player_id,name) values(p_player,p_name);
end $$;
create function public.game_progress_trigger_v1() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare d date:=(now() at time zone 'UTC')::date; pid uuid; begin
 if tg_table_name='battle_vote_rewards' then
  insert into public.game_daily(player_id,day,votes) values(new.voter_id,d,1)
  on conflict(player_id,day) do update set votes=public.game_daily.votes+1;
 elsif tg_table_name='battles' and new.mode='quick' and new.source<>'npc_feed' then
  for pid in select id from public.players where id in(new.player_a,new.player_b) and not is_npc loop
   insert into public.game_daily(player_id,day,battles) values(pid,d,1) on conflict(player_id,day) do update set battles=public.game_daily.battles+1;
   insert into public.game_events(player_id,name) values(pid,'battle_started');
  end loop;
 end if;return new;
end $$;
create trigger game_vote_progress after insert on public.battle_vote_rewards for each row execute function public.game_progress_trigger_v1();
create trigger game_battle_progress after insert on public.battles for each row execute function public.game_progress_trigger_v1();

create function public.game_daily_state_v1(p_player uuid) returns jsonb language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare d date:=(now() at time zone 'UTC')::date; progress public.game_daily; streak int; welcome bool; begin
 select * into progress from public.game_daily where player_id=p_player and day=d;
 with visits as(select day,row_number() over(order by day desc)::int-1 as n from public.game_daily where player_id=p_player and visited and day<=d)
 select count(*) into streak from visits where day=d-n;
 select exists(select 1 from public.game_reward_claims where player_id=p_player and reward_key='welcome') into welcome;
 return jsonb_build_object('day',d,'streak',streak,'votes',coalesce(progress.votes,0),'taps',coalesce(progress.taps,0),'battles',coalesce(progress.battles,0),'visited',coalesce(progress.visited,false),
 'claimed',coalesce((select jsonb_agg(reward_key) from public.game_reward_claims where player_id=p_player and day=d),'[]'::jsonb),
 'welcome_claimed',welcome,'welcome_ready',not welcome and exists(select 1 from public.battle_vote_rewards where voter_id=p_player));
end $$;
create function public.game_claim_reward_v1(p_player uuid,p_key text) returns jsonb language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare d date:=(now() at time zone 'UTC')::date; p public.players; s jsonb; reward int; c public.cosmetics; inserted int; begin
 select * into p from public.players where id=p_player and not is_npc for update;if not found then raise exception 'invalid_player';end if;
 s:=public.game_daily_state_v1(p_player);
 if p_key='welcome' then
  d:='1970-01-01';reward:=100;
  if not (s->>'welcome_ready')::boolean then
   if (s->>'welcome_claimed')::boolean then return jsonb_build_object('replayed',true,'player',to_jsonb(p));end if;
   raise exception 'reward_not_ready';
  end if;
  select * into c from public.cosmetics where code='frame_first_light';if not found then raise exception 'reward_unavailable';end if;
 elsif p_key='visit' and (s->>'visited')::boolean then reward:=20+least(7,(s->>'streak')::int)*5;
 elsif p_key='votes' and (s->>'votes')::int>=3 then reward:=60;
 elsif p_key='taps' and (s->>'taps')::int>=30 then reward:=40;
 elsif p_key='battle' and (s->>'battles')::int>=1 then reward:=80;
 else raise exception 'reward_not_ready';end if;
 insert into public.game_reward_claims(player_id,reward_key,day,points) values(p_player,p_key,d,reward) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return jsonb_build_object('replayed',true,'player',to_jsonb(p));end if;
 if c.id is not null then
  insert into public.player_inventory(player_id,cosmetic_id,source) values(p_player,c.id,'first_vote') on conflict do nothing;
  if p.equipped_frame is null then update public.players set equipped_frame=c.id where id=p_player;end if;
 end if;
 update public.players set mogg_points=mogg_points+reward where id=p_player returning * into p;
 insert into public.game_events(player_id,name) values(p_player,case when p_key='welcome' then 'welcome_claimed' else 'mission_claimed' end);
 return jsonb_build_object('points',reward,'cosmetic',to_jsonb(c),'player',to_jsonb(p),'replayed',false);
end $$;

create function public.game_tap_batch_v1(p_player uuid,p_key uuid,p_count int) returns jsonb language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare p public.players; lim public.game_tap_limits; n int; past int; d date:=(now() at time zone 'UTC')::date; begin
 if p_count is null or p_count<1 or p_count>20 or p_key is null then raise exception 'invalid_batch';end if;
 select * into p from public.refresh_player_energy_v1(p_player);
 if p.is_npc or p.gender is null or p.profile_photo_url is null then raise exception 'onboarding_required';end if;
 select accepted into past from public.game_tap_batches where player_id=p_player and request_key=p_key;
 if found then return jsonb_build_object('player',to_jsonb(p),'accepted',past,'replayed',true);end if;
 insert into public.game_tap_limits(player_id) values(p_player) on conflict do nothing;
 select * into lim from public.game_tap_limits where player_id=p_player for update;
 lim.tokens:=least(20,lim.tokens+greatest(0,extract(epoch from(clock_timestamp()-lim.refreshed_at)))*8);
 n:=greatest(0,least(p_count,p.energy,floor(lim.tokens)::int));
 update public.game_tap_limits set tokens=lim.tokens-n,refreshed_at=clock_timestamp() where player_id=p_player;
 update public.players set energy=energy-n,mogg_points=mogg_points+n*greatest(1,tap_power),
 energy_updated_at=case when energy>=max_energy then now() else energy_updated_at end where id=p_player returning * into p;
 insert into public.game_tap_batches(player_id,request_key,accepted) values(p_player,p_key,n);
 if n>0 then insert into public.game_daily(player_id,day,taps) values(p_player,d,n) on conflict(player_id,day) do update set taps=public.game_daily.taps+n;end if;
 return jsonb_build_object('player',to_jsonb(p),'accepted',n,'replayed',false);
end $$;

create function public.duel_create_v1(p_player uuid) returns public.duel_invites language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare i public.duel_invites;p public.players;begin
 select * into p from public.players where id=p_player and not is_npc for update;
 if p.id is null or p.gender is null or p.profile_photo_url is null then raise exception 'onboarding_required';end if;
 select * into i from public.duel_invites where player_id=p_player and accepted_by is null and expires_at>now() order by created_at desc limit 1;
 if found then return i;end if;
 if (select count(*) from public.duel_invites where player_id=p_player and created_at>now()-interval '1 hour')>=10 then raise exception 'invite_limit';end if;
 insert into public.duel_invites(player_id) values(p_player) returning * into i;return i;
end $$;
create function public.duel_accept_v1(p_player uuid,p_token uuid) returns public.battles language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare i public.duel_invites;b public.battles;begin
 perform pg_advisory_xact_lock(739104,2);
 select * into i from public.duel_invites where token=p_token for update;if not found then raise exception 'invite_not_found';end if;
 if i.player_id=p_player then raise exception 'own_invite';end if;
 if i.accepted_by=p_player then select * into b from public.battles where id=i.battle_id;return b;end if;
 if i.accepted_by is not null or i.expires_at<=now() then raise exception 'invite_closed';end if;
 perform id from public.players where id in(i.player_id,p_player) order by id for update;
 if (select count(*) from public.players where id in(i.player_id,p_player) and not is_npc and gender is not null and profile_photo_url is not null)<>2 then raise exception 'onboarding_required';end if;
 if exists(select 1 from public.battles where status='active' and ends_at>clock_timestamp() and mode='quick' and (player_a in(i.player_id,p_player) or player_b in(i.player_id,p_player))) then raise exception 'player_busy';end if;
 insert into public.battles(player_a,player_b,status,duration_seconds,started_at,ends_at,source,mode)
 values(i.player_id,p_player,'active',60,clock_timestamp(),clock_timestamp()+interval '60 seconds','friend','quick') returning * into b;
 update public.duel_invites set accepted_by=p_player,battle_id=b.id where token=p_token;
 return b;
end $$;

create function public.game_purchase_trigger_v1() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if new.status='paid' and old.status is distinct from 'paid' then
  insert into public.player_inventory(player_id,cosmetic_id,source) select new.player_id,cosmetic_id,'stars_set' from public.cosmetic_bundle_items where bundle_id=new.cosmetic_id on conflict do nothing;
  insert into public.game_events(player_id,name) values(new.player_id,'purchase_paid');
 elsif new.status='refunded' and old.status='paid' then
  -- Remove only contents granted by this order, unless another paid order owns them.
  update public.players p set
   equipped_frame=case when p.equipped_frame=new.cosmetic_id then null else p.equipped_frame end,
   equipped_background=case when exists(select 1 from public.cosmetic_bundle_items where bundle_id=new.cosmetic_id and cosmetic_id=p.equipped_background) then null else p.equipped_background end,
   equipped_title=case when exists(select 1 from public.cosmetic_bundle_items where bundle_id=new.cosmetic_id and cosmetic_id=p.equipped_title) then null else p.equipped_title end
   where p.id=new.player_id and not exists(select 1 from public.star_purchases where id<>new.id and player_id=new.player_id and cosmetic_id=new.cosmetic_id and status='paid');
  delete from public.player_inventory pi where pi.player_id=new.player_id and pi.source in('stars','stars_set')
   and(pi.cosmetic_id=new.cosmetic_id or exists(select 1 from public.cosmetic_bundle_items bi where bi.bundle_id=new.cosmetic_id and bi.cosmetic_id=pi.cosmetic_id))
   and not exists(select 1 from public.star_purchases sp where sp.id<>new.id and sp.player_id=new.player_id and sp.status='paid' and(sp.cosmetic_id=pi.cosmetic_id or exists(select 1 from public.cosmetic_bundle_items bi where bi.bundle_id=sp.cosmetic_id and bi.cosmetic_id=pi.cosmetic_id)));
  insert into public.game_events(player_id,name) values(new.player_id,'purchase_refunded');
 end if;return new;
end $$;
create trigger game_set_fulfillment after update of status on public.star_purchases for each row execute function public.game_purchase_trigger_v1();
create function public.game_outbox_trigger_v1() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if new.status='finished' and old.status is distinct from 'finished' and new.telegram_chat_id is not null and new.telegram_message_id is not null then
  insert into public.game_result_outbox(battle_id) values(new.id) on conflict do nothing;
 end if;return new;
end $$;
create trigger game_result_ready after update of status on public.battles for each row execute function public.game_outbox_trigger_v1();
create function public.game_results_lease_v1() returns setof public.game_result_outbox language sql set search_path=pg_catalog,public,pg_temp as $$
 update public.game_result_outbox set leased_until=now()+interval '2 minutes',attempts=attempts+1 where battle_id in(
 select battle_id from public.game_result_outbox where delivered_at is null and attempts<5 and(leased_until is null or leased_until<now()) order by created_at for update skip locked limit 10) returning *;
$$;
create function public.game_group_top_v1(p_chat bigint) returns jsonb language sql set search_path=pg_catalog,public,pg_temp as $$
 with matches as (
  select b.* from public.battles b join public.players a on a.id=b.player_a join public.players z on z.id=b.player_b
  where b.telegram_chat_id=p_chat and b.status='finished' and b.finished_at>=date_trunc('week',now() at time zone 'UTC') at time zone 'UTC'
   and not a.is_npc and not z.is_npc and b.result_source='human' and b.result_reason='decided'
 ), wins as (
  -- A pair contributes at most one win per participant and day, so rematches don't farm the table.
  select winner_id,least(player_a,player_b) as a,greatest(player_a,player_b) as b,(finished_at at time zone 'UTC')::date as match_day
  from matches group by winner_id,least(player_a,player_b),greatest(player_a,player_b),(finished_at at time zone 'UTC')::date
 ), leaders as (
  select p.id,p.first_name,p.username,count(*) wins from wins w join public.players p on p.id=w.winner_id
  group by p.id,p.first_name,p.username order by wins desc,p.first_name,p.id limit 10
 ) select coalesce(jsonb_agg(to_jsonb(leaders)),'[]'::jsonb) from leaders;
$$;
create function public.game_worker_check_v1(p_secret text) returns boolean language sql security definer set search_path=pg_catalog,game_private,pg_temp as $$
 select length(coalesce(p_secret,''))=36 and exists(select 1 from game_private.worker_settings where id and secret=p_secret);
$$;
create function game_private.worker_tick() returns void language plpgsql security definer set search_path=pg_catalog,game_private,pg_temp as $$
declare s text;begin
 if not exists(select 1 from public.game_result_outbox where delivered_at is null and attempts<5 and(leased_until is null or leased_until<now())) then return;end if;
 select secret into s from game_private.worker_settings where id;
 perform net.http_post(url:='https://zjznmcydpngceiblqtwj.supabase.co/functions/v1/game-worker',headers:=jsonb_build_object('Content-Type','application/json','X-Game-Worker-Secret',s),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function game_private.worker_tick() from public,anon,authenticated,service_role;

do $$ declare r record;begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and(p.proname like 'game_%' or p.proname in('duel_create_v1','duel_accept_v1')) loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
select cron.schedule('game-result-delivery','* * * * *','select game_private.worker_tick()');

-- Campaign report is readable only through the trusted backend / owner SQL editor.
create view public.game_campaign_report with(security_invoker=true) as
 select c.slug,c.label,count(distinct a.player_id) as joined,
 count(distinct a.player_id) filter(where p.onboarding_completed) as profiles,
 count(distinct a.player_id) filter(where exists(select 1 from public.game_events e where e.player_id=a.player_id and e.name='battle_started')) as first_battles,
 count(distinct a.player_id) filter(where exists(select 1 from public.game_daily d where d.player_id=a.player_id and d.visited and d.day>(a.created_at at time zone 'UTC')::date)) as returned,
 count(distinct sp.player_id) filter(where sp.status='paid') as buyers,
 coalesce(sum(sp.stars) filter(where sp.status='paid'),0) as paid_stars
 from public.game_campaigns c left join public.game_attribution a on a.campaign=c.slug
 left join public.players p on p.id=a.player_id left join public.star_purchases sp on sp.player_id=a.player_id and sp.paid_at>=a.created_at
 group by c.slug,c.label;
revoke all on public.game_campaign_report from public,anon,authenticated;
grant select on public.game_campaign_report to service_role;
