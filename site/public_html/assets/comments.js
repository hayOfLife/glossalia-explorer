(() => {
  const template = document.getElementById("transcription-chat-template");
  const templateRoot = template?.content.querySelector("[data-transcription-chat]");
  if (!templateRoot) return;

  const apiUrl = "https://94-232-41-163.sslip.io/glossaliae/comments";
  const authorStorageKey = "glossaliae-comment-author";
  const ownStorageKey = "glossaliae-comment-own-messages";
  const adminSessionKey = "glossaliae-comment-admin-session";
  const idPattern = /^[0-9a-f]{32}$/;
  const authorRecipient = "user_001";
  const publicNamePattern = /^(?:user[A-Za-z0-9]{3,16}|user_001)$/;
  const keyPattern = /^(?:for-ai|T\d{5}(?:-[A-Za-z0-9_-]{1,100})?)$/;
  const localEnvironment = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const states = new Map();
  const pendingWrites = new Set();
  const ownMessages = new Map();
  let sessionAuthorToken = null;
  let serverOffsetMs = 0;
  let panelSequence = 0;
  let adminToken = null;
  let adminExpiresAt = 0;
  let adminExpiryTimer = null;
  let adminDialog = null;
  let ownerLoginVersion = 0;
  let pendingOwnerAction = null;
  let adminBusy = false;
  let adminStatus = null;
  let ownerPanel = null;
  let ownerSessionVersion = 0;
  let ownerActionVersion = 0;
  let ownerPollTimer = null;
  let unreadCount = 0;
  let inbox = null;

  function mergeOwnMessages(value) {
    const stored = JSON.parse(value || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [key, ids] of Object.entries(stored)) {
        if (keyPattern.test(key) && Array.isArray(ids)) {
          if (!ownMessages.has(key)) ownMessages.set(key, new Set());
          for (const id of ids) if (typeof id === "string" && idPattern.test(id)) ownMessages.get(key).add(id);
        }
      }
    }
  }

  function readOwnMessages() {
    try {
      mergeOwnMessages(localStorage.getItem(ownStorageKey));
    } catch {
      // Без локального хранилища авторство запоминается только до закрытия страницы
    }
  }

  function saveOwnMessages() {
    try {
      const stored = localStorage.getItem(ownStorageKey);
      try {
        mergeOwnMessages(stored);
      } catch {
        // Повреждённый индекс заменяется сохранёнными в этой вкладке идентификаторами
      }
      const serialized = JSON.stringify(Object.fromEntries(
        Array.from(ownMessages, ([thread, ids]) => [thread, Array.from(ids).sort()]).sort(([left], [right]) => left.localeCompare(right)),
      ));
      if (serialized !== stored) localStorage.setItem(ownStorageKey, serialized);
    } catch {
      // Сохранённое сообщение останется редактируемым в текущем сеансе
    }
  }

  function getAuthorToken() {
    let token = sessionAuthorToken;
    try {
      token = localStorage.getItem(authorStorageKey) || token;
    } catch {
      // При недоступном хранилище используется токен текущего сеанса
    }

    if (!/^[0-9a-f]{64}$/.test(token || "")) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      try {
        localStorage.setItem(authorStorageKey, token);
      } catch {
        // Токен не переносится в разметку или адрес запроса при ошибке сохранения
      }
    }

    sessionAuthorToken = token;
    return token;
  }

  function rememberOwnMessage(key, id) {
    if (!ownMessages.has(key)) ownMessages.set(key, new Set());
    ownMessages.get(key).add(id);
    saveOwnMessages();
  }

  function validMessage(message) {
    return message && typeof message === "object" && idPattern.test(message.id)
      && typeof message.name === "string" && Array.from(message.name).length <= 40
      && typeof message.text === "string" && Array.from(message.text).length <= 2000
      && typeof message.deleted === "boolean"
      && (message.deleted ? message.name === "" && message.text === "" : publicNamePattern.test(message.name))
      && Number.isSafeInteger(message.createdAt) && message.createdAt > 0
      && Number.isSafeInteger(message.updatedAt) && message.updatedAt >= message.createdAt
      && (message.replyTo === null || message.replyTo === authorRecipient || (typeof message.replyTo === "string" && idPattern.test(message.replyTo)))
      && (message.replyPreview === null || (message.replyPreview
        && message.replyPreview.id === message.replyTo
        && typeof message.replyPreview.name === "string"
        && (message.replyPreview.name === "" || publicNamePattern.test(message.replyPreview.name))
        && typeof message.replyPreview.text === "string" && Array.from(message.replyPreview.text).length <= 200));
  }

  function applyMetadata(state, payload) {
    const limits = payload?.limits;
    if (!Number.isSafeInteger(payload?.serverTime) || payload.serverTime <= 0
      || limits?.messageLength !== 2000 || limits.nameLength !== 40 || limits.editWindowMs !== 300000) {
      throw new Error("Invalid comment metadata");
    }

    serverOffsetMs = payload.serverTime - Date.now();
    state.limits = limits;
    if (adminToken) scheduleAdminExpiry();
  }

  function isVisible(root) {
    return root.isConnected && !root.hasAttribute("hidden") && !root.closest("[hidden]")
      && document.visibilityState !== "hidden" && root.getClientRects().length > 0;
  }

  function addText(parent, tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function messageElementId(state, id) {
    return `chat-${state.panelId}-${id}`;
  }

  function canEdit(state, message) {
    return !message.deleted && ownMessages.get(state.key)?.has(message.id)
      && Date.now() + serverOffsetMs < message.createdAt + state.limits.editWindowMs;
  }

  function updateForm(state) {
    const length = Array.from(state.text.value).length;
    state.counter.textContent = `${length} / ${state.limits.messageLength}${state.historyPaused ? " · История открыта; автообновление приостановлено до ручного обновления." : ""}`;
    state.text.setCustomValidity(length > state.limits.messageLength ? "В сообщении должно быть не более 2000 символов." : "");
    state.fieldset.disabled = !state.active || !state.loaded || pendingWrites.has(state.key) || (state.closed && !state.editId);
    state.closedNotice.hidden = !state.closed;
    state.refresh.disabled = !state.active || state.loading;
    state.older.hidden = !state.nextBefore;
    state.older.disabled = !state.active || state.loading;
    if (state.authorButton) state.authorButton.disabled = !state.active || !state.loaded || state.closed || pendingWrites.has(state.key);
    state.cancel.hidden = !state.editId && !state.replyTo;
    state.context.hidden = state.cancel.hidden;
    state.context.textContent = state.editId ? "Изменение своего сообщения" : state.replyTo === authorRecipient ? "Сообщение автору user_001" : state.replyTo ? `Ответ пользователю: ${state.replyName}` : "";
    state.submit.textContent = state.editId ? "Сохранить изменение" : "Отправить";
    state.cancel.textContent = state.editId ? "Отменить изменение" : "Отменить ответ";
  }

  function setReply(state, message) {
    cancelFormMode(state);
    state.replyTo = message.id;
    state.replyName = message.name;
    updateForm(state);
    state.text.focus();
  }

  function writeToAuthor(state) {
    if (!state.active || !state.loaded || state.closed || pendingWrites.has(state.key)) return;
    cancelFormMode(state);
    state.replyTo = authorRecipient;
    state.replyName = authorRecipient;
    updateForm(state);
    state.text.focus();
  }

  function cancelFormMode(state) {
    if (state.editId && state.draft) {
      state.text.value = state.draft.text;
    }

    state.editId = null;
    state.replyTo = null;
    state.replyName = "";
    state.draft = null;
    updateForm(state);
  }

  function startEdit(state, message) {
    if (!canEdit(state, message) || pendingWrites.has(state.key)) return;
    cancelFormMode(state);
    state.draft = { text: state.text.value };
    state.editId = message.id;
    state.text.value = message.text;
    updateForm(state);
    state.text.focus();
  }

  async function showReply(state, id) {
    if (id === authorRecipient) return;
    if (!state.messages.has(id)) await loadMessages(state, { id, force: true });
    if (!state.active) return;

    const target = document.getElementById(messageElementId(state, id));
    if (target) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      target.focus({ preventScroll: true });
    }
  }

  function renderMessages(state) {
    clearTimeout(state.editTimer);
    state.messagesElement.replaceChildren();
    let nextEditExpiry = Infinity;
    const messages = Array.from(state.messages.values()).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));

    for (const message of messages) {
      const item = document.createElement("li");
      item.className = "chat-message";
      item.id = messageElementId(state, message.id);
      item.tabIndex = -1;
      const heading = addText(item, "div", "chat-message-heading", "");
      addText(heading, "strong", "chat-message-name", message.name);
      const date = new Date(message.createdAt);
      const time = addText(heading, "time", "chat-message-time", date.toLocaleString("ru-RU"));
      time.dateTime = date.toISOString();
      if (message.updatedAt > message.createdAt) addText(heading, "span", "chat-message-time", "изменено");

      if (message.replyTo === authorRecipient && !message.deleted) {
        addText(item, "p", "chat-reply-preview", "Автор user_001");
      } else if (message.replyTo && !message.deleted) {
        const preview = message.replyPreview;
        const replyLink = addText(item, "a", "chat-reply-preview", preview ? `Ответ: ${preview.name}: ${preview.text}` : "Открыть сообщение, на которое дан ответ");
        replyLink.href = `#${messageElementId(state, message.replyTo)}`;
        replyLink.addEventListener("click", (event) => {
          event.preventDefault();
          void showReply(state, message.replyTo);
        });
      }

      addText(item, "p", "chat-message-text", message.deleted ? "Сообщение удалено владельцем" : message.text);
      const actions = addText(item, "div", "chat-message-actions", "");
      if (!message.deleted) {
        const reply = addText(actions, "button", "", "Комментировать");
        reply.type = "button";
        reply.disabled = pendingWrites.has(state.key) || state.closed;
        reply.addEventListener("click", () => setReply(state, message));
      }
      if (canEdit(state, message)) {
        const edit = addText(actions, "button", "", "Изменить");
        edit.type = "button";
        edit.disabled = pendingWrites.has(state.key);
        edit.addEventListener("click", () => startEdit(state, message));
        nextEditExpiry = Math.min(nextEditExpiry, message.createdAt + state.limits.editWindowMs - Date.now() - serverOffsetMs);
      }

      if (localEnvironment && !message.deleted) {
        const remove = addText(actions, "button", "", state.deleteCandidate === message.id ? "Подтвердить удаление" : "Удалить");
        remove.type = "button";
        remove.disabled = adminBusy;
        remove.addEventListener("click", () => {
          if (state.deleteCandidate === message.id) void deleteMessage(state, message.id);
          else {
            state.deleteCandidate = message.id;
            renderMessages(state);
          }
        });
        if (state.deleteCandidate === message.id) {
          const cancel = addText(actions, "button", "", "Отменить удаление");
          cancel.type = "button";
          cancel.disabled = adminBusy;
          cancel.addEventListener("click", () => { state.deleteCandidate = null; renderMessages(state); });
        }
      }

      state.messagesElement.append(item);
    }

    if (!messages.length) addText(state.messagesElement, "li", "chat-empty", "Сообщений пока нет.");
    if (state.active && Number.isFinite(nextEditExpiry)) {
      state.editTimer = setTimeout(() => renderMessages(state), Math.max(1, nextEditExpiry + 20));
    }
    updateForm(state);
  }

  async function loadMessages(state, options = {}) {
    if (!state.active || (state.loading && !options.force)) return;
    if (state.historyPaused && !options.before && !options.id && !options.resetHistory) return;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = new URL(apiUrl);
    url.searchParams.set("key", state.key);
    if (options.before) url.searchParams.set("before", options.before);
    if (options.id) url.searchParams.set("id", options.id);
    if (!state.loaded) state.status.textContent = "Загружаем сообщения…";
    state.messagesElement.setAttribute("aria-busy", "true");
    updateForm(state);

    try {
      const response = await fetch(url.href, { credentials: "omit", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Comment loading failed");

      const payload = await response.json();
      if (controller.signal.aborted || !state.active || state.controller !== controller) return;
      if (typeof payload.closed !== "boolean" || !Array.isArray(payload.messages) || payload.messages.length > (options.id ? 1 : 50)
        || !payload.messages.every(validMessage)
        || !(payload.nextBefore === null || (typeof payload.nextBefore === "string" && idPattern.test(payload.nextBefore)))) {
        throw new Error("Invalid comments response");
      }
      applyMetadata(state, payload);
      state.closed = payload.closed;
      if (!options.id && !options.before) state.messages.clear();
      for (const message of payload.messages) state.messages.set(message.id, message);
      if (!options.id) state.nextBefore = payload.nextBefore;
      if (options.before || options.id || options.resetHistory) {
        state.historyPaused = !options.resetHistory;
        updatePolling(state);
      }
      state.loaded = true;
      state.status.textContent = "";
      renderMessages(state);
    } catch {
      if (state.active && state.controller === controller) state.status.textContent = "Не удалось загрузить сообщения. Нажмите «Обновить сообщения».";
    } finally {
      clearTimeout(timeout);
      if (state.controller === controller) {
        state.controller = null;
        state.loading = false;
        state.messagesElement.setAttribute("aria-busy", "false");
        updateForm(state);
      }
    }
  }

  function updatePolling(state) {
    clearInterval(state.timer);
    state.timer = null;
    if (state.active && !state.historyPaused) {
      state.timer = setInterval(() => { void loadMessages(state); }, 30000);
    }
  }

  function errorMessage(code) {
    const messages = {
      rate_limited: "Слишком частая отправка. Подождите и попробуйте позже.",
      duplicate: "Такое сообщение повторяется в окне из трёх сообщений.",
      profanity: "Сообщение содержит слова, которые не допускаются в чате.",
      invalid_request: "Проверьте текст сообщения.",
      edit_expired: "Время для изменения сообщения истекло.",
      not_author: "Это сообщение нельзя изменить с этого устройства.",
      reply_not_found: "Сообщение, на которое вы отвечаете, не найдено.",
      invalid_key: "Этот чат недоступен.",
      not_found: "Сообщение не найдено.",
      storage_unavailable: "Чат временно недоступен. Попробуйте позже.",
      chat_closed: "Новые сообщения временно не принимаются.",
      admin_origin_not_allowed: "Управление чатами доступно только из локальной версии сайта.",
      admin_unavailable: "Пароль владельца ещё не настроен на сервере.",
      admin_not_authorized: "Пароль или сессия владельца не приняты.",
      admin_session_expired: "Сессия владельца истекла. Введите пароль снова.",
      stale_message: "Сообщение изменилось. Нажмите «Обновить» перед отметкой просмотра.",
    };
    return Object.hasOwn(messages, code) ? messages[code] : "Не удалось отправить сообщение. Попробуйте ещё раз.";
  }

  async function postComment(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(apiUrl, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(input), credentials: "omit", cache: "no-store", signal: controller.signal,
      });
      return { response, payload: await response.json() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function submitMessage(state) {
    if (!state.active || !state.loaded || pendingWrites.has(state.key) || (state.closed && !state.editId)) return;
    const text = state.text.value.trim();
    if (!text || Array.from(text).length > state.limits.messageLength) {
      state.status.textContent = "Введите сообщение до 2000 символов.";
      return;
    }

    const action = state.editId ? "edit" : "create";
    let input;
    try {
      input = action === "edit"
        ? { action, key: state.key, id: state.editId, text, authorToken: getAuthorToken() }
        : { action, key: state.key, text, authorToken: getAuthorToken(), replyTo: state.replyTo };
    } catch {
      state.status.textContent = "Не удалось создать ключ автора сообщения. Попробуйте другой браузер.";
      return;
    }

    pendingWrites.add(state.key);
    for (const panel of states.values()) if (panel.key === state.key) updateForm(panel);
    state.status.textContent = "Отправляем сообщение…";

    try {
      const { response, payload } = await postComment(input);
      if (!response.ok) {
        const error = new Error("Comment submission failed");
        error.code = payload?.error;
        throw error;
      }
      if (!validMessage(payload.message)) throw new Error("Invalid comment response");
      applyMetadata(state, payload);
      if (action === "create") rememberOwnMessage(state.key, payload.message.id);
      state.text.value = "";
      state.editId = null;
      state.replyTo = null;
      state.replyName = "";
      state.draft = null;
      state.status.textContent = "Сообщение сохранено.";

      for (const panel of states.values()) {
        if (panel.key === state.key) {
          panel.messages.set(payload.message.id, payload.message);
          if (panel.active) {
            renderMessages(panel);
            void loadMessages(panel, { force: true });
          }
        }
      }
    } catch (error) {
      state.status.textContent = errorMessage(error.code);
    } finally {
      pendingWrites.delete(state.key);
      for (const panel of states.values()) if (panel.key === state.key) {
        if (panel.active) renderMessages(panel);
        else updateForm(panel);
      }
    }
  }

  function applyUnreadCount(payload) {
    if (!Number.isSafeInteger(payload.unreadCount) || payload.unreadCount < 0) throw new Error("Invalid unread count");
    unreadCount = payload.unreadCount;
    updateOwnerPanel();
  }

  function syncOwnerPolling() {
    const enabled = localEnvironment && adminToken && ownerPanel && isVisible(ownerPanel.root);
    if (!enabled) {
      clearInterval(ownerPollTimer);
      ownerPollTimer = null;
      return;
    }
    if (ownerPollTimer) return;
    const refresh = () => {
      if (!adminToken || adminExpiresAt <= Date.now() + serverOffsetMs) {
        logoutOwner();
        return;
      }
      void performOwnerAction(async () => { applyAdminStatus(await adminRequest("admin-status", "*")); }, false);
    };
    ownerPollTimer = setInterval(refresh, 60000);
    if (!adminStatus) refresh();
  }

  function closeInbox() {
    if (!inbox) return;
    if (inbox.busy) {
      ownerActionVersion++;
      adminBusy = false;
    }
    inbox.version++;
    inbox.busy = false;
    inbox.pages = [];
    inbox.replyForm.hidden = true;
    inbox.text.value = "";
    inbox.content.replaceChildren();
    inbox.position.textContent = "";
    inbox.status.textContent = "";
    if (inbox.dialog.open) inbox.dialog.close();
    updateOwnerPanel();
  }

  function selectedInboxMessage() {
    return inbox?.pages[inbox.pageIndex]?.messages[inbox.messageIndex] || null;
  }

  function updateInboxControls() {
    if (!inbox) return;
    const page = inbox.pages[inbox.pageIndex];
    const message = selectedInboxMessage();
    const busy = inbox.busy || adminBusy;
    inbox.previous.disabled = busy || !message || inbox.messageIndex === 0;
    inbox.next.disabled = busy || !message || inbox.messageIndex >= page.messages.length - 1;
    inbox.older.disabled = busy || (!page?.nextBefore && !inbox.pages[inbox.pageIndex + 1]);
    inbox.newer.disabled = busy || inbox.pageIndex === 0;
    inbox.refresh.disabled = busy;
    inbox.read.disabled = busy || !message || message.read || message.deleted;
    inbox.reply.disabled = busy || !message || message.deleted;
    inbox.remove.disabled = busy || !message || message.deleted;
    inbox.replyFieldset.disabled = busy;
    const length = Array.from(inbox.text.value).length;
    inbox.counter.textContent = `${length} / 2000`;
    inbox.text.setCustomValidity(length > 2000 ? "В ответе должно быть не более 2000 символов." : "");
  }

  function renderInbox() {
    if (!inbox) return;
    inbox.content.replaceChildren();
    const message = selectedInboxMessage();
    if (!message) {
      addText(inbox.content, "p", "chat-empty", inbox.busy ? "Загружаем сообщения автору…" : "Сообщений автору пока нет.");
      inbox.position.textContent = "";
    } else {
      const heading = addText(inbox.content, "div", "chat-message-heading", "");
      addText(heading, "strong", "chat-message-name", message.name);
      addText(heading, "span", "chat-message-time", new Date(message.createdAt).toLocaleString("ru-RU"));
      addText(inbox.content, "p", "chat-inbox-meta", `Чат: ${message.key} · ${message.read ? "Просмотрено" : "Не просмотрено"}`);
      addText(inbox.content, "p", "chat-message-text", message.deleted ? "Сообщение удалено владельцем" : message.text);
      inbox.position.textContent = `Сообщение ${inbox.messageIndex + 1} из ${inbox.pages[inbox.pageIndex].messages.length} · Страница ${inbox.pageIndex + 1}`;
    }
    updateInboxControls();
  }

  function createInbox() {
    if (inbox || !localEnvironment) return;
    const dialog = document.createElement("dialog");
    dialog.className = "chat-owner-dialog chat-inbox-dialog ym-hide-content ym-disable-clickmap ym-disable-submit";
    dialog.setAttribute("aria-label", "Сообщения автору");
    const heading = addText(dialog, "div", "chat-message-heading", "");
    addText(heading, "h3", "", "Сообщения автору");
    const close = addText(heading, "button", "", "Закрыть");
    close.type = "button";
    close.addEventListener("click", closeInbox);
    const status = addText(dialog, "p", "chat-owner-status", "");
    status.setAttribute("role", "status");
    const content = addText(dialog, "article", "chat-inbox-message", "");
    const position = addText(dialog, "p", "chat-counter", "");
    const navigation = addText(dialog, "div", "chat-owner-actions", "");
    function button(parent, text, handler) {
      const element = addText(parent, "button", "", text);
      element.type = "button";
      element.addEventListener("click", handler);
      return element;
    }
    const previous = button(navigation, "Предыдущее сообщение", () => moveInboxMessage(-1));
    const next = button(navigation, "Следующее сообщение", () => moveInboxMessage(1));
    const older = button(navigation, "Предыдущая страница", () => moveInboxPage(1));
    const newer = button(navigation, "Следующая страница", () => moveInboxPage(-1));
    const refresh = button(navigation, "Обновить", () => requireOwnerAction(() => loadInboxPage()));
    const actions = addText(dialog, "div", "chat-owner-actions", "");
    const read = button(actions, "Просмотрено", () => { const message = selectedInboxMessage(); if (message) inboxMutation("admin-read", message); });
    const reply = button(actions, "Ответить", () => { inbox.replyForm.hidden = false; inbox.text.focus(); });
    const remove = button(actions, "Удалить сообщение", () => { const message = selectedInboxMessage(); if (message) inboxMutation("admin-delete", message); });
    const replyForm = addText(dialog, "form", "chat-inbox-reply", "");
    replyForm.hidden = true;
    const replyFieldset = addText(replyForm, "fieldset", "", "");
    const label = addText(replyFieldset, "label", "", "Ответ автора user_001");
    const text = document.createElement("textarea");
    text.className = "ym-disable-keys";
    text.rows = 5;
    text.maxLength = 4000;
    text.required = true;
    label.append(text);
    const counter = addText(replyFieldset, "p", "chat-counter", "0 / 2000");
    const replyActions = addText(replyFieldset, "div", "chat-owner-actions", "");
    const submit = addText(replyActions, "button", "", "Ответить");
    submit.type = "submit";
    button(replyActions, "Отмена", () => { replyForm.hidden = true; text.value = ""; updateInboxControls(); });
    text.addEventListener("input", updateInboxControls);
    replyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const message = selectedInboxMessage();
      const value = text.value.trim();
      if (!message || !value || Array.from(value).length > 2000) {
        status.textContent = "Введите ответ до 2000 символов.";
        return;
      }
      inboxMutation("admin-reply", message, value);
    });
    dialog.addEventListener("cancel", closeInbox);
    dialog.addEventListener("close", () => { if (!dialog.open) closeInbox(); });
    document.body.append(dialog);
    inbox = { dialog, status, content, position, previous, next, older, newer, refresh, read, reply, remove,
      replyForm, replyFieldset, text, counter, pages: [], pageIndex: 0, messageIndex: 0, busy: false, version: 0 };
  }

  function prepareInbox() {
    createInbox();
    if (!inbox || typeof inbox.dialog.showModal !== "function") throw new Error("Inbox dialog unavailable");
    if (!inbox.dialog.open) {
      inbox.version++;
      inbox.dialog.showModal();
    }
  }

  function openInbox() {
    requireOwnerAction(async () => {
      prepareInbox();
      await loadInboxPage();
    });
  }

  async function loadInboxPage(before = null) {
    if (!inbox?.dialog.open) return;
    const version = ++inbox.version;
    inbox.busy = true;
    inbox.status.textContent = "Загружаем сообщения автору…";
    renderInbox();
    try {
      const payload = await adminRequest("admin-inbox", "*", before ? { before } : {});
      if (version !== inbox.version || !inbox.dialog.open) return;
      if (!Array.isArray(payload.messages) || payload.messages.length > 50 || !payload.messages.every((message) =>
        validMessage(message) && typeof message.key === "string" && keyPattern.test(message.key) && typeof message.read === "boolean")
        || new Set(payload.messages.map((message) => message.id)).size !== payload.messages.length
        || !(payload.nextBefore === null || (typeof payload.nextBefore === "string" && idPattern.test(payload.nextBefore)))) {
        throw new Error("Invalid inbox response");
      }
      applyMetadata({ limits: null }, payload);
      if (version !== inbox.version || !inbox.dialog.open) return;
      applyUnreadCount(payload);
      const page = { messages: payload.messages, nextBefore: payload.nextBefore };
      if (before) {
        inbox.pages.push(page);
        inbox.pageIndex = inbox.pages.length - 1;
      } else {
        inbox.pages = [page];
        inbox.pageIndex = 0;
      }
      inbox.messageIndex = Math.max(0, page.messages.length - 1);
      inbox.replyForm.hidden = true;
      inbox.text.value = "";
      inbox.status.textContent = "";
    } catch (error) {
      if (version !== inbox.version || !inbox.dialog.open || error.cancelled) return;
      inbox.status.textContent = "Не удалось загрузить сообщения автору. Нажмите «Обновить».";
      throw error;
    } finally {
      if (version === inbox.version && inbox.dialog.open) {
        inbox.busy = false;
        renderInbox();
      }
    }
  }

  function moveInboxMessage(offset) {
    if (!inbox || inbox.busy || adminBusy) return;
    const next = inbox.messageIndex + offset;
    if (next < 0 || next >= inbox.pages[inbox.pageIndex].messages.length) return;
    inbox.messageIndex = next;
    inbox.replyForm.hidden = true;
    inbox.text.value = "";
    inbox.status.textContent = "";
    renderInbox();
  }

  function moveInboxPage(offset) {
    if (!inbox || inbox.busy || adminBusy) return;
    const next = inbox.pageIndex + offset;
    if (next < 0) return;
    if (inbox.pages[next]) {
      inbox.pageIndex = next;
      inbox.messageIndex = offset > 0 ? inbox.pages[next].messages.length - 1 : 0;
      inbox.replyForm.hidden = true;
      inbox.text.value = "";
      inbox.status.textContent = "";
      renderInbox();
    } else {
      const before = inbox.pages[inbox.pageIndex]?.nextBefore;
      if (offset > 0 && before) requireOwnerAction(() => loadInboxPage(before));
    }
  }

  function publishOwnerMessage(key, message) {
    for (const panel of states.values()) {
      if (panel.key !== key) continue;
      panel.messages.set(message.id, message);
      if (message.deleted) {
        for (const [id, reply] of panel.messages) {
          if (reply.replyTo === message.id) panel.messages.set(id, { ...reply, replyPreview: { id: message.id, name: "", text: "Сообщение удалено владельцем" } });
        }
        panel.deleteCandidate = null;
        if (panel.editId === message.id || panel.replyTo === message.id) cancelFormMode(panel);
      }
      if (panel.active) renderMessages(panel);
    }
  }

  function inboxMutation(action, message, text = null) {
    if (!inbox || inbox.busy || adminBusy) return;
    requireOwnerAction(async () => {
      prepareInbox();
      if (!inbox.pages.length) {
        inbox.pages = [{ messages: [message], nextBefore: null }];
        inbox.pageIndex = 0;
        inbox.messageIndex = 0;
      }
      const version = inbox.version;
      inbox.busy = true;
      inbox.status.textContent = "Сохраняем действие…";
      updateInboxControls();
      try {
        const payload = await adminRequest(action, message.key, { id: message.id,
          ...(action === "admin-read" ? { updatedAt: message.updatedAt } : {}), ...(action === "admin-reply" ? { text } : {}) });
        if (version !== inbox.version || !inbox.dialog.open) return;
        if (action !== "admin-read" && (!validMessage(payload.message)
          || (action === "admin-delete" ? !payload.message.deleted || payload.message.id !== message.id
            : payload.message.name !== authorRecipient || payload.message.replyTo !== message.id))) throw new Error("Invalid inbox mutation");
        applyMetadata({ limits: null }, payload);
        if (version !== inbox.version || !inbox.dialog.open) return;
        applyUnreadCount(payload);
        for (const page of inbox.pages) page.messages = page.messages.map((item) => item.id !== message.id ? item
          : action === "admin-read" ? { ...item, read: true }
            : action === "admin-delete" ? { ...payload.message, key: item.key, read: true } : item);
        if (payload.message) publishOwnerMessage(message.key, payload.message);
        if (action === "admin-reply") {
          inbox.replyForm.hidden = true;
          inbox.text.value = "";
        }
        inbox.status.textContent = action === "admin-read" ? "Отмечено как просмотренное." : action === "admin-reply" ? "Ответ отправлен в исходный чат." : "Сообщение удалено.";
      } catch (error) {
        if (version !== inbox.version || !inbox.dialog.open || error.cancelled) return;
        inbox.status.textContent = errorMessage(error.code);
        throw error;
      } finally {
        if (version === inbox.version && inbox.dialog.open) {
          inbox.busy = false;
          renderInbox();
        }
      }
    });
  }

  function applyAdminStatus(payload) {
    if (typeof payload.globalClosed !== "boolean" || !Array.isArray(payload.closedKeys)
      || payload.closedKeys.length > 10000 || !payload.closedKeys.every((key) => typeof key === "string" && keyPattern.test(key))
      || !Array.isArray(payload.discussionKeys) || payload.discussionKeys.length > 10001
      || !payload.discussionKeys.every((key) => typeof key === "string" && keyPattern.test(key))
      || new Set(payload.discussionKeys).size !== payload.discussionKeys.length) {
      throw new Error("Invalid owner status");
    }
    const token = adminToken;
    applyMetadata({ limits: null }, payload);
    if (token && token !== adminToken) return;
    applyUnreadCount(payload);
    adminStatus = { globalClosed: payload.globalClosed, closedKeys: new Set(payload.closedKeys) };
    if (ownerPanel) {
      for (const key of payload.discussionKeys) {
        if (!ownerPanel.titles.has(key)) ownerPanel.titles.set(key, key);
      }
      updateOwnerChoices();
    }
    for (const state of states.values()) {
      state.closed = adminStatus.globalClosed || adminStatus.closedKeys.has(state.key);
      if (state.active) renderMessages(state);
      else updateForm(state);
    }
    updateOwnerPanel();
  }

  async function adminRequest(action, key, extra = {}, token = adminToken) {
    if (!localEnvironment || !token) throw new Error("Owner access unavailable");
    const sessionVersion = ownerSessionVersion;
    const { response, payload } = await postComment({ action, key, ...extra, adminToken: token });
    if (sessionVersion !== ownerSessionVersion || token !== adminToken) {
      const error = new Error("Owner session changed");
      error.cancelled = true;
      throw error;
    }
    if (!response.ok) {
      const error = new Error("Owner request failed");
      error.code = payload?.error;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function updateOwnerPanel() {
    if (!ownerPanel) return;
    for (const button of ownerPanel.controls.querySelectorAll("button")) button.disabled = adminBusy;
    ownerPanel.select.disabled = adminBusy;
    ownerPanel.bell.hidden = !adminToken || !adminStatus;
    ownerPanel.bell.textContent = `🔔 Автору: ${unreadCount}`;
    ownerPanel.bell.setAttribute("aria-label", `Сообщения автору, непрочитанных: ${unreadCount}`);
    if (adminToken && adminStatus) {
      ownerPanel.summary.textContent = `Запись во всех чатах: ${adminStatus.globalClosed ? "закрыта" : "открыта"}. Выбранный чат: ${adminStatus.closedKeys.has(ownerPanel.select.value) ? "закрыт отдельно" : "не закрыт отдельно"}.`;
    } else {
      ownerPanel.summary.textContent = adminToken ? "Вход сохранён на 30 минут. Обновите состояние чатов." : "При выборе действия управления потребуется пароль владельца.";
    }
    syncOwnerPolling();
  }

  function updateOwnerChoices() {
    if (!ownerPanel) return;
    const previous = ownerPanel.select.value || "for-ai";
    for (const state of states.values()) {
      if (!ownerPanel.titles.has(state.key)) {
        const title = state.root.closest(".sos-item, .entry-card")?.querySelector("summary, h2, h3, h4")?.textContent || state.key;
        ownerPanel.titles.set(state.key, title);
      }
    }

    ownerPanel.select.replaceChildren();
    for (const [key, title] of ownerPanel.titles) {
      const option = addText(ownerPanel.select, "option", "", key === "for-ai" ? title : `${title} — ${key}`);
      option.value = key;
    }
    ownerPanel.select.value = ownerPanel.titles.has(previous) ? previous : "for-ai";
    updateOwnerPanel();
  }

  function logoutOwner() {
    ownerSessionVersion++;
    adminToken = null;
    adminExpiresAt = 0;
    adminStatus = null;
    adminBusy = false;
    unreadCount = 0;
    clearInterval(ownerPollTimer);
    ownerPollTimer = null;
    closeInbox();
    clearTimeout(adminExpiryTimer);
    try {
      sessionStorage.removeItem(adminSessionKey);
    } catch {
      // Недоступное хранилище не мешает удалить сессию из памяти страницы
    }
    if (ownerPanel) {
      ownerPanel.status.textContent = "Управление отключено.";
      ownerPanel.summary.textContent = "";
    }
    for (const state of states.values()) {
      state.deleteCandidate = null;
      if (state.active) renderMessages(state);
    }
    updateOwnerPanel();
  }

  function scheduleAdminExpiry() {
    clearTimeout(adminExpiryTimer);
    const remaining = adminExpiresAt - Date.now() - serverOffsetMs;
    if (remaining <= 0) {
      logoutOwner();
      return;
    }
    adminExpiryTimer = setTimeout(logoutOwner, remaining);
  }

  function readAdminSession() {
    if (!localEnvironment) return;
    try {
      const session = JSON.parse(sessionStorage.getItem(adminSessionKey) || "null");
      const serverNow = Number.isSafeInteger(session?.serverOffsetMs) ? Date.now() + session.serverOffsetMs : NaN;
      if (session && /^[0-9a-f]{64}$/.test(session.token) && Number.isSafeInteger(session.expiresAt)
        && Number.isSafeInteger(serverNow) && session.expiresAt > serverNow && session.expiresAt <= serverNow + 1800000) {
        serverOffsetMs = session.serverOffsetMs;
        adminToken = session.token;
        adminExpiresAt = session.expiresAt;
        scheduleAdminExpiry();
      } else sessionStorage.removeItem(adminSessionKey);
    } catch {
      // Без sessionStorage вход действует только до закрытия текущей страницы
    }
  }

  async function loadOwnerChoices() {
    if (!ownerPanel) return;
    try {
      const response = await fetch("/data/entries.json", { credentials: "omit", cache: "no-store" });
      if (response.ok) {
        const entries = await response.json();
        if (Array.isArray(entries)) for (const entry of entries) {
          if (entry.published && ["manual_transcription", "analysis"].includes(entry.type)
            && typeof entry.reactionKey === "string" && keyPattern.test(entry.reactionKey)) {
            ownerPanel.titles.set(entry.reactionKey, typeof entry.title === "string" ? entry.title : entry.reactionKey);
          }
        }
        updateOwnerChoices();
      }
    } catch {
      // При ошибке каталога остаются доступными чаты текущей страницы
    }
  }

  function ownerStatus(text) {
    if (ownerPanel) ownerPanel.status.textContent = text;
  }

  async function performOwnerAction(action, promptOnAuthFailure = true) {
    if (!localEnvironment || adminBusy) return;
    adminBusy = true;
    const sessionVersion = ownerSessionVersion;
    const actionVersion = ++ownerActionVersion;
    updateOwnerPanel();
    try {
      await action();
    } catch (error) {
      if (error.cancelled || sessionVersion !== ownerSessionVersion || actionVersion !== ownerActionVersion) return;
      if (error.status === 401) {
        logoutOwner();
        if (promptOnAuthFailure) {
          pendingOwnerAction = action;
          showOwnerLogin();
        }
      } else ownerStatus(errorMessage(error.code));
    } finally {
      if (sessionVersion === ownerSessionVersion && actionVersion === ownerActionVersion) {
        adminBusy = false;
        updateOwnerPanel();
        for (const state of states.values()) if (state.active) renderMessages(state);
        if (inbox?.dialog.open) updateInboxControls();
      }
    }
  }

  function requireOwnerAction(action) {
    if (!localEnvironment || adminBusy) return;
    if (adminToken && adminExpiresAt > Date.now() + serverOffsetMs) void performOwnerAction(action);
    else {
      logoutOwner();
      pendingOwnerAction = action;
      showOwnerLogin();
    }
  }

  function clearOwnerLogin() {
    ownerLoginVersion++;
    pendingOwnerAction = null;
    if (adminDialog) {
      adminDialog.password.value = "";
      adminDialog.submit.disabled = false;
    }
  }

  function showOwnerLogin() {
    if (!localEnvironment) return;
    if (!adminDialog) {
      const dialog = document.createElement("dialog");
      dialog.className = "chat-owner-dialog ym-hide-content ym-disable-clickmap ym-disable-submit";
      dialog.setAttribute("aria-label", "Пароль владельца");
      const form = addText(dialog, "form", "chat-owner-login", "");
      addText(form, "h3", "", "Пароль владельца");
      const label = addText(form, "label", "", "Пароль");
      const password = document.createElement("input");
      password.className = "ym-disable-keys";
      password.type = "password";
      password.autocomplete = "off";
      password.maxLength = 1024;
      password.required = true;
      label.append(password);
      const status = addText(form, "p", "chat-owner-status", "");
      status.setAttribute("role", "status");
      const buttons = addText(form, "div", "chat-owner-actions", "");
      const submit = addText(buttons, "button", "", "Войти на 30 минут");
      submit.type = "submit";
      const cancel = addText(buttons, "button", "", "Отменить");
      cancel.type = "button";
      cancel.addEventListener("click", () => { clearOwnerLogin(); dialog.close(); });
      form.addEventListener("submit", (event) => { event.preventDefault(); void loginOwner(); });
      dialog.addEventListener("cancel", clearOwnerLogin);
      dialog.addEventListener("close", () => { if (!dialog.open) clearOwnerLogin(); });
      document.body.append(dialog);
      adminDialog = { dialog, form, password, status, submit };
    }
    if (typeof adminDialog.dialog.showModal !== "function") {
      ownerStatus("Браузер не поддерживает окно входа владельца.");
      return;
    }
    adminDialog.status.textContent = "Пароль не сохраняется. В этой вкладке сохранится только временная сессия на 30 минут.";
    if (!adminDialog.dialog.open) {
      ownerLoginVersion++;
      adminDialog.submit.disabled = false;
      adminDialog.dialog.showModal();
    }
    adminDialog.password.focus();
  }

  async function loginOwner() {
    if (!localEnvironment || !adminDialog || adminDialog.submit.disabled) return;
    const password = adminDialog.password.value;
    adminDialog.password.value = "";
    if (!password) return;
    const loginVersion = ++ownerLoginVersion;
    adminDialog.submit.disabled = true;
    adminDialog.status.textContent = "Проверяем пароль…";
    try {
      const { response, payload } = await postComment({ action: "admin-login", key: "*", password });
      if (loginVersion !== ownerLoginVersion || !adminDialog.dialog.open) return;
      if (!response.ok) {
        const error = new Error("Owner login failed");
        error.code = payload?.error;
        throw error;
      }
      if (!/^[0-9a-f]{64}$/.test(payload.adminToken) || !Number.isSafeInteger(payload.expiresAt)
        || payload.expiresAt <= payload.serverTime || payload.expiresAt > payload.serverTime + 1800000) throw new Error("Invalid owner session");
      applyAdminStatus(payload);
      ownerSessionVersion++;
      adminToken = payload.adminToken;
      adminExpiresAt = payload.expiresAt;
      try {
        sessionStorage.setItem(adminSessionKey, JSON.stringify({ token: adminToken, expiresAt: adminExpiresAt, serverOffsetMs }));
      } catch {
        // Пароль не сохраняется даже при недоступном хранилище сессии
      }
      scheduleAdminExpiry();
      const action = pendingOwnerAction;
      pendingOwnerAction = null;
      adminDialog.dialog.close();
      ownerStatus("Вход выполнен на 30 минут.");
      updateOwnerPanel();
      void loadOwnerChoices();
      if (action) void performOwnerAction(action);
    } catch (error) {
      if (loginVersion === ownerLoginVersion && adminDialog.dialog.open) adminDialog.status.textContent = errorMessage(error.code);
    } finally {
      if (loginVersion === ownerLoginVersion) {
        adminDialog.password.value = "";
        adminDialog.submit.disabled = false;
      }
    }
  }

  function changeLock(key, closed) {
    requireOwnerAction(async () => {
      ownerStatus("Сохраняем настройку…");
      applyAdminStatus(await adminRequest("admin-lock", key, { closed }));
      ownerStatus("Настройка сохранена.");
    });
  }

  function deleteMessage(state, id) {
    requireOwnerAction(async () => {
      try {
        state.status.textContent = "Удаляем сообщение…";
        const payload = await adminRequest("admin-delete", state.key, { id });
        if (!validMessage(payload.message) || !payload.message.deleted || payload.message.id !== id) throw new Error("Invalid deletion response");
        applyMetadata(state, payload);
        if (!adminToken) return;
        applyUnreadCount(payload);
        publishOwnerMessage(state.key, payload.message);
        state.status.textContent = "Сообщение удалено владельцем.";
      } catch (error) {
        state.status.textContent = errorMessage(error.code);
        throw error;
      }
    });
  }

  function openOwnerChat() {
    requireOwnerAction(async () => {
      applyAdminStatus(await adminRequest("admin-status", "*"));
      performOpenOwnerChat();
    });
  }

  function performOpenOwnerChat() {
    if (!ownerPanel || !localEnvironment) return;
    const key = ownerPanel.select.value;
    if (!keyPattern.test(key)) return;
    let root = Array.from(states.values()).find((state) => state.key === key && ownerPanel.container.contains(state.root))?.root;
    if (!root) {
      root = document.createElement("div");
      root.className = "transcription-chat";
      root.dataset.transcriptionChat = key;
      root.hidden = true;
      ownerPanel.container.insertBefore(root, ownerPanel.root);
      mount(root);
    }

    for (let ancestor = root.parentElement; ancestor && ancestor !== ownerPanel.container; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === "DETAILS") ancestor.open = true;
    }
    root.removeAttribute("hidden");
    syncVisibility();
    root.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function createOwnerPanel() {
    const container = document.getElementById("for-ai");
    if (!localEnvironment || !container) return;
    const root = document.createElement("section");
    root.className = "chat-owner-panel ym-hide-content ym-disable-clickmap ym-disable-submit";
    addText(root, "h3", "", "Управление чатами (локально)");
    const status = addText(root, "p", "chat-owner-status", "");
    status.setAttribute("role", "status");
    const controls = addText(root, "div", "", "");
    const selectLabel = addText(controls, "label", "", "Чат");
    const select = document.createElement("select");
    selectLabel.append(select);
    const summary = addText(controls, "p", "chat-owner-status", "");
    const actions = addText(controls, "div", "chat-owner-actions", "");
    const buttons = [
      ["Открыть чат", openOwnerChat],
      ["Обновить состояние", () => requireOwnerAction(async () => { applyAdminStatus(await adminRequest("admin-status", "*")); })],
      ["Закрыть запись в выбранном чате", () => { void changeLock(select.value, true); }],
      ["Открыть запись в выбранном чате", () => { void changeLock(select.value, false); }],
      ["Закрыть запись во всех чатах", () => { void changeLock("*", true); }],
      ["Открыть запись во всех чатах", () => { void changeLock("*", false); }],
      ["Выйти", logoutOwner],
    ];
    for (const [text, handler] of buttons) {
      const button = addText(actions, "button", "", text);
      button.type = "button";
      button.addEventListener("click", handler);
    }

    const bell = addText(actions, "button", "chat-inbox-bell", "🔔 Автору: 0");
    bell.type = "button";
    bell.hidden = true;
    bell.addEventListener("click", openInbox);

    ownerPanel = { root, container, status, controls, select, summary, bell, titles: new Map([["for-ai", "Общий чат для ИИ"]]) };
    select.addEventListener("change", updateOwnerPanel);
    container.append(root);
    updateOwnerChoices();
  }

  function mount(root) {
    if (states.has(root) || !keyPattern.test(root.dataset.transcriptionChat || "")) return;
    if (!root.children.length) root.append(...Array.from(templateRoot.childNodes, (node) => node.cloneNode(true)));
    root.classList.add("transcription-chat", "ym-hide-content", "ym-disable-clickmap", "ym-disable-submit");
    const form = root.querySelector("[data-chat-form]");
    if (!form || form.dataset.chatApi !== apiUrl) return;

    const state = {
      root, key: root.dataset.transcriptionChat, panelId: ++panelSequence, form,
      fieldset: form.querySelector("fieldset"), text: form.querySelector('[name="text"]'),
      messagesElement: root.querySelector("[data-chat-messages]"), status: root.querySelector("[data-chat-status]"), closedNotice: root.querySelector("[data-chat-closed]"),
      refresh: root.querySelector("[data-chat-refresh]"), older: root.querySelector("[data-chat-older]"),
      authorButton: root.querySelector("[data-chat-author]"),
      context: form.querySelector("[data-chat-context]"), counter: form.querySelector("[data-chat-counter]"),
      submit: form.querySelector("[data-chat-submit]"), cancel: form.querySelector("[data-chat-cancel]"),
      limits: { messageLength: 2000, nameLength: 40, editWindowMs: 300000 }, messages: new Map(),
      loaded: false, loading: false, active: false, closed: false, historyPaused: false, controller: null, timer: null, editTimer: null,
      nextBefore: null, replyTo: null, replyName: "", editId: null, draft: null, deleteCandidate: null,
    };
    if ([state.fieldset, state.text, state.messagesElement, state.status, state.closedNotice, state.refresh,
      state.older, state.context, state.counter, state.submit, state.cancel].some((element) => !element)) return;

    states.set(root, state);
    form.addEventListener("submit", (event) => { event.preventDefault(); void submitMessage(state); });
    state.text.addEventListener("input", () => updateForm(state));
    state.cancel.addEventListener("click", () => cancelFormMode(state));
    state.refresh.addEventListener("click", () => { void loadMessages(state, { force: true, resetHistory: true }); });
    state.older.addEventListener("click", () => { if (state.nextBefore) void loadMessages(state, { before: state.nextBefore }); });
    state.authorButton?.addEventListener("click", () => writeToAuthor(state));
    updateForm(state);
    updateOwnerChoices();
  }

  function mountWithin(node) {
    if (node.nodeType !== 1) return;
    if (node.matches("[data-transcription-chat]")) mount(node);
    for (const root of node.querySelectorAll("[data-transcription-chat]")) mount(root);
  }

  function syncVisibility() {
    for (const [root, state] of states) {
      const active = isVisible(root);
      if (active !== state.active) {
        state.active = active;
        clearInterval(state.timer);
        clearTimeout(state.editTimer);
        state.controller?.abort();
        if (active) {
          if (state.loaded) renderMessages(state);
          void loadMessages(state, { force: true });
          updatePolling(state);
        }
        updateForm(state);
      }
      if (!root.isConnected) states.delete(root);
    }
    syncOwnerPolling();
  }

  readOwnMessages();
  window.addEventListener("storage", (event) => {
    if (event.key !== ownStorageKey || event.newValue === null) return;
    try {
      mergeOwnMessages(event.newValue);
      saveOwnMessages();
      for (const state of states.values()) if (state.active) renderMessages(state);
    } catch {
      // Повреждённая запись другой вкладки не стирает текущие сведения об авторстве
    }
  });
  readAdminSession();
  mountWithin(document.body);
  createOwnerPanel();
  syncVisibility();
  const observer = new MutationObserver((records) => {
    let visibilityChanged = false;
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) mountWithin(node);
        visibilityChanged = true;
      } else if (record.attributeName !== "class" || record.target.matches("[data-panel]")) {
        visibilityChanged = true;
      }
    }
    if (visibilityChanged) syncVisibility();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "class"] });
  document.addEventListener("visibilitychange", syncVisibility);
  window.addEventListener("resize", syncVisibility);
  window.addEventListener("pagehide", () => {
    ownerSessionVersion++;
    adminToken = null;
    adminExpiresAt = 0;
    clearTimeout(adminExpiryTimer);
    clearInterval(ownerPollTimer);
    ownerPollTimer = null;
    adminBusy = false;
    adminStatus = null;
    unreadCount = 0;
    clearOwnerLogin();
    closeInbox();
    updateOwnerPanel();
    observer.disconnect();
    for (const state of states.values()) {
      clearInterval(state.timer);
      clearTimeout(state.editTimer);
      state.controller?.abort();
      state.active = false;
    }
  });
  window.addEventListener("pageshow", () => {
    readAdminSession();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "class"] });
    syncVisibility();
  });
})();
