import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { decoratedPhoto, html } from "../_shared/portrait.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const MINI_APP_URL = "https://qwqwqwqwqwqw-lgtm.github.io/mog-battle/";
const MINI_APP_LAUNCH_URL = MINI_APP_URL + "?v=arena2.2";

async function tg(method: string, body: any) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return await r.json();
}

async function send(chat_id: number, text: string, reply_markup?: any) {
  return await tg("sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML",
    reply_markup,
  });
}

async function ensurePlayer(u: any) {
  let q = await db
    .from("players")
    .select("*")
    .eq("telegram_id", u.id)
    .maybeSingle();
  if (q.data) return q.data;

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
  return c.data;
}

function rank(score: number, g?: string) {
  const m = [
    "SUB3",
    "SUB5",
    "LLTN",
    "LTN",
    "HLTN",
    "LMTN",
    "MTN",
    "HMTN",
    "LHTN",
    "HTN",
    "HHTN",
    "CHAD",
    "GIGACHAD",
  ];
  const f = [
    "SUB3",
    "SUB5",
    "LLTB",
    "LTB",
    "HLTB",
    "LMTB",
    "MTB",
    "HMTB",
    "LHTB",
    "HTB",
    "HHTB",
    "STACY",
    "TRUE STACY",
  ];
  const cuts = [
    0, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2350, 2600, 2900, 3300,
  ];
  const a = g === "female" ? f : m;
  let i = 0;
  cuts.forEach((x, n) => {
    if (score >= x) i = n;
  });
  return a[i];
}

function displayName(p: any) {
  return html(p.first_name || (p.username ? `@${p.username}` : "Игрок"));
}

