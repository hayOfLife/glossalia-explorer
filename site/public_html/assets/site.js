(() => {
  const links = Array.from(document.querySelectorAll("[data-tab-link]"));
  const sectionNav = document.querySelector(".section-nav");
  const tabScrollKey = "glossaliae-scroll-to-tabs";
  let initialPageShown = false;
  const sectionPaths = new Set([
    "/", "/news/", "/calendar/", "/situations/", "/situations/glossolalia/",
    "/sos/", "/situations/help/", "/termination-of-pregnancy/", "/situations/agnosticism/",
    "/situations/life-partner/", "/situations/mental-health/", "/situations/divine-guidance/", "/situations/occultism-support/", "/situations/temple-offering/", "/translation/", "/help/", "/help/glossolalia/",
    "/help/purpose/", "/help/churches/", "/help/theories/", "/help/library/", "/help/ai/", "/help/author/",
    "/articles/why-god-is-lord/", "/articles/glossolalia-hypothesis/",
    "/articles/lurianic-kabbalah-soul-integrity/",
    "/articles/glossolalia-kabbalah-common-points/",
    "/articles/self-writing-generative-archive/",
    "/articles/latin-greek-process-morphology/",
    "/articles/transcription-notes/",
    "/articles/hebrew-russian-sounds/",
    "/articles/author-term-definitions/",
    "/articles/channel-abbreviations/",
    "/dictionaries/words/", "/dictionaries/suffixes-and-particles/", "/transcription-analyses/",
    "/articles/transcription-symbol-systems/",
    "/articles/transcription-symbols-print/",
    "/help/eugenics-vs-genetic-engineering/", "/donate/", "/for-ai/",
  ]);
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const panelIds = new Set(panels.map((panel) => panel.id));
  const transcriptionFilter = document.getElementById("transcription-filter");
  const filterStatus = document.getElementById("transcription-filter-status");
  const dateFrom = document.getElementById("transcription-date-from");
  const dateTo = document.getElementById("transcription-date-to");
  const timeFrom = document.getElementById("transcription-time-from");
  const timeTo = document.getElementById("transcription-time-to");
  const queryField = document.getElementById("transcription-query");
  const purposeQueryField = document.getElementById("transcription-purpose-query");
  const allDates = document.getElementById("transcription-all-dates");
  const analysisAny = document.getElementById("transcription-analysis-any");
  const analysisPercent = document.getElementById("transcription-analysis-percent");
  const analysisLabelOption = document.getElementById("transcription-analysis-label");
  const percentFrom = document.getElementById("transcription-percent-from");
  const percentTo = document.getElementById("transcription-percent-to");
  const analysisLabelValue = document.getElementById("transcription-analysis-label-value");
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
  let transcriptionsLoaded = false;
  let transcriptionsLoadFailed = false;
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

  function addText(parent, tagName, className, value) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
  }

  function addNewsText(parent, value) {
    const text = String(value ?? "");
    let offset = 0;

    for (const match of text.matchAll(/\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g)) {
      parent.append(document.createTextNode(text.slice(offset, match.index)));

      let url;
      try {
        url = new URL(match[2], window.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") url = null;
      } catch {
        url = null;
      }

      if (url) {
        const link = addText(parent, "a", "", match[1]);
        link.href = url.href;
      } else {
        parent.append(document.createTextNode(match[0]));
      }

      offset = match.index + match[0].length;
    }

    parent.append(document.createTextNode(text.slice(offset)));
  }

  function analysisModeValue(mode) {
    if (mode === "not_required") return "не требуется";

    return mode === "manual" ? "100%" : (/^(?:100|[1-9]?\d)%$/.test(mode) ? mode : "авто");
  }

  function analysisLabel(mode) {
    return `Разбор транскрипции: ${analysisModeValue(mode)}`;
  }

  function addAcquisitionIcon(heading, type) {
    const audio = type === "audio";
    const label = audio ? "Транскрипция получена из аудиозаписи" : "Транскрипция получена письменно";
    const icon = addText(heading, "span", "transcription-acquisition", "");
    icon.dataset.acquisitionType = audio ? "audio" : "written";
    icon.setAttribute("title", label);
    icon.setAttribute("aria-label", label);
    icon.setAttribute("role", "img");
    const image = document.createElement("img");
    image.src = `/assets/transcription-${audio ? "audio" : "written"}.svg`;
    image.alt = "";
    image.width = 20;
    image.height = 20;
    icon.append(image);
  }

  function createEntryCard(entry, headingTag) {
    const isTranscription = entry.type === "manual_transcription" || entry.type === "analysis";
    const isNews = entry.type === "news";
    const card = document.createElement("article");
    card.className = "entry-card";
    const entryLabel = entry.type === "manual_transcription" ? `§${entry.externalKey} · ${entry.group}` : entry.group;
    addText(card, "p", "entry-tag", entryLabel);
    const heading = addText(card, headingTag, "", "");
    const headingText = isTranscription ? addText(heading, "span", "transcription-heading", "") : heading;
    if (isTranscription) heading.classList.add("transcription-heading-row");
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
      headingText.append(pageLink);
    } else {
      headingText.textContent = entry.title;
    }
    if (isTranscription) {
      addAcquisitionIcon(heading, calendarTranscriptions[entry.sourceUrl]?.acquisitionType ?? entry.acquisitionType ?? "written");
    }

    const body = addText(card, "p", "entry-body", isNews ? "" : isTranscription ? (entry.copyText ?? entry.bodyText) : entry.bodyText);
    if (isNews) addNewsText(body, entry.bodyText);

    if (!isNews) addText(card, "p", "analysis-mode", analysisLabel(entry.analysisMode));
    addText(card, "p", "entry-meta", `${isNews ? "Дата публикации" : "Появление транскрипции"}: ${entry.dateNote}`);

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

    if (isTranscription) {
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
    const heading = addText(item, "summary", "transcription-heading-row", "");
    addText(heading, "span", "transcription-heading", `${number}. ${entry.title}`);
    addAcquisitionIcon(heading, transcription?.acquisitionType ?? entry.acquisitionType ?? "written");
    const body = addText(item, "div", "sos-item-body", "");
    if (entry.group) addText(body, "p", "entry-meta", `Раздел сайта: ${entry.group}`);
    addText(body, "p", "entry-meta", `Появление транскрипции: ${entry.dateNote || "Дата получения не установлена"}`);

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
    if (transcription?.commentaryHtml) {
      const commentary = addText(body, "div", "help-page transcription-commentary", "");
      commentary.innerHTML = transcription.commentaryHtml;
    }
    return item;
  }

  function normalizeSearchText(value) {
    return String(value ?? "").toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
  }

  function updateFilterFields() {
    if (!transcriptionFilter) return;

    dateFrom.disabled = allDates.checked;
    dateTo.disabled = allDates.checked;
    percentFrom.disabled = !analysisPercent.checked;
    percentTo.disabled = !analysisPercent.checked;
    analysisLabelValue.disabled = !analysisLabelOption.checked;
    const percentFields = document.getElementById("transcription-percent-fields");
    const labelField = document.getElementById("transcription-analysis-label-field");
    if (percentFields) percentFields.hidden = !analysisPercent.checked;
    if (labelField) labelField.hidden = !analysisLabelOption.checked;
  }

  function resetTranscriptionFilter() {
    if (!transcriptionFilter) return;

    dateFrom.value = todayDate;
    dateTo.value = todayDate;
    timeFrom.value = "00:00";
    timeTo.value = "23:59";
    queryField.value = "";
    purposeQueryField.value = "";
    allDates.checked = false;
    analysisAny.checked = true;
    analysisPercent.checked = false;
    analysisLabelOption.checked = false;
    percentFrom.value = "0";
    percentTo.value = "100";
    analysisLabelValue.value = "auto";
    updateFilterFields();
  }

  function readTranscriptionFilter() {
    const filter = {
      allDates: allDates.checked,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      timeFrom: timeFrom.value,
      timeTo: timeTo.value,
      query: normalizeSearchText(queryField.value),
      purposeQuery: normalizeSearchText(purposeQueryField.value),
      analysis: analysisPercent.checked ? "percent" : analysisLabelOption.checked ? "label" : "any",
      percentFrom: Number(percentFrom.value),
      percentTo: Number(percentTo.value),
      label: analysisLabelValue.value,
    };

    if (!filter.allDates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filter.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(filter.dateTo)) {
        return { error: "Укажите обе даты получения." };
      }
      if (filter.dateFrom > filter.dateTo) return { error: "Дата начала не может быть позже даты окончания." };
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(filter.timeFrom) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(filter.timeTo)) {
      return { error: "Укажите время от 00:00 до 23:59." };
    }
    if (filter.timeFrom > filter.timeTo) return { error: "Время начала не может быть позже времени окончания." };
    if (filter.analysis === "percent") {
      if (!/^\d{1,3}$/.test(percentFrom.value) || !/^\d{1,3}$/.test(percentTo.value)
        || filter.percentFrom > 100 || filter.percentTo > 100) {
        return { error: "Укажите целые проценты от 0 до 100." };
      }
      if (filter.percentFrom > filter.percentTo) return { error: "Начальный процент не может быть больше конечного." };
    }
    return filter;
  }

  function renderFilteredResults() {
    if (!todayResults || !transcriptionFilter || !filterStatus) return;

    todayResults.replaceChildren();
    const filter = readTranscriptionFilter();
    filterStatus.classList.toggle("is-error", Boolean(filter.error || transcriptionsLoadFailed));
    if (filter.error) {
      filterStatus.textContent = filter.error;
      return;
    }
    if (transcriptionsLoadFailed) {
      filterStatus.textContent = "Не удалось загрузить транскрипции для поиска. Обновите страницу позже.";
      return;
    }
    if (!transcriptionsLoaded) {
      filterStatus.textContent = "Загружаем транскрипции…";
      return;
    }

    const fullDay = filter.timeFrom === "00:00" && filter.timeTo === "23:59";
    const selectedEntries = Object.values(calendarTranscriptions)
      .filter((transcription) => {
        const entry = transcription.entry;
        if (!entry.published || !["manual_transcription", "analysis"].includes(entry.type)) return false;
        if (!filter.allDates && (!entry.calendarDate || entry.calendarDate < filter.dateFrom || entry.calendarDate > filter.dateTo)) return false;
        if (!entry.appearanceTime) {
          if (!fullDay) return false;
        } else if (entry.appearanceTime < filter.timeFrom || entry.appearanceTime > filter.timeTo) return false;
        if (filter.query && ![transcription.originalText, transcription.copyText]
          .some((text) => normalizeSearchText(text).includes(filter.query))) return false;
        if (filter.purposeQuery && !normalizeSearchText(transcription.purposeText).includes(filter.purposeQuery)) return false;

        const mode = analysisModeValue(entry.analysisMode);
        if (filter.analysis === "percent" && (!mode.endsWith("%")
          || Number(mode.slice(0, -1)) < filter.percentFrom || Number(mode.slice(0, -1)) > filter.percentTo)) return false;
        if (filter.analysis === "label" && mode !== analysisModeValue(filter.label)) return false;
        return true;
      })
      .map((transcription) => transcription.entry)
      .sort((left, right) => {
        const dateOrder = (left.calendarDate || "9999-12-31").localeCompare(right.calendarDate || "9999-12-31");
        return dateOrder || (left.appearanceTime || "24:00").localeCompare(right.appearanceTime || "24:00");
      });

    filterStatus.textContent = `Найдено транскрипций: ${selectedEntries.length}.`;
    const period = filter.allDates ? "Все даты" : filter.dateFrom === filter.dateTo
      ? formatCalendarDate(filter.dateFrom)
      : `${formatCalendarDate(filter.dateFrom)} — ${formatCalendarDate(filter.dateTo)}`;
    addText(todayResults, "h3", "day-results-heading", `${period}, ${filter.timeFrom}–${filter.timeTo}`);
    if (selectedEntries.length === 0) {
      addText(todayResults, "p", "day-empty", "По выбранным условиям транскрипций не найдено.");
      return;
    }

    selectedEntries.forEach((entry, index) => todayResults.append(createCalendarTranscription(entry, index + 1)));
    loadReactions();
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

  function showCurrentSection() {
    const hash = window.location.hash.slice(1);
    const currentId = document.body.dataset.pageId || (panelIds.has(hash) ? hash : "about");
    const currentTabId = ["dictionary-words", "dictionary-suffixes", "article-transcription-analyses", "article-latin-greek-process-morphology", "article-transcription-notes", "article-hebrew-russian-sounds", "article-author-term-definitions", "article-channel-abbreviations", "article-transcription-symbol-systems", "article-transcription-symbols-print"].includes(currentId)
      ? "translation" : currentId;

    for (const link of links) {
      const isCurrent = link.dataset.tabLink === currentTabId
        || (link.dataset.tabLink === "help" && (currentTabId.startsWith("help-") || currentTabId.startsWith("article-")))
        || (link.dataset.tabLink === "situations" && (currentTabId.startsWith("situation-") || currentTabId === "sos" || currentTabId === "termination-of-pregnancy"));
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
    if (currentPanel) document.title = currentPanel.dataset.pageTitle || `${currentPanel.dataset.title} — Глоссалия`;
    document.documentElement.classList.add("site-ready");
  }

  function documentHeading() {
    const currentId = document.body.dataset.pageId || window.location.hash.slice(1);
    return currentId.startsWith("article-") || currentId.startsWith("dictionary-") || ["help-eugenics", "help-churches"].includes(currentId)
      ? document.getElementById(`${currentId}-title`)
      : null;
  }

  function scrollToSectionStart() {
    const target = documentHeading() || sectionNav;
    target?.scrollIntoView({ block: "start", behavior: "instant" });
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
      requestAnimationFrame(scrollToSectionStart);
    } else {
      try {
        sessionStorage.setItem(tabScrollKey, destination.pathname);
      } catch {
        // Прокрутка недоступна, если браузер запрещает хранилище сеанса
      }
    }
  });

  window.addEventListener("pageshow", (event) => {
    let shouldScroll = false;

    try {
      const destinationPath = sessionStorage.getItem(tabScrollKey);
      if (destinationPath) {
        sessionStorage.removeItem(tabScrollKey);
        shouldScroll = destinationPath === window.location.pathname;
      }
    } catch {
      // Прокрутка недоступна, если браузер запрещает хранилище сеанса
    }

    // При возврате и перезагрузке браузер восстанавливает прежнее место чтения
    const navigationType = window.performance?.getEntriesByType("navigation")[0]?.type;
    const restoringPosition = event.persisted || ["back_forward", "reload"].includes(navigationType);
    if (!initialPageShown && documentHeading() && !window.location.hash && !restoringPosition) shouldScroll = true;
    initialPageShown = true;

    if (shouldScroll) requestAnimationFrame(scrollToSectionStart);
  });

  if (!document.body.dataset.pageId) {
    window.addEventListener("hashchange", () => {
      showCurrentSection();
      requestAnimationFrame(scrollToSectionStart);
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

  transcriptionFilter?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderFilteredResults();
  });
  allDates?.addEventListener("change", updateFilterFields);
  for (const radio of [analysisAny, analysisPercent, analysisLabelOption]) {
    radio?.addEventListener("change", updateFilterFields);
  }
  document.getElementById("transcription-filter-reset")?.addEventListener("click", () => {
    resetTranscriptionFilter();
    renderFilteredResults();
  });
  resetTranscriptionFilter();
  showCurrentSection();
  renderFilteredResults();
  renderCollections();
  prepareTranscriptionReactions();

  const methodologyContainer = document.getElementById("dictionary-words-methodology");
  if (methodologyContainer && !methodologyContainer.children.length) {
    fetch("/data/dictionary-methodology.html", { credentials: "omit", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Dictionary methodology unavailable");
        return response.text();
      })
      .then((content) => { methodologyContainer.innerHTML = content; })
      .catch(() => { methodologyContainer.textContent = "Не удалось загрузить методологию. Обновите страницу."; });
  }

  const dictionaryContainer = document.getElementById("dictionary-words-content");
  if (dictionaryContainer && !dictionaryContainer.children.length) {
    fetch("/data/dictionary.html", { credentials: "omit", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Dictionary unavailable");
        return response.text();
      })
      .then((content) => { dictionaryContainer.innerHTML = content; })
      .catch(() => { dictionaryContainer.textContent = "Не удалось загрузить словарь. Обновите страницу."; });
  }

  for (const [id, path, error] of [
    ["translation-prompt-content", "/data/prompt-general.html", "Не удалось загрузить промпт. Обновите страницу."],
    ["transcription-analyses-content", "/data/transcription-analyses.html", "Не удалось загрузить список разборов. Обновите страницу."],
    ["dictionary-suffixes-methodology", "/data/suffix-methodology.html", "Не удалось загрузить методологию. Обновите страницу."],
    ["dictionary-suffixes-content", "/data/suffix-dictionary.html", "Не удалось загрузить словарь. Обновите страницу."],
    ["translation-phonetics-content", "/data/prompt-phonetics.html", "Не удалось загрузить фонетический справочник. Обновите страницу."],
    ["article-channel-abbreviations-content", "/data/abbreviations-article.html", "Не удалось загрузить словарь сокращений. Обновите страницу."],
  ]) {
    const container = document.getElementById(id);
    if (container && !container.children.length) {
      fetch(path, { credentials: "omit", cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Suffix section unavailable");
          return response.text();
        })
        .then((content) => { container.innerHTML = content; })
        .catch(() => { container.textContent = error; });
    }
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

  if (transcriptionFilter && todayResults) fetch("/data/calendar-transcriptions.json", { credentials: "omit", cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Transcriptions unavailable");
      return response.json();
    })
    .then((data) => {
      if (!data || typeof data !== "object" || Array.isArray(data)
        || !Object.entries(data).every(([sourceUrl, transcription]) => transcription
          && typeof transcription === "object" && transcription.entry
          && transcription.entry.sourceUrl === sourceUrl
          && typeof transcription.copyText === "string"
          && typeof transcription.originalText === "string"
          && typeof transcription.purposeText === "string")) throw new Error("Invalid transcription search data");

      calendarTranscriptions = data;
      transcriptionsLoaded = true;
      renderFilteredResults();
    })
    .catch(() => {
      transcriptionsLoadFailed = true;
      renderFilteredResults();
    });

  if (newsResults || situationsResults) fetch("/data/entries.json", { credentials: "omit", cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Data request failed");
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data)) throw new Error("Invalid data format");

      entries = data;
      renderCollections();
      loadReactions();
    })
    .catch(() => {
      loadFailed = true;
      renderCollections();
    });
})();
