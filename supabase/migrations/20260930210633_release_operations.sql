-- Campaigns are first-touch labels, never user-supplied SQL or discounts.
insert into public.game_campaigns(slug,label) values
 ('nikita','Никита Looksmax'),('nalimov','Налимов'),('mhs','Служба MHS'),
 ('shawty','шавти илья'),('style','Make Your Style') on conflict do nothing;
create index game_attribution_campaign on public.game_attribution(campaign);
create index duel_invites_accepted_by on public.duel_invites(accepted_by) where accepted_by is not null;
create index duel_invites_battle on public.duel_invites(battle_id) where battle_id is not null;
create index cosmetic_bundle_items_cosmetic on public.cosmetic_bundle_items(cosmetic_id);
alter table public.players add column if not exists photo_consent_at timestamptz;
alter table public.players add column if not exists photo_consent_version text;
create function public.game_replace_photo_v1(p_player uuid,p_url text,p_version text default '2026-09-30') returns public.players
 language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare p public.players;begin
 if p_version is distinct from '2026-09-30' then raise exception 'photo_consent_required';end if;
 p:=public.replace_profile_photo_v1(p_player,p_url);
 update public.players set photo_consent_at=now(),photo_consent_version=p_version where id=p_player returning * into p;
 insert into public.game_events(player_id,name) values(p_player,'photo_saved');
 return p;
end $$;
revoke all on function public.game_replace_photo_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.game_replace_photo_v1(uuid,text,text) to service_role;
-- Retry keys exist for network recovery. Rate limits still apply to any new key.
select cron.schedule('game-maintenance','25 2 * * *',$job$
 delete from public.game_tap_batches where created_at<now()-interval '30 days';
 delete from public.duel_invites where expires_at<now()-interval '30 days';
 delete from public.game_events where created_at<now()-interval '90 days' and name in('session_open','shop_open','share_profile','share_result','share_duel','onboarding_open','invoice_open','share_prepared');
$job$);
