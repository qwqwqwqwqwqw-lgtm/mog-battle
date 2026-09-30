-- Only the owner / trusted backend can read these. No public dashboard or player data export.
select * from public.game_campaign_report order by first_battles desc,joined desc;

-- Conversion by first source, counted once per account.
select a.campaign,count(*) opened,
 count(*) filter(where exists(select 1 from public.battle_vote_rewards v where v.voter_id=a.player_id and v.created_at>=a.created_at)) first_vote,
 count(*) filter(where p.onboarding_completed) profiles,
 count(*) filter(where exists(select 1 from public.game_events e where e.player_id=a.player_id and e.name='battle_started')) quick_started,
 count(*) filter(where exists(select 1 from public.game_daily d where d.player_id=a.player_id and d.visited and d.day=(a.created_at at time zone 'UTC')::date+1)) d1_returned
from public.game_attribution a join public.players p on p.id=a.player_id
where a.created_at>=now()-interval '30 days' and not p.is_npc group by a.campaign;

-- D1 cohort: include only accounts that have had a full next UTC day to return.
select (a.created_at at time zone 'UTC')::date cohort,count(*) users,
 count(*) filter(where exists(select 1 from public.game_daily d where d.player_id=a.player_id and d.visited and d.day=(a.created_at at time zone 'UTC')::date+1)) returned_d1
from public.game_attribution a join public.players p on p.id=a.player_id
where not p.is_npc and (a.created_at at time zone 'UTC')::date < (now() at time zone 'UTC')::date-1
group by cohort order by cohort desc;

-- Handle actual human support promptly. Answers are displayed in the player's support history.
select id,category,status,created_at,message from public.support_requests where status='open' order by created_at;

-- Delivery failures require review. Only retry after resolving the Telegram error.
select battle_id,attempts,last_error,created_at from public.game_result_outbox where delivered_at is null order by created_at;

-- Net recorded sales: paid excludes orders already marked refunded.
select status,count(*) orders,sum(stars) stars from public.star_purchases group by status;
