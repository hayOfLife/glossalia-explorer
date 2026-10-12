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
    entry: { ...fixtures[1] },
    originalText: 'Ранняя исходная строка!\nСЛОВО  \n\t ПРОБУЖДЕНИЕ. Буквально [a+b].',
    copyText: 'Карта: особая строка для копирования!\nВторая строка.',
    purposeText: 'Назначение ранней записи. ВОССТАНОВЛЕНИЕ  \n\t ПАМЯТИ.',
    purposeHtml: '<p>Назначение ранней записи.</p>',
    translationHtml: '<p><mark class="transcription-term">Карта!</mark> Предполагаемый перевод.</p>',
    pageUrl: '/transcriptions/T00042/part_2/',
  },
  [laterSource]: {
    entry: { ...fixtures[0] }, originalText: 'Поздняя исходная строка!',
    purposeText: 'Назначение поздней записи.',
    copyText: 'Карта: поздняя строка!', purposeHtml: '<p>Назначение поздней записи.</p>',
    translationHtml: '<p>Перевод поздней записи.</p>', pageUrl: '/transcriptions/T00041/part_1/',
  },
  [nextSource]: {
    entry: { ...fixtures[2] }, originalText: 'Исходная строка второго дня!',
    purposeText: 'Назначение второго дня.',
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
    this.checked = false;
    this.disabled = false;
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

function browser(options = {}) {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [options.now || '2026-10-01T09:00:00Z'])); }
  }

  const body = new Element('body');
  body.dataset.pageId = options.newsOnly ? 'news' : 'today';
  const news = new Element('div');
  news.id = 'news-results';
  body.append(news);
  if (!options.newsOnly) {
    const form = new Element('form');
    form.id = 'transcription-filter';
    body.append(form);
    for (const id of ['date-from', 'date-to', 'time-from', 'time-to', 'query', 'purpose-query', 'all-dates', 'percent-from', 'percent-to']) {
      const field = new Element('input');
      field.id = `transcription-${id}`;
      field.type = id === 'all-dates' ? 'checkbox' : id.startsWith('date-') ? 'date' : id.startsWith('time-') ? 'time' : id.startsWith('percent-') ? 'number' : 'text';
      form.append(field);
    }

    for (const mode of ['any', 'percent', 'label']) {
      const radio = new Element('input');
      radio.id = `transcription-analysis-${mode}`;
      radio.type = 'radio';
      radio.name = 'transcription-analysis-mode';
      radio.value = mode;
      form.append(radio);
    }

    const label = new Element('select');
    label.id = 'transcription-analysis-label-value';
    label.value = 'auto';
    form.append(label);

    const reset = new Element('button');
    reset.id = 'transcription-filter-reset';
    reset.type = 'button';
    reset.textContent = 'Сегодня';
    form.append(reset);

    for (const id of ['transcription-filter-status', 'today-results']) {
      const element = new Element('div');
      element.id = id;
      body.append(element);
    }
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
    fetch: (url, settings) => {
      assert.ok(['GET', 'HEAD'].includes(settings?.method || 'GET'), 'Unexpected external write request');
      assert.equal(settings?.body, undefined);
      return new Promise((resolve, reject) => requests.push({ url: String(url), settings, resolve, reject }));
    },
  });
  const script = options.exposeEntryCard
    ? source.replace('  function createEntryCard(entry, headingTag) {',
      '  globalThis.testEntryCard = createEntryCard;\n  function createEntryCard(entry, headingTag) {')
    : source;
  runInContext(script, context);

  async function settle() { await new Promise((resolve) => setImmediate(resolve)); }
  async function reply(url, data, ok = true) {
    const request = requests.find((item) => item.url === url && !item.answered);
    assert.ok(request, `Missing mocked request ${url}`);
    request.answered = true;
    request.resolve({ ok, json: async () => data });
    await settle();
  }
  async function dispatch(element, name) {
    assert.ok(element);
    const event = { target: element, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of element.listeners.get(name) || []) await handler(event);
    for (const handler of handlers.get(name) || []) await handler(event);
    await settle();
  }
  async function submit(values = {}) {
    for (const [name, value] of Object.entries(values)) {
      const field = document.getElementById(`transcription-${name}`);
      assert.ok(field);
      if (name === 'all-dates') field.checked = value;
      else field.value = value;
    }
    await dispatch(document.getElementById('transcription-filter'), 'submit');
  }
  async function fail(url) {
    const request = requests.find((item) => item.url === url && !item.answered);
    assert.ok(request, `Missing mocked request ${url}`);
    request.answered = true;
    request.reject(new Error('Network unavailable'));
    await settle();
  }
  async function selectAnalysis(mode) {
    for (const value of ['any', 'percent', 'label']) document.getElementById(`transcription-analysis-${value}`).checked = value === mode;
    await dispatch(document.getElementById(`transcription-analysis-${mode}`), 'change');
  }
  const dayResults = document.getElementById('today-results');
  const filterStatus = document.getElementById('transcription-filter-status');
  return {
    body, news, dayResults, filterStatus, document, requests, copied, reply, fail, submit, selectAnalysis, settle,
    createEntryCard: context.testEntryCard,
    click: (element) => dispatch(element, 'click'),
    change: (element) => dispatch(element, 'change'),
  };
}

