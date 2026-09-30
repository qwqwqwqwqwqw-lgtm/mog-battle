-- Run in the owner's SQL editor. Fixtures and side effects are rolled back.
begin;
do $$
declare a uuid;b uuid;v uuid;outsider uuid;i public.duel_invites;match public.battles;other public.battles;
 r jsonb;r2 jsonb;initial_points bigint;after_points bigint;set_id uuid;payload text;key uuid:=gen_random_uuid(); accepted int;
begin
 insert into public.players(telegram_id,first_name,gender,profile_photo_url,onboarding_completed,mogg_points,mogg_score)
 values(9000000000001,'QA A','male','https://qwqwqwqwqwqw-lgtm.github.io/mog-battle/npc/npc001.jpg',true,1000,800) returning id into a;
 insert into public.players(telegram_id,first_name,gender,profile_photo_url,onboarding_completed,mogg_points,mogg_score)
 values(9000000000002,'QA B','female','https://qwqwqwqwqwqw-lgtm.github.io/mog-battle/npc/npc002.jpg',true,1000,900) returning id into b;
 insert into public.players(telegram_id,first_name) values(9000000000003,'QA voter without photo') returning id into v;
 insert into public.players(telegram_id,first_name,gender,profile_photo_url)
 values(9000000000004,'QA outsider','male','https://qwqwqwqwqwqw-lgtm.github.io/mog-battle/npc/npc003.jpg') returning id into outsider;
 perform public.game_touch_v1(v,'launch');perform public.game_touch_v1(v,'organic');
 if(select count(*) from public.game_events where player_id=v and name='session_open')<>1 then raise exception 'session duplicate';end if;
 if(select campaign from public.game_attribution where player_id=v)<>'launch' then raise exception 'attribution changed';end if;
 r:=public.game_claim_reward_v1(v,'visit');r2:=public.game_claim_reward_v1(v,'visit');
 if(r->>'points')::int<>25 or (r2->>'replayed')::boolean<>true then raise exception 'visit reward replay';end if;
 i:=public.duel_create_v1(a);match:=public.duel_accept_v1(b,i.token);other:=public.duel_accept_v1(b,i.token);
 if match.id<>other.id or match.mode<>'quick' then raise exception 'duel replay';end if;
 begin perform public.duel_accept_v1(outsider,i.token);raise exception 'third participant accepted';
 exception when others then if sqlerrm<>'invite_closed' then raise;end if;end;
 perform public.cast_battle_vote_v2(match.id,v,a,false);
 if (public.game_daily_state_v1(v)->>'votes')::int<>1 then raise exception 'vote progress';end if;
 r:=public.game_claim_reward_v1(v,'welcome');r2:=public.game_claim_reward_v1(v,'welcome');
 if(r->>'points')::int<>100 or (r2->>'replayed')::boolean<>true then raise exception 'welcome replay';end if;
 if(select count(*) from public.player_inventory where player_id=v)<>1 then raise exception 'welcome inventory';end if;
 begin perform public.cast_battle_vote_v2(match.id,v,a,false);raise exception 'duplicate vote accepted';
 exception when others then if sqlerrm<>'already_voted' then raise;end if;end;
 if(public.game_daily_state_v1(v)->>'votes')::int<>1 then raise exception 'duplicate vote progress';end if;
 select mogg_points into initial_points from public.players where id=a;
 r:=public.game_tap_batch_v1(a,key,8);r2:=public.game_tap_batch_v1(a,key,8);accepted:=(r->>'accepted')::int;
 select mogg_points into after_points from public.players where id=a;
 if accepted<>8 or after_points-initial_points<>8 or (r2->>'replayed')::boolean<>true then raise exception 'tap batch replay';end if;
 if(public.game_daily_state_v1(a)->>'taps')::int<>8 then raise exception 'tap progress duplicated';end if;
 begin perform public.game_tap_batch_v1(a,gen_random_uuid(),null);raise exception 'null batch accepted';
 exception when others then if sqlerrm<>'invalid_batch' then raise;end if;end;
 begin perform public.game_tap_batch_v1(v,gen_random_uuid(),1);raise exception 'anonymous taps accepted';
 exception when others then if sqlerrm<>'onboarding_required' then raise;end if;end;
 update public.battles set ends_at=clock_timestamp()-interval '1 second',telegram_chat_id=-999000012345,telegram_message_id=1 where id=match.id;
 match:=public.finish_mogg_battle(match.id,999,999);
 if match.winner_id<>a or match.votes_a<>1 or match.votes_b<>0 or match.score_delta_a<>0 then raise exception 'quick result not real votes';end if;
 if(select mogg_score from public.players where id=a)<>800 then raise exception 'quick modified rating';end if;
 if(select count(*) from public.game_result_outbox where battle_id=match.id)<>1 then raise exception 'missing result outbox';end if;
 if(jsonb_array_length(public.game_group_top_v1(-999000012345)))<>1 then raise exception 'weekly table';end if;
 -- A purchase is fulfilled only through the verified webhook RPC; no Telegram payment is made here.
 select id into set_id from public.cosmetics where code='frame_afterhours';payload:='qa_'||gen_random_uuid();
 insert into public.star_purchases(player_id,cosmetic_id,invoice_payload,stars,terms_version) values(a,set_id,payload,99,'2026-09-30');
 begin perform public.fulfill_star_purchase_v1(payload,9000000000001,'XTR',1,'qa_wrong');raise exception 'wrong amount accepted';
 exception when others then if sqlerrm<>'payment_mismatch' then raise;end if;end;
 r:=public.fulfill_star_purchase_v1(payload,9000000000001,'XTR',99,'qa_charge_'||key);
 r2:=public.fulfill_star_purchase_v1(payload,9000000000001,'XTR',99,'qa_charge_'||key);
 if(r2->>'replayed')::boolean<>true then raise exception 'payment replay';end if;
 if(select count(*) from public.player_inventory where player_id=a and cosmetic_id in(select cosmetic_id from public.cosmetic_bundle_items where bundle_id=set_id union all select set_id))<>3 then raise exception 'bundle not complete';end if;
 update public.players set equipped_frame=set_id,equipped_background=(select id from public.cosmetics where code='bg_afterhours'),equipped_title=(select id from public.cosmetics where code='title_afterhours') where id=a;
 update public.star_purchases set status='refunded' where invoice_payload=payload;
 if(select count(*) from public.player_inventory where player_id=a and source in('stars','stars_set'))<>0 then raise exception 'refund kept bundle';end if;
 if(select equipped_frame from public.players where id=a) is not null then raise exception 'refund equipped item';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and(p.proname like 'game_%' or p.proname in('duel_create_v1','duel_accept_v1')) and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) then raise exception 'client can call trusted RPC';end if;
 if public.game_worker_check_v1('00000000-0000-0000-0000-000000000000') then raise exception 'worker accepts wrong secret';end if;
end $$;
rollback;
select 'PASS: rewards, photo-free votes, duels, taps, real results, group top, payments, refunds and RPC access' as result;
