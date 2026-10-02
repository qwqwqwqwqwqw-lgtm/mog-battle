"use strict";
(() => {
  const API =
    "https://zjznmcydpngceiblqtwj.supabase.co/functions/v1/player-api";
  const BOT = "https://t.me/MoggBattleGameBot";
  const tg = window.Telegram?.WebApp;
  const $ = (id) => document.getElementById(id);
  const escape = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const fmt = (n) => Number(n || 0).toLocaleString("ru-RU");
  const name = (p) => p?.first_name || p?.username || "Игрок";
  const key = (c) =>
    String(c?.visual_key || c?.code || "")
      .replace(/^(frame_|bg_|title_|intro_|victory_|score_|name_|react_)/, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  const field = {
    frame: "equipped_frame",
    profile_bg: "equipped_background",
    title: "equipped_title",
    name_style: "equipped_name_style",
    score_style: "equipped_score_style",
    battle_intro: "equipped_battle_intro",
    victory_card: "equipped_victory_card",
    reaction: "equipped_reaction",
  };
  const kindName = {
    frame: "Рамка",
    profile_bg: "Фон",
    title: "Титул",
    name_style: "Имя",
    score_style: "Рейтинг",
    battle_intro: "Вступление",
    victory_card: "Карточка победы",
    reaction: "Реакция",
  };
  const cuts = [
    0, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2350, 2600, 2900, 3300,
  ];
  const ranks = {
    male: [
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
    ],
    female: [
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
    ],
  };
  const state = {
    player: null,
    feed: [],
    shop: [],
    inventory: [],
    daily: {},
    drops: {},
    rankedQueue: null,
    lastBattle: null,
    bundles: [],
    demo: !tg?.initData,
    feedFilter: "human",
    kindFilter: "all",
    view: "arena",
    invite: null,
  };
  const skipped = new Set(),
    voted = new Set();
  let ready = false,
    refreshing = false,
    booting = false,
    voting = false,
    matchBusy = false,
    pendingAction = null,
    photoFile = null,
    photoURL = null,
    gender = null,
    lastResult = null,
    tapCount = 0,
    tapBatch = null,
    tapSending = false,
    tapTimer = null,
    toastTimer = null,
    matchTimer = null,
    pollTimer = null,
    modalLocked = false;

  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("show");
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2800);
  }
  function openTelegram(url) {
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.location.href = url;
  }
  function requireTelegram() {
    if (state.demo) {
      openTelegram(BOT + "?startapp");
      return false;
    }
    return true;
  }
  function safePhoto(url) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol !== "https:" && u.origin !== location.origin) return "";
      if (
        u.origin === location.origin ||
        u.hostname === "zjznmcydpngceiblqtwj.supabase.co" ||
        u.hostname === "qwqwqwqwqwqw-lgtm.github.io"
      )
        return u.href;
    } catch {}
    return "";
  }
  function portrait(p, frame = p?.style?.frame) {
    const photo = safePhoto(p?.profile_photo_url);
    return `<div class="portrait ${frame ? "cosmeticFrame frame-" + key(frame) : ""}">${photo ? `<img src="${escape(photo)}" alt="Фото ${escape(name(p))}" loading="lazy" decoding="async">` : `<span>${escape(name(p).charAt(0))}</span>`}</div>`;
  }
  function title(p) {
    const c = p?.style?.title;
    return c
      ? `<span class="cosmeticTitle title-${key(c)}">${escape(c.name)}</span>`
      : "";
  }
  function rank(p) {
    let i = 0;
    cuts.forEach((n, j) => {
      if (Number(p?.mogg_score || 0) >= n) i = j;
    });
    return (ranks[p?.gender] || ranks.male)[i];
  }
  function rankLabel(p) {
    return Number(p?.battles_played || 0) === 0 &&
      Number(p?.mogg_score || 0) === 0
      ? "Новичок · первые бои впереди"
      : rank(p) + " · " + fmt(p.mogg_score) + " рейтинга";
  }
  function own(b) {
    return !!state.player && [b.player_a, b.player_b].includes(state.player.id);
  }
  function practice(b) {
    return !!(b.a?.is_npc || b.b?.is_npc || b.source === "npc_feed");
  }
  function live(b) {
    return b.status === "active" && new Date(b.ends_at).getTime() > Date.now();
  }
  function timeLeft(date) {
    const n = Math.max(0, Math.ceil((new Date(date) - Date.now()) / 1000));
    return n >= 3600
      ? Math.ceil(n / 3600) + " ч"
      : n >= 60
        ? Math.ceil(n / 60) + " мин"
        : n > 0
          ? n + " сек"
          : "Подводим итог";
  }

  async function call(action, extra = {}) {
    if (state.demo) throw new Error("open_in_telegram");
    const ctrl = new AbortController(),
      timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: tg.initData, action, ...extra }),
        signal: ctrl.signal,
      });
      let d;
      try {
        d = await r.json();
      } catch {
        throw new Error("invalid_response");
      }
      if (!r.ok || d.error) {
        const e = new Error(d.error || "request_failed");
        e.data = d;
        throw e;
      }
      return d;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("request_timeout");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  function track(event) {
    if (!state.demo) call("game_event", { name: event }).catch(() => {});
  }
  function errorText(e) {
    return (
      {
        open_in_telegram: "Открой игру через Telegram.",
        invalid_auth: "Открой игру заново из бота.",
        request_timeout: "Сервер отвечает долго. Попробуй ещё раз.",
        onboarding_required: "Добавь своё фото перед участием.",
        photo_required: "Для боя нужно фото.",
        invalid_photo: "Не удалось прочитать фото. Выбери другой снимок.",
        not_enough_points: "Пока не хватает Points.",
        no_energy: "Энергия закончилась. Она восстанавливается.",
        already_owned: "Этот предмет уже в коллекции.",
        already_voted: "Твой голос уже учтён.",
        battle_closed: "Бой уже завершён.",
        reward_not_ready: "Сначала выполни задание.",
        player_busy: "У одного из участников уже идёт быстрый бой.",
        invite_closed: "Вызов уже принят или срок истёк.",
        invite_not_found: "Этот вызов не найден.",
        own_invite: "Отправь эту ссылку другу.",
        invite_limit: "Ты создал много вызовов. Попробуй через час.",
        sold_out: "Все экземпляры уже разобраны.",
        support_daily_limit:
          "До 5 обращений в сутки. Срочно: mogglabs@gmail.com.",
      }[e.message] || "Не получилось завершить действие. Попробуй ещё раз."
    );
  }
  function showModal(label, html) {
    modalLocked = false;
    $("modalClose").disabled = false;
    $("modalLabel").textContent = label;
    $("modalBody").innerHTML = html;
    if (!$("modal").open) $("modal").showModal();
  }
  function closeModal() {
    if (!modalLocked) $("modal").close();
  }
  $("modalClose").onclick = closeModal;
  $("modal").addEventListener("cancel", (e) => {
    if (modalLocked) e.preventDefault();
  });
  for (const id of ["modal", "onboarding"])
    $(id).addEventListener("click", (e) => {
      if (e.target === $(id)) {
        const r = $(id).getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        ) {
          if (id === "modal") closeModal();
          else {
            pendingAction = null;
            $(id).close();
          }
        }
      }
    });

  function openView(view) {
    if (!["arena", "tasks", "style", "profile"].includes(view)) view = "arena";
    state.view = view;
    document
      .querySelectorAll(".view")
      .forEach((x) => x.classList.toggle("active", x.id === view + "View"));
    document.querySelectorAll("[data-view]").forEach((x) => {
      const chosen = x.dataset.view === view;
      x.classList.toggle("selected", chosen);
      if (chosen) x.setAttribute("aria-current", "page");
      else x.removeAttribute("aria-current");
    });
    history.replaceState(null, "", "#" + view);
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
        ? "instant"
        : "smooth",
    });
    if (view === "style") track("shop_open");
  }
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => openView(b.dataset.view)));
  $("profileShortcut").onclick = () => openView("profile");
  document.querySelector(".wordmark").onclick = (e) => {
    e.preventDefault();
    openView("arena");
  };

  function renderPlayer() {
    const p = state.player || {},
      photo = safePhoto(p.profile_photo_url);
    $("miniAvatar").innerHTML = photo
      ? `<img src="${escape(photo)}" alt="">`
      : escape(name(p).charAt(0));
    $("miniPoints").textContent = fmt(p.mogg_points) + " P";
    $("taskPoints").innerHTML = fmt(p.mogg_points) + "<span>Points</span>";
    $("shopPoints").textContent = fmt(p.mogg_points) + " Points";
    const st = p.style || {};
    $("profileHero").className =
      "profile-hero" + (st.profile_bg ? " bg-" + key(st.profile_bg) : "");
    $("profileHero").innerHTML =
      portrait(p) +
      `<h2 class="${st.name_style ? "name-" + key(st.name_style) : ""}">${escape(name(p))}</h2><p class="profile-username">${p.username ? "@" + escape(p.username) : "Твоё место на арене"}</p>${title(p)}<p class="profile-rank">${escape(rankLabel(p))}</p>`;
    $("profileStats").innerHTML =
      `<div><b>${fmt(p.battles_played)}</b><span>Бои с итогом</span></div><div><b>${fmt(p.battles_won)}</b><span>Победы</span></div><div><b>${fmt(p.season_peak)}</b><span>Пик рейтинга</span></div>`;
    $("refCount").textContent =
      "Друзей с готовым профилем: " + fmt(p.referral_count);
    renderLab();
  }
  function battleCard(b, isOwn = false) {
    const label = state.demo
      ? "Пример пары · демо"
      : practice(b)
        ? "Тренировочный бой"
        : b.source === "friend"
          ? "Дуэль друзей"
          : b.mode === "quick"
            ? "Быстрый бой"
            : "Рейтинговый бой";
    const fighter = (p, index) =>
      `<div class="fighter ${p?.style?.profile_bg ? "bg-" + key(p.style.profile_bg) : ""}">${portrait(p)}<div class="fighter-info"><b class="${p?.style?.name_style ? "name-" + key(p.style.name_style) : ""}">${escape(name(p))}</b><span class="fighter-index">${index}</span></div><div class="fighter-title">${title(p) || "MOGG BATTLE"}</div></div>`;
    return `<article class="battle-card ${isOwn ? "own-battle" : ""}" data-battle="${escape(b.id)}"><div class="battle-meta"><span class="${practice(b) ? "practice" : ""}">${escape(label)}</span><span class="timer" ${state.demo ? "" : `data-ends="${escape(b.ends_at)}"`}>${state.demo ? "Демо" : timeLeft(b.ends_at)}</span></div><div class="faces">${fighter(b.a, "01")}${fighter(b.b, "02")}<span class="vs-label" aria-hidden="true">VS</span></div>${isOwn ? `<div class="own-note">${b.mode === "quick" ? "Твой бой идёт. Пригласи друзей выбрать победителя. Рейтинг сохраняется." : b.quorum_at ? "5 оценок собраны. Осталось финальное голосование." : "Ждём 5 оценок. Бой может идти до суток; рейтинг меняется только по голосам."}</div><div class="vote-row"><button class="secondary share-battle" data-id="${escape(b.id)}">Позвать голосовать ↗</button><button class="secondary revisit">Выбрать другие бои</button></div>` : `<div class="vote-row"><button class="vote-button" data-side="a" data-id="${escape(b.id)}">За ${escape(name(b.a))}</button><button class="vote-button" data-side="b" data-id="${escape(b.id)}">За ${escape(name(b.b))}</button></div><div class="battle-meta"><button class="report-button" data-report="${escape(b.id)}">Пожаловаться</button><button class="report-button" data-skip="${escape(b.id)}">Пропустить →</button></div>`}</article>`;
  }
  function renderFeed() {
    const active = state.feed.filter(
        (b) =>
          live(b) && b.source !== "npc_feed" && !(b.a?.is_npc && b.b?.is_npc),
      ),
      mine = active.filter(own);
    $("ownBattles").innerHTML = mine.length
      ? '<div class="own-heading"><b>Твой бой</b><span>На арене</span></div>' +
        mine.map((b) => battleCard(b, true)).join("")
      : "";
    let candidates = active.filter(
      (b) => !own(b) && !skipped.has(b.id) && !voted.has(b.id),
    );
    if (state.feedFilter === "human")
      candidates = candidates.filter((b) => !practice(b));
    if (state.feedFilter === "practice")
      candidates = candidates.filter(practice);
    candidates.sort((a, b) => Number(practice(a)) - Number(practice(b)));
    $("battleFeed").innerHTML = candidates.length
      ? battleCard(candidates[0])
      : state.feedFilter === "practice"
        ? `<div class="empty"><span class="empty-symbol">VS</span><b>Твой тренировочный бой</b><p>Ты против виртуального соперника. Голосуют люди, рейтинг сохраняется.</p><button class="secondary" id="startPractice" ${matchBusy ? "disabled" : ""}>Начать тренировку</button></div>`
        : `<div class="empty"><span class="empty-symbol">↗</span><b>Сейчас нет открытых боёв</b><p>Создай дуэль с другом и отправь ссылку в беседу. Первый бой начинается с вас.</p><button class="secondary" id="emptyDuel">Вызвать друга ↗</button><p><button class="report-button" id="revisit">${skipped.size ? "Показать пропущенные" : "Проверить новые пары"}</button></p></div>`;
    $("emptyDuel")?.addEventListener("click", createDuel);
    $("startPractice")?.addEventListener("click", () => startMatch("practice"));
    document
      .querySelectorAll("[data-side]")
      .forEach(
        (b) => (b.onclick = () => vote(b.dataset.id, b.dataset.side, b)),
      );
    document.querySelectorAll("[data-skip]").forEach(
      (b) =>
        (b.onclick = () => {
          skipped.add(b.dataset.skip);
          renderFeed();
        }),
    );
    document
      .querySelectorAll("[data-report]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            support("report", "Бой: " + b.dataset.report + "\nПричина: ")),
      );
    document
      .querySelectorAll(".share-battle")
      .forEach(
        (b) =>
          (b.onclick = () =>
            shareLink(
              "Помоги выбрать победителя моего MOGG-батла!",
              BOT + "?startapp=battle_" + b.dataset.id.replaceAll("-", ""),
            )),
      );
    document.querySelectorAll(".revisit").forEach(
      (b) =>
        (b.onclick = () => {
          $("battleFeed").scrollIntoView({ behavior: "smooth" });
        }),
    );
    $("revisit")?.addEventListener("click", async () => {
      skipped.clear();
      await refresh();
      renderFeed();
    });
    renderQueue();
  }
  document.querySelectorAll("[data-feed]").forEach(
    (b) =>
      (b.onclick = () => {
        state.feedFilter = b.dataset.feed;
        document
          .querySelectorAll("[data-feed]")
          .forEach((x) => x.classList.toggle("selected", x === b));
        renderFeed();
      }),
  );
  async function vote(id, side, button) {
    if (!requireTelegram() || voting) return;
    voting = true;
    document
      .querySelectorAll(`[data-id="${id}"][data-side]`)
      .forEach((b) => (b.disabled = true));
    try {
      await call("vote", { battle_id: id, side });
      button.classList.add("voted");
      voted.add(id);
      tg?.HapticFeedback?.notificationOccurred("success");
      toast("Голос принят · +2 Points");
      await new Promise((r) => setTimeout(r, 350));
      await refresh();
    } catch (e) {
      if (e.message === "already_voted") {
        voted.add(id);
        renderFeed();
      }
      toast(errorText(e));
    } finally {
      voting = false;
      document
        .querySelectorAll(`[data-id="${id}"][data-side]`)
        .forEach((b) => (b.disabled = false));
    }
  }

  function renderDaily() {
    const d = state.daily || {};
    $("streak").innerHTML =
      String(d.streak || 1).padStart(2, "0") + "<span>дней подряд</span>";
    const claims = new Set(d.claimed || []),
      missions = [
        {
          key: "visit",
          icon: "↗",
          title: "Загляни на арену",
          value: d.visited ? 1 : 0,
          goal: 1,
          reward: 20 + Math.min(7, d.streak || 1) * 5,
        },
        {
          key: "votes",
          icon: "◉",
          title: "Выбери победителя 3 раза",
          value: d.votes || 0,
          goal: 3,
          reward: 60,
        },
        {
          key: "battle",
          icon: "⚔",
          title: "Начни быстрый бой",
          value: d.battles || 0,
          goal: 1,
          reward: 80,
        },
        {
          key: "taps",
          icon: "✳",
          title: "Сделай 30 тапов в LAB",
          value: d.taps || 0,
          goal: 30,
          reward: 40,
        },
      ];
    $("missions").innerHTML = missions
      .map((m) => {
        const claimed = claims.has(m.key),
          done = m.value >= m.goal;
        return `<div class="mission ${claimed ? "completed" : ""}"><span class="mission-symbol">${claimed ? "✓" : m.icon}</span><div class="mission-copy"><b>${m.title}</b><p>${Math.min(m.value, m.goal)} / ${m.goal} · +${m.reward} Points</p><div class="progress"><i style="width:${Math.min(100, (m.value / m.goal) * 100)}%"></i></div></div><button data-claim="${m.key}" ${claimed || !done ? "disabled" : ""}>${claimed ? "✓" : done ? "Забрать" : "+" + m.reward}</button></div>`;
      })
      .join("");
    document
      .querySelectorAll("[data-claim]")
      .forEach((b) => (b.onclick = () => claim(b.dataset.claim, b)));
    $("welcomeCard").hidden = !!d.welcome_claimed;
    $("welcomeCard").classList.toggle("reward-locked", !d.welcome_ready);
    $("welcomeCard").innerHTML =
      `<span class="welcome-icon">✳</span><div><b>${d.welcome_ready ? "Твоя первая рамка готова" : "Первый голос — первый стиль"}</b><p>${d.welcome_ready ? "FIRST LIGHT + 100 Points. Забери и надень." : "Выбери победителя и получи рамку FIRST LIGHT."}</p></div>${d.welcome_ready ? '<button id="claimWelcome">Забрать</button>' : ""}`;
    $("claimWelcome")?.addEventListener("click", (e) =>
      claim("welcome", e.currentTarget),
    );
  }
  async function claim(key, button) {
    if (!requireTelegram()) return;
    button.disabled = true;
    try {
      const d = await call("claim_game_reward", { key });
      await refresh();
      if (d.replayed) {
        toast("Награда уже в твоём аккаунте");
        return;
      }
      if (key === "welcome") {
        showModal(
          "ПЕРВЫЙ ШАГ СДЕЛАН",
          `<div class="result-modal-symbol">✳</div><h2 class="result-modal-title">FIRST LIGHT</h2><p class="result-modal-detail">Твоя первая рамка и +${d.points} Points. Рамка уже надета, если у тебя не было другой.</p><button id="rewardCollection" class="primary">Посмотреть мой стиль ↗</button>`,
        );
        $("rewardCollection").onclick = () => {
          closeModal();
          openView("style");
          showOwned();
        };
      } else toast("+" + d.points + " Points · награда получена");
    } catch (e) {
      toast(errorText(e));
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }
  function renderLab() {
    const p = state.player || {},
      pending = tapCount + (tapBatch?.count || 0),
      energy = Math.max(0, Number(p.energy || 0) - pending);
    $("energy").textContent = energy + " / " + (p.max_energy || 100);
    $("energyProgress").style.width =
      Math.min(100, (energy / (p.max_energy || 100)) * 100) + "%";
    const lv = {
      tap: Math.max(0, (p.tap_power || 1) - 1),
      energy: p.energy_level || 0,
      recovery: p.recovery_level || 0,
      idle: p.idle_level || 0,
    };
    const descriptions = {
      tap: `${p.tap_power || 1} → ${(p.tap_power || 1) + 1} Points за тап`,
      energy: `${p.max_energy || 100} → ${(p.max_energy || 100) + 10} энергии`,
      recovery: "Энергия восстанавливается быстрее",
      idle: `${(p.idle_level || 0) * 6} → ${((p.idle_level || 0) + 1) * 6} Points в час`,
    };
    $("upgrades").innerHTML = Object.entries({
      tap: "Сканер",
      energy: "Аккумулятор",
      recovery: "Зарядный модуль",
      idle: "Генератор",
    })
      .map(([k, n]) => {
        const cost = Math.floor(250 * 1.72 ** lv[k]);
        return `<div class="upgrade"><b>${n} · LV ${lv[k]}</b><p>${descriptions[k]}</p><button data-upgrade="${k}" ${Number(p.mogg_points || 0) < cost ? "disabled" : ""}>${fmt(cost)} Points</button></div>`;
      })
      .join("");
    document.querySelectorAll("[data-upgrade]").forEach((b) => {
      const upgrade = async () => {
        if (!ensureProfile(upgrade)) return;
        b.disabled = true;
        try {
          await flushTaps();
          await call("buy_upgrade", { kind: b.dataset.upgrade });
          await refresh();
          toast("Модуль улучшен");
        } catch (e) {
          toast(errorText(e));
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      };
      b.onclick = upgrade;
    });
  }
  function ensureProfile(next) {
    if (!requireTelegram()) return false;
    if (!state.player?.gender || !state.player?.profile_photo_url) {
      pendingAction = next;
      openOnboarding();
      return false;
    }
    return true;
  }
  $("tapBtn").onclick = (e) => {
    if (!ensureProfile(() => openView("tasks"))) return;
    const pending = tapCount + (tapBatch?.count || 0);
    if (Number(state.player.energy || 0) <= pending) {
      toast("Энергия восстанавливается. Можно голосовать за бои.");
      return;
    }
    if (tapCount >= 20) return;
    tapCount++;
    renderLab();
    const r = e.currentTarget.getBoundingClientRect(),
      floating = document.createElement("span");
    floating.className = "tap-float";
    floating.textContent = "+" + (state.player.tap_power || 1);
    floating.style.left = r.left + r.width / 2 - 10 + "px";
    floating.style.top = r.top + 45 + "px";
    document.body.appendChild(floating);
    setTimeout(() => floating.remove(), 650);
    tg?.HapticFeedback?.impactOccurred("light");
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => flushTaps(), 300);
    if (tapCount >= 8) flushTaps();
  };
  async function flushTaps() {
    if (tapSending) return;
    clearTimeout(tapTimer);
    if (!tapBatch && tapCount) {
      tapBatch = { key: crypto.randomUUID(), count: Math.min(20, tapCount) };
      tapCount -= tapBatch.count;
    }
    if (!tapBatch) return;
    tapSending = true;
    try {
      const d = await call("tap_batch", {
        request_key: tapBatch.key,
        count: tapBatch.count,
      });
      state.player = { ...d.player, style: state.player.style };
      tapBatch = null;
      renderPlayer();
      if (d.accepted === 0) toast("Сделай паузу: энергия и темп ограничены.");
    } catch (e) {
      if (
        ["request_timeout", "invalid_response", "Failed to fetch"].includes(
          e.message,
        )
      ) {
        toast("Связь прервалась. Тапы отправим повторно.");
      } else {
        tapBatch = null;
        tapCount = 0;
        toast(errorText(e));
      }
    } finally {
      tapSending = false;
      if (tapBatch || tapCount) tapTimer = setTimeout(() => flushTaps(), 1200);
    }
  }
  $("labDaily").onclick = async () => {
    if (!ensureProfile(() => $("labDaily").click())) return;
    $("labDaily").disabled = true;
    try {
      await call("claim_prestige");
      await refresh();
      toast("Бонус LAB получен");
    } catch (e) {
      toast(
        e.message === "already_claimed"
          ? "Сегодня бонус уже получен"
          : errorText(e),
      );
    } finally {
      $("labDaily").disabled = false;
    }
  };

  function bundleParts(c) {
    return state.bundles
      .filter((x) => x.bundle_id === c.id)
      .map((x) => state.shop.find((s) => s.id === x.cosmetic_id))
      .filter(Boolean);
  }
  function preview(c) {
    const p = state.player || {},
      k = key(c);
    if (c.kind === "frame") return portrait(p, c);
    if (c.kind === "profile_bg")
      return `<div class="bg-${k}">${portrait(p, null)}</div>`;
    if (c.kind === "title")
      return `<span class="cosmeticTitle title-${k}">${escape(c.name)}</span>`;
    if (c.kind === "name_style")
      return `<b class="name-${k}">${escape(name(p))}</b>`;
    if (c.kind === "score_style") return `<b class="score-${k}">1 700</b>`;
    return `<b class="intro-${k}">${escape(c.name)}</b>`;
  }
  function renderShop() {
    const owned = new Set(state.inventory.map((x) => x.cosmetics?.id)),
      sets = state.shop.filter(
        (c) => c.collection === "sets" && Number(c.price_stars) > 0,
      );
    $("sets").innerHTML = sets
      .map((c) => {
        const group = c.code.includes("chrome")
          ? "chrome-set"
          : c.code.includes("apex")
            ? "apex-set"
            : "";
        return `<article class="set-card"><div class="set-showroom ${group}">${portrait(state.player, c)}<div class="set-words"><span class="eyebrow">MOGG / FULL LOOK</span><h3>${escape(c.name).replace(" ", "<br>")}</h3><span class="set-parts">Рамка + фон + титул<br>Один набор. Цельный образ.</span></div></div><div class="set-bottom"><button class="secondary" data-try="${escape(c.id)}">Примерить</button><button class="primary" data-buy="${escape(c.id)}" ${owned.has(c.id) ? "disabled" : ""}>${owned.has(c.id) ? "В коллекции" : fmt(c.price_stars) + " Stars"}</button></div></article>`;
      })
      .join("");
    let items = state.shop.filter(
      (c) =>
        !["sets", "set_items", "first_steps", "top1", "top10"].includes(
          c.collection,
        ) &&
        !["reaction", "victory_card"].includes(c.kind) &&
        ((c.is_purchasable && Number(c.price_points) > 0) ||
          Number(c.price_stars) > 0),
    );
    if (state.kindFilter === "other")
      items = items.filter(
        (c) => !["frame", "profile_bg", "title"].includes(c.kind),
      );
    else if (state.kindFilter !== "all")
      items = items.filter((c) => c.kind === state.kindFilter);
    items.sort(
      (a, b) =>
        Number(a.price_stars > 0) - Number(b.price_stars > 0) ||
        Number(a.price_points || a.price_stars) -
          Number(b.price_points || b.price_stars),
    );
    $("shop").innerHTML =
      items.map((c) => itemCard(c, owned.has(c.id))).join("") ||
      '<p class="muted">В этой категории пока нет предметов.</p>';
    bindShop();
  }
  function itemCard(c, isOwned = false, inventory = false) {
    const equipped = state.player?.[field[c.kind]] === c.id;
    return `<article class="item"><div class="item-preview">${preview(c)}</div><b class="item-name">${escape(c.name)}</b><span class="item-kind">${escape(kindName[c.kind] || "Стиль")}${Number(c.price_stars) > 0 ? " · Stars" : ""}</span><div class="item-actions"><button data-try="${escape(c.id)}">Примерить</button>${inventory ? `<button class="${equipped ? "equipped" : ""}" data-equip="${escape(c.id)}" ${["reaction", "victory_card"].includes(c.kind) ? "disabled" : ""}>${["reaction", "victory_card"].includes(c.kind) ? "Архивный предмет" : equipped ? "Снять" : "Надеть"}</button>` : `<button class="purchase" data-buy="${escape(c.id)}" ${isOwned ? "disabled" : ""}>${isOwned ? "В коллекции" : Number(c.price_stars) > 0 ? fmt(c.price_stars) + " Stars" : fmt(c.price_points) + " Points"}</button>`}</div></article>`;
  }
  function renderInventory() {
    $("ownedCount").textContent = state.inventory.length;
    $("inventory").innerHTML = state.inventory.length
      ? state.inventory.map((x) => itemCard(x.cosmetics, true, true)).join("")
      : '<div class="empty"><b>Твой стиль начинается здесь</b><p>Первый голос открывает рамку FIRST LIGHT.</p><button class="secondary" id="firstVote">На арену ↗</button></div>';
    $("firstVote")?.addEventListener("click", () => openView("arena"));
    bindShop();
  }
  function bindShop() {
    document
      .querySelectorAll("[data-try]")
      .forEach((b) => (b.onclick = () => tryOn(b.dataset.try)));
    document
      .querySelectorAll("[data-buy]")
      .forEach((b) => (b.onclick = () => buy(b.dataset.buy)));
    document.querySelectorAll("[data-equip]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!requireTelegram()) return;
          b.disabled = true;
          try {
            await call("equip", { cosmetic_id: b.dataset.equip });
            await refresh();
            toast("Стиль обновлён");
          } catch (e) {
            toast(errorText(e));
          } finally {
            if (b.isConnected) b.disabled = false;
          }
        }),
    );
  }
  function showOwned() {
    document
      .querySelectorAll("[data-store]")
      .forEach((x) =>
        x.classList.toggle("selected", x.dataset.store === "owned"),
      );
    $("shopPanel").hidden = true;
    $("ownedPanel").hidden = false;
  }
  document.querySelectorAll("[data-store]").forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.store === "owned") showOwned();
        else {
          document
            .querySelectorAll("[data-store]")
            .forEach((x) => x.classList.toggle("selected", x === b));
          $("shopPanel").hidden = false;
          $("ownedPanel").hidden = true;
        }
      }),
  );
  document.querySelectorAll("[data-kind]").forEach(
    (b) =>
      (b.onclick = () => {
        state.kindFilter = b.dataset.kind;
        document
          .querySelectorAll("[data-kind]")
          .forEach((x) => x.classList.toggle("selected", x === b));
        renderShop();
      }),
  );
  function tryOn(id) {
    const c =
      state.shop.find((x) => x.id === id) ||
      state.inventory.find((x) => x.cosmetics.id === id)?.cosmetics;
    if (!c) return;
    const parts = bundleParts(c),
      p = { ...state.player, style: { ...(state.player?.style || {}) } };
    for (const item of [c, ...parts]) p.style[item.kind] = item;
    showModal(
      "ПРИМЕРКА / " + (kindName[c.kind] || "СТИЛЬ"),
      `<h2>${escape(c.name)}</h2><div class="try-hero ${p.style.profile_bg ? "bg-" + key(p.style.profile_bg) : ""}">${portrait(p)}<h3 class="${p.style.name_style ? "name-" + key(p.style.name_style) : ""}">${escape(name(p))}</h3>${title(p)}${parts.length ? '<div class="bundle-parts">Рамка · фон · титул</div>' : ""}</div><p>Так оформление выглядит с твоим фото. Примерка бесплатна.</p><button id="tryPurchase" class="primary">${state.inventory.some((x) => x.cosmetics.id === id) ? "Открыть коллекцию" : Number(c.price_stars) > 0 ? "Купить за " + fmt(c.price_stars) + " Stars" : Number(c.price_points) > 0 ? "Купить за " + fmt(c.price_points) + " Points" : "На арену"}</button>`,
    );
    $("tryPurchase").onclick = () => {
      if (state.inventory.some((x) => x.cosmetics.id === id)) {
        closeModal();
        openView("style");
        showOwned();
      } else if (Number(c.price_stars) > 0 || Number(c.price_points) > 0)
        buy(id);
      else {
        closeModal();
        openView("arena");
      }
    };
  }
  async function buy(id) {
    if (!ensureProfile(() => buy(id))) return;
    const c = state.shop.find((x) => x.id === id);
    if (!c) return;
    if (state.inventory.some((x) => x.cosmetics.id === id)) {
      toast("Уже в коллекции");
      return;
    }
    if (Number(c.price_stars) > 0) {
      showModal(
        "ПОКУПКА / TELEGRAM STARS",
        `<h2>${escape(c.name)}</h2><div class="try-hero">${preview(c)}</div><p>${bundleParts(c).length ? "В наборе: рамка, фон и титул. Все три предмета останутся в твоей коллекции." : "Предмет останется в твоей коллекции."} Цена: ${fmt(c.price_stars)} Stars.</p><label class="check-row"><input id="purchaseConsent" type="checkbox"><span>Прочитал <a href="rules.html#purchases" target="_blank" rel="noopener">условия покупки и возвратов</a>.</span></label><button id="confirmPurchase" class="primary" disabled>Перейти к оплате · ${fmt(c.price_stars)} Stars</button><p id="purchaseStatus" role="status"></p>`,
      );
      $("purchaseConsent").onchange = () =>
        ($("confirmPurchase").disabled = !$("purchaseConsent").checked);
      $("confirmPurchase").onclick = async () => {
        $("confirmPurchase").disabled = true;
        try {
          const d = await call("create_star_invoice", {
            cosmetic_id: id,
            terms_version: "2026-09-30",
          });
          track("invoice_open");
          tg.openInvoice(d.invoice_url, (status) => {
            if (status === "paid") {
              closeModal();
              toast("Оплата принята. Проверяем доставку…");
              waitForPurchase(id);
            } else if (status === "failed") {
              $("purchaseStatus").textContent =
                "Платёж не прошёл. Можно попробовать ещё раз.";
              $("confirmPurchase").disabled = false;
            } else {
              $("purchaseStatus").textContent =
                status === "pending"
                  ? "Telegram обрабатывает платёж. Предмет появится после подтверждения."
                  : "Оплата отменена. Списание не подтверждено.";
              $("confirmPurchase").disabled = false;
            }
          });
        } catch (e) {
          $("purchaseStatus").textContent = errorText(e);
          $("confirmPurchase").disabled = false;
        }
      };
    } else {
      try {
        await flushTaps();
        await call("buy_cosmetic", { cosmetic_id: id });
        await refresh();
        toast("Предмет в коллекции");
        closeModal();
        showOwned();
      } catch (e) {
        toast(errorText(e));
      }
    }
  }
  async function waitForPurchase(id) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await refresh();
      if (state.inventory.some((x) => x.cosmetics?.id === id)) {
        toast("Покупка доставлена · можно надеть");
        openView("style");
        showOwned();
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    toast("Платёж проверяется. Статус обновится; помощь — в профиле.");
  }

  function openOnboarding() {
    track("onboarding_open");
    gender = state.player?.gender || null;
    photoFile = null;
    if (photoURL) {
      URL.revokeObjectURL(photoURL);
      photoURL = null;
    }
    $("photoInput").value = "";
    $("photoConsent").checked = false;
    $("photoPreview").hidden = true;
    $("photoPickerText").hidden = false;
    $("photoFeedback").textContent = "JPEG / PNG / WEBP · до 5 МБ";
    document
      .querySelectorAll("[data-gender]")
      .forEach((b) =>
        b.classList.toggle("selected", b.dataset.gender === gender),
      );
    $("savePhoto").disabled = true;
    if (!$("onboarding").open) $("onboarding").showModal();
  }
  function photoReady() {
    $("savePhoto").disabled =
      !gender || !photoFile || !$("photoConsent").checked;
  }
  document.querySelectorAll("[data-gender]").forEach(
    (b) =>
      (b.onclick = () => {
        gender = b.dataset.gender;
        document
          .querySelectorAll("[data-gender]")
          .forEach((x) => x.classList.toggle("selected", x === b));
        photoReady();
      }),
  );
  $("photoConsent").onchange = photoReady;
  $("onboardClose").onclick = () => {
    pendingAction = null;
    $("onboarding").close();
  };
  $("onboarding").addEventListener("cancel", () => {
    pendingAction = null;
  });
  $("photoInput").onchange = () => {
    const f = $("photoInput").files?.[0];
    photoFile = null;
    $("photoPreview").hidden = true;
    $("photoPickerText").hidden = false;
    photoReady();
    if (!f) return;
    if (
      f.size > 5 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(f.type)
    ) {
      toast("Нужно фото JPEG, PNG или WEBP до 5 МБ.");
      return;
    }
    photoFile = f;
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = URL.createObjectURL(f);
    $("photoPreview").src = photoURL;
    $("photoPreview").hidden = false;
    $("photoPickerText").hidden = true;
    photoReady();
  };
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  async function resizedPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (
        !image.naturalWidth ||
        image.naturalWidth * image.naturalHeight > 40_000_000
      )
        throw new Error("invalid_photo");
      const ratio = Math.min(
        1,
        1280 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      context.fillStyle = "#101211";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  $("savePhoto").onclick = async () => {
    if (!gender || !photoFile || !$("photoConsent").checked) return;
    $("savePhoto").disabled = true;
    $("photoFeedback").textContent = "Сохраняем профиль…";
    try {
      await call("set_gender", { gender });
      await call("upload_photo", {
        mime: "image/jpeg",
        base64: await resizedPhoto(photoFile),
        photo_consent: true,
      });
      $("onboarding").close();
      await refresh();
      toast("Фото готово. Твой ход!");
      const next = pendingAction;
      pendingAction = null;
      if (next) next();
    } catch (e) {
      $("photoFeedback").textContent = errorText(e);
      photoReady();
    }
  };
  $("changePhoto").onclick = () => {
    if (requireTelegram()) {
      pendingAction = null;
      openOnboarding();
    }
  };

  async function startMatch(mode) {
    if (!ensureProfile(() => startMatch(mode)) || matchBusy) return;
    matchBusy = true;
    clearTimeout(matchTimer);
    $("quickBtn").disabled = true;
    $("rankedBtn").disabled = true;
    if ($("startPractice")) $("startPractice").disabled = true;
    $("matchStatus").textContent =
      mode === "practice"
        ? "Готовим тренировку с виртуальным соперником…"
        : mode === "quick"
          ? "Ищем игрока для минутной дуэли…"
          : "Ищем игрока для рейтингового боя…";
    let until = Date.now() + 30000;
    async function search() {
      try {
        const d = await call("open_matchmaking", {
          mode: mode === "practice" ? "quick" : mode,
          ...(mode === "practice" ? { opponent: "practice" } : {}),
        });
        if (d.unavailable) {
          $("matchStatus").textContent =
            "Тренировка сейчас недоступна. Попробуй вызвать друга.";
          finish();
          return;
        }
        if (d.votes_required) {
          $("matchStatus").textContent =
            "Перед следующим рейтинговым боем выбери победителя ещё в " +
            d.votes_required +
            " чужих боях.";
          finish();
          return;
        }
        if (d.matched) {
          await refresh();
          $("matchStatus").textContent = practice(d.battle)
            ? "Тренировочный соперник найден. Голосуют только люди."
            : "Бой найден. Пусть люди выберут победителя.";
          openView("arena");
          finish();
          return;
        }
        if (mode === "ranked") {
          state.rankedQueue = d.request;
          renderQueue();
          $("matchStatus").textContent =
            "Заявка принята. Можно выйти — поиск продолжается.";
          finish();
          return;
        }
        if (Date.now() < until) {
          matchTimer = setTimeout(search, 2500);
        } else {
          $("matchStatus").textContent =
            "Соперник пока не найден. Попробуй вызвать друга.";
          finish();
        }
      } catch (e) {
        $("matchStatus").textContent = errorText(e);
        finish();
      }
    }
    function finish() {
      matchBusy = false;
      $("quickBtn").disabled = false;
      $("rankedBtn").disabled = false;
      if ($("startPractice")) $("startPractice").disabled = false;
    }
    search();
  }
  $("quickBtn").onclick = () => startMatch("quick");
  $("rankedBtn").onclick = () => startMatch("ranked");
  function renderQueue() {
    const q = state.rankedQueue;
    $("rankedQueue").innerHTML =
      q && new Date(q.expires_at) > new Date()
        ? '<div class="queue">Поиск продолжается, даже если закрыть игру.<button id="cancelQueue" class="secondary">Снять заявку</button></div>'
        : "";
    $("cancelQueue")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        await call("cancel_ranked");
        state.rankedQueue = null;
        renderQueue();
        toast("Заявка снята");
      } catch (e) {
        toast(errorText(e));
      }
    });
  }
  function shareLink(text, url) {
    const share =
      "https://t.me/share/url?url=" +
      encodeURIComponent(url) +
      "&text=" +
      encodeURIComponent(text);
    openTelegram(share);
  }
  function refURL() {
    return BOT + "?startapp=ref_" + String(state.player?.telegram_id || "");
  }
  async function createDuel() {
    if (!ensureProfile(createDuel)) return;
    $("friendBtn").disabled = true;
    try {
      const d = await call("create_duel");
      showModal(
        "ПЕРСОНАЛЬНЫЙ ВЫЗОВ",
        `<h2>Кто могнет кого?</h2><div class="invite-preview">${portrait(state.player)}</div><p>Отправь другу вызов. После принятия — минутный бой. Ссылка на голосование появится в игре.</p><button id="sendDuel" class="primary">Отправить вызов ↗</button><button id="copyDuel" class="secondary">Скопировать ссылку</button>`,
      );
      $("sendDuel").onclick = () => {
        track("share_duel");
        shareLink(
          name(state.player) + " вызывает тебя на MOGG-батл. Принимаешь?",
          d.url,
        );
      };
      $("copyDuel").onclick = async () => {
        try {
          await navigator.clipboard.writeText(d.url);
          toast("Ссылка скопирована");
        } catch {
          showModal(
            "ССЫЛКА НА ВЫЗОВ",
            `<p style="overflow-wrap:anywhere">${escape(d.url)}</p><button class="primary" id="sendDuelFallback">Отправить в Telegram ↗</button>`,
          );
          $("sendDuelFallback").onclick = () =>
            shareLink("Принимаешь MOGG-вызов?", d.url);
        }
      };
    } catch (e) {
      toast(errorText(e));
    } finally {
      $("friendBtn").disabled = false;
    }
  }
  $("friendBtn").onclick = createDuel;
  $("shareInvite").onclick = () => {
    if (!requireTelegram()) return;
    const url = refURL();
    showModal(
      "ПРИГЛАШЕНИЕ / +100 POINTS ОБОИМ",
      `<h2>Позови друга на арену</h2><p>Фото-дуэль длится минуту. Победителя выбирают голоса людей.</p><p>Если новый друг зайдёт по твоей ссылке и создаст профиль со своим фото, вы оба получите по 100 Points на оформление. Одного перехода недостаточно. Points — игровые очки.</p><label for="personalInvite">Твоя персональная ссылка</label><input id="personalInvite" readonly value="${escape(url)}" style="width:100%;box-sizing:border-box"><button id="sendReferral" class="primary">Отправить приглашение ↗</button><button id="copyReferral" class="secondary">Скопировать ссылку</button>`,
    );
    $("sendReferral").onclick = () =>
      shareLink(
        "Давай фото-батл в Telegram? Вызываем друг друга, беседа выбирает победителя за минуту. Это моя рефка: после твоего первого профиля со своим фото нам обоим дадут по 100 игровых Points на оформление.",
        url,
      );
    $("copyReferral").onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast("Персональная ссылка скопирована");
      } catch {
        $("personalInvite").focus();
        $("personalInvite").select();
        toast("Скопируй выделенную ссылку вручную");
      }
    };
  };
  function uuidFromStart(value) {
    return /^[a-f0-9]{32}$/i.test(value)
      ? value.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
      : null;
  }
  async function handleStart() {
    const start =
      new URLSearchParams(tg?.initData || "").get("start_param") ||
      tg?.initDataUnsafe?.start_param ||
      "";
    if (start.startsWith("duel_")) {
      const token = uuidFromStart(start.slice(5));
      if (token) {
        try {
          const d = await call("duel_info", { token });
          state.invite = d;
          renderInvite();
        } catch (e) {
          toast(errorText(e));
        }
      }
    } else if (start.startsWith("battle_")) {
      const id = uuidFromStart(start.slice(7));
      if (id) {
        try {
          const d = await call("battle_info", { battle_id: id });
          if (d.battle && live(d.battle)) {
            state.feed = [d.battle, ...state.feed.filter((b) => b.id !== id)];
            renderFeed();
          } else if (d.battle) {
            state.lastBattle = d.battle;
            renderLastBattle();
            toast("Этот бой уже завершён. Итог можно посмотреть в профиле.");
            openView("profile");
          }
        } catch (e) {
          toast(errorText(e));
        }
      }
    }
  }
  function renderInvite() {
    const d = state.invite;
    if (!d) return;
    $("inviteBanner").hidden = false;
    $("inviteBanner").className = "invite-banner";
    const valid =
      !d.invite.accepted_by && new Date(d.invite.expires_at) > new Date();
    $("inviteBanner").innerHTML =
      `<h2>${escape(name(d.player))} вызывает тебя</h2><p>${valid ? "Минутный бой. Рейтинг сохраняется." : "Этот вызов уже принят или истёк."}</p>${valid ? '<button id="acceptDuel" class="primary">Принять вызов ↗</button>' : ""}`;
    $("acceptDuel")?.addEventListener("click", async () => {
      if (!ensureProfile(() => $("acceptDuel")?.click())) return;
      $("acceptDuel").disabled = true;
      try {
        await call("accept_duel", { token: d.invite.token });
        state.invite = null;
        $("inviteBanner").hidden = true;
        await refresh();
        toast("Дуэль началась · позови друзей голосовать");
      } catch (e) {
        toast(errorText(e));
        if ($("acceptDuel")) $("acceptDuel").disabled = false;
      }
    });
  }

  function resultTitle(b) {
    if (b.result_reason === "insufficient_votes") return "Не хватило голосов";
    if (b.result_reason === "delivery_failed") return "Бой не начался";
    if (!b.winner_id) return "Ничья";
    return b.winner_id === state.player?.id
      ? "Ты забрал этот батл"
      : "В этот раз сильнее соперник";
  }
  function renderLastBattle() {
    const b = state.lastBattle;
    if (!b) {
      $("lastBattle").innerHTML = "";
      return;
    }
    const delta =
      Number(
        b.player_a === state.player?.id ? b.score_delta_a : b.score_delta_b,
      ) || 0;
    $("lastBattle").innerHTML =
      `<div class="result-card"><span class="eyebrow">ПОСЛЕДНИЙ БАТЛ</span><h2>${escape(resultTitle(b))}</h2><p>${escape(name(b.a))} / ${escape(name(b.b))}<br>${b.result_reason === "insufficient_votes" ? "Итог без победителя. Рейтинг сохранён." : `${Number(b.votes_a || 0)} : ${Number(b.votes_b || 0)} голосов · ${delta > 0 ? "+" : ""}${delta} рейтинга`}</p>${b.winner_id === state.player?.id ? '<button id="shareLastResult" class="secondary">Поделиться победой ↗</button>' : '<button id="rematch" class="secondary">Новый вызов другу ↗</button>'}</div>`;
    $("shareLastResult")?.addEventListener("click", () => shareCard(true));
    $("rematch")?.addEventListener("click", createDuel);
  }
  function resultPopup(b) {
    showModal(
      "БАТЛ / ИТОГ",
      `<div class="result-modal-symbol">${b.winner_id === state.player?.id ? "↗" : "VS"}</div><h2 class="result-modal-title">${escape(resultTitle(b))}</h2><p class="result-modal-detail">${b.result_reason === "insufficient_votes" ? "Голосов недостаточно. Можно попробовать снова или позвать друзей." : fmt(b.votes_a) + " : " + fmt(b.votes_b) + " · выбор игроков"}</p><button id="resultAction" class="primary">${b.winner_id === state.player?.id ? "Поделиться победой ↗" : "Вернуться на арену"}</button>`,
    );
    $("resultAction").onclick = () => {
      if (b.winner_id === state.player?.id) shareCard(true);
      else {
        closeModal();
        openView("arena");
      }
    };
  }
  function renderRankReward() {
    const d = state.drops || {};
    const available = d.next_tier;
    $("rankReward").innerHTML =
      `<b>${available ? "Награда за ранг готова" : "Продолжай свой путь"}</b><p>${available ? "Открой предмет за достигнутый ранг." : "Первая награда за рейтинг — с SUB5, 700 очков. Первую рамку можно получить сразу за голосование."}</p><button id="openDrop" class="${available ? "primary" : "secondary"}" ${!available ? "disabled" : ""}>${available ? "Забрать предмет ↗" : "Ранговая награда пока закрыта"}</button>`;
    $("openDrop").onclick = async () => {
      if (!requireTelegram()) return;
      $("openDrop").disabled = true;
      try {
        const d = await call("open_drop");
        await refresh();
        if (d.compensation) {
          toast("Предмет уже есть · +" + d.compensation + " Points");
          return;
        }
        const c = d.drop?.cosmetics;
        if (c) {
          showModal(
            "НОВЫЙ ПРЕДМЕТ",
            `<h2>${escape(c.name)}</h2><div class="try-hero">${preview(c)}</div><p>Предмет уже в твоей коллекции.</p><button id="dropCollection" class="primary">Открыть коллекцию ↗</button>`,
          );
          $("dropCollection").onclick = () => {
            closeModal();
            openView("style");
            showOwned();
          };
        } else toast("Награда получена");
      } catch (e) {
        toast(errorText(e));
      }
    };
  }
  $("rankGuide").onclick = () => {
    const p = state.player || {},
      r = ranks[p.gender] || ranks.male;
    showModal(
      "ЛИГИ / MOGG BATTLE",
      `<h2>Твой путь</h2><p>Ранг — игровой результат голосований. Он не является объективной оценкой внешности.</p>${r.map((n, i) => `<div class="rank-row ${rank(p) === n ? "current" : ""}"><b>${n}</b><span>${fmt(cuts[i])}${i === 12 ? "+" : "–" + fmt(cuts[i + 1] - 1)}</span></div>`).join("")}`,
    );
  };

  $("dailyBtn").onclick = async () => {
    if (!ensureProfile(() => $("dailyBtn").click())) return;
    showModal(
      "MOGG DAILY / БЕСПЛАТНО",
      `<h2>Твой ежедневный приз</h2><p>Один бесплатный спин. Points, энергия или косметика.</p><div id="spinDisc" class="spin-disc" aria-hidden="true"></div><p id="spinResult" class="spin-result" role="status"></p><button id="spinRun" class="primary" disabled>Проверяем…</button><details class="odds"><summary>Призы и шансы</summary><p>50 P — 18%; 75 P — 15%; 100 P — 15%; 150 P — 10%; 200 P — 8%; 400 P — 3%; 20 энергии — 10%; 50 энергии — 6%; 100 P + 20 энергии — 5%; рамка — 4%; фон — 3%; титул — 3%.</p><p>Цветные сектора — оформление, а не вероятности. При отсутствии нового подходящего предмета: 150 Points. Лишняя энергия превращается в Points 1:1. Токены MOGG в призах отсутствуют.</p></details>`,
    );
    try {
      const d = await call("daily_spin_status");
      if (!$("spinRun")) return;
      $("spinRun").disabled = d.claimed;
      $("spinRun").textContent = d.claimed
        ? "Сегодня уже получено"
        : "Крутить бесплатно ↗";
      if (d.prize) $("spinResult").textContent = prizeText(d.prize);
      $("spinRun").onclick = async () => {
        $("spinRun").disabled = true;
        modalLocked = true;
        $("modalClose").disabled = true;
        try {
          const d = await call("daily_spin_v2");
          if (
            !d.replayed &&
            !matchMedia("(prefers-reduced-motion:reduce)").matches
          ) {
            $("spinDisc").classList.add("spinning");
            await new Promise((r) => setTimeout(r, 2200));
          }
          $("spinResult").textContent = prizeText(d.prize);
          $("spinRun").textContent = "На сегодня получено";
          await refresh();
        } catch (e) {
          $("spinResult").textContent = errorText(e);
          $("spinRun").disabled = false;
          $("spinRun").textContent = "Повторить безопасно";
        } finally {
          modalLocked = false;
          $("modalClose").disabled = false;
        }
      };
    } catch (e) {
      $("spinResult").textContent = errorText(e);
      $("spinRun").textContent = "Закрой и попробуй ещё раз";
    }
  };
  function prizeText(p) {
    if (!p) return "";
    return (
      p.cosmetic_name ||
      [
        p.points ? "+" + p.points + " Points" : "",
        p.energy ? "+" + p.energy + " энергии" : "",
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }

  function imageLoad(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }
  async function makeShareCard(win) {
    const p = state.player,
      c = document.createElement("canvas");
    c.width = 900;
    c.height = 1200;
    const ctx = c.getContext("2d");
    ctx.fillStyle =
      { midnight: "#221d32", liquidchrome: "#252b34", goldroom: "#302719" }[
        key(p.style?.profile_bg)
      ] || "#101211";
    ctx.fillRect(0, 0, 900, 1200);
    ctx.fillStyle = "#d9ff67";
    ctx.font = "900 49px Arial";
    ctx.fillText("MOGG BATTLE", 60, 95);
    ctx.fillStyle = "#9ca78f";
    ctx.font = "20px monospace";
    ctx.fillText(win ? "THIS ROUND IS MINE." : "MAKE YOUR MOVE.", 60, 138);
    const photo = safePhoto(p.profile_photo_url);
    if (photo) {
      const img = await imageLoad(photo);
      const scale = Math.max(780 / img.width, 680 / img.height),
        w = img.width * scale,
        h = img.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(60, 187, 780, 680, 20);
      ctx.clip();
      ctx.drawImage(img, 60 + (780 - w) / 2, 187 + (680 - h) / 2, w, h);
      ctx.restore();
    }
    const color =
      { afterhours: "#c9a3ff", chromeclub: "#dbe5ee", apex: "#eec973" }[
        key(p.style?.frame)
      ] || "#d9ff67";
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(60, 187, 780, 680, 20);
    ctx.stroke();
    ctx.fillStyle = "#f1f1e8";
    ctx.font = "900 52px Arial";
    let text = name(p);
    while (ctx.measureText(text).width > 775 && text.length > 4)
      text = text.slice(0, -2) + "…";
    ctx.fillText(text, 60, 953);
    ctx.fillStyle = color;
    ctx.font = "700 29px Arial";
    ctx.fillText(p.style?.title?.name || rankLabel(p), 60, 1001);
    ctx.fillStyle = "#d9ff67";
    ctx.font = "900 39px Arial";
    ctx.fillText(
      win ? "Я ЗАБРАЛ ЭТОТ БАТЛ." : "СМОЖЕШЬ МОГНУТЬ МЕНЯ?",
      60,
      1085,
    );
    ctx.fillStyle = "#9ca78f";
    ctx.font = "20px monospace";
    ctx.fillText("@MoggBattleGameBot", 60, 1142);
    return c.toDataURL("image/png");
  }
  async function shareCard(win = false) {
    if (!ensureProfile(() => shareCard(win))) return;
    showModal(
      "ТВОЯ КАРТОЧКА / ПОДЕЛИТЬСЯ",
      '<h2>Твой ход — в беседу</h2><p id="cardStatus" role="status">Готовим карточку с твоим фото…</p><div id="cardPreview"></div><button id="cardLink" class="secondary">Отправить ссылку ↗</button>',
    );
    const text = win
      ? "Я забрал этот MOGG-батл. Сможешь повторить?"
      : "Сможешь могнуть меня? Залетай на MOGG BATTLE.";
    $("cardLink").onclick = () => shareLink(text, refURL());
    try {
      const dataURL = await makeShareCard(win);
      if (!$("cardPreview")) return;
      $("cardPreview").innerHTML =
        `<img class="share-preview" src="${dataURL}" alt="Твоя карточка MOGG BATTLE"><button id="cardSend" class="primary">Отправить карточку ↗</button><button id="cardStory" class="secondary">В историю ↗</button><a class="secondary" href="${dataURL}" download="MOGG-face-card.png">Скачать PNG</a>`;
      $("cardStatus").textContent =
        "Карточка содержит твоё фото и игровой результат.";
      let prepared = null;
      const prepare = async () => {
        if (!prepared)
          prepared = await call("prepare_share", {
            png: dataURL.split(",")[1],
            battle_id: win ? state.lastBattle?.id : null,
          });
        return prepared;
      };
      $("cardSend").onclick = async () => {
        $("cardSend").disabled = true;
        try {
          const d = await prepare();
          if (tg?.shareMessage && d.message_id)
            tg.shareMessage(d.message_id, (sent) => {
              if (sent) {
                track(win ? "share_result" : "share_profile");
                toast(
                  "Карточка отправлена. Друг сможет зайти по кнопке в ней.",
                );
              }
            });
          else shareLink(text, refURL());
        } catch (e) {
          toast(errorText(e));
        } finally {
          if ($("cardSend")) $("cardSend").disabled = false;
        }
      };
      $("cardStory").onclick = async () => {
        if (!tg?.shareToStory) {
          toast("Истории доступны в актуальном мобильном Telegram.");
          return;
        }
        $("cardStory").disabled = true;
        try {
          const d = await prepare();
          tg.shareToStory(d.image_url, { text: text + "\n" + refURL() });
        } catch (e) {
          toast(errorText(e));
        } finally {
          if ($("cardStory")) $("cardStory").disabled = false;
        }
      };
    } catch {
      if (!$("cardStatus")) return;
      $("cardStatus").textContent =
        "Карточку не удалось загрузить. Ссылку можно отправить прямо сейчас.";
    }
  }
  $("shareProfile").onclick = () => shareCard(false);

  function support(category = "other", message = "") {
    if (!requireTelegram()) return;
    showModal(
      "ПОМОЩЬ / MOGG LABS",
      `<h2>Есть вопрос?</h2><p>Поддержка: <a href="mailto:mogglabs@gmail.com">mogglabs@gmail.com</a></p><form id="supportForm" class="support-form"><label>Тема<select id="supportCategory"><option value="other">Другой вопрос</option><option value="report">Жалоба на фото или игрока</option><option value="payment">Покупка или возврат</option><option value="delete_photo">Удаление фото</option><option value="delete_account">Удаление аккаунта</option></select></label><label>Что произошло?<textarea id="supportMessage" required minlength="5" maxlength="1500" rows="4" placeholder="Опиши вопрос или причину жалобы"></textarea></label><button class="primary" id="supportSubmit" type="submit">Отправить обращение</button><p id="supportFeedback" role="status"></p></form><button id="supportHistory" class="secondary">Мои обращения</button><div id="supportHistoryList"></div><div class="support-actions"><button id="deletePhoto" class="delete-button">Удалить текущее фото и карточки</button><a href="rules.html" target="_blank" rel="noopener">Правила и сведения об операторе ↗</a></div>`,
    );
    $("supportCategory").value = category;
    $("supportMessage").value = message;
    let requestKey = null;
    $("supportForm").oninput = () => {
      requestKey = null;
    };
    $("supportForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("supportSubmit");
      if (btn.disabled) return;
      btn.disabled = true;
      requestKey = requestKey || crypto.randomUUID();
      try {
        const d = await call("support_submit", {
          category: $("supportCategory").value,
          message: $("supportMessage").value.trim(),
          request_key: requestKey,
        });
        $("supportFeedback").textContent =
          "Принято · №" +
          d.request.id.slice(0, 8) +
          ". Статус — в «Мои обращения».";
        $("supportMessage").value = "";
        requestKey = null;
      } catch (e) {
        $("supportFeedback").textContent = errorText(e);
      } finally {
        btn.disabled = false;
      }
    };
    $("supportHistory").onclick = async () => {
      try {
        const d = await call("support_list");
        $("supportHistoryList").innerHTML = d.requests.length
          ? d.requests
              .map(
                (r) =>
                  `<div class="support-ticket">№${escape(r.id.slice(0, 8))} · ${escape({ open: "Принято", in_progress: "В работе", resolved: "Закрыто" }[r.status] || r.status)}${r.response ? "<br>" + escape(r.response) : ""}</div>`,
              )
              .join("")
          : "<p>Пока нет обращений.</p>";
      } catch (e) {
        toast(errorText(e));
      }
    };
    $("deletePhoto").onclick = async () => {
      if (!state.player?.profile_photo_url) {
        toast("В профиле нет фото");
        return;
      }
      if (
        !confirm(
          "Удалить текущее фото и созданные карточки? Для участия в новых боях нужно будет загрузить другое фото. Очки и предметы сохранятся.",
        )
      )
        return;
      $("deletePhoto").disabled = true;
      try {
        const d = await call("delete_photo", {
          photo_url: state.player.profile_photo_url,
        });
        await refresh();
        toast(
          d.storage_removed
            ? "Фото удалено"
            : "Фото скрыто. Удаление файла продолжается.",
        );
        closeModal();
      } catch (e) {
        toast(errorText(e));
        if ($("deletePhoto")) $("deletePhoto").disabled = false;
      }
    };
  }
  $("supportBtn").onclick = () => support();
  $("guideBtn").onclick = () =>
    showModal(
      "БЫСТРЫЙ СТАРТ",
      `<h2>Три шага к батлу</h2><div class="guide-step"><span>01 / ВЫБИРАЙ</span><h3>Два фото. Один голос.</h3><p>Голосуй сразу, без загрузки фото. За голос — 2 Points. За первый голос можно забрать рамку и ещё 100 Points.</p></div><div class="guide-step"><span>02 / ВЫЗЫВАЙ</span><h3>Друг или случайный соперник</h3><p>Для участия добавь своё фото. Быстрый бой длится минуту. В обычном поиске соперники — игроки. Тренировку с виртуальным соперником можно запустить отдельно. Голосуют люди. Если голосов нет, победитель не назначается.</p></div><div class="guide-step"><span>03 / ВЫДЕЛЯЙСЯ</span><h3>Собери свой стиль</h3><p>Points получай за задания, голоса и в LAB. В магазине — оформление за Points или Stars. Набор содержит рамку, фон и титул. Рейтинг зависит от голосов игроков.</p></div><p>Добавь бота в беседу: /battle — минутная дуэль; /ranked — рейтинговый вызов. Рейтинговый бой ждёт 5 оценок, затем 10 минут, максимум сутки. Перед следующим рейтинговым боем оцени 3 чужих пары.</p>`,
    );

  function applyData(d, initial = false) {
    const old = lastResult;
    state.player = d.player;
    state.feed = d.feed || [];
    if (d.shop) state.shop = d.shop;
    if (d.bundles) state.bundles = d.bundles;
    state.inventory = d.inventory || [];
    state.daily = d.daily || {};
    state.drops = d.drops || {};
    state.rankedQueue = d.ranked_queue || null;
    state.lastBattle = d.last_battle || null;
    lastResult = d.last_battle?.id || null;
    renderPlayer();
    renderFeed();
    renderDaily();
    renderShop();
    renderInventory();
    renderRankReward();
    renderLastBattle();
    if (
      !initial &&
      old !== lastResult &&
      d.last_battle &&
      !$("modal").open &&
      !$("onboarding").open
    )
      resultPopup(d.last_battle);
  }
  async function refresh() {
    if (!ready || state.demo || refreshing || tapSending || document.hidden)
      return;
    refreshing = true;
    try {
      applyData(await call("me", { include_catalog: false }));
      $("connection").hidden = true;
    } catch (e) {
      $("connection").hidden = false;
      $("connectionText").textContent = errorText(e);
      if (e.message === "invalid_auth") {
        ready = false;
        $("retry").textContent = "Открыть в Telegram";
        $("retry").onclick = () => openTelegram(BOT + "?startapp");
      }
    } finally {
      refreshing = false;
    }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(
      async () => {
        if (!document.hidden) await refresh();
        schedulePoll();
      },
      state.feed.some((b) => live(b) && own(b)) || state.rankedQueue
        ? 6500
        : 25000,
    );
  }
  async function boot() {
    if (booting) return;
    booting = true;
    if (state.demo) {
      demo();
      ready = true;
      booting = false;
      return;
    }
    try {
      applyData(await call("me"), true);
      ready = true;
      $("connection").hidden = true;
      await handleStart();
      schedulePoll();
    } catch (e) {
      $("connection").hidden = false;
      $("connectionText").textContent = errorText(e);
      $("battleFeed").innerHTML =
        '<div class="empty"><b>Связь с ареной прервалась</b><p>Проверь интернет и нажми «Повторить».</p></div>';
    } finally {
      booting = false;
    }
  }
  $("retry").onclick = () => (ready ? refresh() : boot());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refresh();
      schedulePoll();
    } else flushTaps();
  });
  setInterval(() => {
    document
      .querySelectorAll("[data-ends]")
      .forEach((x) => (x.textContent = timeLeft(x.dataset.ends)));
  }, 1000);
  $("groupLink").onclick = (e) => {
    if (tg?.openTelegramLink) {
      e.preventDefault();
      openTelegram(e.currentTarget.href);
    }
  };
  function demo() {
    const c = (id, code, name, kind, stars, visual) => ({
      id,
      code,
      name,
      kind,
      price_stars: stars,
      price_points: 0,
      is_purchasable: true,
      collection: "sets",
      visual_key: visual,
    });
    state.shop = [
      c(
        "demo-night",
        "frame_afterhours",
        "AFTER HOURS",
        "frame",
        99,
        "afterhours",
      ),
      c(
        "demo-chrome",
        "frame_chromeclub",
        "CHROME CLUB",
        "frame",
        249,
        "chromeclub",
      ),
      c("demo-apex", "frame_apex", "APEX", "frame", 399, "apex"),
    ];
    state.player = {
      id: "demo",
      first_name: "Твой профиль",
      mogg_points: 0,
      mogg_score: 0,
      gender: "male",
      energy: 100,
      max_energy: 100,
      style: {},
      profile_photo_url: "npc/npc001.jpg",
    };
    state.feed = [
      {
        id: "demo-pair",
        player_a: "demo-a",
        player_b: "demo-b",
        a: {
          first_name: "ALEX",
          is_demo: true,
          profile_photo_url: "npc/npc003.jpg",
        },
        b: {
          first_name: "NICK",
          is_demo: true,
          profile_photo_url: "npc/npc005.jpg",
        },
        source: "demo",
        mode: "quick",
        status: "active",
        ends_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ];
    state.daily = { streak: 1, claimed: [] };
    $("demoBanner").hidden = false;
    renderPlayer();
    renderFeed();
    renderDaily();
    renderShop();
    renderInventory();
    renderRankReward();
    $("feedLabel").textContent = "Демо-пара";
    document.querySelectorAll("[data-ends]").forEach((x) => {
      x.removeAttribute("data-ends");
      x.textContent = "Демо";
    });
  }
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#101211");
      tg.setBackgroundColor("#101211");
      tg.setBottomBarColor?.("#101211");
    } catch {}
    const safe = () => {
      document.documentElement.style.setProperty(
        "--safe-top",
        Math.max(
          tg.safeAreaInset?.top || 0,
          tg.contentSafeAreaInset?.top || 0,
        ) + "px",
      );
      document.documentElement.style.setProperty(
        "--safe-bottom",
        Math.max(
          tg.safeAreaInset?.bottom || 0,
          tg.contentSafeAreaInset?.bottom || 0,
        ) + "px",
      );
    };
    safe();
    tg.onEvent?.("safeAreaChanged", safe);
    tg.onEvent?.("contentSafeAreaChanged", safe);
  }
  openView(location.hash.slice(1) || "arena");
  boot();
})();
