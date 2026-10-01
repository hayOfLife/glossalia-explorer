import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../public_html/assets/site.js', import.meta.url), 'utf8');
const sourcePrefix = 'https://github.com/hayOfLife/glossalia-explorer/blob/main/docs/transcriptions/';
const stableSource = `${sourcePrefix}T00042/part_2.md`;
const laterSource = `${sourcePrefix}T00041/part_1.md`;
const nextSource = `${sourcePrefix}T00040/part_1.md`;
const fixtures = [
  {
    type: 'analysis', published: true, calendarDate: '2026-10-01', appearanceTime: '17:00',
    sourceUrl: laterSource, reactionKey: 'T00041-part_1', externalKey: 'T00041',
    title: 'Поздняя запись', group: 'Агностицизм', bodyText: 'Поздняя исходная строка!',
    dateNote: '01.10.2026, 17:00', analysisMode: '95%',
  },
  {
    type: 'manual_transcription', published: true, calendarDate: '2026-10-01', appearanceTime: '08:00',
    sourceUrl: stableSource, reactionKey: 'T00030', externalKey: 'T00030',
    title: 'Ранняя запись', group: 'Материалы автора', bodyText: 'Ранняя исходная строка!',
    copyText: 'Отдельный текст entries!', dateNote: '01.10.2026, 08:00', analysisMode: 'manual',
  },
  {
    type: 'manual_transcription', published: true, calendarDate: '2026-10-02', appearanceTime: '09:00',
    sourceUrl: nextSource, reactionKey: 'T00040-part_1', externalKey: 'T00040',
    title: 'Запись другого дня', group: 'Материалы автора', bodyText: 'Исходная строка второго дня!',
    dateNote: '02.10.2026, 09:00', analysisMode: '100%',
  },
  {
    type: 'news', published: true, sourceUrl: 'https://example.com/news',
    title: 'Новость проекта', group: 'Новости', bodyText: 'Текст новости', dateNote: '01.10.2026',
  },
  {
    type: 'manual_transcription', published: false, calendarDate: '2026-10-01', appearanceTime: '07:00',
    sourceUrl: `${sourcePrefix}T00099/part_1.md`, reactionKey: 'T00099-part_1',
    title: 'Неопубликованная запись', bodyText: 'Не должна отображаться', dateNote: '01.10.2026',
  },
];
const metadata = {
  [stableSource]: {
    copyText: 'Карта: особая строка для копирования!\nВторая строка.',
    purposeHtml: '<p>Назначение ранней записи.</p>',
    translationHtml: '<p><mark class="transcription-term">Карта!</mark> Предполагаемый перевод.</p>',
    pageUrl: '/transcriptions/T00042/part_2/',
  },
  [laterSource]: {
    copyText: 'Карта: поздняя строка!', purposeHtml: '<p>Назначение поздней записи.</p>',
    translationHtml: '<p>Перевод поздней записи.</p>', pageUrl: '/transcriptions/T00041/part_1/',
  },
  [nextSource]: {
    copyText: 'Карта: второй день!', purposeHtml: '<p>Назначение второго дня.</p>',
    translationHtml: '<p>Перевод второго дня.</p>', pageUrl: '/transcriptions/T00040/part_1/',
  },
};

function descendants(element) {
  return element.children.flatMap((child) => child.children ? [child, ...descendants(child)] : [child]);
}

function matches(element, selector) {
  if (!element.tagName) return false;
  const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attribute) {
    const value = element.getAttribute(attribute[1]);
    return value !== null && (attribute[2] === undefined || value === attribute[2]);
  }
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector === 'a[href]') return element.tagName === 'A' && Boolean(element.href);
  return element.tagName === selector.toUpperCase();
}

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this._text = '';
    this._html = '';
    this.value = '';
    this.hidden = false;
    this.open = false;
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  get textContent() { return this._text + this._html.replace(/<[^>]+>/g, '') + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this._html = ''; this.replaceChildren(); }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = String(value); this._text = ''; this.replaceChildren(); }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'href') return this.href || null;
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] ?? null;
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  querySelectorAll(selector) { return descendants(this).filter((element) => selector.split(',').some((part) => matches(element, part.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let current = this;
    while (current) {
      if (selector.split(',').some((part) => matches(current, part.trim()))) return current;
      current = current.parentElement;
    }
    return null;
  }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }
  select() { this.selected = true; }
}

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-01T09:00:00Z'])); }
}

