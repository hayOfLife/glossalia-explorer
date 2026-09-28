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
        || (link.dataset.tabLink === "situations" && currentId.startsWith("situation-"));
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
    })
    .catch(() => {
      loadFailed = true;
      renderDayResults();
      renderCollections();
    });
})();
