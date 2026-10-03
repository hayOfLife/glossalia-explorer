(() => {
  const links = Array.from(document.querySelectorAll("[data-tab-link]"));
  const sectionNav = document.querySelector(".section-nav");
  const tabScrollKey = "glossaliae-scroll-to-tabs";
  const sectionPaths = new Set([
    "/", "/news/", "/calendar/", "/situations/", "/situations/glossolalia/",
    "/sos/", "/situations/help/", "/termination-of-pregnancy/", "/situations/agnosticism/",
    "/situations/life-partner/", "/translation/", "/help/", "/help/glossolalia/",
    "/help/purpose/", "/help/churches/", "/help/theories/", "/help/library/", "/help/ai/", "/help/author/",
    "/articles/why-god-is-lord/", "/articles/glossolalia-hypothesis/",
    "/articles/lurianic-kabbalah-soul-integrity/",
    "/articles/glossolalia-kabbalah-common-points/",
    "/help/eugenics-vs-genetic-engineering/", "/donate/", "/for-ai/",
  ]);
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
  let calendarTranscriptions = {};
  let loadFailed = false;
  const localEnvironment = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const productionReactionApiUrl = "https://94-232-41-163.sslip.io/glossaliae/reactions";
  const localReactionApiUrl = "https://94-232-41-163.sslip.io/glossaliae/reactions-local";
  const reactionApiUrl = localEnvironment ? localReactionApiUrl : productionReactionApiUrl;
  const reactionCounts = new Map();
  const pendingReactions = new Set();
  const reactionErrors = new Map();
  let reactionsRequested = false;
  let reactionsAvailable = false;
  let sessionVoterId = null;
  const voterStorageKey = localEnvironment ? "glossaliae-voter-id-local" : "glossaliae-voter-id";
  const voteStorageKey = localEnvironment ? "glossaliae-votes-local" : "glossaliae-votes";
  const aliceLink = document.getElementById("alice-translation-link");
  const alicePromptStatus = document.getElementById("alice-prompt-status");

  async function prepareAliceLink() {
    if (!aliceLink || !alicePromptStatus) return;

    try {
      const response = await fetch("/data/promptForAlice_guessingTheMeaningOfTheGlossary.min.txt", { cache: "no-store" });
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
    const available = reactionsAvailable && reactionCounts.has(key);
    const pending = pendingReactions.has(key);

    for (const button of controls.querySelectorAll("button")) {
      const vote = Number(button.dataset.vote);
      const count = vote === 1 ? counts.likes : counts.dislikes;
      button.disabled = !available || pending;
      button.setAttribute("aria-pressed", String(ownVotes[key] === vote));
      button.setAttribute("aria-label", `${vote === 1 ? "Нравится" : "Не нравится"}: ${controls.dataset.reactionTitle}, голосов: ${available ? count : "недоступно"}`);
      button.querySelector("span").textContent = available ? String(count) : "—";
    }

    controls.querySelector("[data-reaction-status]").textContent = pending
      ? "Сохраняем оценку…"
      : (available ? reactionErrors.get(key) || "" : "Оценки временно недоступны");
  }

  function updateReactionControls(key) {
    for (const controls of document.querySelectorAll("[data-reaction-key]")) {
      if (controls.dataset.reactionKey === key) {
        updateOneReactionControl(controls, key);
      }
    }
  }

  function validReactionCounts(counts) {
    return counts && Number.isSafeInteger(counts.likes) && counts.likes >= 0
      && Number.isSafeInteger(counts.dislikes) && counts.dislikes >= 0;
  }

  async function submitReaction(key, vote) {
    if (!reactionsAvailable || !reactionCounts.has(key) || pendingReactions.has(key)) return;

    const nextVote = ownVotes[key] === vote ? 0 : vote;
    pendingReactions.add(key);
    reactionErrors.delete(key);
    updateReactionControls(key);

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
      if (!validReactionCounts(result)) throw new Error("Invalid reaction counts");

      reactionCounts.set(key, { likes: result.likes, dislikes: result.dislikes });
      ownVotes[key] = nextVote;
      try {
        localStorage.setItem(voteStorageKey, JSON.stringify(ownVotes));
      } catch {
        // Оценка сохранена на сервере и останется отмеченной до закрытия страницы
      }
    } catch (error) {
      reactionErrors.set(key, error.rateLimited
        ? "Слишком много оценок. Подождите до 10 минут."
        : "Не удалось сохранить оценку. Попробуйте ещё раз.");
    } finally {
      pendingReactions.delete(key);
      updateReactionControls(key);
    }
  }

  function addReactionControls(card, entry) {
    const key = entry.reactionKey || (entry.type === "manual_transcription" ? entry.externalKey : "");
    if (!key || card.querySelector("[data-reaction-key]")) return;

    const controls = document.createElement("div");
    controls.className = "entry-reactions";
    controls.dataset.reactionKey = key;
    controls.dataset.reactionTitle = entry.title || "Транскрипция";
    addText(controls, "span", "entry-reactions-label", "Оцените транскрипцию");

    for (const [vote, symbol] of [[1, "👍"], [-1, "👎"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.vote = String(vote);
      button.setAttribute("aria-pressed", "false");
      button.append(document.createTextNode(`${symbol} `), document.createElement("span"));
      button.addEventListener("click", () => submitReaction(key, vote));
      controls.append(button);
    }

    const status = addText(controls, "span", "entry-reactions-status", "");
    status.dataset.reactionStatus = "";
    status.setAttribute("role", "status");
    card.append(controls);
    updateOneReactionControl(controls, key);
  }

  async function loadReactions() {
    if (!reactionApiUrl || reactionsRequested) {
      return;
    }

    reactionsRequested = true;

    try {
      const response = await fetch(reactionApiUrl, { credentials: "omit", cache: "no-store" });

      if (!response.ok) {
        throw new Error("Reaction counts request failed");
      }

      const counts = await response.json();
      if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
        throw new Error("Invalid reaction counts format");
      }

      for (const [key, value] of Object.entries(counts)) {
        if (validReactionCounts(value)) reactionCounts.set(key, value);
      }

      reactionsAvailable = true;
    } catch {
      reactionsAvailable = false;
    }

    for (const controls of document.querySelectorAll("[data-reaction-key]")) {
      updateOneReactionControl(controls, controls.dataset.reactionKey);
    }
  }

  function prepareTranscriptionReactions() {
    for (const placeholder of document.querySelectorAll("[data-transcription-reaction]")) {
      addReactionControls(placeholder, {
        reactionKey: placeholder.dataset.transcriptionReaction,
        title: placeholder.dataset.reactionTitle,
      });
    }

    if (document.querySelector("[data-reaction-key]")) {
      loadReactions();
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

  function analysisLabel(mode) {
    const label = mode === "manual" ? "100%" : (/^(?:100|[1-9]?\d)%$/.test(mode) ? mode : "авто");
    return `Разбор транскрипции: ${label}`;
  }

  function createEntryCard(entry, headingTag) {
    const card = document.createElement("article");
    card.className = "entry-card";
    const entryLabel = entry.type === "manual_transcription" ? `§${entry.externalKey} · ${entry.group}` : entry.group;
    addText(card, "p", "entry-tag", entryLabel);
    const heading = addText(card, headingTag, "", "");
    let transcriptionPath;
    try {
      const sourceUrl = new URL(entry.sourceUrl);
      transcriptionPath = sourceUrl.hostname === "github.com"
        ? sourceUrl.pathname.match(/^\/hayOfLife\/glossalia-explorer\/blob\/main\/docs\/transcriptions\/(.+)\.md$/)
        : null;
    } catch {
      transcriptionPath = null;
    }
    if (transcriptionPath) {
      const pageLink = document.createElement("a");
      pageLink.href = `/transcriptions/${transcriptionPath[1]}/`;
      pageLink.textContent = entry.title;
      heading.append(pageLink);
    } else {
      heading.textContent = entry.title;
    }
    addText(card, "p", "entry-body", entry.bodyText);
    addText(card, "p", "analysis-mode", analysisLabel(entry.analysisMode));
    addText(card, "p", "entry-meta", `Появление транскрипции: ${entry.dateNote}`);

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

    if (entry.type === "manual_transcription" || entry.type === "analysis") {
      addReactionControls(card, entry);

      if (entry.reactionKey) {
        const chat = document.createElement("div");
        chat.className = "transcription-chat";
        chat.dataset.transcriptionChat = entry.reactionKey;
        chat.hidden = true;
        card.append(chat);
      }
    }

    return card;
  }

  function createCalendarTranscription(entry, number) {
    const transcription = calendarTranscriptions[entry.sourceUrl];
    const item = document.createElement("details");
    item.className = "sos-item";
    addText(item, "summary", "", `${number}. ${entry.title}`);
    const body = addText(item, "div", "sos-item-body", "");
    addText(body, "p", "entry-meta", `Появление транскрипции: ${entry.dateNote}`);

    const purpose = addText(body, "details", "transcription-purpose", "");
    addText(purpose, "summary", "", "предполагаемое назначение");
    const purposeBody = addText(purpose, "div", "transcription-purpose-body", "");
    purposeBody.innerHTML = transcription?.purposeHtml || "<p>Пока не заполнено</p>";

    const field = document.createElement("textarea");
    field.id = `calendar-transcription-${number}`;
    field.setAttribute("aria-label", "Текст для копирования");
    field.readOnly = true;
    field.rows = 4;
    field.value = transcription?.copyText ?? entry.copyText ?? entry.bodyText ?? "";
    body.append(field);
    addText(body, "p", "analysis-mode", analysisLabel(entry.analysisMode));

    const translation = addText(body, "details", "author-translation", "");
    addText(translation, "summary", "", "предполагаемый перевод");
    const translationBody = addText(translation, "div", "author-translation-body", "");
    translationBody.innerHTML = transcription?.translationHtml || "<p>Пока не заполнено</p>";

    const actions = addText(body, "div", "sos-actions", "");
    const copyButton = addText(actions, "button", "", "Скопировать");
    copyButton.type = "button";
    copyButton.dataset.copyTarget = field.id;
    const detailLink = addText(actions, "a", "", "Подробнее");
    detailLink.href = transcription?.pageUrl || entry.sourceUrl;
    if (!transcription?.pageUrl) {
      detailLink.target = "_blank";
      detailLink.rel = "noopener noreferrer";
    }
    const status = addText(actions, "span", "sos-copy-status", "");
    status.dataset.copyStatus = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    if (entry.method) addText(body, "p", "entry-meta", `Способ: ${entry.method}`);
    if (entry.statusNote) addText(body, "p", "entry-status", entry.statusNote);
    addReactionControls(body, entry);
    if (entry.reactionKey) {
      const chat = document.createElement("div");
      chat.dataset.transcriptionChat = entry.reactionKey;
      chat.hidden = true;
      body.append(chat);
    }
    return item;
  }

  function renderDayResults() {
    if (!todayResults) return;

    todayResults.replaceChildren();
    addText(todayResults, "h3", "day-results-heading", formatCalendarDate(selectedDate));

    if (loadFailed) {
      addText(todayResults, "p", "day-empty", "Не удалось загрузить материалы. Обновите страницу позже.");
      return;
    }

    const selectedEntries = entries
      .filter((entry) => entry.published && entry.calendarDate === selectedDate)
      .sort((left, right) => {
        if (!left.appearanceTime && !right.appearanceTime) return 0;
        if (!left.appearanceTime) return 1;
        if (!right.appearanceTime) return -1;
        return left.appearanceTime.localeCompare(right.appearanceTime);
      });

    if (selectedEntries.length === 0) {
      addText(todayResults, "p", "day-empty", "На эту дату опубликованных записей пока нет.");
      return;
    }

    let transcriptionNumber = 0;
    for (const entry of selectedEntries) {
      todayResults.append(entry.type === "manual_transcription" || entry.type === "analysis"
        ? createCalendarTranscription(entry, ++transcriptionNumber)
        : createEntryCard(entry, "h4"));
    }
  }

  function renderCollection(container, type, emptyMessage) {
    if (!container) return;

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
    if (!calendarGrid || !calendarMonthLabel) return;

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
    const currentId = document.body.dataset.pageId || (panelIds.has(hash) ? hash : "about");

    for (const link of links) {
      const isCurrent = link.dataset.tabLink === currentId
        || (link.dataset.tabLink === "help" && (currentId.startsWith("help-") || currentId.startsWith("article-")))
        || (link.dataset.tabLink === "situations" && (currentId.startsWith("situation-") || currentId === "sos" || currentId === "termination-of-pregnancy"));
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
    if (currentPanel) document.title = `${currentPanel.dataset.title} — Глоссалия`;
    document.documentElement.classList.add("site-ready");
  }

  function scrollToTabs() {
    sectionNav?.scrollIntoView({ block: "start", behavior: "instant" });
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const link = event.target.closest?.("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target.toLowerCase() !== "_self")) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;

    const isPanelHash = !document.body.dataset.pageId
      && destination.pathname === window.location.pathname
      && panelIds.has(destination.hash.slice(1));
    if (!isPanelHash && link.getAttribute("href").startsWith("#")) return;
    if (!isPanelHash && (!sectionPaths.has(destination.pathname) || destination.hash)) return;

    if (destination.pathname === window.location.pathname && destination.search === window.location.search) {
      if (document.body.dataset.pageId) event.preventDefault();
      requestAnimationFrame(scrollToTabs);
    } else {
      try {
        sessionStorage.setItem(tabScrollKey, destination.pathname);
      } catch {
        // Прокрутка недоступна, если браузер запрещает хранилище сеанса
      }
    }
  });

  window.addEventListener("pageshow", () => {
    try {
      const destinationPath = sessionStorage.getItem(tabScrollKey);
      if (destinationPath) {
        sessionStorage.removeItem(tabScrollKey);
        if (destinationPath === window.location.pathname) requestAnimationFrame(scrollToTabs);
      }
    } catch {
      // Прокрутка недоступна, если браузер запрещает хранилище сеанса
    }
  });

  if (!document.body.dataset.pageId) {
    window.addEventListener("hashchange", () => {
      showCurrentSection();
      requestAnimationFrame(scrollToTabs);
    });
  }
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-copy-target]");
    if (!button) return;

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
  for (const button of document.querySelectorAll("[data-open-dialog]")) {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.openDialog).showModal();
    });
  }

  const detailDialog = document.getElementById("transcription-detail-dialog");
  const detailTitle = document.getElementById("transcription-detail-title");
  const detailContent = document.getElementById("transcription-detail-content");
  const detailPageLink = document.getElementById("transcription-detail-page");
  let detailRequest = null;
  let detailOrigin = null;

  if (detailDialog && detailTitle && detailContent && detailPageLink && typeof detailDialog.showModal === "function") {
    document.addEventListener("click", async (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      const link = event.target.closest(".sos-actions a, .entry-card h3 a, .entry-card h4 a");
      if (!link) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || !/^\/transcriptions\/.+\/$/.test(destination.pathname)) return;

      event.preventDefault();
      detailRequest?.abort();
      const request = new AbortController();
      detailRequest = request;
      detailOrigin = { link, x: window.scrollX, y: window.scrollY };
      detailTitle.textContent = "Полный разбор";
      detailPageLink.href = destination.href;
      detailContent.replaceChildren();
      const status = addText(detailContent, "p", "", "Загружаем разбор…");
      status.setAttribute("role", "status");
      document.documentElement.classList.add("transcription-detail-open");
      detailDialog.showModal();

      try {
        const response = await fetch(destination.href, { credentials: "omit", cache: "no-cache", signal: request.signal });
        if (!response.ok) throw new Error("Transcription unavailable");

        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const analysis = page.querySelector(".transcription-analysis");
        if (!analysis) throw new Error("Transcription analysis missing");
        if (request.signal.aborted || !detailDialog.open) return;

        detailTitle.textContent = page.querySelector("#transcription h2")?.textContent || "Полный разбор";
        const content = document.importNode(analysis, true);
        for (const sourceLink of content.querySelectorAll("a[href]")) {
          if (sourceLink.getAttribute("href").startsWith("#")) continue;
          sourceLink.target = "_blank";
          sourceLink.rel = "noopener noreferrer";
        }
        detailContent.replaceChildren(content);
      } catch {
        if (!request.signal.aborted && detailDialog.open) {
          status.textContent = "Не удалось загрузить разбор. Попробуйте ещё раз или откройте отдельной страницей.";
        }
      }
    });

    detailDialog.addEventListener("close", () => {
      if (detailDialog.open) return;

      detailRequest?.abort();
      detailRequest = null;
      document.documentElement.classList.remove("transcription-detail-open");
      if (!detailOrigin) return;

      // Закрытие читателя возвращает фокус и прокрутку к исходному абзацу
      detailOrigin.link.focus({ preventScroll: true });
      window.scrollTo({ left: detailOrigin.x, top: detailOrigin.y, behavior: "instant" });
      detailOrigin = null;
    });
  }

  document.getElementById("calendar-previous")?.addEventListener("click", () => shiftMonth(-1));
  document.getElementById("calendar-next")?.addEventListener("click", () => shiftMonth(1));
  showCurrentSection();
  renderCalendar();
  renderCollections();
  prepareTranscriptionReactions();

  const dictionaryContainer = document.getElementById("channel-dictionary-content");
  if (dictionaryContainer && !dictionaryContainer.children.length) {
    fetch("/data/dictionary.html", { credentials: "omit", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Dictionary unavailable");
        return response.text();
      })
      .then((content) => { dictionaryContainer.innerHTML = content; })
      .catch(() => { dictionaryContainer.textContent = "Не удалось загрузить словарь. Обновите страницу."; });
  }

  const analysisFields = Array.from(document.querySelectorAll("[data-analysis-source]"));
  if (analysisFields.length) fetch("/data/analysis-modes.json", { credentials: "omit", cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Analysis modes unavailable");
      return response.json();
    })
    .then((modes) => {
      for (const field of analysisFields) {
        field.textContent = analysisLabel(modes[field.dataset.analysisSource]);
      }
    })
    .catch(() => {});

  const translationFields = Array.from(document.querySelectorAll("[data-author-translation]"));
  if (translationFields.length) fetch("data/author-translations.json", { credentials: "omit", cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Translations unavailable");
      return response.json();
    })
    .then((translations) => {
      for (const field of translationFields) {
        field.innerHTML = translations[field.dataset.authorTranslation]
          || "<p>Пока не заполнено</p>";
      }
    })
    .catch(() => {
      for (const field of translationFields) field.textContent = "Пока не заполнено";
    });

  const purposeFields = Array.from(document.querySelectorAll("[data-purpose-source]"));
  if (purposeFields.length) fetch("data/transcription-purposes.json", { credentials: "omit", cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Purposes unavailable");
      return response.json();
    })
    .then((purposes) => {
      for (const field of purposeFields) {
        field.innerHTML = purposes[field.dataset.purposeSource]
          || "<p>Пока не заполнено</p>";
      }
    })
    .catch(() => {
      for (const field of purposeFields) field.textContent = "Пока не заполнено";
    });

  const calendarTranscriptionsReady = todayResults
    ? fetch("/data/calendar-transcriptions.json", { credentials: "omit", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Calendar transcriptions unavailable");
        return response.json();
      })
      .then((data) => {
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid calendar transcriptions");
        calendarTranscriptions = data;
      })
      .catch(() => {})
    : Promise.resolve();

  if (calendarGrid || newsResults || situationsResults) fetch("/data/entries.json", { credentials: "omit", cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Data request failed");
      }

      return response.json();
    })
    .then(async (data) => {
      if (!Array.isArray(data)) {
        throw new Error("Invalid data format");
      }

      entries = data;
      await calendarTranscriptionsReady;
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
