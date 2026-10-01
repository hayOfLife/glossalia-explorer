import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../public_html/assets/comments.js', import.meta.url), 'utf8');
const bootPosition = source.indexOf('  readAdminSession();');
assert.notEqual(bootPosition, -1);
const isolatedSource = source.slice(0, bootPosition) + `
  globalThis.commentTest = { requireOwnerAction, getAuthorToken, rememberOwnMessage, canEdit,
    createOwnerPanel, openInbox, validMessage, writeToAuthor, renderMessages, showReply, syncOwnerPolling,
    logoutOwner, states, getInbox() { return inbox; }, getOwnerPanel() { return ownerPanel; } };
})();`;
const authorKey = 'glossaliae-comment-author';
const ownKey = 'glossaliae-comment-own-messages';
const sessionKey = 'glossaliae-comment-admin-session';
const limits = { messageLength: 2000, nameLength: 40, editWindowMs: 300000 };

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.open = false;
    this.hidden = false;
    this.isConnected = true;
    this.dataset = {};
    this.classList = { add() {} };
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  closest() { return null; }
  querySelectorAll(selector) {
    return descendants(this).filter((element) => selector === 'button' && element.tagName === 'BUTTON');
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setCustomValidity(value) { this.validationMessage = value; }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }

  dispatch(name, properties = {}) {
    const event = { target: this, preventDefault() {}, ...properties };
    for (const listener of this.listeners.get(name) || []) listener(event);
  }

  showModal() { this.open = true; }
  close() {
    this.open = false;
    queueMicrotask(() => this.dispatch('close'));
  }

  focus() {}
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function browser(storage = new Map(), options = {}) {
  const body = new Element('body');
  const session = new Map();
  const requests = [];
  const storageWrites = [];
  const handlers = new Map();
  const intervals = new Map();
  let timerSequence = 0;
  const ownerContainer = options.ownerPanel ? new Element('section') : null;
  if (ownerContainer) body.append(ownerContainer);
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storageWrites.push(key);
      storage.set(key, String(value));
    },
    removeItem: (key) => storage.delete(key),
  };
  const context = createContext({
    document: {
      body,
      visibilityState: 'visible',
      getElementById: (id) => id === 'transcription-chat-template'
        ? { content: { querySelector: () => new Element('div') } } : id === 'for-ai' ? ownerContainer : null,
      createElement: (tag) => new Element(tag),
    },
    window: {
      location: { hostname: options.hostname || 'localhost' },
      addEventListener: (name, handler) => {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(handler);
      },
    },
    localStorage,
    sessionStorage: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, String(value)),
      removeItem: (key) => session.delete(key),
    },
    fetch: (url, options) => new Promise((resolve, reject) => {
      requests.push({ url, options, resolve, reject });
    }),
    crypto: webcrypto,
    AbortController,
    URL,
    Date,
    setTimeout: () => ++timerSequence,
    clearTimeout() {},
    setInterval: (handler, milliseconds) => { const id = ++timerSequence; intervals.set(id, { handler, milliseconds }); return id; },
    clearInterval: (id) => intervals.delete(id),
  });
  runInContext(isolatedSource, context);

  function loginControls() {
    const dialog = body.children.find((child) => child.tagName === 'DIALOG');
    const elements = descendants(dialog);
    return {
      dialog,
      form: elements.find((element) => element.tagName === 'FORM'),
      password: elements.find((element) => element.tagName === 'INPUT'),
      status: elements.find((element) => element.className === 'chat-owner-status'),
      submit: elements.find((element) => element.tagName === 'BUTTON' && element.type === 'submit'),
      cancel: elements.find((element) => element.tagName === 'BUTTON' && element.textContent === 'Отменить'),
    };
  }

  return {
    api: context.commentTest,
    session,
    requests,
    storageWrites,
    intervals,
    document: context.document,
    loginControls,
    storageEvent: () => {
      const event = { key: ownKey, newValue: storage.get(ownKey), storageArea: localStorage };
      for (const handler of handlers.get('storage') || []) handler(event);
    },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function completeLogin(request, number = 1, unreadCount = 0) {
  const serverTime = Date.now();
  request.resolve({
    ok: true,
    json: async () => ({
      adminToken: number.toString(16).padStart(64, '0'),
      expiresAt: serverTime + 1800000,
      serverTime,
      limits,
      globalClosed: false,
      closedKeys: [],
      discussionKeys: ['for-ai'],
      unreadCount,
    }),
  });
}

function startLogin(tab, action) {
  tab.api.requireOwnerAction(action);
  const controls = tab.loginControls();
  controls.password.value = 'synthetic-test-password';
  controls.form.dispatch('submit');
  return controls;
}

test('cancelled owner login cannot save a session or perform its pending action', async () => {
  const tab = browser();
  let actions = 0;
  const controls = startLogin(tab, async () => { actions++; });
  controls.cancel.dispatch('click');
  await settle();
  completeLogin(tab.requests[0]);
  await settle();

  assert.equal(controls.dialog.open, false);
  assert.equal(tab.session.has(sessionKey), false);
  assert.equal(actions, 0);
});

test('reopening owner login cannot accept a cancelled request as the new login', async () => {
  const tab = browser();
  let actions = 0;
  const controls = startLogin(tab, async () => { actions++; });
  controls.cancel.dispatch('click');
  await settle();
  tab.api.requireOwnerAction(async () => { actions++; });
  controls.password.value = 'new-window-password-draft';
  const initialStatus = controls.status.textContent;
  completeLogin(tab.requests[0]);
  await settle();

  assert.equal(controls.dialog.open, true);
  assert.equal(controls.submit.disabled, false);
  assert.equal(controls.password.value, 'new-window-password-draft');
  assert.equal(controls.status.textContent, initialStatus);
  assert.equal(tab.session.has(sessionKey), false);
  assert.equal(actions, 0);
});

for (const oldResponse of ['success', 'failure']) {
  test(`late owner login ${oldResponse} cannot alter a reopened login attempt`, async () => {
    const tab = browser();
    let oldActions = 0;
    let newActions = 0;
    const controls = startLogin(tab, async () => { oldActions++; });
    controls.cancel.dispatch('click');
    await settle();
    startLogin(tab, async () => { newActions++; });
    assert.equal(tab.requests.length, 2);
    assert.equal(controls.submit.disabled, true);
    const pendingStatus = controls.status.textContent;
    controls.password.value = 'draft-for-another-attempt';

    if (oldResponse === 'success') completeLogin(tab.requests[0]);
    else tab.requests[0].reject(new Error('Synthetic network failure'));
    await settle();

    assert.equal(controls.dialog.open, true);
    assert.equal(controls.submit.disabled, true);
    assert.equal(controls.status.textContent, pendingStatus);
    assert.equal(controls.password.value, 'draft-for-another-attempt');
    assert.equal(tab.session.has(sessionKey), false);
    assert.equal(oldActions, 0);
    assert.equal(newActions, 0);

    completeLogin(tab.requests[1], 2);
    await settle();
    assert.equal(controls.dialog.open, false);
    assert.equal(tab.session.has(sessionKey), true);
    assert.equal(oldActions, 0);
    assert.equal(newActions, 1);
  });
}

test('two tabs retain both own message IDs after saving and reloading', () => {
  const storage = new Map([[authorKey, 'f'.repeat(64)]]);
  const first = browser(storage);
  const second = browser(storage);
  const firstId = 'a'.repeat(32);
  const secondId = 'b'.repeat(32);
  first.api.rememberOwnMessage('for-ai', firstId);
  second.api.rememberOwnMessage('for-ai', secondId);
  const reloaded = browser(storage);
  const state = { key: 'for-ai', limits };
  const message = (id) => ({ id, deleted: false, createdAt: Date.now() });

  assert.equal(first.api.getAuthorToken(), second.api.getAuthorToken());
  assert.deepEqual(JSON.parse(storage.get(ownKey))['for-ai'].sort(), [firstId, secondId]);
  assert.equal(reloaded.api.canEdit(state, message(firstId)), true);
  assert.equal(reloaded.api.canEdit(state, message(secondId)), true);
});

test('storage event makes another tab recognize a newly saved own message', () => {
  const storage = new Map();
  const first = browser(storage);
  const second = browser(storage);
  const state = { key: 'T00014', limits };
  const message = { id: 'c'.repeat(32), deleted: false, createdAt: Date.now() };
  assert.equal(second.api.canEdit(state, message) ?? false, false);
  first.api.rememberOwnMessage(state.key, message.id);
  second.storageEvent();

  assert.equal(second.api.canEdit(state, message), true);
  assert.equal(second.storageWrites.length, 0);
  second.storageEvent();
  assert.equal(second.storageWrites.length, 0);
});

test('corrupted own message storage is replaced when a new message is saved', () => {
  const storage = new Map([[ownKey, '{invalid-json']]);
  const tab = browser(storage);
  const state = { key: 'for-ai', limits };
  const message = { id: 'd'.repeat(32), deleted: false, createdAt: Date.now() };
  tab.api.rememberOwnMessage(state.key, message.id);

  assert.deepEqual(JSON.parse(storage.get(ownKey))['for-ai'], [message.id]);
  assert.equal(browser(storage).api.canEdit(state, message), true);
});

test('unavailable local storage still allows editing own messages in the current tab', () => {
  const storage = {
    get() { throw new Error('Synthetic storage denial'); },
    set() { throw new Error('Synthetic storage denial'); },
  };
  const tab = browser(storage);
  const state = { key: 'for-ai', limits };
  const message = { id: 'e'.repeat(32), deleted: false, createdAt: Date.now() };
  tab.api.rememberOwnMessage(state.key, message.id);

  assert.equal(tab.api.canEdit(state, message), true);
});

function publicMessage(number, overrides = {}) {
  const createdAt = Date.now() - 1000 + number;
  return { id: number.toString(16).padStart(32, '0'), name: 'userExample', text: `Обращение ${number}`,
    deleted: false, createdAt, updatedAt: createdAt, replyTo: 'user_001', replyPreview: null, ...overrides };
}

function respond(request, payload, status = 200) {
  request.resolve({ ok: status < 400, status, json: async () => ({ serverTime: Date.now(), limits, ...payload }) });
}

function apiRequest(tab, action) {
  return tab.requests.filter((request) => request.options?.method === 'POST'
    && JSON.parse(request.options.body).action === action).at(-1);
}

async function authenticatedBrowser(count = 2) {
  const tab = browser(new Map(), { ownerPanel: true });
  tab.api.createOwnerPanel();
  assert.equal(tab.api.getOwnerPanel().bell.hidden, true);
  startLogin(tab, async () => {});
  completeLogin(apiRequest(tab, 'admin-login'), 1, count);
  await settle();
  const catalog = tab.requests.find((request) => request.url === '/data/entries.json');
  if (catalog) respond(catalog, []);
  await settle();
  return tab;
}

function chatState(messages = []) {
  const state = { key: 'for-ai', panelId: 1, limits, messages: new Map(messages.map((message) => [message.id, message])),
    active: true, loaded: true, closed: false, historyPaused: false, nextBefore: null, replyTo: null, replyName: '', editId: null, draft: null };
  for (const name of ['text', 'counter', 'fieldset', 'closedNotice', 'refresh', 'older', 'cancel', 'context', 'submit', 'messagesElement']) state[name] = new Element('div');
  return state;
}

test('author recipient and owner replies have valid distinct identities without a sentinel GET', async () => {
  const tab = browser();
  const incoming = publicMessage(1, { text: '<script>literal text</script>' });
  const ownerReply = publicMessage(2, { name: 'user_001', replyTo: incoming.id,
    replyPreview: { id: incoming.id, name: incoming.name, text: incoming.text } });
  assert.equal(tab.api.validMessage(incoming), true);
  assert.equal(tab.api.validMessage(ownerReply), true);
  assert.equal(tab.api.validMessage({ ...ownerReply, name: 'user_002' }), false);
  const state = chatState([incoming]);
  tab.api.renderMessages(state);
  assert.ok(descendants(state.messagesElement).some((element) => element.textContent === 'Автор user_001'));
  assert.ok(descendants(state.messagesElement).some((element) => element.textContent === incoming.text));
  await tab.api.showReply(state, 'user_001');
  assert.equal(tab.requests.length, 0);
  tab.api.writeToAuthor(state);
  assert.equal(state.replyTo, 'user_001');
  assert.match(state.context.textContent, /автору user_001/);
});

test('inbox bell, explicit read, owner reply and deletion preserve the selected chat and unread rules', async () => {
  const tab = await authenticatedBrowser(2);
  const panel = tab.api.getOwnerPanel();
  assert.equal(panel.bell.hidden, false);
  assert.match(panel.bell.textContent, /2$/);
  panel.bell.dispatch('click');
  const first = { ...publicMessage(1), key: 'T00014', read: false };
  const second = { ...publicMessage(2, { replyTo: 'a'.repeat(32) }), key: 'for-ai', read: false };
  respond(apiRequest(tab, 'admin-inbox'), { messages: [first, second], nextBefore: null, unreadCount: 2 });
  await settle();
  const inbox = tab.api.getInbox();
  assert.equal(apiRequest(tab, 'admin-read'), undefined);
  inbox.read.dispatch('click');
  const readRequest = apiRequest(tab, 'admin-read');
  assert.deepEqual(Object.keys(JSON.parse(readRequest.options.body)).sort(), ['action', 'adminToken', 'id', 'key', 'updatedAt']);
  assert.equal(JSON.parse(readRequest.options.body).updatedAt, second.updatedAt);
  respond(readRequest, { unreadCount: 1 });
  await settle();
  assert.equal(inbox.pages[0].messages[1].read, true);
  assert.match(panel.bell.textContent, /1$/);

  inbox.previous.dispatch('click');
  inbox.reply.dispatch('click');
  assert.equal(inbox.replyForm.hidden, false);
  inbox.text.value = '<b>Ответ автора</b>';
  inbox.replyForm.dispatch('submit');
  const replyRequest = apiRequest(tab, 'admin-reply');
  assert.equal(JSON.parse(replyRequest.options.body).key, first.key);
  assert.equal(JSON.parse(replyRequest.options.body).id, first.id);
  assert.equal(JSON.parse(replyRequest.options.body).text, '<b>Ответ автора</b>');
  respond(replyRequest, { message: publicMessage(3, { name: 'user_001', replyTo: first.id }), unreadCount: 1 }, 201);
  await settle();
  assert.equal(inbox.pages[0].messages[0].read, false);
  assert.equal(inbox.replyForm.hidden, true);

  inbox.remove.dispatch('click');
  respond(apiRequest(tab, 'admin-delete'), { message: { ...first, name: '', text: '', deleted: true }, unreadCount: 0 });
  await settle();
  assert.equal(inbox.pages[0].messages[0].deleted, true);
  assert.equal(inbox.reply.disabled, true);
  assert.match(panel.bell.textContent, /0$/);
});

test('owner status polling runs every minute only while the authenticated local panel is visible', async () => {
  const tab = await authenticatedBrowser(2);
  assert.deepEqual(Array.from(tab.intervals.values(), (timer) => timer.milliseconds), [60000]);
  tab.document.visibilityState = 'hidden';
  tab.api.syncOwnerPolling();
  assert.equal(tab.intervals.size, 0);
  tab.document.visibilityState = 'visible';
  tab.api.syncOwnerPolling();
  tab.intervals.values().next().value.handler();
  respond(apiRequest(tab, 'admin-status'), { globalClosed: false, closedKeys: [], discussionKeys: ['for-ai'], unreadCount: 4 });
  await settle();
  assert.match(tab.api.getOwnerPanel().bell.textContent, /4$/);
  tab.api.logoutOwner();
  assert.equal(tab.intervals.size, 0);
  assert.equal(tab.api.getOwnerPanel().bell.hidden, true);

  const publicTab = browser(new Map(), { ownerPanel: true, hostname: 'glossalia-explorer.tuqo.ru' });
  publicTab.api.createOwnerPanel();
  assert.equal(publicTab.api.getOwnerPanel(), null);
  assert.equal(publicTab.intervals.size, 0);
});

test('background owner status rejection clears the session without opening a password modal', async () => {
  const tab = await authenticatedBrowser();
  tab.intervals.values().next().value.handler();
  respond(apiRequest(tab, 'admin-status'), { error: 'admin_session_expired' }, 401);
  await settle();

  assert.equal(tab.loginControls().dialog.open, false);
  assert.equal(tab.session.has(sessionKey), false);
  assert.equal(tab.api.getOwnerPanel().bell.hidden, true);
  assert.equal(tab.intervals.size, 0);
});

test('inbox pages retain individual navigation and return to a cached newer page', async () => {
  const tab = await authenticatedBrowser();
  tab.api.openInbox();
  const newest = { ...publicMessage(3), key: 'for-ai', read: false };
  respond(apiRequest(tab, 'admin-inbox'), { messages: [newest], nextBefore: newest.id, unreadCount: 2 });
  await settle();
  const inbox = tab.api.getInbox();
  inbox.older.dispatch('click');
  assert.equal(JSON.parse(apiRequest(tab, 'admin-inbox').options.body).before, newest.id);
  const older = { ...publicMessage(1), key: 'T00014', read: false };
  respond(apiRequest(tab, 'admin-inbox'), { messages: [older], nextBefore: null, unreadCount: 2 });
  await settle();
  assert.equal(inbox.pageIndex, 1);
  inbox.status.textContent = 'Сообщение удалено.';
  inbox.newer.dispatch('click');
  assert.equal(inbox.pageIndex, 0);
  assert.equal(inbox.status.textContent, '');
  assert.equal(inbox.pages[0].messages[0].id, newest.id);
  assert.equal(apiRequest(tab, 'admin-read'), undefined);
});

test('moving to another incoming message clears the previous read confirmation', async () => {
  const tab = await authenticatedBrowser();
  tab.api.openInbox();
  const messages = [1, 2].map((index) => ({ ...publicMessage(index), key: 'for-ai', read: false }));
  respond(apiRequest(tab, 'admin-inbox'), { messages, nextBefore: null, unreadCount: 2 });
  await settle();
  const inbox = tab.api.getInbox();
  inbox.read.dispatch('click');
  respond(apiRequest(tab, 'admin-read'), { unreadCount: 1 });
  await settle();
  assert.equal(inbox.status.textContent, 'Отмечено как просмотренное.');
  inbox.previous.dispatch('click');
  assert.equal(inbox.pages[inbox.pageIndex].messages[inbox.messageIndex].id, messages[0].id);
  assert.equal(inbox.status.textContent, '');
  assert.equal(inbox.read.disabled, false);
});

test('late inbox success after close and reopen cannot replace the new page or clear its busy state', async () => {
  const tab = await authenticatedBrowser();
  tab.api.openInbox();
  const oldRequest = apiRequest(tab, 'admin-inbox');
  const inbox = tab.api.getInbox();
  descendants(inbox.dialog).find((element) => element.textContent === 'Закрыть').dispatch('click');
  tab.api.openInbox();
  const newRequest = apiRequest(tab, 'admin-inbox');
  assert.notEqual(newRequest, oldRequest);
  respond(oldRequest, { messages: [{ ...publicMessage(1), key: 'for-ai', read: false }], nextBefore: null, unreadCount: 99 });
  await settle();
  assert.equal(inbox.dialog.open, true);
  assert.equal(inbox.busy, true);
  assert.equal(inbox.pages.length, 0);
  assert.match(tab.api.getOwnerPanel().bell.textContent, /2$/);
  respond(newRequest, { messages: [{ ...publicMessage(2), key: 'T00014', read: false }], nextBefore: null, unreadCount: 1 });
  await settle();
  assert.equal(inbox.busy, false);
  assert.equal(inbox.pages[0].messages[0].key, 'T00014');
});

test('a late inbox mutation cannot update a new session after logout', async () => {
  const tab = await authenticatedBrowser();
  tab.api.openInbox();
  const message = { ...publicMessage(1), key: 'for-ai', read: false };
  respond(apiRequest(tab, 'admin-inbox'), { messages: [message], nextBefore: null, unreadCount: 2 });
  await settle();
  const inbox = tab.api.getInbox();
  inbox.read.dispatch('click');
  const request = apiRequest(tab, 'admin-read');
  tab.api.logoutOwner();
  respond(request, { unreadCount: 20 });
  await settle();
  assert.equal(inbox.dialog.open, false);
  assert.equal(inbox.pages.length, 0);
  assert.equal(tab.api.getOwnerPanel().bell.hidden, true);
  assert.match(tab.api.getOwnerPanel().bell.textContent, /0$/);
});

test('a corrected server clock that expires the session cannot restore inbox data after logout', async () => {
  const tab = await authenticatedBrowser();
  tab.api.openInbox();
  respond(apiRequest(tab, 'admin-inbox'), {
    messages: [{ ...publicMessage(1), key: 'for-ai', read: false }], nextBefore: null, unreadCount: 99,
    serverTime: Date.now() + 1800001,
  });
  await settle();

  assert.equal(tab.api.getInbox().dialog.open, false);
  assert.equal(tab.api.getInbox().pages.length, 0);
  assert.equal(tab.api.getOwnerPanel().bell.hidden, true);
  assert.match(tab.api.getOwnerPanel().bell.textContent, /0$/);
});

test('edited incoming message stays unread when its displayed version cannot be marked read', async () => {
  const tab = await authenticatedBrowser();
  tab.api.openInbox();
  const message = { ...publicMessage(1), key: 'for-ai', read: false };
  respond(apiRequest(tab, 'admin-inbox'), { messages: [message], nextBefore: null, unreadCount: 2 });
  await settle();
  const inbox = tab.api.getInbox();
  inbox.read.dispatch('click');
  respond(apiRequest(tab, 'admin-read'), { error: 'stale_message', message: 'Сообщение изменилось. Обновите список обращений.' }, 409);
  await settle();
  assert.equal(inbox.pages[0].messages[0].read, false);
  assert.match(inbox.status.textContent, /Сообщение изменилось/);
  assert.equal(inbox.read.disabled, false);
});

test('an explicit inbox action retries its original message after owner reauthentication', async () => {
  const tab = await authenticatedBrowser();
  tab.api.openInbox();
  const message = { ...publicMessage(1), key: 'T00014', read: false };
  respond(apiRequest(tab, 'admin-inbox'), { messages: [message], nextBefore: null, unreadCount: 2 });
  await settle();
  tab.api.getInbox().read.dispatch('click');
  respond(apiRequest(tab, 'admin-read'), { error: 'admin_session_expired' }, 401);
  await settle();
  const login = tab.loginControls();
  assert.equal(login.dialog.open, true);
  login.password.value = 'synthetic-new-password';
  login.form.dispatch('submit');
  completeLogin(apiRequest(tab, 'admin-login'), 2, 2);
  await settle();
  const retry = apiRequest(tab, 'admin-read');
  assert.equal(JSON.parse(retry.options.body).id, message.id);
  assert.equal(JSON.parse(retry.options.body).key, message.key);
  assert.equal(JSON.parse(retry.options.body).updatedAt, message.updatedAt);
  respond(retry, { unreadCount: 1 });
  await settle();
  assert.equal(tab.api.getInbox().dialog.open, true);
  assert.equal(tab.api.getInbox().pages[0].messages[0].read, true);
});