function cards(page) { return page.dayResults.children.filter((element) => element.tagName === 'DETAILS' && element.className === 'sos-item'); }
function summary(card) { return card.children.find((element) => element.tagName === 'SUMMARY'); }
function titles(page) { return cards(page).map((card) => summary(card).querySelector('.transcription-heading').textContent); }
async function load(page, calendarData = metadata, entries = fixtures) {
  await page.reply('/data/entries.json', entries);
  await page.reply('/data/calendar-transcriptions.json', calendarData);
}

test('карточка использует текст для вывода и сохраняет полный исходник в данных', () => {
  const page = browser({ exposeEntryCard: true });
  const entry = { ...fixtures[1], copyText: 'Ру⟐ви! <слово> & смысл' };
  const card = page.createEntryCard(entry, 'h3');
  assert.equal(card.querySelector('.entry-body').textContent, entry.copyText);
  assert.equal(card.querySelector('.entry-body').innerHTML, '');
  assert.equal(entry.bodyText, fixtures[1].bodyText);
  const fallback = { ...entry };
  delete fallback.copyText;
  assert.equal(page.createEntryCard(fallback, 'h3').querySelector('.entry-body').textContent, fallback.bodyText);
  const empty = { ...entry, copyText: '' };
  assert.equal(page.createEntryCard(empty, 'h3').querySelector('.entry-body').textContent, '');
});

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
  assert.equal(cards(page).length, 2);
  assert.equal(cards(page)[0].querySelector('textarea').value, metadata[stableSource].copyText);
  await page.reply('/data/entries.json', fixtures);
  assert.equal(cards(page)[0].querySelector('textarea').value, metadata[stableSource].copyText);
  assert.equal(cards(page)[1].querySelector('.author-translation-body').innerHTML, metadata[laterSource].translationHtml);
});

test('значок получения зависит от acquisitionType, сохраняется при смене дня и не появляется у новостей', async () => {
  const page = browser();
  const acquisitionEntries = fixtures.map((entry) => ({
    ...entry,
    acquisitionType: entry.sourceUrl === stableSource ? 'written' : 'audio',
    analysisMode: entry.sourceUrl === stableSource ? 'auto' : '100%',
  }));
  const acquisitionMetadata = {
    ...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, {
      ...value, entry: acquisitionEntries.find((entry) => entry.sourceUrl === key),
    }])),
    [stableSource]: { ...metadata[stableSource], entry: acquisitionEntries[1], acquisitionType: 'audio' },
    [laterSource]: { ...metadata[laterSource], entry: acquisitionEntries[0], acquisitionType: 'written' },
  };
  function checkIcon(card, type) {
    const heading = summary(card);
    assert.ok(heading.className.split(/\s+/).includes('transcription-heading-row'));
    assert.ok(heading.querySelector('.transcription-heading'));
    const icons = heading.querySelectorAll('.transcription-acquisition');
    assert.equal(icons.length, 1);
    assert.equal(icons[0].dataset.acquisitionType, type);
    assert.equal(heading.children.at(-1), icons[0]);
    const label = type === 'audio' ? 'Транскрипция получена из аудиозаписи' : 'Транскрипция получена письменно';
    assert.equal(icons[0].getAttribute('title'), label);
    assert.equal(icons[0].getAttribute('aria-label'), label);
    assert.equal(icons[0].getAttribute('role'), 'img');
    const image = icons[0].querySelector('img');
    assert.equal(image.src, `/assets/transcription-${type}.svg`);
    assert.equal(image.alt, '');
    assert.equal(image.width, 20);
    assert.equal(image.height, 20);
  }

  await page.reply('/data/entries.json', acquisitionEntries);
  await page.reply('/data/calendar-transcriptions.json', acquisitionMetadata);
  checkIcon(cards(page)[0], 'audio');
  checkIcon(cards(page)[1], 'written');
  assert.equal(cards(page)[0].querySelector('.analysis-mode').textContent, 'Разбор транскрипции: авто');
  assert.equal(cards(page)[1].querySelector('.analysis-mode').textContent, 'Разбор транскрипции: 100%');
  assert.equal(page.news.querySelector('.transcription-acquisition'), null);

  await page.submit({ 'date-from': '2026-10-02', 'date-to': '2026-10-02' });
  assert.equal(cards(page).length, 1);
  checkIcon(cards(page)[0], 'audio');
  await page.submit({ 'date-from': '2026-10-01', 'date-to': '2026-10-01' });
  assert.equal(cards(page).length, 2);
  checkIcon(cards(page)[0], 'audio');
  checkIcon(cards(page)[1], 'written');
});

