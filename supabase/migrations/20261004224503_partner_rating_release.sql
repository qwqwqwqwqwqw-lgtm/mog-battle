-- Optional partner offers. Only the authenticated server may inspect or award claims.
create table public.partner_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique references public.game_campaigns(slug),
  title text not null check (length(title) between 1 and 80),
  username text not null check (username ~ '^[a-zA-Z][a-zA-Z0-9_]{4,31}$'),
  reward_points integer not null default 100 check (reward_points between 1 and 1000),
  is_active boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  check (ends_at is null or ends_at > starts_at)
);
create table public.partner_claims (
  campaign_id uuid not null references public.partner_campaigns(id),
  player_id uuid not null references public.players(id) on delete cascade,
  reward_points integer not null check (reward_points between 1 and 1000),
  claimed_at timestamptz not null default now(),
  primary key (campaign_id, player_id)
);
create index partner_claims_player_idx on public.partner_claims(player_id);
alter table public.partner_campaigns enable row level security;
alter table public.partner_claims enable row level security;
revoke all on public.partner_campaigns, public.partner_claims from public, anon, authenticated;
grant all on public.partner_campaigns, public.partner_claims to service_role;

create function public.claim_partner_points_v1(p_player uuid, p_campaign uuid)
returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare c public.partner_campaigns; awarded integer;
begin
  -- Serializes every claim for this player; also prevents two concurrent checks awarding twice.
  perform id from public.players where id=p_player and not is_npc for update;
  if not found then raise exception 'player_not_found'; end if;
  select * into c from public.partner_campaigns where id=p_campaign for share;
  if not found or not c.is_active or c.starts_at>now() or (c.ends_at is not null and c.ends_at<=now())
    then raise exception 'partner_inactive'; end if;
  select reward_points into awarded from public.partner_claims where campaign_id=p_campaign and player_id=p_player;
  if found then return jsonb_build_object('replayed',true,'points',awarded); end if;
  insert into public.partner_claims(campaign_id,player_id,reward_points) values(p_campaign,p_player,c.reward_points);
  update public.players set mogg_points=mogg_points+c.reward_points where id=p_player;
  return jsonb_build_object('replayed',false,'points',c.reward_points);
end $$;
revoke all on function public.claim_partner_points_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_partner_points_v1(uuid,uuid) to service_role;
