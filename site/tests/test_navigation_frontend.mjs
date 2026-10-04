import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../public_html/assets/site.js', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../scripts/build_static.py', import.meta.url), 'utf8');
const routeBlock = builder.match(/ROUTES = \{([\s\S]*?)\n\}/)?.[1];
assert.ok(routeBlock);
const routeIds = new Map([...routeBlock.matchAll(/"([a-z0-9-]+)": "([^"]+)"/g)].map((match) => [match[2], match[1]]));
const sectionRoutes = [...routeIds.keys()];
const documentRoutes = sectionRoutes.filter((route) => routeIds.get(route).startsWith('article-')
  || ['help-eugenics', 'help-churches'].includes(routeIds.get(route)));
const scrollKey = 'glossaliae-scroll-to-tabs';

function browser(options = {}) {
  const location = new URL(options.url || 'https://glossalia-explorer.tuqo.ru/situations/');
  const pageId = options.pageId || routeIds.get(location.pathname) || 'situations';
  const storage = options.storage || new Map();
  const documentHandlers = new Map();
  const windowHandlers = new Map();
  const frames = [];
  const scrolls = [];
  const restoredPositions = [];
  const fetches = [];

  function element() {
    return {
      children: [], listeners: new Map(), textContent: '',
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {},
      addEventListener(name, handler) { this.listeners.set(name, handler); },
    };
  }

  const dialog = options.detailDialog ? element() : null;
  if (dialog) {
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.listeners.get('close')(); };
  }
  const detailElements = dialog ? new Map([
    ['transcription-detail-dialog', dialog],
    ['transcription-detail-title', element()],
    ['transcription-detail-content', element()],
    ['transcription-detail-page', element()],
  ]) : new Map();
  const nav = { scrollIntoView: (settings) => scrolls.push({ ...settings, target: 'tabs' }) };
  const heading = { scrollIntoView: (settings) => scrolls.push({ ...settings, target: 'document' }) };
  const context = createContext({
    document: {
      body: { dataset: options.hashPanels ? {} : { pageId } },
      documentElement: { classList: { add() {}, remove() {} } },
      querySelector: (selector) => selector === '.section-nav' ? nav : null,
      querySelectorAll: (selector) => selector === '[data-panel]'
        ? (options.hashPanels || []).map((id) => ({ id, classList: { toggle() {} } })) : [],
      getElementById: (id) => id === `${pageId}-title` ? heading : detailElements.get(id) || null,
      createElement: element,
      addEventListener: (name, handler) => {
        if (!documentHandlers.has(name)) documentHandlers.set(name, []);
        documentHandlers.get(name).push(handler);
      },
    },
    window: {
      location, scrollX: 11, scrollY: 912,
      performance: { getEntriesByType: () => [{ type: options.navigationType || 'navigate' }] },
      scrollTo: (settings) => restoredPositions.push(settings),
      addEventListener: (name, handler) => {
        if (!windowHandlers.has(name)) windowHandlers.set(name, []);
        windowHandlers.get(name).push(handler);
      },
    },
    localStorage: { getItem: () => null },
    sessionStorage: {
      getItem: (key) => {
        if (options.blockedStorage) throw new Error('Storage blocked');
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (options.blockedStorage) throw new Error('Storage blocked');
        storage.set(key, String(value));
      },
      removeItem: (key) => {
        if (options.blockedStorage) throw new Error('Storage blocked');
        storage.delete(key);
      },
    },
    requestAnimationFrame: (callback) => frames.push(callback),
    fetch: async (url) => {
      fetches.push(url);
      return { ok: false };
    },
    AbortController,
    URL,
  });
  runInContext(source, context);
  assert.equal(fetches.length, 0);

  async function click(href, properties = {}, linkOptions = {}) {
    const link = {
      href: new URL(href, location.href).href,
      target: linkOptions.target || '',
      getAttribute: (name) => name === 'href' ? href : null,
      hasAttribute: (name) => name === 'download' && Boolean(linkOptions.download),
      focus: (settings) => { link.focusSettings = settings; },
    };
    const event = {
      button: 0, defaultPrevented: false,
      target: { closest: (selector) => selector === 'a[href]'
        || (linkOptions.detail && selector === '.sos-actions a, .entry-card h3 a, .entry-card h4 a') ? link : null },
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const handler of documentHandlers.get('click') || []) await handler(event);
    return { event, link };
  }

  function showPage(properties = {}) {
    for (const handler of windowHandlers.get('pageshow') || []) handler({ persisted: false, ...properties });
  }

  function runFrames() {
    for (const frame of frames.splice(0)) frame();
  }

  return { click, showPage, runFrames, storage, scrolls, restoredPositions, dialog, fetches, location };
}

