const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const file = path.join(
    root,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") ||
      "index.html",
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg",
        ".png": "image/png",
      }[path.extname(file)] || "text/plain",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const errors = [];
  try {
    const demo = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    demo.on("pageerror", (e) => errors.push(e.message));
    await demo.route("https://telegram.org/js/telegram-web-app.js", (r) =>
      r.fulfill({ body: "", contentType: "application/javascript" }),
    );
    await demo.goto(origin);
    await demo.waitForSelector(".battle-card");
    assert(await demo.locator("#demoBanner").isVisible());
    assert(!(await demo.locator("#onboarding").isVisible()));
    for (const width of [320, 390, 768, 1200]) {
      await demo.setViewportSize({ width, height: 844 });
      for (const view of ["arena", "tasks", "style", "profile"]) {
        await demo.locator('[data-view="' + view + '"]').click();
        assert(
          await demo.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
          `overflow ${view} ${width}`,
        );
        if (process.env.QA_SCREENSHOTS && width === 390)
          await demo.screenshot({
            path: path.join(process.env.QA_SCREENSHOTS, view + ".png"),
            fullPage: true,
          });
      }
    }
    await demo.locator('[data-view="arena"]').click();
    assert.equal(await demo.locator(".timer").textContent(), "Демо");
    await demo.locator('[data-feed="practice"]').click();
    assert.equal(await demo.locator(".battle-card").count(), 0);
    assert(await demo.locator("#startPractice").isVisible());
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.telegramCalls = [];
      window.Telegram = {
        WebApp: {
          initData: "hash=fixture",
          initDataUnsafe: {},
          ready() {},
          expand() {},
          setHeaderColor() {},
          setBackgroundColor() {},
          setBottomBarColor() {},
          onEvent() {},
          HapticFeedback: { notificationOccurred() {}, impactOccurred() {} },
          openTelegramLink(url) {
            window.telegramCalls.push({ type: "link", url });
          },
          openInvoice(url, callback) {
            window.telegramCalls.push({ type: "invoice", url });
            callback("paid");
          },
          shareMessage(id, callback) {
            window.telegramCalls.push({ type: "share", id });
            callback(window.shareCancelled !== true);
          },
          shareToStory(url, params) {
            window.telegramCalls.push({ type: "story", url, params });
          },
        },
      };
    });
    const P = "00000000-0000-4000-8000-000000000001";
    const A = "00000000-0000-4000-8000-000000000002";
    const B = "00000000-0000-4000-8000-000000000003";
    const frame = {
      id: "00000000-0000-4000-8000-000000000020",
      code: "frame_first_light",
      name: "FIRST LIGHT",
      kind: "frame",
      visual_key: "firstlight",
      collection: "first_steps",
    };
    const set = {
      id: "00000000-0000-4000-8000-000000000030",
      code: "frame_afterhours",
      name: "AFTER HOURS",
      kind: "frame",
      visual_key: "afterhours",
      collection: "sets",
      is_purchasable: true,
      price_stars: 99,
    };
    const bg = {
      id: "00000000-0000-4000-8000-000000000031",
      code: "bg_afterhours",
      name: "MIDNIGHT",
      kind: "profile_bg",
      visual_key: "midnight",
      collection: "set_items",
    };
    const title = {
      id: "00000000-0000-4000-8000-000000000032",
      code: "title_afterhours",
      name: "NIGHT MOGGER",
      kind: "title",
      visual_key: "nightmogger",
      collection: "set_items",
    };
    const model = {
      player: {
        id: P,
        telegram_id: 1234567,
        first_name: "TEST",
        mogg_points: 0,
        mogg_score: 0,
        energy: 100,
        max_energy: 100,
        tap_power: 1,
        style: {},
      },
      inventory: [],
      daily: {
        visited: true,
        streak: 1,
        votes: 0,
        taps: 0,
        battles: 0,
        claimed: [],
      },
      shop: [frame, set, bg, title],
      bundles: [
        { bundle_id: set.id, cosmetic_id: bg.id },
        { bundle_id: set.id, cosmetic_id: title.id },
      ],
      feed: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          player_a: A,
          player_b: B,
          status: "active",
          mode: "quick",
          source: "miniapp",
          ends_at: new Date(Date.now() + 60000).toISOString(),
          a: {
            id: A,
            first_name: "<img src=x onerror=window.hacked=1>",
            profile_photo_url: origin + "/npc/npc001.jpg",
            style: {},
          },
          b: {
            id: B,
            first_name: "NICK",
            profile_photo_url: origin + "/npc/npc005.jpg",
            style: {},
          },
        },
      ],
      drops: {},
    };
    const filler = {
      ...model.feed[0],
      id: "00000000-0000-4000-8000-000000000011",
      source: "npc_feed",
      a: { ...model.feed[0].a, first_name: "NPC FILLER A", is_npc: true },
      b: { ...model.feed[0].b, first_name: "NPC FILLER B", is_npc: true },
    };
    const practicePair = {
      ...model.feed[0],
      id: "00000000-0000-4000-8000-000000000012",
      source: "npc",
      a: { ...model.feed[0].a, first_name: "VIRTUAL OPPONENT", is_npc: true },
    };
    model.feed.unshift(filler, practicePair);
    const actions = [];
    let bought = false;
    let tapRequests = 0;
    await page.route("https://telegram.org/js/telegram-web-app.js", (r) =>
      r.fulfill({ body: "", contentType: "application/javascript" }),
    );
    await page.route("**/functions/v1/player-api", async (route) => {
      const body = route.request().postDataJSON();
      actions.push(body);
      let result = { ok: true };
      if (body.action === "me") {
        if (bought)
          model.inventory.push(
            ...[set, bg, title]
              .filter(
                (c) => !model.inventory.some((x) => x.cosmetics.id === c.id),
              )
              .map((c) => ({ cosmetics: c })),
          );
        result = { ok: true, ...model };
      } else if (body.action === "vote") {
        model.daily.votes++;
        model.daily.welcome_ready = true;
        model.player.mogg_points += 2;
        model.feed = [filler];
      } else if (body.action === "claim_game_reward") {
        model.inventory.push({ cosmetics: frame });
        model.daily.welcome_claimed = true;
        model.player.mogg_points += 100;
        model.player.equipped_frame = frame.id;
        model.player.style.frame = frame;
        result = { ok: true, points: 100 };
      } else if (body.action === "set_gender") {
        model.player.gender = body.gender;
      } else if (body.action === "upload_photo") {
        assert.equal(body.photo_consent, true);
        assert.equal(body.mime, "image/jpeg");
        assert(Buffer.from(body.base64, "base64").byteLength < 5 * 1024 * 1024);
        model.player.profile_photo_url = origin + "/npc/npc001.jpg";
      } else if (body.action === "create_duel") {
        result = {
          ok: true,
          url: "https://t.me/MoggBattleGameBot?startapp=duel_fixture",
        };
      } else if (body.action === "open_matchmaking") {
        assert.equal(body.mode, "quick");
        result = { ok: true, matched: false, unavailable: true };
      } else if (body.action === "create_star_invoice") {
        assert.equal(body.terms_version, "2026-09-30");
        bought = true;
        result = { ok: true, invoice_url: "https://t.me/$fixture" };
      } else if (body.action === "tap_batch") {
        tapRequests++;
        model.player.energy -= body.count;
        model.player.mogg_points += body.count;
        result = { ok: true, player: model.player, accepted: body.count };
      } else if (body.action === "prepare_share") {
        assert(body.png.length > 500);
        result = {
          ok: true,
          message_id: "prepared_fixture",
          image_url: origin + "/social-cover.png",
        };
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    });
    await page.goto(origin);
    await page.waitForSelector(".vote-button");
    assert(!(await page.locator("#onboarding").isVisible()));
    assert.equal(await page.evaluate(() => window.hacked), undefined);
    assert(
      await page
        .locator('[data-feed="human"]')
        .evaluate((x) => x.classList.contains("selected")),
    );
    assert(
      !(await page.locator("#battleFeed").textContent()).includes("NPC FILLER"),
    );
    assert(
      !(await page.locator("#battleFeed").textContent()).includes(
        "VIRTUAL OPPONENT",
      ),
    );
    await page.locator('[data-feed="practice"]').click();
    assert(
      (await page.locator("#battleFeed").textContent()).includes(
        "VIRTUAL OPPONENT",
      ),
    );
    assert(
      !(await page.locator("#battleFeed").textContent()).includes("NPC FILLER"),
    );
    await page.locator('[data-feed="human"]').click();
    await page.locator(".vote-button").first().click();
    await page.waitForSelector("#claimWelcome");
    assert.equal(
      await page.locator(".battle-card").count(),
      0,
      "NPC filler returned after refresh",
    );
    assert(await page.locator("#emptyDuel").isVisible());
    await page.locator("#claimWelcome").click();
    await page.waitForSelector("#rewardCollection");
    await page.locator("#rewardCollection").click();
    assert(
      await page
        .locator("#inventory .item-name")
        .filter({ hasText: "FIRST LIGHT" })
        .isVisible(),
    );
    await page.locator('[data-view="arena"]').click();
    await page.locator("#friendBtn").click();
    assert(await page.locator("#onboarding").isVisible());
    await page.locator('[data-gender="male"]').click();
    await page
      .locator("#photoInput")
      .setInputFiles(path.join(root, "npc/npc001.jpg"));
    assert(await page.locator("#savePhoto").isDisabled());
    await page.locator("#photoConsent").check();
    await page.locator("#savePhoto").click();
    await page.waitForSelector("#sendDuel");
    await page.locator("#sendDuel").click();
    assert(
      (await page.evaluate(() => window.telegramCalls)).some((x) =>
        x.url?.includes("duel_fixture"),
      ),
    );
    await page.locator("#modalClose").click();
    await page.locator("#quickBtn").click();
    await page.waitForFunction(() =>
      document.querySelector("#matchStatus").textContent.includes("недоступна"),
    );
    assert.equal(
      actions.find((x) => x.action === "open_matchmaking").opponent,
      undefined,
    );
    await page.locator('[data-feed="practice"]').click();
    await page.locator("#startPractice").click();
    await page.waitForFunction(
      () => document.querySelector("#quickBtn").disabled === false,
    );
    assert.equal(
      actions.filter((x) => x.action === "open_matchmaking").at(-1).opponent,
      "practice",
    );
    await page.locator('[data-view="style"]').click();
    await page.locator('[data-store="shop"]').click();
    await page.locator('[data-try="' + set.id + '"]').click();
    assert(
      await page
        .locator(".try-hero.bg-midnight .title-nightmogger")
        .isVisible(),
    );
    await page.locator("#tryPurchase").click();
    assert(await page.locator("#confirmPurchase").isDisabled());
    await page.locator("#purchaseConsent").check();
    await page.locator("#confirmPurchase").click();
    await page.waitForFunction(() =>
      document.querySelector("#inventory").textContent.includes("MIDNIGHT"),
    );
    assert.equal(await page.locator("#inventory .item").count(), 4);
    await page.locator('[data-view="tasks"]').click();
    await page.locator("#lab summary").click();
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) document.querySelector("#tapBtn").click();
    });
    await page.waitForTimeout(700);
    assert.equal(tapRequests, 1, "taps were sent individually");
    assert.equal(actions.find((x) => x.action === "tap_batch").count, 5);
    await page.locator('[data-view="profile"]').click();
    await page.locator("#shareProfile").click();
    await page.waitForSelector("#cardSend");
    const shareCount = () =>
      actions.filter(
        (x) => x.action === "game_event" && x.name === "share_profile",
      ).length;
    assert.equal(shareCount(), 0, "opening card must not count as sending");
    await page.evaluate(() => {
      window.shareCancelled = true;
    });
    await page.locator("#cardSend").click();
    await page.waitForFunction(() =>
      window.telegramCalls.some((x) => x.type === "share"),
    );
    assert.equal(shareCount(), 0, "cancelled share must not count as sending");
    await page.evaluate(() => {
      window.shareCancelled = false;
    });
    const sentEvent = page.waitForResponse(
      (r) =>
        r.url().includes("player-api") &&
        r.request().postDataJSON()?.name === "share_profile",
    );
    await page.locator("#cardSend").click();
    await sentEvent;
    assert.equal(shareCount(), 1, "successful share must count once");
    await page.locator("#cardStory").click();
    await page.waitForFunction(() =>
      window.telegramCalls.some((x) => x.type === "story"),
    );
    const story = await page.evaluate(() =>
      window.telegramCalls.find((x) => x.type === "story"),
    );
    assert(
      story.params.text.includes(
        "https://t.me/MoggBattleGameBot?startapp=ref_",
      ),
      "story must include invitation link",
    );
    assert.equal(actions.filter((x) => x.action === "prepare_share").length, 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: demo at 4 widths, photo-free first vote, welcome claim, consent + resized photo, invite, full set try-on, Stars checkout, inventory, batched taps, share card, escaped names.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