async function telegramFileToPublicUrl(fileId: string, telegramId: number) {
  const f = await tg("getFile", { file_id: fileId });
  if (!f.ok) throw new Error("get_file_failed");

  const remote = `https://api.telegram.org/file/bot${TOKEN}/${f.result.file_path}`;
  const res = await fetch(remote);
  if (!res.ok) throw new Error("download_photo_failed");

  const bytes = new Uint8Array(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "image/jpeg";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const path = `${telegramId}/${crypto.randomUUID()}.${ext}`;

  const up = await db.storage.from("profile-photos").upload(path, bytes, {
    contentType: ct,
    upsert: false,
  });
  if (up.error) throw up.error;

  return db.storage.from("profile-photos").getPublicUrl(path).data.publicUrl;
}

async function startBattle(
  chatId: number,
  a: any,
  b: any,
  requestId: string,
  battleMode: string = "group",
) {
  if (!a.profile_photo_url || !b.profile_photo_url) {
    await send(
      chatId,
      "Оба игрока должны сначала загрузить фото через Mini App или команду <b>/photo</b>.",
    );
    return;
  }

  const created = await db.rpc("accept_group_battle", {
    p_request: requestId,
    p_player: b.id,
    p_chat: chatId,
  });

  if (created.error) throw created.error;

  const decorated = await Promise.allSettled([
    decoratedPhoto(db, a),
    decoratedPhoto(db, b),
  ]);
  const photoA =
    decorated[0].status === "fulfilled" ? decorated[0].value : null;
  const photoB =
    decorated[1].status === "fulfilled" ? decorated[1].value : null;
  const sentA = await tg("sendPhoto", {
    chat_id: chatId,
    photo: photoA?.url || a.profile_photo_url,
    caption: `A — ${displayName(a)}${photoA?.title ? " · " + html(photoA.title) : ""}`,
    parse_mode: "HTML",
  });

  const sentB = await tg("sendPhoto", {
    chat_id: chatId,
    photo: photoB?.url || b.profile_photo_url,
    caption: `B — ${displayName(b)}${photoB?.title ? " · " + html(photoB.title) : ""}`,
    parse_mode: "HTML",
  });

  const battle = created.data;
  if (!sentA?.ok || !sentB?.ok) {
    await db.rpc("cancel_undelivered_battle_v2", { p_battle: battle.id });
    throw new Error("battle_photo_delivery_failed");
  }
  const prompt =
    battle.mode === "quick"
      ? "QUICK · одна минута на выбор. Рейтинг не меняется. Итог появится здесь."
      : "RANKED · выбери участника. После пяти оценок — ещё 10 минут, всего до 24 часов. Итог появится здесь.";
  const posted = await send(chatId, prompt, {
    inline_keyboard: [
      [
        { text: displayName(a), callback_data: "battle_a:" + battle.id },
        { text: displayName(b), callback_data: "battle_b:" + battle.id },
      ],
      [
        {
          text: "Открыть MOGG BATTLE",
          url: "https://t.me/MoggBattleGameBot?startapp",
        },
      ],
    ],
  });
  if (!posted?.ok) {
    const cancelled = await db.rpc("cancel_undelivered_battle_v2", {
      p_battle: battle.id,
    });
    if (cancelled.error) throw cancelled.error;
    throw new Error("battle_message_failed");
  }
  const linked = await db
    .from("battles")
    .update({
      telegram_message_id: posted.result.message_id,
      ...(battle.mode === "quick"
        ? {
            started_at: new Date().toISOString(),
            ends_at: new Date(Date.now() + 60000).toISOString(),
          }
        : {}),
    })
    .eq("id", battle.id)
    .eq("status", "active");
  if (linked.error) throw linked.error;
}

async function claimDailyText(playerId: string): Promise<string> {
  try {
    const r = await db.rpc("claim_chat_daily_v1", { p_player: playerId });
    if (r.error) throw r.error;
    if (!r.data) throw new Error("empty_daily_result");
    return `+40 Points ✅\nТвои Points: ${r.data.mogg_points ?? 0}`;
  } catch (e: any) {
    if (String(e?.message || e).includes("already_claimed"))
      return "Сегодня бонус уже получен. Возвращайся завтра.";
    return "Не удалось получить бонус. Попробуй ещё раз.";
  }
}

async function setupCommands() {
  // Private chat menu: includes /start and setup actions.
  await tg("setMyCommands", {
    scope: { type: "all_private_chats" },
    commands: [
      { command: "start", description: "Открыть MOGG BATTLE" },
      { command: "daily", description: "Ежедневный бонус" },
      { command: "photo", description: "Сменить фото" },
      { command: "profile", description: "Мой профиль" },
      { command: "balance", description: "Рейтинг и Points" },
      { command: "rank", description: "Мой ранг" },
      { command: "ref", description: "Пригласить друга" },
      { command: "support", description: "Связаться с поддержкой" },
      { command: "paysupport", description: "Вопросы об оплате" },
      { command: "deleteaccount", description: "Запрос удаления данных" },
      { command: "privacy", description: "Данные и сведения об операторе" },
      { command: "terms", description: "Правила игры и покупок" },
      { command: "report", description: "Пожаловаться на фото или игрока" },
      { command: "help", description: "Все команды" },
    ],
  });

  // Group menu: /start deliberately removed.
  await tg("setMyCommands", {
    scope: { type: "all_group_chats" },
    commands: [
      { command: "battle", description: "Минутная дуэль с другом" },
      { command: "ranked", description: "Вызов с рейтингом" },
      { command: "top", description: "Недельный топ беседы" },
      { command: "quick", description: "Бой без рейтинга" },
      { command: "daily", description: "Ежедневный бонус" },
      { command: "profile", description: "Мой профиль" },
      { command: "balance", description: "Рейтинг и Points" },
      { command: "rank", description: "Мой ранг" },
      { command: "ref", description: "Пригласить друга" },
      { command: "support", description: "Связаться с поддержкой" },
      { command: "paysupport", description: "Вопросы об оплате" },
      { command: "deleteaccount", description: "Запрос удаления данных" },
      { command: "privacy", description: "Данные и сведения об операторе" },
      { command: "terms", description: "Правила игры и покупок" },
      { command: "report", description: "Пожаловаться на фото или игрока" },
      { command: "help", description: "Все команды" },
    ],
  });
}

const WEBHOOK_CONTEXT = "mogg-battle/telegram-webhook/v1";
async function webhookSecret(): Promise<string> {
  if (!TOKEN) throw new Error("bot_token_missing");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(WEBHOOK_CONTEXT),
  );
  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function secretMatches(received: string | null, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
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

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  let expected: string;
  try {
    expected = await webhookSecret();
  } catch {
    return new Response("Unavailable", { status: 503 });
  }
  if (
    !secretMatches(req.headers.get("X-Telegram-Bot-Api-Secret-Token"), expected)
  )
    return new Response("Forbidden", { status: 403 });
  try {
    let update: any;
    try {
      update = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!update || typeof update !== "object" || Array.isArray(update))
      return new Response("Invalid update", { status: 400 });

    if (update.chat_join_request) {
      const j = update.chat_join_request;
      const cfg = await db
        .from("channel_reward_config")
        .select("chat_id")
        .eq("id", true)
        .single();
      if (cfg.error) throw cfg.error;
      if (
        cfg.data.chat_id &&
        String(j.chat.id) === String(cfg.data.chat_id) &&
        !j.from.is_bot
      ) {
        const saved = await db.from("channel_join_rewards").upsert(
          {
            telegram_id: j.from.id,
            chat_id: j.chat.id,
            requested_at: new Date(j.date * 1000).toISOString(),
          },
          { onConflict: "telegram_id", ignoreDuplicates: true },
        );
        if (saved.error) throw saved.error;
      }
      return new Response("ok");
    }

    // Reserve stock atomically before approving checkout. Ambiguous acknowledgements keep the hold.
    if (update.pre_checkout_query) {
      const pc = update.pre_checkout_query;
      let ok = false,
        errorMessage = "Не удалось проверить покупку. Попробуй позже.";
      try {
        const r = await db.rpc("reserve_star_checkout_v1", {
          p_payload: pc.invoice_payload,
          p_telegram_id: pc.from.id,
          p_currency: pc.currency,
          p_amount: pc.total_amount,
          p_query: pc.id,
        });
        if (r.error) throw r.error;
        ok = r.data?.ok === true;
      } catch (e: any) {
        const reason = String(e?.message || e);
        if (reason.includes("sold_out"))
          errorMessage = "Все экземпляры уже куплены или зарезервированы.";
        else if (reason.includes("already_owned"))
          errorMessage = "Этот предмет уже есть в твоём инвентаре.";
        else if (reason.includes("payment_in_progress"))
          errorMessage =
            "Оплата этого предмета уже обрабатывается. Если она не завершится, напиши /paysupport.";
        else if (reason.includes("payment_mismatch"))
          errorMessage =
            "Этот счёт принадлежит другому аккаунту или сумма не совпадает.";
        else if (
          reason.includes("item_changed") ||
          reason.includes("purchase_not_pending")
        )
          errorMessage = "Счёт больше недоступен. Открой магазин заново.";
      }
      const answered = await tg("answerPreCheckoutQuery", {
        pre_checkout_query_id: pc.id,
        ok,
        ...(ok ? {} : { error_message: errorMessage }),
      });
      if (!answered?.ok)
        return new Response("Checkout acknowledgement failed", { status: 500 });
      return new Response("ok");
    }

    if (update.message?.successful_payment) {
      const m = update.message,
        sp = m.successful_payment;
      try {
        const r = await db.rpc("fulfill_star_purchase_v1", {
          p_payload: sp.invoice_payload,
          p_telegram_id: m.from?.id,
          p_currency: sp.currency,
          p_amount: sp.total_amount,
          p_charge: sp.telegram_payment_charge_id,
        });
        if (r.error) throw r.error;
        if (!r.data?.replayed) {
          const safeName = String(r.data?.name || "Cosmetic")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          // Delivery is committed; a notification failure must not undo the purchase.
          try {
            await send(
              m.chat.id,
              `⭐️ Оплата получена. <b>${safeName}</b> доступен в твоём инвентаре.`,
            );
          } catch {
            console.error("payment_notification_failed");
          }
          if (r.data?.already_owned)
            console.error(
              "payment_item_already_owned",
              sp.telegram_payment_charge_id,
            );
        }
        return new Response("ok");
      } catch (e: any) {
        console.error("payment_fulfillment_failed", e);
        return new Response("Payment processing unavailable", { status: 500 });
      }
    }

    if (update.poll_answer) {
      const pa = update.poll_answer;
      if (!pa.user) return new Response("ok");
      const voter = await ensurePlayer(pa.user);
      const qb = await db
        .from("battles")
        .select("*")
        .eq("telegram_poll_id", pa.poll_id)
        .maybeSingle();
      const b = qb.data;
      if (qb.error) throw qb.error;
      if (!b || !pa.user || voter.id === b.player_a || voter.id === b.player_b)
        return new Response("ok");
      const target = !pa.option_ids?.length
        ? null
        : pa.option_ids[0] === 0
          ? b.player_a
          : b.player_b;
      const saved = await db.rpc("cast_battle_vote_v2", {
        p_battle: b.id,
        p_voter: voter.id,
        p_target: target,
        p_allow_change: true,
      });
      if (saved.error && !String(saved.error.message).includes("battle_closed"))
        throw saved.error;

      return new Response("ok");
    }

    if (update.poll?.is_closed) {
      const p = update.poll;
      const qb = await db
        .from("battles")
        .select("*")
        .eq("telegram_poll_id", p.id)
        .maybeSingle();
      if (qb.data) {
        const a = Number(p.options?.[0]?.voter_count || 0);
        const b = Number(p.options?.[1]?.voter_count || 0);
        await db.rpc("finish_mogg_battle", {
          p_battle: qb.data.id,
          p_votes_a: a,
          p_votes_b: b,
        });
      }
      return new Response("ok");
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const user = await ensurePlayer(cq.from);
      const [action, id] = String(cq.data || "").split(":");

      if (action === "battle_a" || action === "battle_b") {
        const qb = await db
          .from("battles")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (qb.error) throw qb.error;
        if (!qb.data) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Бой не найден",
          });
          return new Response("ok");
        }
        const result = await db.rpc("cast_battle_vote_v2", {
          p_battle: id,
          p_voter: user.id,
          p_target: action === "battle_a" ? qb.data.player_a : qb.data.player_b,
          p_allow_change: false,
        });
        const reason = String(result.error?.message || "");
        const text = reason.includes("battle_closed")
          ? "Бой завершён. Итог — в приложении."
          : reason.includes("already_voted")
            ? "Твой голос уже учтён."
            : reason.includes("fighters_cannot_vote")
              ? "Участники не голосуют за свой бой."
              : result.error
                ? "Не удалось принять голос. Попробуй ещё раз."
                : "Голос принят · +2 Points";
        await tg("answerCallbackQuery", {
          callback_query_id: cq.id,
          text,
          show_alert: !!result.error,
        });
        if (reason.includes("battle_closed") && cq.message)
          await tg("editMessageReplyMarkup", {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Итог в MOGG BATTLE",
                    url: "https://t.me/MoggBattleGameBot?startapp",
                  },
                ],
              ],
            },
          });
        return new Response("ok");
      }
      if (action === "photo_help") {
        await tg("answerCallbackQuery", {
          callback_query_id: cq.id,
          text: "Открой личку бота и отправь /photo",
        });
        return new Response("ok");
      }

      if (action === "daily_help") {
        await tg("answerCallbackQuery", {
          callback_query_id: cq.id,
          text: await claimDailyText(user.id),
          show_alert: true,
        });
        return new Response("ok");
      }

      const qr = await db
        .from("battle_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      const r = qr.data;

      if (!r) {
        await tg("answerCallbackQuery", {
          callback_query_id: cq.id,
          text: "Вызов уже недоступен",
        });
        return new Response("ok");
      }

      if (action === "decline") {
        if (user.id !== r.challenger_id && user.id !== r.target_id) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Это приглашение не тебе",
          });
          return new Response("ok");
        }

        await db
          .from("battle_requests")
          .update({ status: "declined" })
          .eq("id", r.id)
          .eq("status", "pending");
        await tg("editMessageText", {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          text: "Вызов отклонён.",
        });
        await tg("answerCallbackQuery", { callback_query_id: cq.id });
        return new Response("ok");
      }

      if (action === "accept") {
        if (
          r.status !== "pending" ||
          new Date(r.expires_at).getTime() < Date.now()
        ) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Вызов уже закрыт",
          });
          return new Response("ok");
        }

        if (r.challenger_id === user.id) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Нельзя принять свой вызов",
          });
          return new Response("ok");
        }

        if (r.target_id && r.target_id !== user.id) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Это персональный вызов",
          });
          return new Response("ok");
        }

        if (!user.profile_photo_url) {
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Сначала загрузи фото через /photo или Mini App",
          });
          return new Response("ok");
        }

        const qa = await db
          .from("players")
          .select("*")
          .eq("id", r.challenger_id)
          .single();
        try {
          await startBattle(
            cq.message.chat.id,
            qa.data,
            user,
            r.id,
            r.mode === "quick" ? "quick" : "group",
          );
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Баттл создан",
          });
          await tg("editMessageReplyMarkup", {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            reply_markup: { inline_keyboard: [] },
          });
        } catch (e: any) {
          const reason = String(e?.message || e);
          const text = reason.includes("votes_required")
            ? "Перед следующим Ranked оцените по 3 чужих боя в приложении. Quick доступен сразу."
            : reason.includes("player_busy")
              ? "У одного из игроков уже идёт бой. Дождитесь завершения."
              : reason.includes("request_closed")
                ? "Вызов уже принят или истёк."
                : reason.includes("photo_required")
                  ? "Оба игрока должны загрузить фото."
                  : "Не удалось начать бой. Попробуйте ещё раз.";
          await tg("answerCallbackQuery", {
            callback_query_id: cq.id,
            text,
            show_alert: true,
          });
        }

        return new Response("ok");
      }
    }

    const m = update.message;
    if (!m?.from) return new Response("ok");

    const supportCmd = (m.text || "")
      .split(/\s+/)[0]
      .split("@")[0]
      .toLowerCase();
    if (
      [
        "/support",
        "/paysupport",
        "/deleteaccount",
        "/privacy",
        "/report",
      ].includes(supportCmd)
    ) {
      const privateChat = m.chat.type === "private";
      let detail = "Опиши вопрос или предложение.";
      if (supportCmd === "/paysupport")
        detail =
          "По покупке или возврату: укажи предмет, дату оплаты и приложи квитанцию Telegram. Обращения разбираются вручную; автоматического возврата по этой команде нет.";
      if (supportCmd === "/report")
        detail =
          "Для жалобы укажи имя игрока, время боя и причину. Можно приложить скриншот.";
      if (supportCmd === "/privacy")
        detail =
          "Оператор: Смирнов Роман Артурович.\nПо вопросам персональных данных и удаления напиши в поддержку. Для запроса удаления: /deleteaccount в личном чате.";
      if (supportCmd === "/deleteaccount")
        detail = privateChat
          ? "Чтобы запросить удаление фото или аккаунта, напиши на почту ниже, укажи, что удалить, и свой Telegram ID: " +
            String(m.from.id) +
            ". Поддержка проверит принадлежность аккаунта. Команда не удаляет данные автоматически."
          : "Открой личный чат с @MoggBattleGameBot и отправь /deleteaccount — там будут инструкции. Не публикуй данные аккаунта в группе.";
      await send(
        m.chat.id,
        "<b>Mogg Labs · поддержка</b>\n" +
          detail +
          "\n\n📩 mogglabs@gmail.com\nНе присылай пароли, seed-фразы и приватные ключи.",
      );
      return new Response("ok");
    }

    const player = await ensurePlayer(m.from);

    if (m.photo?.length && player.awaiting_photo) {
      try {
        const best = m.photo[m.photo.length - 1];
        const publicUrl = await telegramFileToPublicUrl(
          best.file_id,
          player.telegram_id,
        );
        const saved = await db.rpc("game_replace_photo_v1", {
          p_player: player.id,
          p_url: publicUrl,
        });
        if (saved.error) throw saved.error;
        await retryPhotoDeletions(db, saved.data);
        await send(
          m.chat.id,
          "Фото сохранено ✅ Оно теперь используется и в Mini App, и во всех MOGG Battles.",
        );
      } catch (e: any) {
        console.error("photo_save_failed");
        await send(
          m.chat.id,
          "Не удалось подтвердить сохранение фото. Открой профиль и проверь снимок; если он не обновился, отправь /photo и фото ещё раз.",
        );
      }
      return new Response("ok");
    }

    if (!m.text) return new Response("ok");

    const cmd = m.text.split(/\s+/)[0].split("@")[0].toLowerCase();

    if (cmd === "/start") {
      await setupCommands();

      if (m.chat.type !== "private") {
        await send(
          m.chat.id,
          "В группе используй <b>/battle</b>, /daily, /profile, /rank или /help.",
        );
        return new Response("ok");
      }

      await tg("setChatMenuButton", {
        chat_id: m.chat.id,
        menu_button: {
          type: "web_app",
          text: "Играть",
          web_app: { url: MINI_APP_LAUNCH_URL },
        },
      });
      const me = await tg("getMe", {});
      // Preserve referral attribution for previously shared /start links.
      const referralArg =
        String(m.text || "")
          .trim()
          .split(/\s+/)[1] || "";
      const referralMatch = /^ref_([1-9]\d{0,15})$/.exec(referralArg);
      const openAppButton = referralMatch
        ? {
            text: "OPEN MOGG BATTLE",
            url: `https://t.me/${me.result.username}?startapp=ref_${referralMatch[1]}`,
          }
        : { text: "OPEN MOGG BATTLE", web_app: { url: MINI_APP_LAUNCH_URL } };
      await send(
        m.chat.id,
        `⚔️ <b>MOGG BATTLE</b>\n\n` +
          `Два фото. Один выбор.\n\nГолосуй сразу, получи первую рамку и вызови друга на минутную дуэль.\n\n` +
          `В беседе <b>/battle</b> — быстрый вызов. <b>/ranked</b> — бой с рейтингом.`,
        {
          inline_keyboard: [
            [openAppButton],
            [
              { text: "📸 Загрузить фото", callback_data: "photo_help:none" },
              { text: "🎁 Daily", callback_data: "daily_help:none" },
            ],
            [
              {
                text: "➕ Добавить в группу",
                url: `https://t.me/${me.result.username}?startgroup=true`,
              },
            ],
          ],
        },
      );
    } else if (cmd === "/help") {
      await setupCommands();
      if (m.chat.type === "private") {
        await send(
          m.chat.id,
          `<b>MOGG BATTLE</b>\n\n` +
            `/start — открыть меню\n` +
            `/daily — бесплатный бонус\n` +
            `/photo — загрузить/сменить фото\n` +
            `/profile — профиль\n` +
            `/balance — рейтинг и Points\n` +
            `/rank — ранг\n` +
            `/ref — приглашения\n\n` +
            `/support — поддержка\n` +
            `/paysupport — покупки и возвраты\n` +
            `/report — жалоба на фото или игрока\n` +
            `/deleteaccount — запрос удаления данных\n` +
            `/privacy — данные и сведения об операторе\n` +
            `/terms — правила игры и покупок`,
        );
      } else {
        await send(
          m.chat.id,
          `<b>MOGG BATTLE · GROUP</b>\n\n` +
            `/battle — минутная дуэль\n` +
            `/ranked — вызов с рейтингом\n` +
            `/top — победители недели\n` +
            `/quick — бой без рейтинга\n` +
            `Ответь на сообщение друга командой /battle или /quick — персональный вызов\n` +
            `/daily — бесплатный бонус\n` +
            `/profile — профиль\n` +
            `/balance — рейтинг и Points\n` +
            `/rank — ранг\n` +
            `/ref — приглашения\n\n` +
            `/support — поддержка\n` +
            `/paysupport — покупки и возвраты\n` +
            `/report — жалоба на фото или игрока\n` +
            `/deleteaccount — запрос удаления данных\n` +
            `/privacy — данные и сведения об операторе\n` +
            `/terms — правила игры и покупок`,
        );
      }
    } else if (cmd === "/terms") {
      await send(
        m.chat.id,
        'Правила MOGG BATTLE, условия покупок и данные: <a href="' +
          MINI_APP_URL +
          'rules.html">открыть</a>.\nПоддержка платежей: /paysupport.',
      );
    } else if (cmd === "/top") {
      if (m.chat.type === "private") {
        await send(
          m.chat.id,
          "В беседе /top показывает победителей недели. Добавь бота в группу и начни /battle.",
        );
      } else {
        const top = await db.rpc("game_group_top_v1", { p_chat: m.chat.id });
        if (top.error) throw top.error;
        const rows = top.data || [];
        await send(
          m.chat.id,
          "<b>MOGG BATTLE · ТОП БЕСЕДЫ</b>\n\n" +
            (rows.length
              ? rows
                  .map(
                    (p: any, i: number) =>
                      i +
                      1 +
                      ". " +
                      displayName(p) +
                      " · <b>" +
                      Number(p.wins) +
                      " побед</b>",
                  )
                  .join("\n")
              : "Первые победы ещё впереди. Начни /battle и позови беседу голосовать.") +
            "\n\nНовая неделя — в понедельник, 03:00 МСК. Пара даёт одному участнику не больше одной победы в день. NPC в топе нет.",
        );
      }
    } else if (cmd === "/photo") {
      await db
        .from("players")
        .update({ awaiting_photo: true })
        .eq("id", player.id);
      await send(
        m.chat.id,
        'Отправь своё фото. Отправкой разрешаешь показывать его игрокам и в беседах, где участвуешь в боях. Правила: <a href="' +
          MINI_APP_URL +
          'rules.html">открыть</a>. Новое фото заменит старое в профиле и будущих батлах.',
      );
    } else if (cmd === "/daily") {
      await send(m.chat.id, await claimDailyText(player.id));
    } else if (cmd === "/balance") {
      await send(
        m.chat.id,
        `Рейтинг: <b>${player.mogg_score || 0}</b>\nPoints: <b>${player.mogg_points || 0}</b>`,
      );
    } else if (cmd === "/profile") {
      await send(
        m.chat.id,
        `👤 <b>${displayName(player)}</b>\n` +
          `Rank: <b>${rank(Number(player.mogg_score || 0), player.gender)}</b>\n` +
          `MOGG Score: <b>${player.mogg_score || 0}</b>\n` +
          `Battles: <b>${player.battles_played || 0}</b>\n` +
          `Photo: ${player.profile_photo_url ? "✅" : "❌ /photo"}`,
      );
    } else if (cmd === "/rank") {
      await send(
        m.chat.id,
        `Rank: <b>${rank(Number(player.mogg_score || 0), player.gender)}</b>\n` +
          `MOGG Score: <b>${player.mogg_score || 0}</b>`,
      );
    } else if (cmd === "/ref") {
      const me = await tg("getMe", {});
      await send(
        m.chat.id,
        `Твоя ссылка:\n<pre>https://t.me/${me.result.username}?startapp=ref_${player.telegram_id}</pre>\n\n` +
          `Награда засчитывается после активации профиля приглашённого.`,
      );
    } else if (cmd === "/battle" || cmd === "/quick" || cmd === "/ranked") {
      const isQuick = cmd !== "/ranked";
      if (m.chat.type === "private") {
        await send(
          m.chat.id,
          isQuick
            ? "Добавь бота в группу. Там /battle создаёт минутную дуэль."
            : "Добавь бота в группу. Там /ranked создаёт вызов с рейтингом.",
        );
        return new Response("ok");
      }

      if (!player.profile_photo_url) {
        await send(
          m.chat.id,
          "Сначала загрузи фото в личке бота командой <b>/photo</b> или через Mini App.",
        );
        return new Response("ok");
      }

      const target =
        m.reply_to_message?.from && !m.reply_to_message.from.is_bot
          ? await ensurePlayer(m.reply_to_message.from)
          : null;

      if (target?.id === player.id) {
        await send(m.chat.id, "Самого себя вызвать нельзя 🙂");
        return new Response("ok");
      }

      const reqRow = await db
        .from("battle_requests")
        .insert({
          challenger_id: player.id,
          target_id: target?.id || null,
          telegram_chat_id: m.chat.id,
          mode: isQuick ? "quick" : target ? "targeted" : "open",
          status: "pending",
          expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
        })
        .select("*")
        .single();

      if (reqRow.error) throw reqRow.error;

      if (target) {
        await send(
          m.chat.id,
          `${isQuick ? "⚡ QUICK" : "⚔️ RANKED"} · <b>${displayName(player)}</b> вызывает <b>${displayName(target)}</b>.\n\n${isQuick ? "Рейтинг не меняется." : "Для рейтинга нужны 5 оценок. Правила одинаковые с Mini App."}\nПринять вызов?`,
          {
            inline_keyboard: [
              [
                {
                  text: "✅ ПРИНЯТЬ",
                  callback_data: `accept:${reqRow.data.id}`,
                },
                {
                  text: "✕ ОТКАЗАТЬСЯ",
                  callback_data: `decline:${reqRow.data.id}`,
                },
              ],
            ],
          },
        );
      } else {
        await send(
          m.chat.id,
          `${isQuick ? "⚡ QUICK" : "⚔️ RANKED"} · <b>${displayName(player)}</b> открыл вызов.\n\n${isQuick ? "Рейтинг не меняется." : "Для рейтинга нужны 5 оценок. Правила одинаковые с Mini App."}\nКто готов выйти против него?`,
          {
            inline_keyboard: [
              [
                {
                  text: "⚔️ ПРИНЯТЬ БАТТЛ",
                  callback_data: `accept:${reqRow.data.id}`,
                },
              ],
            ],
          },
        );
      }
    }

    return new Response("ok");
  } catch (e: any) {
    console.error(e);
    return new Response("ok");
  }
});
