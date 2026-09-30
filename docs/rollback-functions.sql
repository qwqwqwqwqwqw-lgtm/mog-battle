CREATE OR REPLACE FUNCTION public.accept_group_battle(p_request uuid, p_player uuid, p_chat bigint)
 RETURNS battles
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.battle_requests; b public.battles;
begin
 perform pg_advisory_xact_lock(739104,2);
 select * into r from public.battle_requests where id=p_request for update;
 if not found or r.status<>'pending' or r.expires_at<=now() or r.telegram_chat_id is distinct from p_chat then raise exception 'request_closed'; end if;
 if r.challenger_id=p_player or (r.target_id is not null and r.target_id<>p_player) then raise exception 'wrong_player'; end if;
 perform id from public.players where id in(r.challenger_id,p_player) order by id for update;
 if (select count(*) from public.players where id in(r.challenger_id,p_player) and profile_photo_url is not null)<>2 then raise exception 'photo_required'; end if;
 if exists(select 1 from public.battles where status='active' and ends_at>now() and (coalesce(mode,'group')='quick')=(r.mode='quick') and (player_a in(r.challenger_id,p_player) or player_b in(r.challenger_id,p_player))) then raise exception 'player_busy'; end if;
 if r.mode is distinct from 'quick' and (ranked_votes_needed_v2(r.challenger_id)>0 or ranked_votes_needed_v2(p_player)>0) then raise exception 'votes_required'; end if;
 insert into public.battles(player_a,player_b,status,duration_seconds,started_at,ends_at,source,mode,telegram_chat_id)
 values(r.challenger_id,p_player,'active',case when r.mode='quick' then 60 else 86400 end,clock_timestamp(),clock_timestamp()+case when r.mode='quick' then interval '60 seconds' else interval '24 hours' end,'telegram',case when r.mode='quick' then 'quick' else 'group' end,p_chat) returning * into b;
 update public.battle_requests set status='accepted',accepted_by=p_player,matched_battle_id=b.id where id=r.id;
 update battles set rating_a_start=(select mogg_score from players where id=b.player_a),rating_b_start=(select mogg_score from players where id=b.player_b) where id=b.id returning * into b;
 if r.mode is distinct from 'quick' then update players set last_ranked_started_at=b.started_at where id in(b.player_a,b.player_b) and not coalesce(is_npc,false); end if;
 return b;
end $function$


