import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { html } from "../_shared/portrait.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const secret = req.headers.get("X-Game-Worker-Secret") || "";
  if (secret.length !== 36) return new Response("Forbidden", { status: 403 });
  const auth = await db.rpc("game_worker_check_v1", { p_secret: secret });
  if (auth.error || auth.data !== true)
    return new Response("Forbidden", { status: 403 });
  const leased = await db.rpc("game_results_lease_v1");
  if (leased.error) return new Response("Unavailable", { status: 503 });
  let delivered = 0;
  for (const job of leased.data || []) {
    try {
      const battle = await db
        .from("battles")
        .select("*")
        .eq("id", job.battle_id)
        .single();
      if (battle.error) throw battle.error;
      const b = battle.data;
      const players = await db
        .from("players")
        .select("id,first_name,username")
        .in("id", [b.player_a, b.player_b]);
      if (players.error) throw players.error;
      const display = (id: string) =>
        html(players.data.find((p: any) => p.id === id)?.first_name || "Игрок");
      const result =
        b.result_reason === "insufficient_votes"
          ? "Не хватило голосов. Победитель не назначен."
          : b.winner_id
            ? "Победа: <b>" + display(b.winner_id) + "</b>"
            : "Ничья. Рейтинг сохранён.";
      const text = `<b>MOGG BATTLE · ИТОГ</b>\n\n${display(b.player_a)} / ${display(b.player_b)}\n${Number(b.votes_a) || 0} : ${Number(b.votes_b) || 0} голосов\n\n${result}\n${b.mode === "quick" ? "Минутная дуэль · без изменения рейтинга." : "Рейтинг: " + (b.score_delta_a > 0 ? "+" : "") + (b.score_delta_a || 0) + " / " + (b.score_delta_b > 0 ? "+" : "") + (b.score_delta_b || 0)}`;
      const response = await fetch(
        "https://api.telegram.org/bot" +
          Deno.env.get("TELEGRAM_BOT_TOKEN") +
          "/editMessageText",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: b.telegram_chat_id,
            message_id: b.telegram_message_id,
            text,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Реванш в MOGG BATTLE ↗",
                    url: "https://t.me/MoggBattleGameBot?startapp",
                  },
                ],
              ],
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const resultApi = await response.json();
      if (
        !resultApi.ok &&
        !String(resultApi.description || "").includes("message is not modified")
      )
        throw new Error("telegram_result_unavailable");
      const saved = await db
        .from("game_result_outbox")
        .update({ delivered_at: new Date().toISOString(), last_error: null })
        .eq("battle_id", job.battle_id);
      if (saved.error) throw saved.error;
      delivered++;
    } catch {
      await db
        .from("game_result_outbox")
        .update({ last_error: "delivery_unavailable" })
        .eq("battle_id", job.battle_id);
    }
  }
  return Response.json({ ok: true, delivered });
});