test('ссылки разделов прокручивают к табам, а документы — к своему заголовку', async () => {
  assert.ok(sectionRoutes.length > 0);
  for (const route of sectionRoutes) {
    const storage = new Map();
    const origin = browser({ url: 'https://glossalia-explorer.tuqo.ru/transcriptions/T00027/part_8/', storage });
    const { event } = await origin.click(route);
    assert.equal(event.defaultPrevented, false);
    assert.equal(storage.get(scrollKey), route);
    assert.equal(origin.scrolls.length, 0);

    const destination = browser({ url: `https://glossalia-explorer.tuqo.ru${route}`, storage });
    destination.showPage();
    destination.runFrames();
    assert.equal(destination.scrolls.length, 1);
    assert.equal(destination.scrolls[0].block, 'start');
    assert.equal(destination.scrolls[0].behavior, 'instant');
    assert.equal(destination.scrolls[0].target, documentRoutes.includes(route) ? 'document' : 'tabs');
    assert.equal(storage.has(scrollKey), false);
    destination.showPage();
    destination.runFrames();
    assert.equal(destination.scrolls.length, 1);
  }
});

test('прямое открытие каждого документа прокручивает к заголовку без флага и хранилища', () => {
  for (const route of documentRoutes) {
    for (const blockedStorage of [false, true]) {
      const page = browser({ url: `http://127.0.0.1:8877${route}`, blockedStorage });
      page.showPage();
      page.runFrames();
      assert.equal(page.scrolls.length, 1, route);
      assert.equal(page.scrolls[0].target, 'document');
      assert.equal(page.scrolls[0].block, 'start');
      page.showPage();
      page.runFrames();
      assert.equal(page.scrolls.length, 1);
    }
  }
});

test('новая вкладка документа прокручивается сама, исходная вкладка сохраняет обычный клик', async () => {
  const route = '/articles/latin-greek-process-morphology/';
  for (const [properties, linkOptions] of [
    [{ ctrlKey: true }, {}], [{ button: 1 }, {}], [{}, { target: '_blank' }],
  ]) {
    const origin = browser();
    const { event } = await origin.click(route, properties, linkOptions);
    origin.runFrames();
    assert.equal(event.defaultPrevented, false);
    assert.equal(origin.storage.has(scrollKey), false);
    assert.equal(origin.scrolls.length, 0);

    const destination = browser({ url: `https://glossalia-explorer.tuqo.ru${route}` });
    destination.showPage();
    destination.runFrames();
    assert.equal(destination.scrolls.length, 1);
    assert.equal(destination.scrolls[0].target, 'document');
  }
});

test('открытие якоря документа, возврат и перезагрузка сохраняют позицию браузера', () => {
  for (const options of [
    { url: 'http://127.0.0.1:8877/articles/latin-greek-process-morphology/#main' },
    { navigationType: 'back_forward' },
    { navigationType: 'reload' },
    { persisted: true },
  ]) {
    const page = browser({ url: 'http://127.0.0.1:8877/articles/latin-greek-process-morphology/', ...options });
    page.showPage({ persisted: Boolean(options.persisted) });
    page.runFrames();
    assert.equal(page.scrolls.length, 0);
  }
});

test('ссылка текущего раздела прокручивает сразу, а другой query ждёт загрузки страницы', async () => {
  const page = browser();
  const current = await page.click('/situations/');
  assert.equal(current.event.defaultPrevented, true);
  page.runFrames();
  assert.equal(page.scrolls.length, 1);
  assert.equal(page.storage.has(scrollKey), false);

  const differentQuery = await page.click('/situations/?view=all');
  assert.equal(differentQuery.event.defaultPrevented, false);
  page.runFrames();
  assert.equal(page.scrolls.length, 1);
  assert.equal(page.storage.get(scrollKey), '/situations/');
});