function browser(options = {}) {
  const body = new Element('body');
  body.dataset.pageId = options.newsOnly ? 'news' : 'today';
  const news = new Element('div');
  news.id = 'news-results';
  body.append(news);
  const ids = options.newsOnly ? [] : ['calendar-grid', 'calendar-month', 'today-results', 'calendar-previous', 'calendar-next'];
  for (const id of ids) {
    const element = new Element(id.startsWith('calendar-previous') || id.startsWith('calendar-next') ? 'button' : 'div');
    element.id = id;
    body.append(element);
  }
  const handlers = new Map();
  const requests = [];
  const copied = [];
  const document = {
    body,
    documentElement: { classList: { add() {}, remove() {} } },
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
    getElementById: (id) => body.querySelector(`#${id}`),
    createElement: (tag) => new Element(tag),
    createTextNode: (textContent) => ({ textContent }),
    addEventListener: (name, handler) => {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
    execCommand: () => Boolean(options.legacyCopy),
  };
  const context = createContext({
    document,
    window: { location: new URL(`http://127.0.0.1:8877/${options.newsOnly ? 'news' : 'calendar'}/`), addEventListener() {} },
    Date: FixedDate,
    URL,
    AbortController,
    crypto: { getRandomValues() { throw new Error('Unexpected vote mutation'); } },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame() {},
    navigator: { clipboard: { writeText: async (text) => {
      if (options.copyFails) throw new Error('Clipboard blocked');
      copied.push(text);
    } } },
    fetch: (url, settings) => new Promise((resolve, reject) => requests.push({ url: String(url), settings, resolve, reject })),
  });
  runInContext(source, context);

  async function settle() { await new Promise((resolve) => setImmediate(resolve)); }
  async function reply(url, data, ok = true) {
    const request = requests.find((item) => item.url === url && !item.answered);
    assert.ok(request, `Missing mocked request ${url}`);
    request.answered = true;
    request.resolve({ ok, json: async () => data });
    await settle();
  }
  async function click(element) {
    assert.ok(element);
    const event = { target: element, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of element.listeners.get('click') || []) await handler(event);
    for (const handler of handlers.get('click') || []) await handler(event);
    await settle();
  }
  const dayResults = document.getElementById('today-results');
  return { body, news, dayResults, document, requests, copied, reply, click, settle };
}

function cards(page) { return page.dayResults.children.filter((element) => element.tagName === 'DETAILS' && element.className === 'sos-item'); }
function summary(card) { return card.children.find((element) => element.tagName === 'SUMMARY'); }

test('календарные транскрипции раскрываются и сохраняют текст, назначение, перевод, порядок и ключ', async () => {
  const page = browser();
  await page.reply('/data/entries.json', fixtures);
  await page.reply('/data/calendar-transcriptions.json', metadata);
  const items = cards(page);
  assert.equal(items.length, 2);
  assert.equal(summary(items[0]).textContent, '1. Ранняя запись');
  assert.equal(summary(items[1]).textContent, '2. Поздняя запись');
  assert.equal(items[0].open, false);
  assert.equal(items[0].querySelector('textarea').value, metadata[stableSource].copyText);
  assert.equal(items[0].querySelector('textarea').readOnly, true);
  assert.equal(items[0].querySelector('textarea').getAttribute('aria-label'), 'Текст для копирования');
  assert.equal(items[0].querySelector('.transcription-purpose').tagName, 'DETAILS');
  assert.equal(items[0].querySelector('.transcription-purpose').open, false);
  assert.equal(items[0].querySelector('.transcription-purpose-body').innerHTML, metadata[stableSource].purposeHtml);
  assert.equal(items[0].querySelector('.author-translation').tagName, 'DETAILS');
  assert.equal(items[0].querySelector('.author-translation').open, false);
  assert.equal(items[0].querySelector('.author-translation-body').innerHTML, metadata[stableSource].translationHtml);
  assert.equal(items[0].querySelector('.analysis-mode').textContent, 'Разбор транскрипции: 100%');
  assert.equal(items[1].querySelector('.analysis-mode').textContent, 'Разбор транскрипции: 95%');
  assert.equal(items[0].querySelector('[data-reaction-key]').dataset.reactionKey, 'T00030');
  assert.equal(items[0].querySelector('[data-transcription-chat]').dataset.transcriptionChat, 'T00030');
  assert.equal(items[0].querySelector('[data-transcription-chat]').hidden, true);
  const actions = items[0].querySelector('.sos-actions');
  assert.ok(actions.querySelector('[data-copy-target]'));
  assert.equal(actions.querySelector('a').href, metadata[stableSource].pageUrl);

  await page.reply('https://94-232-41-163.sslip.io/glossaliae/reactions-local', {
    T00030: { likes: 4, dislikes: 1 }, 'T00041-part_1': { likes: 2, dislikes: 0 },
  });
  const voteButtons = items[0].querySelector('[data-reaction-key]').querySelectorAll('button');
  assert.equal(voteButtons.length, 2);
  assert.equal(voteButtons[0].querySelector('span').textContent, '4');
  assert.equal(voteButtons[1].querySelector('span').textContent, '1');
  assert.equal(voteButtons[0].disabled, false);
  const news = page.news.querySelector('article');
  assert.equal(news.className, 'entry-card');
  assert.ok(news.textContent.includes('Текст новости'));
  assert.equal(news.querySelector('details'), null);
  assert.equal(news.querySelector('[data-reaction-key]'), null);
});

test('данные блоков применяются независимо от порядка загрузки JSON', async () => {
  const page = browser();
  await page.reply('/data/calendar-transcriptions.json', metadata);
  await page.reply('/data/entries.json', fixtures);
  assert.equal(cards(page)[0].querySelector('textarea').value, metadata[stableSource].copyText);
  assert.equal(cards(page)[1].querySelector('.author-translation-body').innerHTML, metadata[laterSource].translationHtml);
});

test('смена дня заново нумерует абзацы, а динамическая кнопка копирует свою строку', async () => {
  const page = browser();
  await page.reply('/data/entries.json', fixtures);
  await page.reply('/data/calendar-transcriptions.json', metadata);
  await page.click(cards(page)[0].querySelector('[data-copy-target]'));
  assert.deepEqual(page.copied, [metadata[stableSource].copyText]);
  assert.equal(cards(page)[0].querySelector('[data-copy-status]').textContent, 'Скопировано');

  const day = page.document.getElementById('calendar-grid').children.find((element) => element.tagName === 'BUTTON' && element.textContent === '2');
  await page.click(day);
  assert.equal(cards(page).length, 1);
  assert.equal(summary(cards(page)[0]).textContent, '1. Запись другого дня');
  assert.equal(cards(page)[0].querySelector('textarea').value, metadata[nextSource].copyText);
  assert.equal(cards(page)[0].querySelector('[data-reaction-key]').dataset.reactionKey, 'T00040-part_1');
  assert.equal(cards(page)[0].querySelector('[data-transcription-chat]').dataset.transcriptionChat, 'T00040-part_1');
  await page.click(cards(page)[0].querySelector('[data-copy-target]'));
  assert.deepEqual(page.copied, [metadata[stableSource].copyText, metadata[nextSource].copyText]);
  assert.equal(cards(page)[0].querySelector('[data-copy-status]').textContent, 'Скопировано');
});

test('отказ календарных метаданных сохраняет исходные строки и пустые сведения без поломки календаря', async () => {
  const page = browser();
  await page.reply('/data/entries.json', fixtures);
  await page.reply('/data/calendar-transcriptions.json', null, false);
  const items = cards(page);
  assert.equal(items.length, 2);
  assert.equal(items[0].querySelector('textarea').value, fixtures[1].copyText);
  assert.equal(items[1].querySelector('textarea').value, fixtures[0].bodyText);
  assert.equal(items[0].querySelector('.sos-actions').querySelector('a').href, stableSource);
  assert.equal(items[0].querySelector('.sos-actions').querySelector('a').target, '_blank');
  for (const item of items) {
    assert.equal(item.querySelector('.transcription-purpose-body').textContent, 'Пока не заполнено');
    assert.equal(item.querySelector('.author-translation-body').textContent, 'Пока не заполнено');
  }
  assert.ok(page.document.getElementById('calendar-grid').children.some((element) => element.tagName === 'BUTTON'));
  assert.ok(page.news.querySelector('article').textContent.includes('Новость проекта'));
});

test('неполный JSON оставляет fallback для отсутствующей карточки, а отказ буфера предлагает ручное копирование', async () => {
  const page = browser({ copyFails: true });
  await page.reply('/data/entries.json', fixtures);
  await page.reply('/data/calendar-transcriptions.json', { [stableSource]: metadata[stableSource] });
  const items = cards(page);
  assert.equal(items[0].querySelector('textarea').value, metadata[stableSource].copyText);
  assert.equal(items[1].querySelector('textarea').value, fixtures[0].bodyText);
  assert.equal(items[1].querySelector('.author-translation-body').textContent, 'Пока не заполнено');
  await page.click(items[0].querySelector('[data-copy-target]'));
  assert.equal(items[0].querySelector('textarea').selected, true);
  assert.equal(items[0].querySelector('[data-copy-status]').textContent, 'Скопируйте выделенный текст вручную');
  assert.deepEqual(page.copied, []);
});

test('страница новостей сохраняет article и не загружает календарные данные', async () => {
  const page = browser({ newsOnly: true });
  assert.equal(page.requests.some((request) => request.url === '/data/calendar-transcriptions.json'), false);
  await page.reply('/data/entries.json', fixtures);
  assert.equal(page.news.querySelector('article').className, 'entry-card');
  assert.ok(page.news.querySelector('article').textContent.includes('Новость проекта'));
  assert.equal(page.news.querySelector('details'), null);
  assert.equal(page.requests.some((request) => request.url === '/data/calendar-transcriptions.json'), false);
});
