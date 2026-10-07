import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../public_html/assets/metrika.js', import.meta.url), 'utf8');
const counterId = 113419573;
const scriptUrl = 'https://mc.yandex.ru/metrika/tag.js?id=113419573';
const productionUrl = 'https://glossalia-explorer.tuqo.ru/';

function browser(options = {}) {
  const location = new URL(options.url || `${productionUrl}#about`);
  const handlers = new Map();
  const created = [];
  const inserted = [];
  const scripts = [{ tagName: 'SCRIPT', src: new URL('assets/metrika.js', location).href }];
  const panels = new Map(['about', 'translation'].map((id) => [id, {
    hasAttribute: (name) => name === 'data-panel',
  }]));
  panels.set('main', { hasAttribute: () => false });

  const parentNode = {
    insertBefore(node, anchor) {
      const index = scripts.indexOf(anchor);
      assert.notEqual(index, -1);
      node.parentNode = this;
      scripts.splice(index, 0, node);
      inserted.push(node);
    },
  };
  scripts[0].parentNode = parentNode;

  const document = {
    body: { dataset: options.pageId === undefined ? {} : { pageId: options.pageId } },
    referrer: 'https://example.com/incoming-link',
    title: 'О сайте — Глоссалия',
    scripts,
    createElement(tag) {
      const node = { tagName: tag.toUpperCase(), src: '', async: false };
      created.push(node);
      return node;
    },
    getElementsByTagName: (tag) => tag.toLowerCase() === 'script' ? scripts : [],
    getElementById: (id) => panels.get(id) || null,
  };
  const sandbox = {
    document, location,
    addEventListener(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
  };
  sandbox.window = sandbox;

  // Оболочка site.js подключается раньше счётчика и первой обновляет заголовок панели
  if (options.panelTitles) {
    sandbox.addEventListener('hashchange', () => {
      const title = options.panelTitles[location.hash.slice(1)];
      if (title) document.title = title;
    });
  }

  const context = createContext(sandbox);
  function load() { runInContext(source, context); }
  function calls(command) {
    return Array.from(context.ym?.a || [], (args) => Array.from(args))
      .filter((args) => !command || args[1] === command);
  }
  function changeHash(hash) {
    const oldURL = location.href;
    location.hash = hash;
    for (const handler of handlers.get('hashchange') || []) {
      handler({ oldURL, newURL: location.href });
    }
  }

  load();
  return { context, document, location, created, inserted, load, calls, changeHash };
}

test('боевой сайт создаёт асинхронный загрузчик и один init с переданными настройками', () => {
  const page = browser({ url: `${productionUrl}translation/`, pageId: 'translation' });
  assert.equal(typeof page.context.ym, 'function');
  assert.equal(page.calls().length, 1);
  const [init] = page.calls('init');
  assert.equal(init[0], counterId);
  assert.deepEqual({ ...init[2] }, {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: 'dataLayer',
    referrer: page.document.referrer,
    url: page.location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });
  assert.equal(page.inserted.length, 1);
  assert.equal(page.inserted[0].tagName, 'SCRIPT');
  assert.equal(page.inserted[0].src, scriptUrl);
  assert.equal(page.inserted[0].async, true);
});

test('локальные, файловые и чужие адреса не создают счётчик и удалённый script', () => {
  for (const url of [
    'http://localhost:8877/', 'http://127.0.0.1:8877/', 'http://[::1]:8877/',
    'file:///C:/site/index.html', 'https://example.com/',
    'https://glossalia-explorer.tuqo.ru.example.com/', 'https://www.glossalia-explorer.tuqo.ru/',
  ]) {
    const page = browser({ url });
    page.changeHash('#translation');
    assert.equal(Object.hasOwn(page.context, 'ym'), false, url);
    assert.equal(page.created.length, 0, url);
    assert.equal(page.inserted.length, 0, url);
  }
});

test('переход к панели прежней оболочки отправляет один hit с обновлённым заголовком', () => {
  const title = 'Как сделать перевод иных языков';
  const page = browser({ panelTitles: { translation: title } });
  const previousUrl = page.location.href;
  page.changeHash('#translation');
  assert.equal(page.document.title, title);
  assert.equal(page.calls('init').length, 1);
  assert.equal(page.calls('hit').length, 1);
  const [hit] = page.calls('hit');
  assert.equal(hit[0], counterId);
  assert.equal(hit[2], `${productionUrl}#translation`);
  assert.deepEqual({ ...hit[3] }, { title, referer: previousUrl });
});

test('обычные якоря и hash статической страницы не добавляют просмотров', () => {
  const legacy = browser();
  legacy.changeHash('#main');
  legacy.changeHash('#unknown-anchor');
  assert.equal(legacy.calls('init').length, 1);
  assert.equal(legacy.calls('hit').length, 0);

  const staticPage = browser({ url: `${productionUrl}translation/`, pageId: 'translation' });
  staticPage.changeHash('#about');
  staticPage.changeHash('#main');
  assert.equal(staticPage.calls('init').length, 1);
  assert.equal(staticPage.calls('hit').length, 0);
});

test('повторное исполнение счётчика не дублирует init, загрузчик и просмотры панелей', () => {
  const page = browser();
  page.load();
  page.load();
  assert.equal(page.calls('init').length, 1);
  assert.equal(page.created.length, 1);
  assert.equal(page.inserted.length, 1);
  page.changeHash('#translation');
  assert.equal(page.calls('hit').length, 1);
});