test('модификаторы, средняя кнопка и уже отменённый клик сохраняют поведение браузера', async () => {
  for (const properties of [
    { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
    { button: 1 }, { button: 2 }, { defaultPrevented: true },
  ]) {
    const page = browser();
    const { event } = await page.click('/situations/glossolalia/', properties);
    page.runFrames();
    assert.equal(event.defaultPrevented, Boolean(properties.defaultPrevented));
    assert.equal(page.storage.has(scrollKey), false);
    assert.equal(page.scrolls.length, 0);
  }
});

test('внешние, служебные, неизвестные и якорные ссылки не ставят флаг прокрутки', async () => {
  for (const href of [
    'https://example.com/situations/glossolalia/', '/transcriptions/T00027/part_8/',
    '/assets/header-cross.png', '/data/entries.json', '/situations/unknown/',
    '/help/not-a-section/', '#main', '#', '/situations/glossolalia/#fragment',
  ]) {
    const page = browser();
    await page.click(href);
    page.runFrames();
    assert.equal(page.storage.has(scrollKey), false, href);
    assert.equal(page.scrolls.length, 0, href);
  }
});

test('ссылки для загрузки и открытия в другом контексте не меняют прокрутку', async () => {
  for (const linkOptions of [
    { download: true }, { target: '_blank' }, { target: '_parent' },
    { target: '_top' }, { target: 'reader' },
  ]) {
    const page = browser();
    await page.click('/help/glossolalia/', {}, linkOptions);
    assert.equal(page.storage.has(scrollKey), false);
  }

  const page = browser();
  await page.click('/help/glossolalia/', {}, { target: '_SELF' });
  assert.equal(page.storage.get(scrollKey), '/help/glossolalia/');
});

test('локальные маршруты работают, но ссылка на другой порт не считается внутренней', async () => {
  const page = browser({ url: 'http://127.0.0.1:8877/situations/' });
  await page.click('http://127.0.0.1:8878/help/');
  assert.equal(page.storage.has(scrollKey), false);
  await page.click('/situations/glossolalia/');
  assert.equal(page.storage.get(scrollKey), '/situations/glossolalia/');
});

test('прежняя оболочка с hash переключает только известные панели', async () => {
  const page = browser({ url: 'http://127.0.0.1:8877/', hashPanels: ['about', 'situation-1'] });
  const panel = await page.click('#situation-1');
  assert.equal(panel.event.defaultPrevented, false);
  page.runFrames();
  assert.equal(page.scrolls.length, 1);
  await page.click('#main');
  page.runFrames();
  assert.equal(page.scrolls.length, 1);
});

test('просроченный переход не прокручивает другой раздел, запрещённое хранилище не ломает клик', async () => {
  const storage = new Map([[scrollKey, '/help/']]);
  const page = browser({ storage });
  page.showPage();
  page.runFrames();
  assert.equal(page.scrolls.length, 0);
  assert.equal(storage.has(scrollKey), false);

  const blockedPage = browser({ blockedStorage: true });
  const { event } = await blockedPage.click('/help/');
  assert.equal(event.defaultPrevented, false);
  blockedPage.showPage();
  blockedPage.runFrames();
  assert.equal(blockedPage.scrolls.length, 0);
});

test('Подробнее открывает прежнюю модалку и после закрытия сохраняет место абзаца', async () => {
  const page = browser({ detailDialog: true });
  const { event, link } = await page.click('/transcriptions/T00027/part_8/', {}, { detail: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(page.dialog.open, true);
  assert.equal(page.fetches.length, 1);
  assert.equal(page.storage.has(scrollKey), false);
  page.runFrames();
  assert.equal(page.scrolls.length, 0);

  page.dialog.close();
  assert.equal(link.focusSettings.preventScroll, true);
  assert.equal(page.restoredPositions.length, 1);
  assert.equal(page.restoredPositions[0].left, 11);
  assert.equal(page.restoredPositions[0].top, 912);
});
