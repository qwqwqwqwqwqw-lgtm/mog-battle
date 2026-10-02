(() => {
  const $ = (id) => document.getElementById(id);
  const modes = {
    duel: {
      label: "ВЫЗОВ ПРИНЯТ?",
      heading: "КТО КОГО<br>МОГНЁТ?",
      copy: "Вызови друга. Бой длится минуту.<br>Победителя выбирают голоса людей.",
      cta: "ВЫЗОВИ ДРУГА ↗",
      footer: "t.me/MoggBattleGameBot",
      terms: "Играть бесплатно. Оформление — по желанию.",
      title: "Фото-батл",
      hint: "Для первого знакомства с игрой. Картинка показывает механику без выдуманных игроков и результатов.",
      caption:
        "Я сделал MOGG BATTLE — фото-дуэли с друзьями в Telegram. Вызываешь друга, люди голосуют, бой длится минуту. Играть можно бесплатно. Попробуй вызвать одного друга 👇\nhttps://t.me/MoggBattleGameBot?startapp=c_post01",
      note: "Это текст от создателя игры. Игроку стоит написать о своём настоящем опыте и добавить личную ссылку из профиля.",
    },
    style: {
      label: "ТВОЯ FACE CARD",
      heading: "ТВОЙ ПРОФИЛЬ.<br>ТВОЙ СТИЛЬ.",
      copy: "Фото, рамка, фон и титул.<br>Примерь оформление в MOGG BATTLE.",
      cta: "СОБЕРИ СВОЙ ОБРАЗ ↗",
      footer: "t.me/MoggBattleGameBot",
      terms: "Есть оформление за Points и за Stars.",
      title: "Face card",
      hint: "Показывает вторую причину зайти: оформить профиль и делиться своей карточкой. Иллюстрация условная; твоя настоящая карточка создаётся в игре.",
      caption:
        "В MOGG BATTLE можно собрать свою face card: фото, рамка, фон и титул. Примерка бесплатна, оформление есть за игровые Points и за Stars. А потом можно вызвать друга на фото-батл.\nhttps://t.me/MoggBattleGameBot?startapp=c_style01",
      note: "Лучший материал для этого захода — твоя настоящая карточка из игры. Этот пост подходит для знакомства с функцией.",
    },
    referral: {
      label: "ПРИГЛАСИ ДРУГА",
      heading: "+100 POINTS<br>КАЖДОМУ.",
      copy: "Новый друг заходит по твоей рефке<br>и создаёт профиль со своим фото.",
      cta: "ВОЗЬМИ ССЫЛКУ В ПРОФИЛЕ ↗",
      footer: "Играйте вместе в MOGG BATTLE",
      terms:
        "Points — игровые очки на оформление. Одного перехода недостаточно.",
      title: "Рефералка",
      hint: "Для настоящего игрока, который хочет поделиться своей ссылкой. Начисление — после первого профиля нового приглашённого со своим фото.",
      caption:
        "Давай фото-батл в Telegram? Это моя рефка: после твоего первого профиля со своим фото нам обоим дадут по 100 игровых Points на оформление. Потом вызовем друг друга, а друзья выберут победителя.\n[ВСТАВЬ СВОЮ ССЫЛКУ ИЗ ПРОФИЛЯ]",
      note: "Перед публикацией обязательно замени строку в квадратных скобках своей персональной ссылкой. Общая ссылка бота не начисляет реферальный бонус.",
    },
  };
  function select(mode) {
    const m = modes[mode];
    if (!m) return;
    $("poster").dataset.mode = mode;
    $("posterLabel").textContent = m.label;
    $("posterHeading").innerHTML = m.heading;
    $("posterCopy").innerHTML = m.copy;
    $("posterCTA").textContent = m.cta;
    $("posterFooter").textContent = m.footer;
    $("posterTerms").textContent = m.terms;
    $("materialTitle").textContent = m.title;
    $("materialHint").textContent = m.hint;
    $("caption").value = m.caption;
    $("note").textContent = m.note;
    $("download").href = "promo/post-" + mode + ".png";
    $("copyStatus").textContent = "";
    document.querySelectorAll("[data-mode]").forEach((b) => {
      if (b.tagName === "BUTTON") {
        b.classList.toggle("selected", b.dataset.mode === mode);
        b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
      }
    });
  }
  document
    .querySelectorAll("button[data-mode]")
    .forEach((b) => (b.onclick = () => select(b.dataset.mode)));
  $("copyCaption").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("caption").value);
      $("copyStatus").textContent = "Текст скопирован";
    } catch {
      $("caption").focus();
      $("caption").select();
      $("copyStatus").textContent = "Скопируй выделенный текст вручную";
    }
  };
  new ResizeObserver((entries) => {
    $("poster").style.setProperty(
      "--scale",
      entries[0].contentRect.width / 1080,
    );
  }).observe(document.querySelector(".poster-wrap"));
  const mode = new URLSearchParams(location.search).get("mode");
  select(modes[mode] ? mode : "duel");
})();
