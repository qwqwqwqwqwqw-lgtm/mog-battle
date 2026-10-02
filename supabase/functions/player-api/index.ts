import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { validatePng, cleanupCards } from "../_shared/portrait.ts";
import { decodePhoto } from "../_shared/raster.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EQUIP_FIELDS: any = {
  frame: "equipped_frame",
  profile_bg: "equipped_background",
  title: "equipped_title",
  battle_intro: "equipped_battle_intro",
  victory_card: "equipped_victory_card",
  score_style: "equipped_score_style",
  name_style: "equipped_name_style",
  reaction: "equipped_reaction",
};

const RARITY_ORDER = [
  "common",
  "rare",
  "epic",
  "elite",
  "legendary",
  "mythic",
  "ascended",
];
const DROP_MILESTONES = [1, 3, 6, 9, 11, 12];
const RATES_BY_TIER: any = {
  1: {
    common: 58,
    rare: 30,
    epic: 10,
    elite: 2,
    legendary: 0,
    mythic: 0,
    ascended: 0,
  },
  2: {
    common: 48,
    rare: 32,
    epic: 15,
    elite: 5,
    legendary: 0,
    mythic: 0,
    ascended: 0,
  },
  3: {
    common: 42,
    rare: 32,
    epic: 18,
    elite: 7,
    legendary: 1,
    mythic: 0,
    ascended: 0,
  },
  4: {
    common: 34,
    rare: 30,
    epic: 22,
    elite: 10,
    legendary: 4,
    mythic: 0,
    ascended: 0,
  },
  5: {
    common: 28,
    rare: 29,
    epic: 23,
    elite: 13,
    legendary: 6,
    mythic: 1,
    ascended: 0,
  },
  6: {
    common: 22,
    rare: 27,
    epic: 25,
    elite: 15,
    legendary: 8,
    mythic: 3,
    ascended: 0,
  },
  7: {
    common: 18,
    rare: 25,
    epic: 25,
    elite: 16,
    legendary: 11,
    mythic: 5,
    ascended: 0,
  },
  8: {
    common: 14,
    rare: 23,
    epic: 25,
    elite: 17,
    legendary: 13,
    mythic: 7,
    ascended: 1,
  },
  9: {
    common: 11,
    rare: 21,
    epic: 24,
    elite: 18,
    legendary: 15,
    mythic: 10,
    ascended: 1,
  },
  10: {
    common: 9,
    rare: 19,
    epic: 23,
    elite: 19,
    legendary: 16,
    mythic: 12,
    ascended: 2,
  },
  11: {
    common: 7,
    rare: 17,
    epic: 22,
    elite: 20,
    legendary: 18,
    mythic: 13,
    ascended: 3,
  },
  12: {
    common: 5,
    rare: 12,
    epic: 20,
    elite: 20,
    legendary: 20,
    mythic: 18,
    ascended: 5,
  },
};