test('фильтр даты заново нумерует абзацы, а динамическая кнопка копирует свою строку', async () => {
  const page = browser();
  await page.reply('/data/entries.json', fixtures);
  await page.reply('/data/calendar-transcriptions.json', metadata);
  await page.click(cards(page)[0].querySelector('[data-copy-target]'));
  assert.deepEqual(page.copied, [metadata[stableSource].copyText]);
  assert.equal(cards(page)[0].querySelector('[data-copy-status]').textContent, 'Скопировано');

  await page.submit({ 'date-from': '2026-10-02', 'date-to': '2026-10-02' });
  assert.equal(cards(page).length, 1);
  assert.equal(summary(cards(page)[0]).textContent, '1. Запись другого дня');
  assert.equal(cards(page)[0].querySelector('textarea').value, metadata[nextSource].copyText);
  assert.equal(cards(page)[0].querySelector('[data-reaction-key]').dataset.reactionKey, 'T00040-part_1');
  assert.equal(cards(page)[0].querySelector('[data-transcription-chat]').dataset.transcriptionChat, 'T00040-part_1');
  await page.click(cards(page)[0].querySelector('[data-copy-target]'));
  assert.deepEqual(page.copied, [metadata[stableSource].copyText, metadata[nextSource].copyText]);
  assert.equal(cards(page)[0].querySelector('[data-copy-status]').textContent, 'Скопировано');
});

test('загрузка и отказ календарного JSON дают понятный статус, а новости остаются доступны', async (context) => {
  for (const failure of ['http', 'invalid', 'network']) await context.test(failure, async () => {
    const page = browser();
    assert.match(page.filterStatus.textContent, /загруз|загруж/i);
    assert.equal(cards(page).length, 0);
    await page.reply('/data/entries.json', fixtures);
    assert.match(page.filterStatus.textContent, /загруз|загруж/i);
    assert.equal(cards(page).length, 0);
    if (failure === 'network') await page.fail('/data/calendar-transcriptions.json');
    else await page.reply('/data/calendar-transcriptions.json', failure === 'invalid' ? [] : null, failure !== 'http');
    assert.equal(cards(page).length, 0);
    assert.match(page.filterStatus.textContent, /не удалось|ошиб|недоступ/i);
    assert.ok(page.news.querySelector('article').textContent.includes('Новость проекта'));
    await page.submit({ 'all-dates': true });
    assert.equal(cards(page).length, 0);
    assert.match(page.filterStatus.textContent, /не удалось|ошиб|недоступ/i);
  });
});