CREATE OR REPLACE FUNCTION public.attach_referral_v1(p_invited uuid, p_inviter_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE invited public.players; inviter public.players; r public.referrals;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referral:'||p_invited::text,0));
  SELECT * INTO invited FROM public.players WHERE id=p_invited;
  IF NOT FOUND OR invited.is_npc THEN RAISE EXCEPTION 'invalid_invited'; END IF;
  SELECT * INTO inviter FROM public.players WHERE telegram_id=p_inviter_telegram_id AND NOT is_npc;
  IF NOT FOUND OR inviter.id=invited.id THEN RETURN jsonb_build_object('ignored',true); END IF;
  INSERT INTO public.referrals(inviter_id,invited_id)
  VALUES(inviter.id,invited.id) ON CONFLICT(invited_id) DO NOTHING;
  SELECT * INTO r FROM public.referrals WHERE invited_id=p_invited FOR UPDATE;
  UPDATE public.players SET referred_by=r.inviter_id WHERE id=p_invited AND referred_by IS DISTINCT FROM r.inviter_id;
  IF invited.gender IS NOT NULL AND nullif(invited.profile_photo_url,'') IS NOT NULL THEN
    PERFORM public.activate_referral(p_invited,100);
  END IF;
  RETURN jsonb_build_object('attached',true,'retained_original',r.inviter_id<>inviter.id);
END $function$


CREATE OR REPLACE FUNCTION public.battle_feed_v2(p_player uuid)
 RETURNS SETOF battles
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
 SELECT b.* FROM battles b WHERE b.status='active' AND b.ends_at>clock_timestamp()
 AND (p_player IN(b.player_a,b.player_b) OR NOT EXISTS(SELECT 1 FROM battle_votes v WHERE v.battle_id=b.id AND v.voter_id=p_player))
 ORDER BY (p_player IN(b.player_a,b.player_b)) DESC,
 (EXISTS(SELECT 1 FROM players p WHERE p.id IN(b.player_a,b.player_b) AND NOT coalesce(p.is_npc,false))) DESC,
 b.created_at ASC LIMIT 40
$function$


CREATE OR REPLACE FUNCTION public.cast_battle_vote_v2(p_battle uuid, p_voter uuid, p_target uuid, p_allow_change boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE b public.battles; va integer; vb integer; existing_target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(739104,2);
 SELECT * INTO b FROM battles WHERE id=p_battle FOR UPDATE;
 IF NOT FOUND OR b.status<>'active' OR b.ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'battle_closed'; END IF;
 IF p_voter IN(b.player_a,b.player_b) THEN RAISE EXCEPTION 'fighters_cannot_vote'; END IF;
 IF NOT EXISTS(SELECT 1 FROM players WHERE id=p_voter AND NOT coalesce(is_npc,false)) THEN RAISE EXCEPTION 'invalid_voter'; END IF;
 IF p_target IS NOT NULL AND p_target NOT IN(b.player_a,b.player_b) THEN RAISE EXCEPTION 'invalid_vote'; END IF;
 SELECT voted_for INTO existing_target FROM battle_votes WHERE battle_id=b.id AND voter_id=p_voter;
 IF existing_target IS NOT NULL AND NOT p_allow_change THEN RAISE EXCEPTION 'already_voted'; END IF;
 IF p_target IS NULL THEN
   IF NOT p_allow_change THEN RAISE EXCEPTION 'invalid_vote'; END IF;
   DELETE FROM battle_votes WHERE battle_id=b.id AND voter_id=p_voter;
 ELSE
   INSERT INTO battle_votes(battle_id,voter_id,voted_for) VALUES(b.id,p_voter,p_target)
   ON CONFLICT(battle_id,voter_id) DO UPDATE SET voted_for=excluded.voted_for;
   PERFORM reward_battle_vote_v1(b.id,p_voter);
 END IF;
 SELECT count(*) FILTER(WHERE v.voted_for=b.player_a),count(*) FILTER(WHERE v.voted_for=b.player_b) INTO va,vb
 FROM battle_votes v JOIN players p ON p.id=v.voter_id WHERE v.battle_id=b.id AND NOT coalesce(p.is_npc,false) AND v.voter_id NOT IN(b.player_a,b.player_b);
 IF b.rules_version>=2 AND coalesce(b.mode,'ranked')<>'quick' THEN
   IF va+vb>=5 AND b.quorum_at IS NULL THEN b.quorum_at:=clock_timestamp(); b.ends_at:=least(b.started_at+interval '24 hours',b.quorum_at+interval '10 minutes');
   ELSIF va+vb<5 THEN b.quorum_at:=NULL; b.ends_at:=b.started_at+interval '24 hours'; END IF;
 END IF;
 UPDATE battles SET votes_a=va,votes_b=vb,quorum_at=b.quorum_at,ends_at=b.ends_at WHERE id=b.id;
 RETURN jsonb_build_object('votes_a',va,'votes_b',vb,'ends_at',b.ends_at);
END $function$


CREATE OR REPLACE FUNCTION public.claim_prestige_v1(p_player uuid)
 RETURNS players
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.players; base integer; reward integer;
begin
  select * into p from public.players where id=p_player for update;
  if p.prestige_claimed_on=current_date then raise exception 'already_claimed'; end if;
  base:=least(20, 2 + coalesce(p.tap_power,1) + coalesce(p.energy_level,0) + coalesce(p.recovery_level,0) + coalesce(p.idle_level,0)*2);
  update public.players set mogg_points=coalesce(mogg_points,0)+base,prestige=prestige+base,prestige_claimed_on=current_date
  where id=p_player returning * into p; return p;
end $function$


CREATE OR REPLACE FUNCTION public.create_match_atomic_v1(p_player uuid, p_opponent uuid, p_mode text, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare b public.battles; op public.players; me public.players; rq public.battle_requests; pid uuid;
begin
 perform pg_advisory_xact_lock(739104,2);
 if p_player=p_opponent or p_mode not in('quick','ranked') then raise exception 'invalid_match'; end if;
 -- Canonical participant order prevents opposing requests taking locks in reverse order.
 perform id from public.players where id in(p_player,p_opponent) order by id for update;
 select * into me from public.players where id=p_player;
 select * into op from public.players where id=p_opponent;
 if me.id is null or op.id is null or me.is_npc then raise exception 'invalid_players'; end if;
 select * into b from public.battles where status='active' and (ends_at is null or ends_at>clock_timestamp())
   and (coalesce(mode,'ranked')='quick')=(p_mode='quick') and p_player in(player_a,player_b) order by created_at desc limit 1;
 if found then return jsonb_build_object('battle',to_jsonb(b),'existing',true); end if;
 if not op.is_npc and exists(select 1 from public.battles where status='active'
    and (ends_at is null or ends_at>clock_timestamp()) and (coalesce(mode,'ranked')='quick')=(p_mode='quick') and p_opponent in(player_a,player_b)) then
   return jsonb_build_object('retry',true,'reason','opponent_busy');
 end if;
 if me.profile_photo_url is null or op.profile_photo_url is null or me.gender is null
    or me.gender is distinct from op.gender then raise exception 'invalid_profile'; end if;
 if op.is_npc and not coalesce(op.npc_active,false) then return jsonb_build_object('retry',true); end if;
 if p_request is not null then
   select * into rq from public.battle_requests where id=p_request for update;
   if not found or rq.status<>'pending' or rq.expires_at<=clock_timestamp()
     or rq.challenger_id not in(p_player,p_opponent)
     or rq.mode<>(case when p_mode='quick' then 'quick' else 'matchmaking' end) then
     return jsonb_build_object('retry',true,'reason','queue_changed');
   end if;
 end if;
 if p_mode='ranked' then
   if ranked_votes_needed_v2(p_player)>0 then raise exception 'votes_required'; end if;
   if not op.is_npc and ranked_votes_needed_v2(p_opponent)>0 then return jsonb_build_object('retry',true,'reason','opponent_needs_votes'); end if;
 end if;
 insert into public.battles(player_a,player_b,status,duration_seconds,started_at,ends_at,source,mode)
 values(p_opponent,p_player,'active',case when p_mode='quick' then 60 else 86400 end,clock_timestamp(),clock_timestamp()+case when p_mode='quick' then interval '60 seconds' else interval '24 hours' end,
        case when op.is_npc then 'npc' else 'miniapp' end,p_mode) returning * into b;
 update public.battle_requests set status='accepted',
   accepted_by=case when challenger_id=p_player then p_opponent else p_player end,matched_battle_id=b.id
 where status='pending' and challenger_id in(p_player,p_opponent) and mode=case when p_mode='quick' then 'quick' else 'matchmaking' end;
 if op.is_npc then
   insert into public.npc_matches(battle_id,human_player_id,npc_player_id,mode) values(b.id,p_player,p_opponent,p_mode);
 end if;
 update battles set rating_a_start=op.mogg_score,rating_b_start=me.mogg_score where id=b.id returning * into b;
 if p_mode='ranked' then update players set last_ranked_started_at=b.started_at where id in(p_player,p_opponent) and not coalesce(is_npc,false); end if;
 return jsonb_build_object('battle',to_jsonb(b),'existing',false);
end $function$


CREATE OR REPLACE FUNCTION public.finish_mogg_battle(p_battle uuid, p_votes_a integer, p_votes_b integer)
 RETURNS battles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE b public.battles; pa public.players; pb public.players; winner uuid; loser uuid;
 required integer; rated boolean; amount integer:=0; da integer:=0; db integer:=0; ra integer; rb integer; winner_rating integer; loser_rating integer; reason text;
BEGIN
 PERFORM pg_advisory_xact_lock(739104,2);
 SELECT * INTO b FROM battles WHERE id=p_battle FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'battle_not_found'; END IF;
 IF b.status<>'active' OR b.ends_at>clock_timestamp() OR b.ends_at IS NULL THEN RETURN b; END IF;
 PERFORM id FROM players WHERE id IN(b.player_a,b.player_b) ORDER BY id FOR UPDATE;
 SELECT * INTO pa FROM players WHERE id=b.player_a; SELECT * INTO pb FROM players WHERE id=b.player_b;
 SELECT count(*) FILTER(WHERE v.voted_for=b.player_a),count(*) FILTER(WHERE v.voted_for=b.player_b) INTO p_votes_a,p_votes_b
 FROM battle_votes v JOIN players p ON p.id=v.voter_id WHERE v.battle_id=b.id AND NOT coalesce(p.is_npc,false) AND v.voter_id NOT IN(b.player_a,b.player_b);
 rated:=coalesce(b.mode,'ranked')<>'quick';
 required:=CASE WHEN NOT rated THEN 1 WHEN b.rules_version>=2 THEN 5 WHEN b.mode='group' THEN 3 ELSE 1 END;
 IF p_votes_a+p_votes_b<required THEN
   reason:='insufficient_votes';
   IF rated THEN UPDATE players SET last_ranked_started_at=NULL WHERE id IN(b.player_a,b.player_b) AND last_ranked_started_at=b.started_at; END IF;
 ELSIF p_votes_a=p_votes_b THEN reason:='draw';
 ELSE
   winner:=CASE WHEN p_votes_a>p_votes_b THEN b.player_a ELSE b.player_b END;
   loser:=CASE WHEN winner=b.player_a THEN b.player_b ELSE b.player_a END;
   reason:='decided';
   IF rated THEN
     IF EXISTS(SELECT 1 FROM battles x WHERE x.id<>b.id AND x.status='finished' AND x.finished_at>=(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AND (coalesce(x.score_delta_a,0)<>0 OR coalesce(x.score_delta_b,0)<>0) AND ((x.player_a=b.player_a AND x.player_b=b.player_b) OR (x.player_a=b.player_b AND x.player_b=b.player_a))) THEN reason:='pair_limit';
     ELSE
       ra:=coalesce(b.rating_a_start,pa.mogg_score,0); rb:=coalesce(b.rating_b_start,pb.mogg_score,0);
       winner_rating:=CASE WHEN winner=b.player_a THEN ra ELSE rb END;
       loser_rating:=CASE WHEN winner=b.player_a THEN rb ELSE ra END;
       amount:=greatest(8,least(40,round(48*(1-1/(1+power(10::numeric,greatest(-4000,least(4000,loser_rating-winner_rating))/400.0))))::integer));
       da:=CASE WHEN winner=b.player_a THEN amount ELSE -least(coalesce(pa.mogg_score,0),amount) END;
       db:=CASE WHEN winner=b.player_b THEN amount ELSE -least(coalesce(pb.mogg_score,0),amount) END;
     END IF;
   END IF;
 END IF;
 UPDATE players SET mogg_score=coalesce(mogg_score,0)+CASE WHEN id=b.player_a THEN da ELSE db END,
 season_peak=greatest(coalesce(season_peak,0),coalesce(mogg_score,0)+CASE WHEN id=b.player_a THEN da ELSE db END),
 all_time_peak=greatest(coalesce(all_time_peak,0),coalesce(mogg_score,0)+CASE WHEN id=b.player_a THEN da ELSE db END),
 battles_played=coalesce(battles_played,0)+CASE WHEN reason='insufficient_votes' THEN 0 ELSE 1 END,
 battles_won=coalesce(battles_won,0)+CASE WHEN winner=id AND reason='decided' THEN 1 ELSE 0 END,
 win_streak=CASE WHEN NOT rated OR reason<>'decided' THEN win_streak WHEN winner=id THEN coalesce(win_streak,0)+1 ELSE 0 END
 WHERE id IN(b.player_a,b.player_b);
 UPDATE battles SET status='finished',votes_a=p_votes_a,votes_b=p_votes_b,winner_id=winner,finished_at=clock_timestamp(),result_source='human',result_reason=reason,
 simulation_a=NULL,simulation_b=NULL,score_delta_a=da,score_delta_b=db WHERE id=b.id RETURNING * INTO b;
 RETURN b;
END $function$


CREATE OR REPLACE FUNCTION public.fulfill_star_purchase_v1(p_payload text, p_telegram_id bigint, p_currency text, p_amount integer, p_charge text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare purchase star_purchases; buyer players; c cosmetics; owned boolean; used bigint;
begin
 if p_currency is distinct from 'XTR' or p_amount is null or p_amount<=0 or p_charge is null or length(trim(p_charge))=0 then raise exception 'invalid_payment';end if;
 select * into purchase from star_purchases where invoice_payload=p_payload;
 if not found then raise exception 'purchase_not_found';end if;
 select * into c from cosmetics where id=purchase.cosmetic_id for update;
 select * into purchase from star_purchases where id=purchase.id for update;
 select * into buyer from players where id=purchase.player_id for update;
 if buyer.telegram_id is distinct from p_telegram_id or purchase.stars is distinct from p_amount then raise exception 'payment_mismatch';end if;
 if purchase.status='paid' then
   if purchase.telegram_payment_charge_id is distinct from p_charge then raise exception 'charge_mismatch';end if;
   return jsonb_build_object('replayed',true,'name',c.name);
 end if;
 if purchase.status<>'pending' then raise exception 'purchase_not_pending';end if;
 if exists(select 1 from star_purchases where telegram_payment_charge_id=p_charge) then raise exception 'charge_already_used';end if;
 select exists(select 1 from player_inventory where player_id=buyer.id and cosmetic_id=purchase.cosmetic_id) into owned;
 if not owned and c.limited_total is not null then
   select (select count(*) from player_inventory where cosmetic_id=c.id)+
          (select count(*) from star_purchases where cosmetic_id=c.id and status='pending' and checkout_query_id is not null and id<>purchase.id) into used;
   if used>=c.limited_total then raise exception 'paid_item_needs_review';end if;
 end if;
 update star_purchases set status='paid',telegram_payment_charge_id=p_charge,paid_at=now() where id=purchase.id;
 insert into player_inventory(player_id,cosmetic_id,source) values(buyer.id,purchase.cosmetic_id,'stars') on conflict(player_id,cosmetic_id) do nothing;
 return jsonb_build_object('replayed',false,'name',c.name,'already_owned',owned);
end $function$


CREATE OR REPLACE FUNCTION public.refresh_player_energy_v1(p_player uuid)
 RETURNS players
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p public.players;
  now_ts timestamptz:=now();
  elapsed_energy numeric;
  elapsed_idle numeric;
  seconds_per_energy integer;
  gained_energy integer:=0;
  idle_gain bigint:=0;
begin
  select * into p from public.players where id=p_player for update;
  if not found then raise exception 'player_not_found'; end if;

  seconds_per_energy:=greatest(60, round(180.0 / (1.0 + greatest(0,coalesce(p.recovery_level,0))*0.10))::integer);
  elapsed_energy:=greatest(0,extract(epoch from (now_ts-coalesce(p.energy_updated_at,now_ts))));
  gained_energy:=floor(elapsed_energy/seconds_per_energy);

  if gained_energy>0 then
    update public.players
      set energy=least(max_energy,energy+gained_energy),
          energy_updated_at=case
            when energy+gained_energy>=max_energy then now_ts
            else coalesce(energy_updated_at,now_ts)+(gained_energy*seconds_per_energy)*interval '1 second'
          end
      where id=p_player;
  end if;

  select * into p from public.players where id=p_player for update;
  elapsed_idle:=least(43200,greatest(0,extract(epoch from (now_ts-coalesce(p.idle_updated_at,now_ts)))));
  if coalesce(p.idle_level,0)>0 then
    idle_gain:=floor(elapsed_idle/600)::bigint * greatest(0,p.idle_level);
  end if;
  if idle_gain>0 then
    update public.players set mogg_points=mogg_points+idle_gain,idle_updated_at=now_ts where id=p_player;
  elsif elapsed_idle>=600 then
    update public.players set idle_updated_at=now_ts where id=p_player;
  end if;

  select * into p from public.players where id=p_player;
  return p;
end $function$


CREATE OR REPLACE FUNCTION public.reward_battle_vote_v1(p_battle uuid, p_voter uuid)
 RETURNS players
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.players; inserted integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM battle_votes v JOIN battles b ON b.id=v.battle_id JOIN players voter ON voter.id=v.voter_id WHERE v.battle_id=p_battle AND v.voter_id=p_voter AND NOT coalesce(voter.is_npc,false) AND v.voter_id NOT IN(b.player_a,b.player_b) AND v.voted_for IN(b.player_a,b.player_b)) THEN RAISE EXCEPTION 'invalid_vote'; END IF;
 INSERT INTO battle_vote_rewards(battle_id,voter_id) VALUES(p_battle,p_voter) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN UPDATE players SET mogg_points=coalesce(mogg_points,0)+2 WHERE id=p_voter RETURNING * INTO p;
 ELSE SELECT * INTO p FROM players WHERE id=p_voter; END IF;
 RETURN p;
END $function$


CREATE OR REPLACE FUNCTION public.spin_daily_v2(p_player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare p public.players; c public.cosmetics; day date:=(now() at time zone 'UTC')::date;
 previous jsonb; roll float8; slot int; amount int:=0; gain int:=0; energy_prize int:=0;
 prize jsonb; reward_kind text; fallback boolean:=false;
begin
 select * into p from players where id=p_player for update;
 if not found then raise exception 'player_not_found'; end if;
 select result into previous from daily_spins where player_id=p_player and claimed_on=day;
 if found then return jsonb_build_object('replayed',true,'prize',previous,'player',to_jsonb(p)); end if;
 if p.app_daily_claimed_on=day then raise exception 'already_claimed'; end if;
 roll:=random();
 if roll<0.18 then slot:=0;amount:=50;
 elsif roll<0.33 then slot:=1;amount:=75;
 elsif roll<0.48 then slot:=2;amount:=100;
 elsif roll<0.58 then slot:=3;amount:=150;
 elsif roll<0.66 then slot:=4;amount:=200;
 elsif roll<0.69 then slot:=5;amount:=400;
 elsif roll<0.79 then slot:=6;energy_prize:=20;
 elsif roll<0.85 then slot:=7;energy_prize:=50;
 elsif roll<0.90 then slot:=8;amount:=100;energy_prize:=20;
 elsif roll<0.94 then slot:=9;reward_kind:='frame';
 elsif roll<0.97 then slot:=10;reward_kind:='profile_bg';
 else slot:=11;reward_kind:='title'; end if;
 if energy_prize>0 then
   select * into p from refresh_player_energy_v1(p_player);
   gain:=least(energy_prize,greatest(0,p.max_energy-p.energy));
   amount:=amount+energy_prize-gain;
   update players set energy=energy+gain where id=p_player;
 end if;
 if reward_kind is not null then
   select * into c from cosmetics where is_purchasable=true and price_stars=0
     and price_points>0 and price_points<=1600 and kind=reward_kind and limited_total is null
     and not exists(select 1 from player_inventory i where i.player_id=p_player and i.cosmetic_id=cosmetics.id)
     order by random() limit 1;
   if found then
     insert into player_inventory(player_id,cosmetic_id,source) values(p_player,c.id,'daily_spin');
   else amount:=150;fallback:=true; end if;
 end if;
 update players set mogg_points=coalesce(mogg_points,0)+amount,app_daily_claimed_on=day where id=p_player returning * into p;
 prize:=jsonb_build_object('version',2,'slot_count',12,'slot',slot,'points',amount,
   'energy',gain,'energy_overflow',energy_prize-gain,'cosmetic_id',c.id,'cosmetic_name',c.name,
   'cosmetic_kind',reward_kind,'fallback',fallback,'day',day);
 insert into daily_spins(player_id,claimed_on,result) values(p_player,day,prize);
 return jsonb_build_object('replayed',false,'prize',prize,'player',to_jsonb(p));
end $function$