function hex(b: ArrayBuffer) {
  return [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function tgUser(initData: string, botToken: string) {
  const p = new URLSearchParams(initData);
  const h = p.get("hash");
  if (!h) return null;
  p.delete("hash");
  const data = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const e = new TextEncoder();
  const k1 = await crypto.subtle.importKey(
    "raw",
    e.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const s = await crypto.subtle.sign("HMAC", k1, e.encode(botToken));
  const k2 = await crypto.subtle.importKey(
    "raw",
    s,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const calc = hex(await crypto.subtle.sign("HMAC", k2, e.encode(data)));
  if (calc !== h) return null;
  const authDate = Number(p.get("auth_date") || 0);
  if (
    !authDate ||
    Date.now() / 1000 - authDate > 86400 ||
    authDate > Date.now() / 1000 + 30
  )
    return null;
  const raw = p.get("user");
  if (!raw) return null;
  const user = JSON.parse(raw);
  if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
  user.__start = p.get("start_param") || "";
  return user;
}

async function isMember(token: string, username: string, userId: number) {
  const r = await fetch(
    `https://api.telegram.org/bot${token}/getChatMember?chat_id=@${username}&user_id=${userId}`,
  );
  const j = await r.json();
  return !!(j.ok && !["left", "kicked"].includes(j.result.status));
}

function tierFor(score: number) {
  const cuts = [
    0, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2350, 2600, 2900, 3300,
  ];
  let i = 0;
  cuts.forEach((x, n) => {
    if (score >= x) i = n;
  });
  return i;
}
function ratesFor(tier: number) {
  return RATES_BY_TIER[Math.max(1, Math.min(12, tier))] || RATES_BY_TIER[1];
}
function bytesFromBase64(base64: string) {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function weightedRarity(rates: any, available: Set<string>) {
  let entries = RARITY_ORDER.filter(
    (r) => available.has(r) && Number(rates[r] || 0) > 0,
  ).map((r) => [r, Number(rates[r])]);
  if (!entries.length)
    entries = RARITY_ORDER.filter((r) => available.has(r)).map((r) => [r, 1]);
  const sum = entries.reduce((a, x) => a + Number(x[1]), 0);
  let n = Math.random() * sum;
  for (const [r, w] of entries) {
    n -= Number(w);
    if (n <= 0) return r as string;
  }
  return entries[entries.length - 1]?.[0] as string;
}

async function resolveStyles(db: any, players: any[]) {
  const fields = Object.values(EQUIP_FIELDS) as string[];
  const ids = [
    ...new Set(
      players.flatMap((p) => fields.map((f) => p?.[f]).filter(Boolean)),
    ),
  ];
  if (!ids.length) return players.map((p) => ({ ...p, style: {} }));
  const q = await db
    .from("cosmetics")
    .select("id,code,name,kind,rarity,visual_key")
    .in("id", ids);
  const map = new Map((q.data || []).map((c: any) => [c.id, c]));
  return players.map((p) => {
    const style: any = {};
    for (const [kind, rawField] of Object.entries(EQUIP_FIELDS)) {
      const field = String(rawField);
      if (p?.[field] && map.get(p[field])) style[kind] = map.get(p[field]);
    }
    return { ...p, style };
  });
}

async function botLaunchLink(token: string, telegramId: number) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json();
    const username = j?.ok ? j?.result?.username : null;
    if (!username) return null;
    return `https://t.me/${username}?startapp=ref_${telegramId}`;
  } catch (e) {
    console.error("getMe", e);
    return null;
  }
}

async function enrichFeed(db: any, battles: any[]) {
  if (!battles?.length) return [];
  const ids = [
    ...new Set(battles.flatMap((b: any) => [b.player_a, b.player_b])),
  ];
  const q = await db
    .from("players")
    .select(
      "id,first_name,username,gender,mogg_score,profile_photo_url,is_npc,equipped_frame,equipped_background,equipped_title,equipped_battle_intro,equipped_victory_card,equipped_score_style,equipped_name_style,equipped_reaction",
    )
    .in("id", ids);
  if (q.error) throw q.error;
  const styled = await resolveStyles(db, q.data || []);
  const map = new Map(styled.map((p: any) => [p.id, p]));
  const counts = await db.rpc("battle_human_tallies_v1", {
    p_ids: battles
      .filter((b: any) => b.status === "active")
      .map((b: any) => b.id),
  });
  if (counts.error) throw counts.error;
  const tally = new Map((counts.data || []).map((x: any) => [x.battle_id, x]));
  return battles.map((b: any) => {
    const {
      telegram_chat_id,
      telegram_message_id,
      telegram_poll_id,
      ...visible
    } = b;
    return {
      ...visible,
      ...(tally.get(b.id) || {}),
      a: map.get(b.player_a) || null,
      b: map.get(b.player_b) || null,
    };
  });
}

async function retryPhotoDeletions(db: any, player: any) {
  try {
    const jobs = await db
      .from("photo_deletions")
      .select("id,photo_url")
      .eq("player_id", player.id)
      .is("completed_at", null)
      .order("created_at", { ascending: true })
      .limit(3);
    if (jobs.error) throw jobs.error;
    const prefix =
      Deno.env.get("SUPABASE_URL") +
      "/storage/v1/object/public/profile-photos/" +
      player.telegram_id +
      "/";
    for (const job of jobs.data || []) {
      if (
        !job.photo_url.startsWith(prefix) ||
        !/^[-a-zA-Z0-9_.]+$/.test(job.photo_url.slice(prefix.length))
      )
        continue;
      const current = await db
        .from("players")
        .select("profile_photo_url")
        .eq("id", player.id)
        .single();
      if (current.error || current.data.profile_photo_url === job.photo_url)
        continue;
      const removed = await db.storage
        .from("profile-photos")
        .remove([
          player.telegram_id + "/" + job.photo_url.slice(prefix.length),
        ]);
      if (removed.error) continue;
      const saved = await db
        .from("photo_deletions")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("player_id", player.id);
      if (saved.error) console.error("photo_cleanup_record_failed");
    }
  } catch {
    console.error("photo_cleanup_retry_failed");
  }
}

async function channelRewardSetup(db: any, token: string) {
  const cfg = await db
    .from("channel_reward_config")
    .select("*")
    .eq("id", true)
    .single();
  if (cfg.error) throw cfg.error;
  const c = cfg.data;
  if (c.chat_id && c.webhook_ready) return c;
  const tg = async (method: string, body: any = {}) => {
    const r = await fetch(
      "https://api.telegram.org/bot" + token + "/" + method,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      },
    );
    const j = await r.json();
    if (!j.ok) throw new Error("channel_setup_pending");
    return j.result;
  };
  const chat = await tg("getChat", { chat_id: c.chat_id || "@mbgbchannel" });
  const me = await tg("getMe");
  const member = await tg("getChatMember", {
    chat_id: chat.id,
    user_id: me.id,
  });
  if (member.status !== "administrator" || !member.can_invite_users)
    throw new Error("channel_setup_pending");
  const w = await tg("getWebhookInfo");
  if (!w.url || !w.url.includes("/telegram-bot"))
    throw new Error("channel_setup_pending");
  const enc = new TextEncoder(),
    key = await crypto.subtle.importKey(
      "raw",
      enc.encode(token),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  const secret = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode("mogg-battle/telegram-webhook/v1"),
    ),
  );
  const updates = w.allowed_updates?.length
    ? w.allowed_updates
    : [
        "message",
        "edited_message",
        "channel_post",
        "edited_channel_post",
        "inline_query",
        "chosen_inline_result",
        "callback_query",
        "shipping_query",
        "pre_checkout_query",
        "poll",
        "poll_answer",
        "my_chat_member",
        "chat_join_request",
      ];
  await tg("setWebhook", {
    url: w.url,
    secret_token: secret,
    allowed_updates: [...new Set([...updates, "chat_join_request"])],
    max_connections: w.max_connections || 40,
    drop_pending_updates: false,
  });
  const saved = await db
    .from("channel_reward_config")
    .update({ chat_id: chat.id, webhook_ready: true })
    .eq("id", true);
  if (saved.error) throw saved.error;
  return { ...c, chat_id: chat.id, webhook_ready: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const u = await tgUser(body.initData, token);
    if (!u)
      return Response.json(
        { error: "invalid_auth" },
        { status: 401, headers: cors },
      );

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    let q = await db
      .from("players")
      .select("*")
      .eq("telegram_id", u.id)
      .maybeSingle();
    let p = q.data;
    if (!p) {
      const c = await db
        .from("players")
        .insert({
          telegram_id: u.id,
          username: u.username ?? null,
          first_name: u.first_name ?? null,
          last_name: u.last_name ?? null,
          rating: 0,
          mogg_score: 0,
        })
        .select("*")
        .single();
      if (c.error) throw c.error;
      p = c.data;
    } else if (
      (u.username ?? p.username) !== p.username ||
      (u.first_name ?? p.first_name) !== p.first_name ||
      (u.last_name ?? p.last_name) !== p.last_name
    ) {
      const up = await db
        .from("players")
        .update({
          username: u.username ?? p.username,
          first_name: u.first_name ?? p.first_name,
          last_name: u.last_name ?? p.last_name,
        })
        .eq("id", p.id)
        .select("*")
        .single();
      if (!up.error) p = up.data;
    }

    if (body.action === "support_submit") {
      if (
        ![
          "report",
          "payment",
          "delete_photo",
          "delete_account",
          "other",
        ].includes(body.category) ||
        typeof body.message !== "string" ||
        body.message.trim().length < 5 ||
        body.message.length > 1500 ||
        typeof body.request_key !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.request_key,
        )
      )
        return Response.json(
          { error: "invalid_support_request" },
          { status: 400, headers: cors },
        );
      const r = await db.rpc("submit_support_request_v1", {
        p_player: p.id,
        p_key: body.request_key,
        p_category: body.category,
        p_message: body.message,
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, request: r.data }, { headers: cors });
    }
    if (body.action === "support_list") {
      const r = await db
        .from("support_requests")
        .select("id,category,status,response,created_at")
        .eq("player_id", p.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (r.error) throw r.error;
      return Response.json({ ok: true, requests: r.data }, { headers: cors });
    }
    if (!body.action || body.action === "me") {
      const start = String(u.__start || "");
      const campaign = start.startsWith("c_") ? start.slice(2) : null;
      const touched = await db.rpc("game_touch_v1", {
        p_player: p.id,
        p_campaign: campaign,
      });
      if (touched.error) throw touched.error;
      if (/^ref_[1-9]\d{0,15}$/.test(start)) {
        const attached = await db.rpc("attach_referral_v1", {
          p_invited: p.id,
          p_inviter_telegram_id: Number(start.slice(4)),
        });
        if (attached.error) throw attached.error;
      }
      await retryPhotoDeletions(db, p);
      const er = await db.rpc("refresh_player_energy_v1", { p_player: p.id });
      if (er.error) throw er.error;
      if (er.data) p = er.data;

      const finalized = await db.rpc("finalize_due_battles_v2");
      if (finalized.error) throw finalized.error;

      // Re-read player after possible battle finalization.
      const pq = await db.from("players").select("*").eq("id", p.id).single();
      if (!pq.error) p = pq.data;
      const styledSelf = (await resolveStyles(db, [p]))[0];

      const bq = await db.rpc("battle_feed_v2", { p_player: p.id });
      if (bq.error) throw bq.error;
      // Old NPC-vs-NPC filler must never reach any client, including cached ones.
      const feed = (await enrichFeed(db, bq.data || [])).filter(
        (b: any) => b.source !== "npc_feed" && !(b.a?.is_npc && b.b?.is_npc),
      );
      const gate = await db.rpc("ranked_votes_needed_v2", { p_player: p.id });
      if (gate.error) throw gate.error;
      const recent = await db
        .from("battles")
        .select("*")
        .eq("status", "finished")
        .not("result_source", "is", null)
        .or(`player_a.eq.${p.id},player_b.eq.${p.id}`)
        .order("finished_at", { ascending: false })
        .limit(1);
      if (recent.error) throw recent.error;
      const lastBattle = (await enrichFeed(db, recent.data || []))[0] || null;
      const inv = await db
        .from("player_inventory")
        .select("id,source,obtained_at,cosmetics(*)")
        .eq("player_id", p.id)
        .order("obtained_at", { ascending: false });
      if (inv.error) throw inv.error;
      const sponsors = await db
        .from("sponsor_channels")
        .select("username,title,reward_score")
        .eq("is_active", true)
        .eq("is_required", true);
      const catalog =
        body.include_catalog === false
          ? { data: null, error: null }
          : await db
              .from("cosmetics")
              .select(
                "id,code,name,kind,rarity,min_rank_tier,price_points,price_stars,is_purchasable,drop_enabled,collection,limited_total,sort_order,visual_key",
              )
              .order("sort_order", { ascending: true })
              .limit(180);
      const bundles =
        body.include_catalog === false
          ? { data: null, error: null }
          : await db
              .from("cosmetic_bundle_items")
              .select("bundle_id,cosmetic_id");
      if (bundles.error) throw bundles.error;
      const daily = await db.rpc("game_daily_state_v1", { p_player: p.id });
      if (daily.error) throw daily.error;
      let crew: any = null;
      if (p.crew_id) {
        const cq = await db
          .from("crews")
          .select("*")
          .eq("id", p.crew_id)
          .maybeSingle();
        crew = cq.data || null;
      }
      if (catalog.error) throw catalog.error;

      const pendingRanked = await db
        .from("battle_requests")
        .select("id,expires_at")
        .eq("challenger_id", p.id)
        .eq("mode", "matchmaking")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at")
        .limit(1);
      if (pendingRanked.error) throw pendingRanked.error;
      const tier = tierFor(Number(p.mogg_score || 0));
      const drops = await db
        .from("rank_drops")
        .select("rank_tier")
        .eq("player_id", p.id);
      const opened = new Set(
        (drops.data || []).map((x: any) => Number(x.rank_tier)),
      );
      const available: number[] = DROP_MILESTONES.filter(
        (t) => t <= tier && !opened.has(t),
      );

      return Response.json(
        {
          ok: true,
          ranked_queue: pendingRanked.data?.[0] || null,
          player: styledSelf,
          feed,
          ranked_votes_needed: gate.data,
          last_battle: lastBattle,
          inventory: inv.data || [],
          ...(catalog.data
            ? { shop: catalog.data, bundles: bundles.data || [] }
            : {}),
          daily: daily.data,
          sponsors: sponsors.data || [],
          drops: {
            current_tier: tier,
            available_tiers: available,
            next_tier: available[0] || null,
            rates: ratesFor(available[0] || Math.max(1, tier)),
            milestones: DROP_MILESTONES,
          },
          crew,
        },
        { headers: cors },
      );
    }

    if (body.action === "set_gender") {
      if (!["male", "female"].includes(body.gender))
        throw new Error("invalid_gender");
      const r = await db
        .from("players")
        .update({
          gender: body.gender,
          onboarding_completed: !!p.profile_photo_url,
        })
        .eq("id", p.id)
        .select("*")
        .single();
      if (r.error) throw r.error;
      if (r.data.profile_photo_url) {
        const activation = await db.rpc("activate_referral", {
          p_invited: p.id,
          p_reward: 100,
        });
        if (activation.error) throw activation.error;
      }
      return Response.json({ ok: true, player: r.data }, { headers: cors });
    }

    if (body.action === "delete_photo") {
      const expected = typeof body.photo_url === "string" ? body.photo_url : "";
      const prefix =
        Deno.env.get("SUPABASE_URL") +
        "/storage/v1/object/public/profile-photos/" +
        u.id +
        "/";
      if (
        !expected.startsWith(prefix) ||
        !/^[-a-zA-Z0-9_.]+$/.test(expected.slice(prefix.length))
      )
        return Response.json(
          { error: "photo_requires_support" },
          { status: 400, headers: cors },
        );
      const r = await db.rpc("remove_profile_photo_v1", {
        p_player: p.id,
        p_expected: expected,
      });
      if (r.error) throw r.error;
      const removal = await db.storage
        .from("profile-photos")
        .remove([u.id + "/" + expected.slice(prefix.length)]);
      await cleanupCards(db, p.telegram_id);
      let complete = false;
      if (!removal.error) {
        const saved = await db
          .from("photo_deletions")
          .update({ completed_at: new Date().toISOString() })
          .eq("id", r.data)
          .eq("player_id", p.id);
        complete = !saved.error;
      }
      return Response.json(
        { ok: true, storage_removed: complete },
        { headers: cors },
      );
    }

    if (body.action === "upload_photo") {
      if (body.photo_consent !== true)
        return Response.json(
          { error: "photo_consent_required" },
          { status: 400, headers: cors },
        );
      const mime = String(body.mime || "");
      const base64 = String(body.base64 || "");
      if (!["image/jpeg", "image/png"].includes(mime))
        return Response.json(
          { error: "unsupported_image" },
          { status: 400, headers: cors },
        );
      if (!base64)
        return Response.json(
          { error: "missing_image" },
          { status: 400, headers: cors },
        );
      const bytes = bytesFromBase64(base64);
      if (bytes.byteLength > 5 * 1024 * 1024)
        return Response.json(
          { error: "image_too_large" },
          { status: 413, headers: cors },
        );
      try {
        decodePhoto(bytes);
      } catch {
        return Response.json(
          { error: "invalid_photo" },
          { status: 400, headers: cors },
        );
      }
      const ext =
        mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const path = `${p.telegram_id}/${crypto.randomUUID()}.${ext}`;
      const upload = await db.storage
        .from("profile-photos")
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upload.error) throw upload.error;
      const publicUrl = db.storage.from("profile-photos").getPublicUrl(path)
        .data.publicUrl;
      const upd = await db.rpc("game_replace_photo_v1", {
        p_player: p.id,
        p_url: publicUrl,
      });
      if (upd.error) throw upd.error;
      await retryPhotoDeletions(db, upd.data);
      if (upd.data.gender)
        await db.rpc("activate_referral", { p_invited: p.id, p_reward: 100 });
      return Response.json({ ok: true, player: upd.data }, { headers: cors });
    }

    if (body.action === "apply_ref") {
      const refTelegramId = Number(body.ref_telegram_id || 0);
      if (!refTelegramId || refTelegramId === u.id)
        return Response.json({ ok: true, ignored: true }, { headers: cors });
      const attached = await db.rpc("attach_referral_v1", {
        p_invited: p.id,
        p_inviter_telegram_id: refTelegramId,
      });
      if (attached.error) throw attached.error;
      return Response.json({ ok: true }, { headers: cors });
    }

    if (body.action === "channel_reward_status") {
      let ready = false;
      try {
        const c = await channelRewardSetup(db, token);
        ready = !!c.chat_id && c.webhook_ready;
      } catch {}
      const q = await db
        .from("channel_join_rewards")
        .select("claimed_at")
        .eq("telegram_id", p.telegram_id)
        .maybeSingle();
      if (q.error) throw q.error;
      return Response.json(
        { ready, requested: !!q.data, claimed: !!q.data?.claimed_at },
        { headers: cors },
      );
    }
    if (body.action === "claim_channel_request") {
      const r = await db.rpc("claim_channel_request_v1", { p_player: p.id });
      if (r.error) throw r.error;
      return Response.json(r.data, { headers: cors });
    }

    if (body.action === "cancel_ranked") {
      const r = await db.rpc("cancel_ranked_v3", { p_player: p.id });
      if (r.error) throw r.error;
      return Response.json({ ok: true }, { headers: cors });
    }

    // Voting, server-backed rewards and support are available before photo onboarding.
    if (body.action === "vote") {
      const battleId = String(body.battle_id || "");
      const side = body.side === "a" ? "a" : body.side === "b" ? "b" : null;
      if (!battleId || !side) throw new Error("invalid_vote");
      const qb = await db
        .from("battles")
        .select("*")
        .eq("id", battleId)
        .single();
      if (qb.error) throw qb.error;
      const b = qb.data;
      const vr = await db.rpc("cast_battle_vote_v2", {
        p_battle: b.id,
        p_voter: p.id,
        p_target: side === "a" ? b.player_a : b.player_b,
        p_allow_change: false,
      });
      if (vr.error) throw vr.error;
      return Response.json({ ok: true, ...vr.data }, { headers: cors });
    }
    if (body.action === "game_event") {
      const r = await db.rpc("game_event_v1", {
        p_player: p.id,
        p_name: String(body.name || ""),
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true }, { headers: cors });
    }
    if (body.action === "claim_game_reward") {
      const r = await db.rpc("game_claim_reward_v1", {
        p_player: p.id,
        p_key: String(body.key || ""),
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, ...r.data }, { headers: cors });
    }
    if (body.action === "battle_info") {
      const r = await db
        .from("battles")
        .select("*")
        .eq("id", String(body.battle_id || ""))
        .maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) throw new Error("battle_not_found");
      return Response.json(
        { ok: true, battle: (await enrichFeed(db, [r.data]))[0] },
        { headers: cors },
      );
    }
    if (body.action === "duel_info") {
      const r = await db
        .from("duel_invites")
        .select("token,player_id,accepted_by,battle_id,expires_at")
        .eq("token", String(body.token || ""))
        .maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) throw new Error("invite_not_found");
      const q = await db
        .from("players")
        .select(
          "id,first_name,username,profile_photo_url,equipped_frame,equipped_background,equipped_title",
        )
        .eq("id", r.data.player_id)
        .single();
      if (q.error) throw q.error;
      return Response.json(
        {
          ok: true,
          invite: r.data,
          player: (await resolveStyles(db, [q.data]))[0],
        },
        { headers: cors },
      );
    }
    if (body.action === "create_duel") {
      const r = await db.rpc("duel_create_v1", { p_player: p.id });
      if (r.error) throw r.error;
      return Response.json(
        {
          ok: true,
          invite: r.data,
          url:
            "https://t.me/MoggBattleGameBot?startapp=duel_" +
            r.data.token.replaceAll("-", ""),
        },
        { headers: cors },
      );
    }
    if (body.action === "accept_duel") {
      const r = await db.rpc("duel_accept_v1", {
        p_player: p.id,
        p_token: String(body.token || ""),
      });
      if (r.error) throw r.error;
      return Response.json(
        { ok: true, battle: (await enrichFeed(db, [r.data]))[0] },
        { headers: cors },
      );
    }
    if (body.action === "tap_batch" || body.action === "tap") {
      const r = await db.rpc("game_tap_batch_v1", {
        p_player: p.id,
        p_key:
          body.action === "tap"
            ? crypto.randomUUID()
            : String(body.request_key || ""),
        p_count: body.action === "tap" ? 1 : body.count,
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, ...r.data }, { headers: cors });
    }
    if (!p.gender || !p.profile_photo_url)
      return Response.json(
        { error: "onboarding_required" },
        { status: 409, headers: cors },
      );

    if (body.action === "prepare_share") {
      const budget = await db
        .from("game_events")
        .select("id", { count: "exact", head: true })
        .eq("player_id", p.id)
        .eq("name", "share_prepared")
        .gt("created_at", new Date(Date.now() - 86400000).toISOString());
      if (budget.error) throw budget.error;
      if ((budget.count || 0) >= 10) throw new Error("share_daily_limit");
      const bytes = bytesFromBase64(String(body.png || ""));
      validatePng(bytes);
      let caption = `${p.first_name || p.username || "Игрок"} · MOGG BATTLE\nСможешь могнуть меня?`;
      if (body.battle_id) {
        const b = await db
          .from("battles")
          .select("winner_id,status")
          .eq("id", String(body.battle_id))
          .single();
        if (
          b.error ||
          b.data.status !== "finished" ||
          b.data.winner_id !== p.id
        )
          throw new Error("invalid_result");
        caption = `${p.first_name || p.username || "Игрок"} забрал MOGG-батл. Принимаешь вызов?`;
      }
      const path = `${p.telegram_id}/share_${crypto.randomUUID()}.png`;
      const image = await db.storage
        .from("profile-photos")
        .upload(path, bytes, { contentType: "image/png", upsert: false });
      if (image.error) throw image.error;
      const imageUrl = db.storage.from("profile-photos").getPublicUrl(path)
        .data.publicUrl;
      const url = `https://t.me/MoggBattleGameBot?startapp=ref_${p.telegram_id}`;
      const response = await fetch(
        `https://api.telegram.org/bot${token}/savePreparedInlineMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: p.telegram_id,
            allow_user_chats: true,
            allow_bot_chats: false,
            allow_group_chats: true,
            allow_channel_chats: true,
            result: {
              type: "photo",
              id: crypto.randomUUID(),
              photo_url: imageUrl,
              thumbnail_url: imageUrl,
              photo_width: 900,
              photo_height: 1200,
              caption,
              reply_markup: {
                inline_keyboard: [[{ text: "Залететь на арену ↗", url }]],
              },
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const result = await response.json();
      const event = await db
        .from("game_events")
        .insert({ player_id: p.id, name: "share_prepared" });
      if (event.error) throw event.error;
      return Response.json(
        {
          ok: true,
          image_url: imageUrl,
          message_id: result.ok ? result.result.id : null,
        },
        { headers: cors },
      );
    }

    if (body.action === "daily_spin_status") {
      const day = new Date().toISOString().slice(0, 10);
      const prior = await db
        .from("daily_spins")
        .select("result")
        .eq("player_id", p.id)
        .eq("claimed_on", day)
        .maybeSingle();
      if (prior.error) throw prior.error;
      return Response.json(
        {
          claimed: p.app_daily_claimed_on === day,
          prize: prior.data?.result || null,
        },
        { headers: cors },
      );
    }
    if (
      body.action === "app_daily" ||
      body.action === "daily_spin" ||
      body.action === "daily_spin_v2"
    ) {
      const r = await db.rpc(
        body.action === "daily_spin_v2" ? "spin_daily_v2" : "spin_daily_v1",
        { p_player: p.id },
      );
      if (r.error) throw r.error;
      return Response.json(
        { ok: true, ...r.data, reward: r.data?.prize?.points || 0 },
        { headers: cors },
      );
    }

    if (body.action === "share_link") {
      const link = await botLaunchLink(token, Number(p.telegram_id));
      if (!link)
        return Response.json(
          { error: "share_link_unavailable" },
          { status: 503, headers: cors },
        );
      return Response.json({ ok: true, url: link }, { headers: cors });
    }

    if (body.action === "open_matchmaking" && body.mode !== "quick") {
      const q = await db.rpc("enqueue_ranked_v3", { p_player: p.id });
      if (q.error) throw q.error;
      if (q.data.votes_required)
        return Response.json(
          { ok: true, matched: false, votes_required: q.data.votes_required },
          { headers: cors },
        );
      const work = await db.rpc("process_ranked_queue_v3");
      if (work.error) throw work.error;
      const b = await db
        .from("battles")
        .select("*")
        .eq("status", "active")
        .neq("mode", "quick")
        .gt("ends_at", new Date().toISOString())
        .or(`player_a.eq.${p.id},player_b.eq.${p.id}`)
        .limit(1);
      if (b.error) throw b.error;
      if (b.data?.length)
        return Response.json(
          {
            ok: true,
            matched: true,
            existing: !!q.data.existing,
            mode: b.data[0].mode,
            battle: (await enrichFeed(db, b.data))[0],
          },
          { headers: cors },
        );
      return Response.json(
        { ok: true, matched: false, mode: "ranked", request: q.data.request },
        { headers: cors },
      );
    }

    if (body.action === "open_matchmaking") {
      const createAtomic = async (
        opponentId: string,
        mode: string,
        requestId: string | null = null,
      ) => {
        const r = await db.rpc("create_match_atomic_v1", {
          p_player: p.id,
          p_opponent: opponentId,
          p_mode: mode,
          p_request: requestId,
        });
        if (r.error) throw r.error;
        if (r.data?.retry)
          return Response.json(
            { ok: true, matched: false, mode, retry: true },
            { headers: cors },
          );
        if (!r.data?.battle) throw new Error("match_result_missing");
        const enriched = await enrichFeed(db, [r.data.battle]);
        return Response.json(
          {
            ok: true,
            matched: true,
            existing: !!r.data.existing,
            mode: r.data.battle.mode,
            battle: enriched[0],
          },
          { headers: cors },
        );
      };

      const battleMode = body.mode === "quick" ? "quick" : "ranked";
      const requestMode = battleMode === "quick" ? "quick" : "matchmaking";
      const now = Date.now();

      // Repeated clicks/polling must return the already-active battle instead of creating a duplicate.
      const aq = await db
        .from("battles")
        .select("*")
        .eq("status", "active")
        .in(
          "mode",
          battleMode === "quick"
            ? ["quick"]
            : ["ranked", "group", "matchmaking"],
        )
        .gt("ends_at", new Date().toISOString())
        .or(`player_a.eq.${p.id},player_b.eq.${p.id}`)
        .order("created_at", { ascending: false })
        .limit(1);
      if (aq.error) throw aq.error;
      if (aq.data?.[0]) {
        const enriched = await enrichFeed(db, [aq.data[0]]);
        return Response.json(
          {
            ok: true,
            matched: true,
            existing: true,
            mode: aq.data[0].mode || battleMode,
            battle: enriched[0],
          },
          { headers: cors },
        );
      }

      // Virtual opponents are available only after an explicit practice click.
      if (body.opponent === "practice" && battleMode === "quick") {
        const nq = await db
          .from("players")
          .select("id,mogg_score")
          .eq("is_npc", true)
          .eq("npc_active", true)
          .eq("gender", p.gender)
          .not("profile_photo_url", "is", null)
          .limit(80);
        if (nq.error) throw nq.error;
        const near = (nq.data || [])
          .sort(
            (a: any, b: any) =>
              Math.abs(Number(a.mogg_score || 0) - Number(p.mogg_score || 0)) -
              Math.abs(Number(b.mogg_score || 0) - Number(p.mogg_score || 0)),
          )
          .slice(0, 6);
        if (!near.length)
          return Response.json(
            { ok: true, matched: false, unavailable: true, mode: "quick" },
            { headers: cors },
          );
        return await createAtomic(
          near[Math.floor(Math.random() * near.length)].id,
          "quick",
        );
      }

      if (battleMode === "ranked") {
        const gate = await db.rpc("ranked_votes_needed_v2", { p_player: p.id });
        if (gate.error) throw gate.error;
        if (gate.data > 0)
          return Response.json(
            { ok: true, matched: false, votes_required: gate.data },
            { headers: cors },
          );
      }
      // Old duplicate/stale queue rows must never make maybeSingle fail.
      await db
        .from("battle_requests")
        .update({ status: "expired" })
        .eq("status", "pending")
        .lt("expires_at", new Date().toISOString());
      const own = await db
        .from("battle_requests")
        .select("*")
        .eq("challenger_id", p.id)
        .eq("mode", requestMode)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      if (own.error) throw own.error;
      const waiting = await db
        .from("battle_requests")
        .select("*")
        .eq("mode", requestMode)
        .eq("status", "pending")
        .neq("challenger_id", p.id)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true })
        .limit(40);
      if (waiting.error) throw waiting.error;
      const myScore = Number(p.mogg_score || 0);
      const candidates: any[] = [];
      for (const reqRow of waiting.data || []) {
        const oq = await db
          .from("players")
          .select("*")
          .eq("id", reqRow.challenger_id)
          .maybeSingle();
        if (oq.error) throw oq.error;
        const opp = oq.data;
        if (!opp?.profile_photo_url || opp.gender !== p.gender || opp.is_npc)
          continue;
        if (battleMode === "ranked") {
          const gate = await db.rpc("ranked_votes_needed_v2", {
            p_player: opp.id,
          });
          if (gate.error) throw gate.error;
          if (gate.data > 0) continue;
        }
        // A pending queue row can outlive a match in another mode.
        const occupied = await db
          .from("battles")
          .select("id")
          .eq("status", "active")
          .in(
            "mode",
            battleMode === "quick"
              ? ["quick"]
              : ["ranked", "group", "matchmaking"],
          )
          .gt("ends_at", new Date().toISOString())
          .or(`player_a.eq.${opp.id},player_b.eq.${opp.id}`)
          .limit(1);
        if (occupied.error) throw occupied.error;
        if (occupied.data?.length) continue;
        const ageMs = now - new Date(reqRow.created_at).getTime();
        const diff = Math.abs(Number(opp.mogg_score || 0) - myScore);
        if (battleMode === "ranked") {
          const range = ageMs >= 60000 ? 500 : ageMs >= 30000 ? 300 : 150;
          if (diff > range) continue;
        } else {
          const quickRange =
            ageMs >= 45000
              ? Infinity
              : ageMs >= 25000
                ? 500
                : ageMs >= 10000
                  ? 300
                  : 150;
          if (diff > quickRange) continue;
        }
        candidates.push({ reqRow, opp, diff });
      }
      candidates.sort(
        (a, b) =>
          a.diff - b.diff ||
          new Date(a.reqRow.created_at).getTime() -
            new Date(b.reqRow.created_at).getTime(),
      );
      const pick = candidates[0];
      if (pick) {
        return await createAtomic(pick.opp.id, battleMode, pick.reqRow.id);
      }
      if (own.data?.[0]) {
        const ownReq = own.data[0];
        return Response.json(
          { ok: true, matched: false, request: ownReq, mode: battleMode },
          { headers: cors },
        );
      }

      const r = await db
        .from("battle_requests")
        .insert({
          challenger_id: p.id,
          mode: requestMode,
          status: "pending",
          expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
        })
        .select("*")
        .single();
      if (r.error) throw r.error;
      return Response.json(
        { ok: true, matched: false, mode: battleMode, request: r.data },
        { headers: cors },
      );
    }

    if (body.action === "open_drop") {
      const tier = tierFor(Number(p.mogg_score || 0));
      if (tier < 1)
        return Response.json(
          { error: "no_drop_available" },
          { status: 409, headers: cors },
        );
      const opened = await db
        .from("rank_drops")
        .select("rank_tier")
        .eq("player_id", p.id);
      if (opened.error) throw opened.error;
      const seen = new Set(
        (opened.data || []).map((x: any) => Number(x.rank_tier)),
      );
      const claimTier =
        DROP_MILESTONES.find((t) => t <= tier && !seen.has(t)) || 0;
      if (!claimTier)
        return Response.json(
          { error: "all_rank_drops_claimed" },
          { status: 409, headers: cors },
        );

      const pool = await db
        .from("cosmetics")
        .select("*")
        .eq("drop_enabled", true)
        .lte("min_rank_tier", claimTier);
      if (pool.error) throw pool.error;
      const own = await db
        .from("player_inventory")
        .select("cosmetic_id")
        .eq("player_id", p.id);
      if (own.error) throw own.error;
      const owned = new Set<string>(
        (own.data || []).map((x: any) => String(x.cosmetic_id)),
      );
      const eligible = (pool.data || []).filter(
        (x: any) =>
          !["stars", "top1", "top10"].includes(String(x.collection || "")) &&
          Number(x.price_stars || 0) === 0 &&
          x.limited_total == null,
      );
      let items = eligible.filter((x: any) => !owned.has(String(x.id)));
      if (!items.length) items = eligible;
      if (!items.length) throw new Error("empty_drop_pool");
      const rates = ratesFor(claimTier);
      const availableRarities = new Set<string>(
        items.map((x: any) => String(x.rarity)),
      );
      const chosenRarity = weightedRarity(rates, availableRarities);
      const byRarity = items.filter((x: any) => x.rarity === chosenRarity);
      const item =
        byRarity[Math.floor(Math.random() * byRarity.length)] ||
        items[Math.floor(Math.random() * items.length)];

      const claimed = await db.rpc("claim_rank_drop_v1", {
        p_player: p.id,
        p_tier: claimTier,
        p_cosmetic: item.id,
      });
      if (claimed.error) throw claimed.error;
      return Response.json(
        { ok: true, ...claimed.data, rates, rank_tier: claimTier },
        { headers: cors },
      );
    }

    if (body.action === "buy_upgrade") {
      const kind = String(body.kind || "");
      const r = await db.rpc("buy_progression_upgrade_v1", {
        p_player: p.id,
        p_kind: kind,
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, player: r.data }, { headers: cors });
    }
    if (body.action === "claim_prestige") {
      const r = await db.rpc("claim_prestige_v1", { p_player: p.id });
      if (r.error) throw r.error;
      return Response.json({ ok: true, player: r.data }, { headers: cors });
    }
    if (body.action === "create_crew") {
      const name = String(body.name || "").trim(),
        tag = String(body.tag || "").trim();
      if (
        name.length < 3 ||
        name.length > 24 ||
        tag.length < 2 ||
        tag.length > 5
      )
        return Response.json(
          { error: "invalid_crew_name" },
          { status: 400, headers: cors },
        );
      const r = await db.rpc("create_crew_v1", {
        p_player: p.id,
        p_name: name,
        p_tag: tag,
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, crew: r.data }, { headers: cors });
    }
    if (body.action === "crew_contribute") {
      const amount = Math.max(0, Math.floor(Number(body.amount || 0)));
      const r = await db.rpc("contribute_crew_v1", {
        p_player: p.id,
        p_amount: amount,
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, crew: r.data }, { headers: cors });
    }
    if (body.action === "buy_cosmetic") {
      const cosmeticId = String(body.cosmetic_id || "");
      const r = await db.rpc("buy_cosmetic_v1", {
        p_player: p.id,
        p_cosmetic: cosmeticId,
      });
      if (r.error) throw r.error;
      return Response.json({ ok: true, player: r.data }, { headers: cors });
    }

    if (body.action === "create_star_invoice") {
      const cosmeticId = String(body.cosmetic_id || "");
      const cq = await db
        .from("cosmetics")
        .select("*")
        .eq("id", cosmeticId)
        .single();
      if (cq.error) throw cq.error;
      const c = cq.data;
      if (Number(c.price_stars || 0) <= 0)
        return Response.json(
          { error: "not_for_stars" },
          { status: 400, headers: cors },
        );
      const own = await db
        .from("player_inventory")
        .select("id")
        .eq("player_id", p.id)
        .eq("cosmetic_id", c.id)
        .maybeSingle();
      if (own.data)
        return Response.json(
          { error: "already_owned" },
          { status: 409, headers: cors },
        );
      if (c.limited_total) {
        const count = await db
          .from("player_inventory")
          .select("*", { count: "exact", head: true })
          .eq("cosmetic_id", c.id);
        if ((count.count || 0) >= Number(c.limited_total))
          return Response.json(
            { error: "sold_out" },
            { status: 409, headers: cors },
          );
      }
      if (body.terms_version !== "2026-09-30")
        throw new Error("purchase_terms_required");
      const purchaseId = crypto.randomUUID();
      const payload = `cosm:${purchaseId}`;
      const pr = await db.from("star_purchases").insert({
        id: purchaseId,
        player_id: p.id,
        cosmetic_id: c.id,
        invoice_payload: payload,
        stars: Number(c.price_stars),
        status: "pending",
        terms_version: body.terms_version,
      });
      if (pr.error) throw pr.error;
      const tr = await fetch(
        `https://api.telegram.org/bot${token}/createInvoiceLink`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: c.name.slice(0, 32),
            description:
              `MOGG BATTLE · ${String(c.rarity).toUpperCase()} ${c.kind}`.slice(
                0,
                255,
              ),
            payload,
            currency: "XTR",
            prices: [{ label: c.name, amount: Number(c.price_stars) }],
          }),
        },
      );
      const tj = await tr.json();
      if (!tj.ok) throw new Error(tj.description || "invoice_failed");
      return Response.json(
        { ok: true, invoice_url: tj.result },
        { headers: cors },
      );
    }

    if (body.action === "equip") {
      const cosmeticId = String(body.cosmetic_id || "");
      const own = await db
        .from("player_inventory")
        .select("cosmetic_id,cosmetics(*)")
        .eq("player_id", p.id)
        .eq("cosmetic_id", cosmeticId)
        .maybeSingle();
      if (!own.data)
        return Response.json(
          { error: "not_owned" },
          { status: 403, headers: cors },
        );
      const c: any = own.data.cosmetics;
      const field = EQUIP_FIELDS[c.kind];
      if (!field)
        return Response.json(
          { error: "not_equippable" },
          { status: 400, headers: cors },
        );
      const patch: any = {};
      const isSame = String(p[field] || "") === cosmeticId;
      patch[field] = isSame ? null : cosmeticId;
      const up = await db
        .from("players")
        .update(patch)
        .eq("id", p.id)
        .select("*")
        .single();
      if (up.error) throw up.error;
      return Response.json(
        { ok: true, player: up.data, equipped: !isSame, kind: c.kind },
        { headers: cors },
      );
    }

    return Response.json(
      { error: "unknown_action" },
      { status: 400, headers: cors },
    );
  } catch (e) {
    console.error(e);
    return Response.json(
      { error: String((e as any)?.message || e) },
      { status: 400, headers: cors },
    );
  }
});