test('неполные блоки карточки используют исходный текст, а отказ буфера предлагает ручное копирование', async () => {
  const page = browser({ copyFails: true });
  await page.reply('/data/entries.json', fixtures);
  await page.reply('/data/calendar-transcriptions.json', {
    [stableSource]: metadata[stableSource],
    [laterSource]: { entry: fixtures[0], originalText: fixtures[0].bodyText, copyText: fixtures[0].bodyText, purposeText: '' },
  });
  const items = cards(page);
  assert.equal(items[0].querySelector('textarea').value, metadata[stableSource].copyText);
  assert.equal(items[1].querySelector('textarea').value, fixtures[0].bodyText);
  assert.equal(items[1].querySelector('.author-translation-body').textContent, 'Пока не заполнено');
  assert.equal(items[1].querySelector('.transcription-purpose-body').textContent, 'Пока не заполнено');
  assert.equal(items[1].querySelector('.sos-actions').querySelector('a').href, laterSource);
  assert.equal(items[1].querySelector('.sos-actions').querySelector('a').target, '_blank');
  assert.equal(summary(items[1]).querySelector('.transcription-acquisition').querySelector('img').src, '/assets/transcription-written.svg');
  await page.click(items[0].querySelector('[data-copy-target]'));
  assert.equal(items[0].querySelector('textarea').selected, true);
  assert.equal(items[0].querySelector('[data-copy-status]').textContent, 'Скопируйте выделенный текст вручную');
  assert.deepEqual(page.copied, []);
});

test('поля по умолчанию используют текущий московский день, полный день и все режимы разбора', async () => {
  const page = browser({ now: '2026-09-30T22:15:00Z' });
  for (const id of ['date-from', 'date-to']) {
    assert.equal(page.document.getElementById(`transcription-${id}`).value, '2026-10-01');
    assert.equal(page.document.getElementById(`transcription-${id}`).disabled, false);
  }
  assert.equal(page.document.getElementById('transcription-time-from').value, '00:00');
  assert.equal(page.document.getElementById('transcription-time-to').value, '23:59');
  assert.equal(page.document.getElementById('transcription-query').value, '');
  assert.equal(page.document.getElementById('transcription-purpose-query').value, '');
  assert.equal(page.document.getElementById('transcription-all-dates').checked, false);
  assert.equal(page.document.getElementById('transcription-analysis-any').checked, true);
  assert.equal(page.document.getElementById('transcription-percent-from').value, '0');
  assert.equal(page.document.getElementById('transcription-percent-to').value, '100');
  assert.equal(page.document.getElementById('transcription-percent-from').disabled, true);
  assert.equal(page.document.getElementById('transcription-percent-to').disabled, true);
  assert.equal(page.document.getElementById('transcription-analysis-label-value').value, 'auto');
  assert.equal(page.document.getElementById('transcription-analysis-label-value').disabled, true);
  assert.equal(page.document.getElementById('calendar-grid'), null);
  await load(page);
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
  assert.match(page.filterStatus.textContent, /2/);
});

test('выдача берёт все опубликованные транскрипции из календарного JSON независимо от entries', async () => {
  const page = browser();
  const additionalSource = `${sourcePrefix}T00098/part_1.md`;
  const additionalEntry = {
    ...fixtures[0], sourceUrl: additionalSource, reactionKey: 'T00098-part_1', externalKey: 'T00098',
    appearanceTime: '11:30', title: 'Есть только в календарном JSON',
  };
  await page.reply('/data/calendar-transcriptions.json', {
    [stableSource]: metadata[stableSource],
    [additionalSource]: { ...metadata[laterSource], entry: additionalEntry, pageUrl: '/transcriptions/T00098/part_1/' },
    [fixtures[4].sourceUrl]: { ...metadata[laterSource], entry: fixtures[4] },
    [fixtures[3].sourceUrl]: { ...metadata[laterSource], entry: fixtures[3] },
  });
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Есть только в календарном JSON']);
  assert.equal(cards(page)[1].querySelector('[data-reaction-key]').dataset.reactionKey, 'T00098-part_1');
  await page.reply('/data/entries.json', fixtures);
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Есть только в календарном JSON']);
  await page.submit({ 'all-dates': true });
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Есть только в календарном JSON']);
  assert.ok(page.news.querySelector('article').textContent.includes('Новость проекта'));
});

