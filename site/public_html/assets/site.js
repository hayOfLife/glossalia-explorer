(() => {
  const links = Array.from(document.querySelectorAll("[data-tab-link]"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const panelIds = new Set(panels.map((panel) => panel.id));
  const calendarGrid = document.getElementById("calendar-grid");
  const calendarMonthLabel = document.getElementById("calendar-month");
  const todayResults = document.getElementById("today-results");
  const newsResults = document.getElementById("news-results");
  const situationsResults = document.getElementById("situations-results");
  const moscowDateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const todayParts = Object.fromEntries(moscowDateParts.map((part) => [part.type, part.value]));
  const todayDate = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  let selectedDate = todayDate;
  let calendarYear = Number(todayParts.year);
  let calendarMonth = Number(todayParts.month);
  let entries = [];
  let loadFailed = false;
  const reactionApiUrl = "https://94-232-41-163.sslip.io/glossaliae/reactions";
  const reactionCounts = new Map();
  let reactionsAvailable = false;
  let sessionVoterId = null;
  const voterStorageKey = "glossaliae-voter-id";
  const voteStorageKey = "glossaliae-votes";
  const aliceLink = document.getElementById("alice-translation-link");
  const alicePromptStatus = document.getElementById("alice-prompt-status");

  async function prepareAliceLink() {
    try {
      const response = await fetch("data/promptForAlice_guessingTheMeaningOfTheGlossary.min.txt", { cache: "no-store" });
      if (!response.ok) throw new Error("Prompt unavailable");

      const prompt = (await response.text()).trim();
      if (!prompt) throw new Error("Prompt empty");

      aliceLink.href = `https://alice.yandex.ru/?alice_deeplink=${encodeURIComponent(JSON.stringify({ text: prompt }))}`;
      aliceLink.removeAttribute("aria-disabled");
      aliceLink.removeAttribute("tabindex");
      alicePromptStatus.textContent = "";
    } catch {
      alicePromptStatus.textContent = "Не удалось загрузить промпт. Скачайте полный файл ниже и вставьте его вручную.";
    }
  }

  prepareAliceLink();

  function readStoredVotes() {
    try {
      const votes = JSON.parse(localStorage.getItem(voteStorageKey) || "{}");
      return votes && typeof votes === "object" && !Array.isArray(votes) ? votes : {};
    } catch {
      return {};
    }
  }

  const ownVotes = readStoredVotes();

  function getVoterId() {
    let voterId;

    try {
      voterId = localStorage.getItem(voterStorageKey) || sessionVoterId;
    } catch {
      voterId = sessionVoterId;
    }

    if (!/^[0-9a-f]{32}$/.test(voterId || "")) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      voterId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      sessionVoterId = voterId;
      try {
        localStorage.setItem(voterStorageKey, voterId);
      } catch {
        // Без локального хранилища голос действует только в текущем сеансе
      }
    }

    return voterId;
  }

  function updateOneReactionControl(controls, key) {
    const counts = reactionCounts.get(key) || { likes: 0, dislikes: 0 };

    for (const button of controls.querySelectorAll("button")) {
      const vote = Number(button.dataset.vote);
      const count = vote === 1 ? counts.likes : counts.dislikes;
      button.disabled = !reactionsAvailable;
      button.setAttribute("aria-pressed", String(ownVotes[key] === vote));
      button.setAttribute("aria-label", `${vote === 1 ? "Нравится" : "Не нравится"}: ${controls.dataset.reactionTitle}, голосов: ${reactionsAvailable ? count : "недоступно"}`);
      button.querySelector("span").textContent = reactionsAvailable ? String(count) : "—";
    }

    controls.querySelector("[data-reaction-status]").textContent = reactionsAvailable
      ? ""
      : "Оценки временно недоступны";
  }

  function updateReactionControls(key) {
    for (const controls of document.querySelectorAll("[data-reaction-key]")) {
      if (controls.dataset.reactionKey === key) {
        updateOneReactionControl(controls, key);
      }
    }
  }

  async function submitReaction(key, vote, controls) {
    const nextVote = ownVotes[key] === vote ? 0 : vote;
    const buttons = controls.querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    controls.querySelector("[data-reaction-status]").textContent = "Сохраняем оценку…";

    try {
      const response = await fetch(reactionApiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ key, vote: nextVote, voterId: getVoterId() }),
        credentials: "omit",
        cache: "no-store",
      });

      if (!response.ok) {
        const error = new Error("Reaction request failed");
        error.rateLimited = response.status === 429;
        throw error;
      }

      const result = await response.json();
      reactionCounts.set(key, { likes: result.likes, dislikes: result.dislikes });
      ownVotes[key] = nextVote;
      try {
        localStorage.setItem(voteStorageKey, JSON.stringify(ownVotes));
      } catch {
        // Оценка сохранена на сервере и останется отмеченной до закрытия страницы
      }
      updateReactionControls(key);
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      controls.querySelector("[data-reaction-status]").textContent = error.rateLimited
        ? "Слишком много оценок. Подождите до 10 минут."
        : "Не удалось сохранить оценку. Попробуйте ещё раз.";
    }
  }

  function addReactionControls(card, entry) {
    const controls = document.createElement("div");
    controls.className = "entry-reactions";
    controls.dataset.reactionKey = entry.externalKey;
    controls.dataset.reactionTitle = entry.title;
    addText(controls, "span", "entry-reactions-label", "Оцените транскрипцию");

    for (const [vote, symbol] of [[1, "👍"], [-1, "👎"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.vote = String(vote);
      button.setAttribute("aria-pressed", "false");
      button.append(document.createTextNode(`${symbol} `), document.createElement("span"));
      button.addEventListener("click", () => submitReaction(entry.externalKey, vote, controls));
      controls.append(button);
    }

    const status = addText(controls, "span", "entry-reactions-status", "");
    status.dataset.reactionStatus = "";
    status.setAttribute("role", "status");
    card.append(controls);
    updateOneReactionControl(controls, entry.externalKey);
  }

  async function loadReactions() {
    if (!reactionApiUrl) {
      return;
    }

    try {
      const response = await fetch(reactionApiUrl, { credentials: "omit", cache: "no-store" });

      if (!response.ok) {
        throw new Error("Reaction counts request failed");
      }

      const counts = await response.json();
      for (const [key, value] of Object.entries(counts)) {
        reactionCounts.set(key, value);
      }

      reactionsAvailable = true;
    } catch {
      reactionsAvailable = false;
    }

    for (const controls of document.querySelectorAll("[data-reaction-key]")) {
      updateOneReactionControl(controls, controls.dataset.reactionKey);
    }
  }

  function formatCalendarDate(date) {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  }

  function makeCalendarDate(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function addText(parent, tagName, className, value) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
  }

  function createEntryCard(entry, headingTag) {
    const card = document.createElement("article");
    card.className = "entry-card";
    const entryLabel = entry.type === "manual_transcription" ? `§${entry.externalKey} · ${entry.group}` : entry.group;
    addText(card, "p", "entry-tag", entryLabel);
    addText(card, headingTag, "", entry.title);
    addText(card, "p", "entry-body", entry.bodyText);
    addText(card, "p", "entry-meta", `${entry.type === "manual_transcription" ? "Получение текста" : "Дата"}: ${entry.dateNote}`);

    if (entry.method) {
      addText(card, "p", "entry-meta", `Способ: ${entry.method}`);
    }

    if (entry.statusNote) {
      addText(card, "p", "entry-status", entry.statusNote);
    }

    try {
      const sourceUrl = new URL(entry.sourceUrl);

      if (sourceUrl.protocol === "https:") {
        const sourceLink = addText(card, "a", "entry-source", "Открыть источник ↗");
        sourceLink.href = sourceUrl.href;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
      }
    } catch {
      // Некорректный адрес источника не влияет на показ самой записи
    }

    if (entry.type === "manual_transcription") {
      addReactionControls(card, entry);
    }

    return card;
  }

  function renderDayResults() {
    todayResults.replaceChildren();
    addText(todayResults, "h3", "day-results-heading", formatCalendarDate(selectedDate));

    if (loadFailed) {
      addText(todayResults, "p", "day-empty", "Не удалось загрузить материалы. Обновите страницу позже.");
      return;
    }

    const selectedEntries = entries.filter((entry) => entry.published && entry.calendarDate === selectedDate);

    if (selectedEntries.length === 0) {
      addText(todayResults, "p", "day-empty", "На эту дату опубликованных записей пока нет.");
      return;
    }

    for (const entry of selectedEntries) {
      todayResults.append(createEntryCard(entry, "h4"));
    }
  }

  function renderCollection(container, type, emptyMessage) {
    container.replaceChildren();

    if (loadFailed) {
      addText(container, "p", "day-empty", "Не удалось загрузить материалы. Обновите страницу позже.");
      return;
    }

    const collectionEntries = entries.filter((entry) => entry.published && entry.type === type);

    if (collectionEntries.length === 0) {
      if (emptyMessage) {
        addText(container, "p", "day-empty", emptyMessage);
      }
      return;
    }

    for (const entry of collectionEntries) {
      container.append(createEntryCard(entry, "h3"));
    }
  }

  function renderCollections() {
    renderCollection(newsResults, "news", "Новостей пока нет.");
    renderCollection(situationsResults, "situation", "");
  }

  function renderCalendar() {
    calendarGrid.replaceChildren();
    const monthName = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)));
    calendarMonthLabel.textContent = `${monthName[0].toUpperCase()}${monthName.slice(1)} ${calendarYear}`;

    const firstWeekday = (new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate();

    for (let blank = 0; blank < firstWeekday; blank++) {
      const spacer = document.createElement("span");
      spacer.className = "calendar-blank";
      spacer.setAttribute("aria-hidden", "true");
      calendarGrid.append(spacer);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = makeCalendarDate(calendarYear, calendarMonth, day);
      const count = entries.filter((entry) => entry.published && entry.calendarDate === date).length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      button.textContent = String(day);
      button.setAttribute("aria-label", `${formatCalendarDate(date)}${count ? `, записей: ${count}` : ""}`);
      button.setAttribute("aria-pressed", String(date === selectedDate));
      button.classList.toggle("is-selected", date === selectedDate);
      button.classList.toggle("has-entries", count > 0);
      button.addEventListener("click", () => {
        selectedDate = date;
        renderCalendar();
      });
      calendarGrid.append(button);
    }

    renderDayResults();
  }

  function shiftMonth(offset) {
    const nextMonth = new Date(Date.UTC(calendarYear, calendarMonth - 1 + offset, 1));
    calendarYear = nextMonth.getUTCFullYear();
    calendarMonth = nextMonth.getUTCMonth() + 1;
    const selectedDay = Math.min(Number(selectedDate.slice(8)), new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate());
    selectedDate = makeCalendarDate(calendarYear, calendarMonth, selectedDay);
    renderCalendar();
  }

  function showCurrentSection() {
    const hash = window.location.hash.slice(1);
    const currentId = panelIds.has(hash) ? hash : "about";

    for (const link of links) {
      const isCurrent = link.dataset.tabLink === currentId
        || (link.dataset.tabLink === "help" && currentId.startsWith("help-"))
        || (link.dataset.tabLink === "situations" && (currentId.startsWith("situation-") || currentId === "sos"));
      link.classList.toggle("is-active", isCurrent);

      if (isCurrent) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }

    for (const panel of panels) {
      panel.classList.toggle("is-active", panel.id === currentId);
    }

    const currentPanel = document.getElementById(currentId);
    document.title = `${currentPanel.dataset.title} — Глоссалия`;
    document.documentElement.classList.add("site-ready");
  }

  window.addEventListener("hashchange", showCurrentSection);
  for (const button of document.querySelectorAll("[data-copy-target]")) {
    button.addEventListener("click", async () => {
      const field = document.getElementById(button.dataset.copyTarget);
      const status = button.parentElement.querySelector("[data-copy-status]");

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(field.value);
        } else {
          field.select();
          if (!document.execCommand("copy")) {
            throw new Error("Copy unavailable");
          }
        }
        status.textContent = "Скопировано";
      } catch {
        field.select();
        status.textContent = "Скопируйте выделенный текст вручную";
      }
    });
  }
  for (const button of document.querySelectorAll("[data-open-dialog]")) {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.openDialog).showModal();
    });
  }
  document.getElementById("calendar-previous").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("calendar-next").addEventListener("click", () => shiftMonth(1));
  showCurrentSection();
  renderCalendar();
  renderCollections();

  fetch("data/entries.json", { credentials: "omit" })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Data request failed");
      }

      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data)) {
        throw new Error("Invalid data format");
      }

      entries = data;
      renderCalendar();
      renderCollections();
      loadReactions();
    })
    .catch(() => {
      loadFailed = true;
      renderDayResults();
      renderCollections();
    });
})();