test('изменения применяются по submit, все даты отключают поля, Сегодня восстанавливает полный фильтр', async () => {
  const page = browser();
  await load(page);
  const dateFrom = page.document.getElementById('transcription-date-from');
  const dateTo = page.document.getElementById('transcription-date-to');
  dateFrom.value = '2026-10-02';
  dateTo.value = '2026-10-02';
  await page.change(dateFrom);
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
  await page.submit();
  assert.deepEqual(titles(page), ['1. Запись другого дня']);

  const allDates = page.document.getElementById('transcription-all-dates');
  allDates.checked = true;
  await page.change(allDates);
  assert.equal(dateFrom.disabled, true);
  assert.equal(dateTo.disabled, true);
  assert.deepEqual(titles(page), ['1. Запись другого дня']);
  await page.submit();
  assert.equal(cards(page).length, 3);
  await page.selectAnalysis('percent');
  assert.equal(page.document.getElementById('transcription-percent-from').disabled, false);
  assert.equal(page.document.getElementById('transcription-analysis-label-value').disabled, true);
  await page.submit({ query: 'нет совпадений', 'purpose-query': 'нет назначения', 'time-from': '12:00', 'time-to': '13:00', 'percent-from': '20', 'percent-to': '40' });
  assert.equal(cards(page).length, 0);

  await page.click(page.document.getElementById('transcription-filter-reset'));
  assert.equal(dateFrom.value, '2026-10-01');
  assert.equal(dateTo.value, '2026-10-01');
  assert.equal(dateFrom.disabled, false);
  assert.equal(dateTo.disabled, false);
  assert.equal(allDates.checked, false);
  assert.equal(page.document.getElementById('transcription-time-from').value, '00:00');
  assert.equal(page.document.getElementById('transcription-time-to').value, '23:59');
  assert.equal(page.document.getElementById('transcription-query').value, '');
  assert.equal(page.document.getElementById('transcription-purpose-query').value, '');
  assert.equal(page.document.getElementById('transcription-analysis-any').checked, true);
  assert.equal(page.document.getElementById('transcription-percent-from').value, '0');
  assert.equal(page.document.getElementById('transcription-percent-to').value, '100');
  assert.equal(page.document.getElementById('transcription-percent-from').disabled, true);
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
});

test('буквальный поиск учитывает регистр и пробелы в полном исходнике и тексте копирования, но не перевод', async () => {
  const page = browser();
  await load(page);
  await page.submit({ query: '  слово   пробуждение  ' });
  assert.deepEqual(titles(page), ['1. Ранняя запись']);
  await page.submit({ query: '[a+b]' });
  assert.deepEqual(titles(page), ['1. Ранняя запись']);
  await page.submit({ query: 'вторая   строка.' });
  assert.deepEqual(titles(page), ['1. Ранняя запись']);
  await page.submit({ query: 'Предполагаемый перевод' });
  assert.equal(cards(page).length, 0);
  assert.match(page.filterStatus.textContent, /не найден|0/i);
  await page.submit({ query: '', 'purpose-query': '  восстановление   памяти  ' });
  assert.deepEqual(titles(page), ['1. Ранняя запись']);
});

test('диапазон дат включает границы и применяет одно окно времени к каждому дню', async () => {
  const page = browser();
  await load(page);
  await page.submit({ 'date-from': '2026-10-01', 'date-to': '2026-10-02', 'time-from': '08:00', 'time-to': '09:00' });
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Запись другого дня']);
  await page.submit({ 'time-from': '09:00', 'time-to': '09:00' });
  assert.deepEqual(titles(page), ['1. Запись другого дня']);
  await page.submit({ 'time-from': '17:00', 'time-to': '17:00' });
  assert.deepEqual(titles(page), ['1. Поздняя запись']);
});

test('неизвестное время допускается только за полный день, неизвестная дата только без ограничения дат', async () => {
  const page = browser();
  const unknownTimeSource = `${sourcePrefix}T00097/part_1.md`;
  const unknownDateSource = `${sourcePrefix}T00096/part_1.md`;
  await load(page, {
    ...metadata,
    [unknownTimeSource]: { ...metadata[laterSource], entry: { ...fixtures[0], sourceUrl: unknownTimeSource, title: 'Без времени', appearanceTime: '' } },
    [unknownDateSource]: { ...metadata[laterSource], entry: { ...fixtures[0], sourceUrl: unknownDateSource, title: 'Без даты', calendarDate: '', appearanceTime: '09:15' } },
  });
  assert.equal(cards(page).length, 3);
  assert.ok(titles(page).some((title) => title.endsWith('Без времени')));
  assert.equal(titles(page).some((title) => title.endsWith('Без даты')), false);
  await page.submit({ 'time-from': '08:00', 'time-to': '18:00' });
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
  await page.submit({ 'all-dates': true, 'time-from': '00:00', 'time-to': '23:59' });
  assert.equal(cards(page).length, 5);
  assert.ok(titles(page).some((title) => title.endsWith('Без даты')));
  await page.submit({ 'time-from': '09:00', 'time-to': '10:00' });
  assert.equal(cards(page).length, 2);
  assert.ok(titles(page).some((title) => title.endsWith('Без даты')));
  assert.equal(titles(page).some((title) => title.endsWith('Без времени')), false);
});

test('пустые и обратные интервалы показывают ошибку и не оставляют старые карточки', async () => {
  const page = browser();
  await load(page);
  await page.submit({ 'date-from': '2026-10-02', 'date-to': '2026-10-01' });
  assert.equal(page.filterStatus.textContent, 'Дата начала не может быть позже даты окончания.');
  assert.equal(cards(page).length, 0);
  await page.submit({ 'date-from': '2026-10-01', 'date-to': '2026-10-01', 'time-from': '18:00', 'time-to': '08:00' });
  assert.equal(page.filterStatus.textContent, 'Время начала не может быть позже времени окончания.');
  assert.equal(cards(page).length, 0);
  await page.submit({ 'date-from': '', 'time-from': '00:00' });
  assert.match(page.filterStatus.textContent, /дат/i);
  assert.equal(cards(page).length, 0);
  await page.submit({ 'all-dates': true, 'date-to': '', 'time-to': '23:59' });
  assert.equal(cards(page).length, 3);
  await page.submit({ 'time-to': '' });
  assert.match(page.filterStatus.textContent, /врем/i);
  assert.equal(cards(page).length, 0);
  await page.click(page.document.getElementById('transcription-filter-reset'));
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
});

test('назначение, исходный текст и проценты пересекаются, manual равен 100%, а неизвестная метка отображается как авто', async () => {
  const page = browser();
  const automaticSource = `${sourcePrefix}T00095/part_1.md`;
  const unknownSource = `${sourcePrefix}T00094/part_1.md`;
  await load(page, {
    ...metadata,
    [automaticSource]: { ...metadata[laterSource], entry: { ...fixtures[0], sourceUrl: automaticSource, title: 'Автоматическая запись', appearanceTime: '10:00', analysisMode: 'auto' } },
    [unknownSource]: { ...metadata[laterSource], entry: { ...fixtures[0], sourceUrl: unknownSource, title: 'Метка неизвестна', appearanceTime: '11:00', analysisMode: '' } },
  });
  assert.equal(cards(page).length, 4);
  assert.equal(cards(page).find((card) => summary(card).textContent.includes('Метка неизвестна')).querySelector('.analysis-mode').textContent, 'Разбор транскрипции: авто');
  await page.selectAnalysis('percent');
  await page.submit({ 'percent-from': '95', 'percent-to': '100' });
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
  await page.submit({ 'percent-from': '100', 'percent-to': '100' });
  assert.deepEqual(titles(page), ['1. Ранняя запись']);
  await page.submit({ 'percent-from': '95', 'percent-to': '95' });
  assert.deepEqual(titles(page), ['1. Поздняя запись']);
  await page.submit({ 'percent-to': '100', query: 'Карта', 'purpose-query': 'поздней' });
  assert.deepEqual(titles(page), ['1. Поздняя запись']);
  await page.submit({ query: 'слово пробуждение', 'purpose-query': 'восстановление памяти' });
  assert.deepEqual(titles(page), ['1. Ранняя запись']);
  await page.selectAnalysis('label');
  assert.equal(page.document.getElementById('transcription-percent-from').disabled, true);
  assert.equal(page.document.getElementById('transcription-percent-to').disabled, true);
  assert.equal(page.document.getElementById('transcription-analysis-label-value').disabled, false);
  await page.submit({ query: '', 'purpose-query': '' });
  assert.deepEqual(titles(page), ['1. Автоматическая запись', '2. Метка неизвестна']);
});

test('не требующая разбора запись сохраняет словесную метку в карточках и фильтре, не попадая в проценты', async () => {
  const page = browser({ exposeEntryCard: true });
  const russianSource = `${sourcePrefix}T00064.md`;
  const russianEntry = {
    ...fixtures[0], sourceUrl: russianSource, reactionKey: 'T00064', externalKey: 'T00064',
    title: 'Молитва благодарения', appearanceTime: '13:29', analysisMode: 'not_required',
  };
  const template = readFileSync(new URL('../public_html/index.html', import.meta.url), 'utf8');
  assert.match(template, /<option value="not_required">не требуется<\/option>/);
  assert.equal(page.createEntryCard(russianEntry, 'h3').querySelector('.analysis-mode').textContent, 'Разбор транскрипции: не требуется');

  await load(page, {
    ...metadata,
    [russianSource]: { ...metadata[laterSource], entry: russianEntry },
  });
  const russianCard = cards(page).find((card) => summary(card).textContent.includes('Молитва благодарения'));
  assert.equal(russianCard.querySelector('.analysis-mode').textContent, 'Разбор транскрипции: не требуется');
  await page.selectAnalysis('label');
  await page.submit({ 'analysis-label-value': 'not_required' });
  assert.deepEqual(titles(page), ['1. Молитва благодарения']);
  await page.submit({ 'analysis-label-value': 'auto' });
  assert.equal(cards(page).length, 0);
  await page.selectAnalysis('percent');
  await page.submit({ 'percent-from': '0', 'percent-to': '100' });
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
});

test('процентный интервал принимает только целые числа от 0 до 100 и проверяет порядок', async () => {
  const page = browser();
  await load(page);
  await page.selectAnalysis('percent');
  for (const [from, to] of [['', '100'], ['abc', '100'], ['1.5', '100'], ['-1', '100'], ['0', '101'], ['96', '95']]) {
    await page.submit({ 'percent-from': from, 'percent-to': to });
    assert.equal(cards(page).length, 0, `${from}–${to}`);
    assert.match(page.filterStatus.textContent, /процент|разбор|цел|100|начала/i);
  }
  await page.selectAnalysis('any');
  await page.submit();
  assert.deepEqual(titles(page), ['1. Ранняя запись', '2. Поздняя запись']);
});

test('новость показывает безопасные ссылки и дату публикации без метки разбора и календарных данных', async () => {
  const page = browser({ newsOnly: true });
  const bodyText = 'Первая строка\n[Как сделать перевод иных языков](/translation/)\n\n[Скачать файл промпта](/data/translation_materials.zip)\n[опасное](javascript:alert(1)) [сломано](https://[)\n<img src=x onerror=alert(1)><script>alert(1)</script>';
  const newsEntries = fixtures.map((entry) => entry.type === 'news' ? {
    ...entry, bodyText, dateNote: '05.10.2026',
  } : entry);

  assert.equal(page.requests.some((request) => request.url === '/data/calendar-transcriptions.json'), false);
  await page.reply('/data/entries.json', newsEntries);
  const news = page.news.querySelector('article');
  const body = news.querySelector('.entry-body');
  assert.equal(news.className, 'entry-card');
  assert.ok(news.textContent.includes('Новость проекта'));
  assert.deepEqual(body.querySelectorAll('a').map((link) => [link.textContent, link.href]), [
    ['Как сделать перевод иных языков', 'http://127.0.0.1:8877/translation/'],
    ['Скачать файл промпта', 'http://127.0.0.1:8877/data/translation_materials.zip'],
  ]);
  assert.equal(body.textContent, bodyText
    .replace('[Как сделать перевод иных языков](/translation/)', 'Как сделать перевод иных языков')
    .replace('[Скачать файл промпта](/data/translation_materials.zip)', 'Скачать файл промпта'));
  assert.equal(body.innerHTML, '');
  assert.equal(body.querySelector('img'), null);
  assert.equal(body.querySelector('script'), null);
  assert.equal(news.querySelector('.analysis-mode'), null);
  assert.equal(news.querySelector('.entry-meta').textContent, 'Дата публикации: 05.10.2026');
  assert.equal(page.news.querySelector('details'), null);
  assert.equal(page.requests.some((request) => request.url === '/data/calendar-transcriptions.json'), false);
});
