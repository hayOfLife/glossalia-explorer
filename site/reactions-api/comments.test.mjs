import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashAdminPassword } from './comments.mjs';
import { createReactionServer } from './server.mjs';

const allowedOrigin = 'https://glossalia-explorer.tuqo.ru';
const endpoint = '/glossaliae/comments';
const allowedKeys = ['T00014', 'T00016'];
const limits = { messageLength: 2000, nameLength: 40, editWindowMs: 300000 };
const token = (number) => number.toString(16).padStart(64, '0');
const adminPassword = 'test-only-admin-password-for-temporary-fixtures';
const adminPasswordHash = hashAdminPassword(adminPassword);
const adminSessions = new Map();
const localOrigin = 'http://localhost:8877';

async function withServer(callback, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'glossaliae-comments-'));
  const storagePath = join(directory, 'reactions.json');
  const commentsPath = join(directory, 'comments.json');
  const clock = { value: 1000000, advance(milliseconds = 10001) { this.value += milliseconds; } };
  let server;
  let serverBaseUrl;

  async function stop() {
    if (!server) return;
    const closed = once(server, 'close');
    server.close();
    await closed;
    adminSessions.delete(serverBaseUrl);
    server = undefined;
  }

  async function start() {
    server = createReactionServer({ storagePath, allowedOrigin, allowedKeys, now: () => clock.value, ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    serverBaseUrl = `http://127.0.0.1:${server.address().port}`;
    if (options.adminPasswordHash === adminPasswordHash) await login(serverBaseUrl);
    return serverBaseUrl;
  }

  try {
    const baseUrl = await start();
    await callback({ baseUrl, server, storagePath, commentsPath, clock, restart: async () => { await stop(); return start(); } });
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
}

function post(baseUrl, body, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      Origin: options.origin ?? allowedOrigin,
      'Content-Type': options.contentType ?? 'text/plain;charset=UTF-8',
      ...(options.ip === null ? {} : { 'X-Glossaliae-Client-IP': options.ip ?? '203.0.113.10' }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function create(baseUrl, text, authorToken = token(1), options = {}) {
  return post(baseUrl, { action: 'create', key: options.key ?? 'T00014', text,
    authorToken, replyTo: options.replyTo ?? null }, options);
}

function edit(baseUrl, message, text, authorToken = token(1), options = {}) {
  return post(baseUrl, { action: 'edit', key: options.key ?? 'T00014', id: message.id,
    text, authorToken }, options);
}

async function publicMessage(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const body = await response.json();
  assert.equal(typeof body.serverTime, 'number');
  assert.deepEqual(body.limits, limits);
  assert.deepEqual(Object.keys(body.message).sort(), ['createdAt', 'deleted', 'id', 'name', 'replyPreview', 'replyTo', 'text', 'updatedAt']);
  assert.match(body.message.id, /^[0-9a-f]{32}$/);
  assert.equal(typeof body.message.createdAt, 'number');
  assert.equal(typeof body.message.updatedAt, 'number');
  assert.equal(typeof body.message.deleted, 'boolean');
  return body.message;
}

async function list(baseUrl, key = 'T00014', parameters = {}) {
  const query = new URLSearchParams({ key, ...parameters });
  const response = await fetch(`${baseUrl}${endpoint}?${query}`, { headers: { Origin: allowedOrigin } });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.limits, limits);
  assert.equal(typeof body.serverTime, 'number');
  assert.equal(typeof body.closed, 'boolean');
  assert.ok(Array.isArray(body.messages));
  return body;
}

async function rejected(response, expectedError) {
  assert.ok(response.status >= 400 && response.status < 500, `${response.status}: ${await response.clone().text()}`);
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.equal(typeof body.message, 'string');
  if (expectedError) assert.equal(body.error, expectedError);
}

function vote(baseUrl, value = 1) {
  return fetch(`${baseUrl}/glossaliae/reactions`, {
    method: 'POST',
    headers: { Origin: allowedOrigin, 'Content-Type': 'text/plain', 'X-Glossaliae-Client-IP': '203.0.113.10' },
    body: JSON.stringify({ key: 'T00014', voterId: 'a'.repeat(32), vote: value }),
  });
}

function admin(baseUrl, body, options = {}) {
  return post(baseUrl, { ...body, adminToken: options.adminToken ?? adminSessions.get(baseUrl) ?? token(999) }, { origin: localOrigin, ...options });
}

async function login(baseUrl, options = {}) {
  const response = await post(baseUrl, { action: 'admin-login', key: '*', password: options.password ?? adminPassword },
    { origin: localOrigin, ...options });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.match(body.adminToken, /^[0-9a-f]{64}$/);
  assert.equal(body.expiresAt, body.serverTime + 1800000);
  assert.equal(typeof body.globalClosed, 'boolean');
  assert.ok(Array.isArray(body.closedKeys));
  assert.deepEqual(body.limits, limits);
  assert.ok(Number.isSafeInteger(body.unreadCount) && body.unreadCount >= 0);
  adminSessions.set(baseUrl, body.adminToken);
  return body;
}

async function adminStatus(baseUrl) {
  const response = await admin(baseUrl, { action: 'admin-status', key: '*' });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['closedKeys', 'discussionKeys', 'globalClosed', 'limits', 'serverTime', 'unreadCount']);
  assert.equal(typeof body.globalClosed, 'boolean');
  assert.ok(Array.isArray(body.closedKeys));
  assert.ok(Array.isArray(body.discussionKeys));
  assert.deepEqual(body.limits, limits);
  assert.equal(typeof body.serverTime, 'number');
  assert.ok(Number.isSafeInteger(body.unreadCount) && body.unreadCount >= 0);
  return body;
}

async function inbox(baseUrl, parameters = {}, options = {}) {
  const response = await admin(baseUrl, { action: 'admin-inbox', key: '*', ...parameters }, options);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['limits', 'messages', 'nextBefore', 'serverTime', 'unreadCount']);
  assert.deepEqual(body.limits, limits);
  assert.ok(Number.isSafeInteger(body.unreadCount) && body.unreadCount >= 0);
  for (const message of body.messages) {
    assert.deepEqual(Object.keys(message).sort(), ['createdAt', 'deleted', 'id', 'key', 'name', 'read', 'replyPreview', 'replyTo', 'text', 'updatedAt']);
    assert.equal(typeof message.read, 'boolean');
    assert.equal(typeof message.key, 'string');
    assert.equal(message.deleted, false);
  }
  return body;
}

function markRead(baseUrl, message, options = {}) {
  return admin(baseUrl, { action: 'admin-read', key: options.key ?? message.key ?? 'T00014', id: message.id,
    updatedAt: options.updatedAt ?? message.updatedAt }, options);
}

test('comments and edits survive restarting without changing votes or exposing author credentials', async () => {
  await withServer(async ({ baseUrl, storagePath, commentsPath, clock, restart }) => {
    assert.equal((await vote(baseUrl)).status, 200);
    const originalVotes = readFileSync(storagePath);
    const original = await publicMessage(await create(baseUrl, 'Первая запись'), 201);
    assert.equal(original.createdAt, clock.value);
    assert.equal(original.updatedAt, clock.value);
    assert.equal(original.deleted, false);
    assert.equal(original.replyTo, null);
    assert.equal(original.replyPreview, null);

    clock.advance();
    const updated = await publicMessage(await edit(baseUrl, original, 'Уточнённая запись'), 200);
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal(updated.updatedAt, clock.value);
    assert.equal(updated.name, original.name);
    assert.equal(updated.text, 'Уточнённая запись');
    assert.deepEqual(readFileSync(storagePath), originalVotes);
    assert.equal(readFileSync(commentsPath, 'utf8').includes(token(1)), false);

    const restartedUrl = await restart();
    assert.deepEqual((await list(restartedUrl)).messages, [updated]);
    assert.deepEqual((await list(restartedUrl, 'T00016')).messages, []);
    const publicBody = JSON.stringify(await list(restartedUrl));
    assert.equal(publicBody.includes(token(1)), false);
    assert.equal(publicBody.includes('203.0.113.10'), false);
    assert.deepEqual(readFileSync(storagePath), originalVotes);
  });
});

test('only the author can edit and the five minute edit window ends at its exact boundary', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const message = await publicMessage(await create(baseUrl, 'Изначальный текст'), 201);
    clock.advance();
    await rejected(await edit(baseUrl, message, 'Чужая правка', token(2)), 'not_author');

    clock.value = message.createdAt + 299999;
    const updated = await publicMessage(await edit(baseUrl, message, 'Последняя разрешённая правка'), 200);
    assert.equal(updated.createdAt, message.createdAt);
    assert.equal(updated.updatedAt, clock.value);
    assert.equal(updated.text, 'Последняя разрешённая правка');
  });

  await withServer(async ({ baseUrl, clock }) => {
    const message = await publicMessage(await create(baseUrl, 'Текст с ограниченным сроком'), 201);
    clock.value = message.createdAt + 300000;
    await rejected(await edit(baseUrl, message, 'Запоздалая правка'), 'edit_expired');
    assert.deepEqual((await list(baseUrl)).messages, [message]);
  });
});

test('one author token has a stable pseudonym across discussions, edits and restarts', async () => {
  let rememberedName;
  await withServer(async ({ baseUrl, clock, commentsPath, restart }) => {
    const authorHash = createHash('sha256').update(token(1)).digest('hex');
    const first = await publicMessage(await create(baseUrl, 'Первое сообщение автора'), 201);
    const expectedName = first.name;
    rememberedName = first.name;
    assert.match(first.name, /^user[A-Za-z0-9]{3,16}$/);
    assert.equal(first.name.length, 16);
    assert.match(first.name.slice(4), /[A-Za-z]/);
    assert.match(first.name.slice(4), /[0-9]/);
    clock.advance();
    const second = await publicMessage(await create(baseUrl, 'Другой раздел того же автора', token(1), { key: 'T00016' }), 201);
    assert.equal(second.name, expectedName);
    clock.advance();
    const reply = await publicMessage(await create(baseUrl, 'Ответ другого автора', token(2), { replyTo: first.id }), 201);
    assert.match(reply.name, /^user[A-Za-z0-9]{3,16}$/);
    assert.notEqual(reply.name, expectedName);
    assert.equal(reply.replyPreview.name, expectedName);
    clock.advance();
    const updated = await publicMessage(await edit(baseUrl, first, 'Правка первого сообщения'), 200);
    assert.equal(updated.name, expectedName);
    const stored = JSON.parse(readFileSync(commentsPath, 'utf8'));
    assert.equal(stored.version, 3);
    assert.equal(stored.users[authorHash], expectedName);
    assert.equal(Object.hasOwn(stored.messages[0], 'name'), false);

    const restartedUrl = await restart();
    const messages = [...(await list(restartedUrl)).messages, ...(await list(restartedUrl, 'T00016')).messages];
    assert.equal(messages.filter((message) => message.name === expectedName).length, 2);
    const content = JSON.stringify(messages);
    assert.equal(content.includes(authorHash), false);
    assert.equal(content.includes(token(1)), false);
  });
  await withServer(async ({ baseUrl }) => {
    const independent = await publicMessage(await create(baseUrl, 'Тот же токен в независимом хранилище'), 201);
    assert.notEqual(independent.name, rememberedName);
  });
});

test('an unchanged text can be edited while a name or reply target cannot be supplied', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const message = await publicMessage(await create(baseUrl, 'Текст остаётся прежним'), 201);
    clock.advance();
    const updated = await publicMessage(await edit(baseUrl, message, message.text), 200);
    assert.equal(updated.text, message.text);
    assert.equal(updated.name, message.name);

    clock.advance();
    await rejected(await post(baseUrl, { action: 'edit', key: 'T00014', id: message.id, name: 'Имя',
      text: 'Подмена имени', authorToken: token(1) }), 'invalid_request');
    await rejected(await post(baseUrl, { action: 'edit', key: 'T00014', id: message.id,
      text: 'Подмена ответа', authorToken: token(1), replyTo: message.id }), 'invalid_request');
    assert.deepEqual((await list(baseUrl)).messages, [updated]);
  });
});

test('an edit body completed after the five minute deadline cannot use its earlier connection time', async () => {
  await withServer(async ({ baseUrl, server, clock }) => {
    const message = await publicMessage(await create(baseUrl, 'Текст до задержанного запроса'), 201);
    clock.advance();
    const body = JSON.stringify({ action: 'edit', key: 'T00014', id: message.id,
      text: 'Правка после передачи медленного тела', authorToken: token(1) });
    let pendingRequest;
    let timer;
    const bodyStarted = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The server did not begin reading the partial request')), 5000);
      server.once('request', (incoming) => incoming.once('data', resolve));
    });
    const result = new Promise((resolve, reject) => {
      pendingRequest = httpRequest(`${baseUrl}${endpoint}`, { method: 'POST', headers: {
        Origin: allowedOrigin, 'Content-Type': 'text/plain', 'X-Glossaliae-Client-IP': '203.0.113.10',
      } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      pendingRequest.on('error', reject);
      pendingRequest.write(body.slice(0, 40));
    });

    try {
      await bodyStarted;
      clearTimeout(timer);
      clock.value = message.createdAt + 300000;
      pendingRequest.end(body.slice(40));
      const response = await result;
      assert.equal(response.status, 403);
      assert.equal(response.body.error, 'edit_expired');
      assert.deepEqual((await list(baseUrl)).messages, [message]);
    } finally {
      clearTimeout(timer);
      pendingRequest.destroy();
    }
  });
});

test('HTML is returned as plain text and Unicode length counts code points instead of UTF-16 units', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const text = '<script>alert("example")</script><img src=x onerror="alert(1)">';
    const message = await publicMessage(await create(baseUrl, text), 201);
    assert.equal(message.text, text);
    assert.equal((await list(baseUrl)).messages[0].text, text);

    clock.advance();
    const maximum = await publicMessage(await create(baseUrl, '😀'.repeat(2000), token(2)), 201);
    assert.equal([...maximum.text].length, 2000);
    assert.match(maximum.name, /^user[A-Za-z0-9]{3,16}$/);
    await rejected(await create(baseUrl, '😀'.repeat(2001), token(3), { ip: '203.0.113.11' }));
    assert.equal((await list(baseUrl)).messages.length, 2);
  });
});

test('whole-word profanity blocks Russian and English words without rejecting innocent substrings', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const innocent = 'Бляха, подстрахуй проверку, классический подход, shitake. Сукка, Сукачёв.';
    const original = await publicMessage(await create(baseUrl, innocent), 201);
    assert.equal(original.text, innocent);
    for (const [index, text] of ['БЛЯТЬ!', 'Это fuck.', 'Хуй', 'СуКа!'].entries()) {
      clock.advance();
      await rejected(await create(baseUrl, text, token(index + 2), { ip: `203.0.113.${index + 20}` }), 'profanity');
    }
    assert.deepEqual((await list(baseUrl)).messages.map((message) => message.text), [innocent]);
    clock.advance();
    await rejected(await edit(baseUrl, original, 'сука'), 'profanity');
    clock.advance();
    const permittedEdit = 'Сукка — допустимое слово; Сукачёв.';
    assert.equal((await publicMessage(await edit(baseUrl, original, permittedEdit), 200)).text, permittedEdit);
    assert.deepEqual((await list(baseUrl)).messages.map((message) => message.text), [permittedEdit]);
  });
});

test('request shape, unpublished keys, empty values and malformed credentials are rejected without storing comments', async () => {
  await withServer(async ({ baseUrl }) => {
    const valid = { action: 'create', key: 'T00014', text: 'Запись', authorToken: token(1), replyTo: null };
    const invalid = [
      { ...valid, extra: true }, { ...valid, key: 'T00017' }, { ...valid, text: '' }, { ...valid, text: ' \n\t' },
      { ...valid, text: '\u200b\u200c\u200d' }, { ...valid, name: 'Читатель' },
      { ...valid, authorToken: 'a'.repeat(63) }, { ...valid, authorToken: 'g'.repeat(64) },
      { ...valid, replyTo: 1 }, { ...valid, replyTo: 'a'.repeat(31) }, { ...valid, action: 'remove' },
      { ...valid, text: ['Запись'] },
    ];
    for (const [index, body] of invalid.entries()) {
      await rejected(await post(baseUrl, body, { ip: `203.0.113.${index + 40}` }));
    }
    await rejected(await post(baseUrl, '{broken-json', { ip: '203.0.113.60' }), 'invalid_request');
    await rejected(await post(baseUrl, 'x'.repeat(20000), { ip: '203.0.113.61' }));
    await rejected(await post(baseUrl, valid, { ip: '203.0.113.62', contentType: 'application/json' }));
    await rejected(await post(baseUrl, valid, { ip: null }));
    assert.deepEqual((await list(baseUrl)).messages, []);
  });
});

test('duplicate comparison normalizes case, whitespace, zero-width characters and compatibility forms', async () => {
  for (const scope of ['author', 'address', 'transcription']) {
    await withServer(async ({ baseUrl, clock }) => {
      await publicMessage(await create(baseUrl, 'Текст ＡＢＣ\u200b   пример'), 201);
      clock.advance();
      await rejected(await create(baseUrl, '  текст abc\nпример  ', scope === 'author' ? token(1) : token(2), {
        key: scope === 'transcription' ? 'T00014' : 'T00016',
        ip: scope === 'address' ? '203.0.113.10' : '203.0.113.11',
      }), 'duplicate');
      assert.equal((await list(baseUrl)).messages.length, 1, scope);
      assert.deepEqual((await list(baseUrl, 'T00016')).messages, [], scope);
    });
  }
});

test('duplicate protection compares only the previous two messages rather than preventing an old text forever', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const text = 'Повторяемое давнее сообщение';
    await publicMessage(await create(baseUrl, text), 201);
    clock.advance();
    await publicMessage(await create(baseUrl, 'Второе сообщение'), 201);
    clock.advance();
    await publicMessage(await create(baseUrl, 'Третье сообщение'), 201);
    clock.advance();
    await publicMessage(await create(baseUrl, text), 201);
    assert.deepEqual((await list(baseUrl)).messages.map((message) => message.text), [text, 'Второе сообщение', 'Третье сообщение', text]);
  });
});

test('editing an old first or middle message checks both nearby directions in its discussion', async () => {
  for (const { target, neighbours } of [{ target: 0, neighbours: [1, 2] }, { target: 3, neighbours: [1, 2, 4, 5] }]) {
    await withServer(async ({ baseUrl, clock }) => {
      const messages = [];
      for (let index = 0; index < 8; index++) {
        messages.push(await publicMessage(await create(baseUrl, `Разный текст ${index}`, token(index + 1),
          { ip: `203.0.113.${index + 1}` }), 201));
        clock.advance();
      }

      for (const neighbour of neighbours) {
        const response = await edit(baseUrl, messages[target], messages[neighbour].text, token(target + 1),
          { ip: `203.0.113.${neighbour + 100}` });
        assert.equal(response.status, 409, `target=${target}, neighbour=${neighbour}`);
        await rejected(response, 'duplicate');
        clock.advance();
      }

      assert.deepEqual((await list(baseUrl)).messages, messages);
      const updated = await publicMessage(await edit(baseUrl, messages[target], 'Уникальная допустимая правка', token(target + 1),
        { ip: '203.0.113.200' }), 200);
      assert.equal(updated.text, 'Уникальная допустимая правка');
    });
  }
});

test('editing checks nearby messages by one author across different discussions', async () => {
  const cases = [{ target: 0, neighbours: [1, 2] }, { target: 2, neighbours: [0, 1, 3, 4] }];
  const keys = ['T00014', 'T00016', 'for-ai', 'T00014', 'T00016'];
  for (const { target, neighbours } of cases) {
    for (const neighbour of neighbours) {
      await withServer(async ({ baseUrl, clock }) => {
        const messages = [];
        for (let index = 0; index < keys.length; index++) {
          messages.push(await publicMessage(await create(baseUrl, `Авторский текст ${index}`, token(1),
            { key: keys[index], ip: `203.0.113.${index + 1}` }), 201));
          clock.advance();
        }

        const response = await edit(baseUrl, messages[target], messages[neighbour].text, token(1),
          { key: keys[target], ip: '203.0.113.100' });
        assert.equal(response.status, 409, `target=${target}, neighbour=${neighbour}`);
        await rejected(response, 'duplicate');
        assert.deepEqual((await list(baseUrl, keys[target])).messages, messages.filter((message, index) => keys[index] === keys[target]));
        clock.advance();
        const unchanged = await publicMessage(await edit(baseUrl, messages[target], messages[target].text, token(1),
          { key: keys[target], ip: '203.0.113.101' }), 200);
        assert.equal(unchanged.text, messages[target].text);
      });
    }
  }
});

test('distant matching messages from other authors do not prevent harmless edits', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const texts = ['Далёкий повтор', 'Первый промежуток', 'Второй промежуток', 'Далёкий повтор',
      'Третий промежуток', 'Четвёртый промежуток', 'Пятый промежуток', 'Шестой промежуток'];
    const messages = [];
    for (const [index, text] of texts.entries()) {
      messages.push(await publicMessage(await create(baseUrl, text, token(index + 1),
        { ip: `203.0.113.${index + 1}` }), 201));
      clock.advance();
    }

    for (const index of [0, 3]) {
      const unchanged = await publicMessage(await edit(baseUrl, messages[index], messages[index].text, token(index + 1),
        { ip: `203.0.113.${index + 100}` }), 200);
      assert.equal(unchanged.text, texts[index]);
      clock.advance();
    }
    assert.deepEqual((await list(baseUrl)).messages.map((message) => message.text), texts);
  });
});

test('ten second spacing applies to successful writes by both author and address', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    await publicMessage(await create(baseUrl, 'Первое сообщение'), 201);
    clock.advance(9999);
    await rejected(await create(baseUrl, 'Тот же автор на другом адресе', token(1), { ip: '203.0.113.11' }), 'rate_limited');
    await rejected(await create(baseUrl, 'Другой автор на том же адресе', token(2)), 'rate_limited');
    clock.advance(1);
    await publicMessage(await create(baseUrl, 'Сообщение на границе десяти секунд'), 201);
    assert.equal((await list(baseUrl)).messages.length, 2);
  });
});

test('one author has eight create or edit attempts per ten minutes and the limit expires', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const initialTime = clock.value;
    const message = await publicMessage(await create(baseUrl, 'Сообщение 0'), 201);
    for (let index = 1; index < 8; index++) {
      clock.advance();
      if (index % 2) {
        await publicMessage(await edit(baseUrl, message, `Правка ${index}`), 200);
      } else {
        await publicMessage(await create(baseUrl, `Сообщение ${index}`, token(1), { key: 'T00016' }), 201);
      }
    }
    clock.advance();
    await rejected(await create(baseUrl, 'Девятая попытка'), 'rate_limited');
    clock.advance();
    await publicMessage(await create(baseUrl, 'Другой автор', token(2)), 201);
    clock.value = initialTime + 600000;
    await publicMessage(await create(baseUrl, 'После истечения лимита'), 201);
  });
});

test('failed authenticated writes count toward the author limit even across different addresses', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    for (let index = 0; index < 8; index++) {
      await rejected(await create(baseUrl, `Неопубликованный раздел ${index}`, token(1),
        { key: 'T00017', ip: `203.0.113.${index + 1}` }), 'invalid_key');
    }
    await rejected(await create(baseUrl, 'Девятая авторская попытка', token(1), { ip: '203.0.113.20' }), 'rate_limited');
    await publicMessage(await create(baseUrl, 'Независимый другой автор', token(2), { ip: '203.0.113.21' }), 201);
    clock.advance(600000);
    await publicMessage(await create(baseUrl, 'Сброс авторского ограничения', token(1), { ip: '203.0.113.22' }), 201);
  });
});

test('the address limit counts malformed requests and leaves voting independent', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    for (let index = 0; index < 20; index++) {
      await rejected(await post(baseUrl, '{invalid-json'), 'invalid_request');
    }
    await rejected(await create(baseUrl, 'Превышение IP лимита'), 'rate_limited');
    await publicMessage(await create(baseUrl, 'Другой адрес', token(2), { ip: '203.0.113.11' }), 201);
    assert.equal((await vote(baseUrl)).status, 200);
    clock.advance(600000);
    await publicMessage(await create(baseUrl, 'После сброса IP лимита'), 201);
  });
});

test('comments accept production and canonical local origins while rejecting foreign write origins', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const origins = [allowedOrigin, 'http://localhost:8877', 'https://127.0.0.1:8443', 'http://[::1]:8877'];
    for (const [index, origin] of origins.entries()) {
      const response = await create(baseUrl, `Запись ${index}`, token(index + 1), { origin });
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      await publicMessage(response, 201);
      const get = await fetch(`${baseUrl}${endpoint}?key=T00014`, { headers: { Origin: origin } });
      assert.equal(get.status, 200);
      assert.equal(get.headers.get('access-control-allow-origin'), origin);
      clock.advance();
    }

    const forbidden = ['https://other.example', 'null', 'http://localhost.evil.example:8877',
      'http://127.1:8877', 'http://localhost:0', 'http://localhost:8877/', 'http://user@localhost:8877'];
    for (const origin of forbidden) {
      const response = await create(baseUrl, 'Неразрешённая запись', token(10), { origin });
      assert.equal(response.status, 403, origin);
      assert.equal(response.headers.get('access-control-allow-origin'), null, origin);
    }
    const foreignGet = await fetch(`${baseUrl}${endpoint}?key=T00014`, { headers: { Origin: 'https://other.example' } });
    assert.equal(foreignGet.status, 200);
    assert.equal(foreignGet.headers.get('access-control-allow-origin'), null);
    assert.equal((await list(baseUrl)).messages.length, origins.length);
  });

  await withServer(async ({ baseUrl }) => {
    assert.equal((await fetch(`${baseUrl}${endpoint}?key=T00014`)).status, 404);
    assert.equal((await create(baseUrl, 'Отдельный локальный экземпляр', token(1), { origin: 'http://localhost:8877' })).status, 404);
  }, { environment: 'local', allowedOrigin: undefined });
});

test('replies and direct message lookups stay inside one transcription and preview length counts Unicode code points', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const parent = await publicMessage(await create(baseUrl, '😀'.repeat(205)), 201);
    clock.advance();
    const reply = await publicMessage(await create(baseUrl, 'Ответ на запись', token(2), { replyTo: parent.id }), 201);
    assert.equal(reply.replyTo, parent.id);
    assert.deepEqual(reply.replyPreview, { id: parent.id, name: parent.name, text: '😀'.repeat(200) });
    assert.deepEqual((await list(baseUrl, 'T00014', { id: reply.id })).messages, [reply]);
    assert.equal((await list(baseUrl, 'T00014', { id: reply.id })).nextBefore, null);

    clock.advance();
    await rejected(await create(baseUrl, 'Ответ из другой транскрипции', token(3), { key: 'T00016', replyTo: parent.id }), 'reply_not_found');
    await rejected(await create(baseUrl, 'Ответ на отсутствующий ID', token(4), { ip: '203.0.113.11', replyTo: 'f'.repeat(32) }), 'reply_not_found');
    await rejected(await fetch(`${baseUrl}${endpoint}?key=T00016&id=${parent.id}`), 'not_found');
    await rejected(await fetch(`${baseUrl}${endpoint}?key=T00014&id=invalid`), 'invalid_request');
    assert.equal((await list(baseUrl)).messages.length, 2);
    assert.deepEqual((await list(baseUrl, 'T00016')).messages, []);
  });
});

test('the AI discussion has its own supported key and cannot reply to transcription comments', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const transcription = await publicMessage(await create(baseUrl, 'Комментарий к транскрипции'), 201);
    clock.advance();
    const discussion = await publicMessage(await create(baseUrl, 'Комментарий для раздела ИИ', token(2), { key: 'for-ai' }), 201);
    assert.deepEqual((await list(baseUrl, 'for-ai')).messages, [discussion]);
    assert.deepEqual((await list(baseUrl)).messages, [transcription]);
    clock.advance();
    await rejected(await create(baseUrl, 'Ответ из раздела ИИ', token(3), { key: 'for-ai', replyTo: transcription.id }), 'reply_not_found');
    assert.deepEqual((await list(baseUrl, 'for-ai')).messages, [discussion]);
  });
});

test('pagination returns the latest fifty in ascending order and older pages without gaps or repetition', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const messages = [];
    for (let index = 0; index < 56; index++) {
      messages.push(await publicMessage(await create(baseUrl, `Сообщение номер ${index}`, token(index + 1),
        { ip: `203.0.113.${index + 1}` }), 201));
      clock.advance();
    }
    const latest = await list(baseUrl);
    assert.deepEqual(latest.messages, messages.slice(6));
    assert.equal(latest.nextBefore, messages[6].id);
    const older = await list(baseUrl, 'T00014', { before: latest.nextBefore });
    assert.deepEqual(older.messages, messages.slice(0, 6));
    assert.equal(older.nextBefore, null);
    assert.equal(new Set([...older.messages, ...latest.messages].map((message) => message.id)).size, 56);
    assert.equal(new Set(messages.map((message) => message.name)).size, 56);
    assert.deepEqual((await list(baseUrl, 'T00014', { id: messages[0].id })).messages, [messages[0]]);
  });
});

test('simultaneous creates persist all messages and generate distinct public identifiers', async () => {
  await withServer(async ({ baseUrl, restart }) => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      create(baseUrl, `Параллельное сообщение ${index}`, token(index + 1), { ip: `203.0.113.${index + 1}` })));
    const messages = await Promise.all(responses.map((response) => publicMessage(response, 201)));
    assert.equal(new Set(messages.map((message) => message.id)).size, 12);
    const expected = messages.map((message) => message.text).sort();
    assert.deepEqual((await list(baseUrl)).messages.map((message) => message.text).sort(), expected);
    const restartedUrl = await restart();
    assert.deepEqual((await list(restartedUrl)).messages.map((message) => message.text).sort(), expected);
  });
});

test('administration requires a configured password, issued session and canonical local origin', async () => {
  await withServer(async ({ baseUrl }) => {
    const unavailable = await admin(baseUrl, { action: 'admin-status', key: '*' });
    assert.equal(unavailable.status, 503);
    await publicMessage(await create(baseUrl, 'Пользовательская запись без настройки администратора'), 201);
  });

  await withServer(async ({ baseUrl, commentsPath, clock }) => {
    await publicMessage(await create(baseUrl, 'Сохранённый текст'), 201);
    const originalStorage = readFileSync(commentsPath);
    for (const origin of [allowedOrigin, 'https://other.example', 'http://localhost.evil.example:8877', 'http://localhost:8877/']) {
      const response = await admin(baseUrl, { action: 'admin-lock', key: '*', closed: true }, { origin });
      assert.equal(response.status, 403, origin);
    }
    const wrongSession = await admin(baseUrl, { action: 'admin-status', key: '*' }, { adminToken: token(998) });
    assert.equal(wrongSession.status, 401);
    await rejected(await post(baseUrl, { action: 'admin-delete', key: 'T00014', id: 'a'.repeat(32),
      authorToken: token(1) }, { origin: localOrigin }));
    assert.deepEqual(readFileSync(commentsPath), originalStorage);
    const status = await adminStatus(baseUrl);
    assert.equal(status.globalClosed, false);
    assert.deepEqual(status.closedKeys, []);
    clock.advance();
    await publicMessage(await create(baseUrl, 'Административные отказы не закрыли обсуждение', token(2)), 201);
  }, { adminPasswordHash });
});

test('administrator login rejects foreign origins, bounds passwords and limits five password attempts per address', async () => {
  await withServer(async ({ baseUrl }) => {
    for (const origin of [allowedOrigin, 'https://other.example', 'http://localhost.evil.example:8877']) {
      const response = await post(baseUrl, { action: 'admin-login', key: '*', password: adminPassword }, { origin });
      assert.equal(response.status, 403);
    }
    for (let index = 0; index < 5; index++) {
      const wrongPassword = await post(baseUrl, { action: 'admin-login', key: '*', password: 'test-only-wrong-password' },
        { origin: localOrigin, ip: '203.0.113.11' });
      assert.equal(wrongPassword.status, 401);
    }
    await rejected(await post(baseUrl, { action: 'admin-login', key: '*', password: adminPassword },
      { origin: localOrigin, ip: '203.0.113.11' }), 'rate_limited');
    await login(baseUrl, { ip: '203.0.113.12' });
    await adminStatus(baseUrl);
    await publicMessage(await create(baseUrl, 'Входы администратора не расходуют пользовательский лимит', token(1), { ip: '203.0.113.11' }), 201);
    await rejected(await post(baseUrl, { action: 'admin-login', key: '*', password: '😀'.repeat(257) },
      { origin: localOrigin, ip: '203.0.113.13' }));
  }, { adminPasswordHash });

  await withServer(async ({ baseUrl }) => {
    const response = await post(baseUrl, { action: 'admin-login', key: '*', password: adminPassword }, { origin: localOrigin });
    assert.equal(response.status, 503);
  }, { adminPasswordHash: 'invalid-password-hash' });
});

test('administrator sessions expire at thirty minutes, disappear after restart and stay out of comment storage', async () => {
  await withServer(async ({ baseUrl, commentsPath, clock, restart }) => {
    const session = adminSessions.get(baseUrl);
    await publicMessage(await create(baseUrl, 'Запись для проверки хранения сессии'), 201);
    assert.equal(readFileSync(commentsPath, 'utf8').includes(adminPassword), false);
    assert.equal(readFileSync(commentsPath, 'utf8').includes(session), false);
    assert.equal(JSON.stringify(await list(baseUrl)).includes(session), false);
    const start = clock.value;
    clock.value = start + 1799999;
    await adminStatus(baseUrl);
    clock.advance(1);
    const expired = await admin(baseUrl, { action: 'admin-status', key: '*' });
    assert.equal(expired.status, 401);
    await login(baseUrl);
    const beforeRestart = adminSessions.get(baseUrl);
    assert.notEqual(beforeRestart, session);
    const restartedUrl = await restart();
    const stale = await admin(restartedUrl, { action: 'admin-status', key: '*' }, { adminToken: beforeRestart });
    assert.equal(stale.status, 401);
    assert.notEqual(adminSessions.get(restartedUrl), beforeRestart);
    await adminStatus(restartedUrl);
    assert.equal(readFileSync(commentsPath, 'utf8').includes(adminPassword), false);
    assert.equal(readFileSync(commentsPath, 'utf8').includes(beforeRestart), false);
  }, { adminPasswordHash });
});

test('administrator authentication supports an exact synthetic Unicode password', async () => {
  const password = '  синтетический-тестовый-пароль-🔒-令和  ';
  await withServer(async ({ baseUrl }) => {
    await login(baseUrl, { password });
    await adminStatus(baseUrl);
    const response = await post(baseUrl, { action: 'admin-login', key: '*', password: password.trim() },
      { origin: localOrigin });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'admin_not_authorized');
  }, { adminPasswordHash: hashAdminPassword(password) });
});

test('per-discussion and global locks persist while an author can edit within five minutes', async () => {
  await withServer(async ({ baseUrl, clock, restart }) => {
    const message = await publicMessage(await create(baseUrl, 'Запись до закрытия'), 201);
    const lock = await admin(baseUrl, { action: 'admin-lock', key: 'T00014', closed: true });
    assert.equal(lock.status, 200);
    assert.equal((await list(baseUrl)).closed, true);
    assert.equal((await list(baseUrl, 'T00016')).closed, false);
    assert.equal((await list(baseUrl, 'for-ai')).closed, false);
    assert.deepEqual((await adminStatus(baseUrl)).closedKeys, ['T00014']);
    clock.advance();
    await rejected(await create(baseUrl, 'Новая запись в закрытый раздел', token(2)), 'chat_closed');
    await publicMessage(await edit(baseUrl, message, 'Правка после закрытия'), 200);
    clock.advance();
    await publicMessage(await create(baseUrl, 'Открытая соседняя транскрипция', token(3), { key: 'T00016' }), 201);

    assert.equal((await admin(baseUrl, { action: 'admin-lock', key: '*', closed: true })).status, 200);
    assert.equal((await list(baseUrl, 'T00016')).closed, true);
    assert.equal((await list(baseUrl, 'for-ai')).closed, true);
    clock.advance();
    await rejected(await create(baseUrl, 'Запись в глобально закрытый чат', token(4), { key: 'for-ai' }), 'chat_closed');
    const restartedUrl = await restart();
    const status = await adminStatus(restartedUrl);
    assert.equal(status.globalClosed, true);
    assert.deepEqual(status.closedKeys, ['T00014']);
    assert.equal((await list(restartedUrl)).closed, true);

    assert.equal((await admin(restartedUrl, { action: 'admin-lock', key: '*', closed: false })).status, 200);
    assert.equal((await list(restartedUrl)).closed, true);
    assert.equal((await list(restartedUrl, 'T00016')).closed, false);
    assert.equal((await admin(restartedUrl, { action: 'admin-lock', key: 'T00014', closed: false })).status, 200);
    clock.advance();
    await publicMessage(await create(restartedUrl, 'Раздел снова открыт', token(5)), 201);
  }, { adminPasswordHash });
});

test('administrative responses expose every allowed discussion even when the calendar has no entry', async () => {
  const transcriptionKeys = [...allowedKeys, ...Array.from({ length: 6 }, (_, index) => `T00027-part_${index + 1}`),
    'T00027-sos-text-1', 'T00032-part_1'];
  const expected = [...transcriptionKeys, 'for-ai'];
  await withServer(async ({ baseUrl }) => {
    assert.deepEqual((await login(baseUrl)).discussionKeys, expected);
    assert.deepEqual((await adminStatus(baseUrl)).discussionKeys, expected);
    const lock = await admin(baseUrl, { action: 'admin-lock', key: 'T00027-part_4', closed: true });
    assert.equal(lock.status, 200);
    assert.deepEqual((await lock.json()).discussionKeys, expected);
  }, { adminPasswordHash, allowedKeys: transcriptionKeys });
});

test('admin deletion erases private content and preserves reply chains and tombstones across restarts', async () => {
  await withServer(async ({ baseUrl, commentsPath, clock, restart }) => {
    const parent = await publicMessage(await create(baseUrl, 'Текст для удаления'), 201);
    clock.advance();
    const child = await publicMessage(await create(baseUrl, 'Сохранённый ответ', token(2), { replyTo: parent.id }), 201);
    const deleted = await publicMessage(await admin(baseUrl, { action: 'admin-delete', key: 'T00014', id: parent.id }), 200);
    assert.equal(deleted.id, parent.id);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.name, '');
    assert.equal(deleted.text, '');
    assert.equal(deleted.createdAt, parent.createdAt);
    assert.equal(deleted.updatedAt, clock.value);
    const stored = JSON.parse(readFileSync(commentsPath, 'utf8')).messages.find((message) => message.id === parent.id);
    for (const field of ['name', 'text', 'authorHash']) assert.equal(Object.hasOwn(stored, field), false, field);
    assert.equal(readFileSync(commentsPath, 'utf8').includes(parent.text), false);
    assert.equal(readFileSync(commentsPath, 'utf8').includes(parent.name), true);
    const replyPreview = { id: parent.id, name: '', text: 'Сообщение удалено владельцем' };
    const chat = await list(baseUrl);
    assert.deepEqual(chat.messages.find((message) => message.id === child.id).replyPreview, replyPreview);
    assert.deepEqual((await list(baseUrl, 'T00014', { id: parent.id })).messages, [deleted]);
    clock.advance();
    await rejected(await create(baseUrl, 'Новый ответ удалённому сообщению', token(3), { replyTo: parent.id }));
    assert.equal((await edit(baseUrl, parent, 'Попытка восстановить удалённое сообщение')).status, 410);
    await rejected(await admin(baseUrl, { action: 'admin-delete', key: 'T00016', id: child.id }), 'not_found');
    const restartedUrl = await restart();
    const reloaded = await list(restartedUrl);
    assert.equal(reloaded.messages.length, 2);
    assert.deepEqual(reloaded.messages.find((message) => message.id === parent.id), deleted);
    assert.deepEqual(reloaded.messages.find((message) => message.id === child.id).replyPreview, replyPreview);
    const newMessage = await publicMessage(await create(restartedUrl, 'Новое сообщение после удаления прежнего'), 201);
    assert.equal(newMessage.name, parent.name);
  }, { adminPasswordHash });
});

test('administrative mutations have an independent twenty-per-address limit without a ten second interval', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    for (let index = 0; index < 20; index++) {
      const response = await admin(baseUrl, { action: 'admin-lock', key: '*', closed: true }, { adminToken: token(998) });
      assert.equal(response.status, 401);
    }
    await rejected(await admin(baseUrl, { action: 'admin-lock', key: '*', closed: true }), 'rate_limited');
    await publicMessage(await create(baseUrl, 'Пользовательский лимит независим'), 201);
    const fromAnotherIp = await admin(baseUrl, { action: 'admin-status', key: '*' }, { ip: '203.0.113.11' });
    assert.equal(fromAnotherIp.status, 200);
    assert.equal((await admin(baseUrl, { action: 'admin-status', key: '*' }, { ip: '203.0.113.11' })).status, 200);
    clock.advance(600000);
    await adminStatus(baseUrl);
    for (let index = 0; index < 20; index++) await rejected(await post(baseUrl, '{invalid-json'));
    await adminStatus(baseUrl);
  }, { adminPasswordHash });
});

test('legacy version one comments load with open chats and editable active messages', async () => {
  await withServer(async ({ commentsPath, clock, restart }) => {
    const legacy = {
      id: 'a'.repeat(32), key: 'T00014', name: 'Старое имя', text: 'Старая запись',
      authorHash: createHash('sha256').update(token(1)).digest('hex'),
      createdAt: clock.value, updatedAt: clock.value, replyTo: null,
    };
    writeFileSync(commentsPath, JSON.stringify({ version: 1, messages: [legacy] }));
    const restartedUrl = await restart();
    const chat = await list(restartedUrl);
    assert.equal(chat.closed, false);
    assert.equal(chat.messages[0].deleted, false);
    assert.equal(chat.messages[0].text, legacy.text);
    assert.match(chat.messages[0].name, /^user[A-Za-z0-9]{3,16}$/);
    assert.equal(JSON.parse(readFileSync(commentsPath, 'utf8')).messages[0].name, legacy.name);
    assert.equal((await adminStatus(restartedUrl)).globalClosed, false);
    assert.deepEqual((await adminStatus(restartedUrl)).closedKeys, []);
    clock.advance();
    const updated = await publicMessage(await edit(restartedUrl, chat.messages[0], 'Правка старого формата'), 200);
    assert.equal(updated.name, chat.messages[0].name);
    const migrated = JSON.parse(readFileSync(commentsPath, 'utf8'));
    assert.equal(migrated.version, 3);
    assert.deepEqual(migrated.inboxRead, {});
    assert.equal(migrated.users[legacy.authorHash], updated.name);
    assert.equal(Object.hasOwn(migrated.messages[0], 'name'), false);
    assert.equal((await admin(restartedUrl, { action: 'admin-lock', key: 'T00014', closed: true })).status, 200);
    assert.equal((await list(restartedUrl)).closed, true);
  }, { adminPasswordHash });
});

test('failed comment storage is closed without crashing or changing the vote store', async () => {
  await withServer(async ({ baseUrl, commentsPath, storagePath, clock }) => {
    assert.equal((await vote(baseUrl)).status, 200);
    const originalVotes = readFileSync(storagePath);
    await publicMessage(await create(baseUrl, 'Сохранённая запись'), 201);
    rmSync(commentsPath);
    mkdirSync(commentsPath);
    clock.advance();

    const failedWrite = await create(baseUrl, 'Запись без сохранения', token(2));
    assert.equal(failedWrite.status, 503);
    assert.equal((await failedWrite.json()).error, 'storage_unavailable');
    assert.equal((await fetch(`${baseUrl}${endpoint}?key=T00014`)).status, 503);
    assert.deepEqual(readFileSync(storagePath), originalVotes);
    assert.equal((await fetch(`${baseUrl}/glossaliae/reactions`)).status, 200);

    rmSync(commentsPath, { recursive: true });
    assert.equal((await fetch(`${baseUrl}${endpoint}?key=T00014`)).status, 503);
  });

  await withServer(async ({ commentsPath, restart }) => {
    writeFileSync(commentsPath, '{invalid-storage');
    const restartedUrl = await restart();
    assert.equal((await fetch(`${restartedUrl}${endpoint}?key=T00014`)).status, 503);
    assert.equal((await fetch(`${restartedUrl}/glossaliae/reactions`)).status, 200);
  });
});

test('version two requires valid unique profiles for every active message and bounds their number', async () => {
  const firstHash = createHash('sha256').update(token(1)).digest('hex');
  const secondHash = createHash('sha256').update(token(2)).digest('hex');
  const message = { id: 'a'.repeat(32), key: 'T00014', text: 'Проверяемая запись', authorHash: firstHash,
    createdAt: 1000000, updatedAt: 1000000, replyTo: null, deleted: false };
  const excessive = Object.fromEntries(Array.from({ length: 10001 }, (_, index) =>
    [token(index + 1), `userprofile${index.toString().padStart(5, '0')}`]));
  const invalidProfiles = [{}, { [firstHash]: 'not-a-user' }, { [firstHash]: 'userABC' },
    { [firstHash]: 'userExample123', [secondHash]: 'userExample123' }, excessive];
  for (const users of invalidProfiles) {
    await withServer(async ({ commentsPath, restart }) => {
      writeFileSync(commentsPath, JSON.stringify({ version: 2, users, messages: [message], globalClosed: false, closedKeys: [] }));
      const restartedUrl = await restart();
      assert.equal((await fetch(`${restartedUrl}${endpoint}?key=T00014`)).status, 503);
      assert.equal((await fetch(`${restartedUrl}/glossaliae/reactions`)).status, 200);
    });
  }
});

test('an oversized comment store fails before parsing and leaves voting available', async () => {
  await withServer(async ({ commentsPath, restart }) => {
    writeFileSync(commentsPath, ' '.repeat(8 * 1024 * 1024 + 1));
    const restartedUrl = await restart();
    assert.equal((await fetch(`${restartedUrl}${endpoint}?key=T00014`)).status, 503);
    assert.equal((await fetch(`${restartedUrl}/glossaliae/reactions`)).status, 200);
  });
});

test('sentinel messages have persistent cross-chat read state and an edit makes the viewed version stale', async () => {
  await withServer(async ({ baseUrl, clock, commentsPath, restart }) => {
    const ordinary = await publicMessage(await create(baseUrl, 'Обычная запись'), 201);
    clock.advance();
    const first = await publicMessage(await create(baseUrl, 'Обращение в первом чате', token(2), { replyTo: 'user_001' }), 201);
    clock.advance();
    const second = await publicMessage(await create(baseUrl, 'Обращение в другом чате', token(3),
      { key: 'T00016', replyTo: 'user_001' }), 201);
    clock.advance();
    await publicMessage(await create(baseUrl, 'Ответ обычному посетителю', token(4), { replyTo: ordinary.id }), 201);
    assert.equal(first.replyTo, 'user_001');
    assert.equal(first.replyPreview, null);
    const initial = await inbox(baseUrl);
    assert.deepEqual(initial.messages.map((message) => [message.id, message.key, message.read]),
      [[first.id, 'T00014', false], [second.id, 'T00016', false]]);
    assert.equal(initial.unreadCount, 2);
    assert.equal((await adminStatus(baseUrl)).unreadCount, 2);
    await rejected(await markRead(baseUrl, ordinary), 'not_found');
    await rejected(await markRead(baseUrl, first, { key: 'T00016' }), 'not_found');
    await rejected(await admin(baseUrl, { action: 'admin-read', key: 'T00014', id: first.id }), 'invalid_request');
    const read = await markRead(baseUrl, first);
    assert.equal(read.status, 200);
    assert.deepEqual(Object.keys(await read.clone().json()).sort(), ['limits', 'serverTime', 'unreadCount']);
    assert.equal((await read.json()).unreadCount, 1);
    assert.equal(JSON.parse(readFileSync(commentsPath, 'utf8')).inboxRead[first.id], first.updatedAt);

    const restartedUrl = await restart();
    assert.deepEqual((await inbox(restartedUrl)).messages.map((message) => message.read), [true, false]);
    clock.advance();
    const edited = await publicMessage(await edit(restartedUrl, first, 'Уточнённое обращение', token(2)), 200);
    const stale = await markRead(restartedUrl, first);
    assert.equal(stale.status, 409);
    await rejected(stale, 'stale_message');
    assert.equal((await inbox(restartedUrl)).unreadCount, 2);
    assert.equal((await markRead(restartedUrl, edited)).status, 200);
    const deleted = await admin(restartedUrl, { action: 'admin-delete', key: 'T00016', id: second.id });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).unreadCount, 0);
    await rejected(await markRead(restartedUrl, second, { key: 'T00016' }), 'not_found');
    assert.deepEqual((await inbox(restartedUrl)).messages.map((message) => message.id), [first.id]);
    const stored = JSON.parse(readFileSync(commentsPath, 'utf8'));
    assert.equal(stored.version, 3);
    assert.equal(Object.hasOwn(stored.inboxRead, second.id), false);
  }, { adminPasswordHash });
});

test('owner replies require authentication, keep original chat and survive deletion without losing addressed replies', async () => {
  await withServer(async ({ baseUrl, clock, commentsPath, restart }) => {
    const first = await publicMessage(await create(baseUrl, 'Вопрос владельцу', token(1), { replyTo: 'user_001' }), 201);
    clock.advance();
    const ordinary = await publicMessage(await create(baseUrl, 'Обычный вопрос в другом чате', token(2), { key: 'T00016' }), 201);
    clock.advance();
    const replyBody = { action: 'admin-reply', key: 'T00014', id: first.id, text: 'Ответ владельца' };
    assert.equal((await admin(baseUrl, replyBody, { origin: allowedOrigin })).status, 403);
    assert.equal((await admin(baseUrl, replyBody, { adminToken: token(999) })).status, 401);
    await rejected(await admin(baseUrl, { ...replyBody, key: 'T00016' }), 'not_found');
    await rejected(await post(baseUrl, { action: 'create', key: 'T00014', text: 'Подмена автора', authorToken: token(3),
      replyTo: null, owner: true }, { ip: '203.0.113.20' }), 'invalid_request');
    await rejected(await create(baseUrl, 'Неверный резервный адресат', token(4), { replyTo: 'user_100', ip: '203.0.113.21' }), 'invalid_request');
    const locked = await admin(baseUrl, { action: 'admin-lock', key: '*', closed: true });
    assert.equal(locked.status, 200);
    assert.equal((await locked.json()).unreadCount, 1);
    const response = await admin(baseUrl, replyBody);
    assert.equal((await response.clone().json()).unreadCount, 1);
    const owner = await publicMessage(response, 201);
    assert.equal(owner.name, 'user_001');
    assert.equal(owner.replyTo, first.id);
    assert.equal(owner.replyPreview.name, first.name);
    assert.equal((await inbox(baseUrl)).messages[0].read, false);
    const another = await publicMessage(await admin(baseUrl, { action: 'admin-reply', key: 'T00016', id: ordinary.id,
      text: 'Ответ на обычную запись' }), 201);
    assert.equal(another.name, 'user_001');
    assert.deepEqual((await list(baseUrl, 'T00016')).messages.map((message) => message.id), [ordinary.id, another.id]);
    clock.advance();
    await rejected(await edit(baseUrl, owner, 'Правка посетителем', token(5), { ip: '203.0.113.22' }), 'not_author');
    await rejected(await admin(baseUrl, { ...replyBody, id: owner.id, text: 'Ответ самому владельцу' }), 'reply_not_found');
    await rejected(await markRead(baseUrl, owner), 'not_found');
    assert.equal((await admin(baseUrl, { action: 'admin-lock', key: '*', closed: false })).status, 200);
    clock.advance();
    const followup = await publicMessage(await create(baseUrl, 'Уточнение посетителя', token(6), { replyTo: owner.id }), 201);
    assert.equal(followup.replyPreview.name, 'user_001');
    assert.equal((await inbox(baseUrl)).unreadCount, 2);
    const deleted = await admin(baseUrl, { action: 'admin-delete', key: 'T00014', id: owner.id });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).unreadCount, 2);
    const stored = JSON.parse(readFileSync(commentsPath, 'utf8'));
    const tombstone = stored.messages.find((message) => message.id === owner.id);
    assert.equal(tombstone.owner, true);
    for (const field of ['text', 'name', 'authorHash']) assert.equal(Object.hasOwn(tombstone, field), false);
    for (const message of stored.messages.filter((message) => message.owner)) assert.equal(Object.hasOwn(message, 'authorHash'), false);
    const restartedUrl = await restart();
    assert.deepEqual((await inbox(restartedUrl)).messages.map((message) => message.id), [first.id, followup.id]);
    assert.equal((await inbox(restartedUrl)).unreadCount, 2);
    assert.equal((await list(restartedUrl)).messages.find((message) => message.id === followup.id).replyPreview.text,
      'Сообщение удалено владельцем');
    assert.equal((await markRead(restartedUrl, followup)).status, 200);
  }, { adminPasswordHash });
});

test('owner replies enforce Unicode length, profanity and duplicate checks across chats', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const first = await publicMessage(await create(baseUrl, 'Первый вопрос', token(1), { replyTo: 'user_001' }), 201);
    clock.advance();
    const second = await publicMessage(await create(baseUrl, 'Второй вопрос', token(2), { key: 'T00016', replyTo: 'user_001' }), 201);
    const reply = (text, key = 'T00014', id = first.id) => admin(baseUrl, { action: 'admin-reply', key, id, text });
    await rejected(await reply(''), 'invalid_text');
    await rejected(await reply('😀'.repeat(2001)), 'invalid_text');
    await rejected(await reply('сука'), 'profanity');
    await rejected(await reply(first.text), 'duplicate');
    const maximum = await publicMessage(await reply('😀'.repeat(2000)), 201);
    assert.equal(Array.from(maximum.text).length, 2000);
    await rejected(await reply(maximum.text), 'duplicate');
    await rejected(await reply(maximum.text, 'T00016', second.id), 'duplicate');
    const permitted = await publicMessage(await reply('Сукка — допустимое слово'), 201);
    assert.equal(permitted.name, 'user_001');
  }, { adminPasswordHash });
});

test('inbox pages contain the newest fifty in ascending order and read polling leaves moderation available', async () => {
  await withServer(async ({ baseUrl, clock }) => {
    const messages = [];
    for (let index = 0; index < 56; index++) {
      messages.push(await publicMessage(await create(baseUrl, `Обращение ${index}`, token(index + 1),
        { key: index % 2 ? 'T00016' : 'T00014', replyTo: 'user_001', ip: `203.0.113.${index + 1}` }), 201));
      clock.advance();
    }
    const latest = await inbox(baseUrl);
    assert.deepEqual(latest.messages.map((message) => message.id), messages.slice(6).map((message) => message.id));
    assert.equal(latest.nextBefore, messages[6].id);
    assert.equal(latest.unreadCount, 56);
    const older = await inbox(baseUrl, { before: latest.nextBefore });
    assert.deepEqual(older.messages.map((message) => message.id), messages.slice(0, 6).map((message) => message.id));
    assert.equal(older.nextBefore, null);
    assert.equal((await admin(baseUrl, { action: 'admin-delete', key: 'T00014', id: latest.nextBefore })).status, 200);
    const afterDelete = await inbox(baseUrl, { before: latest.nextBefore });
    assert.deepEqual(afterDelete.messages.map((message) => message.id), messages.slice(0, 6).map((message) => message.id));
    assert.equal(afterDelete.unreadCount, 55);
    await rejected(await admin(baseUrl, { action: 'admin-inbox', key: '*', before: 'f'.repeat(32) }), 'not_found');
    await rejected(await admin(baseUrl, { action: 'admin-inbox', key: '*', before: null }), 'invalid_request');
    await rejected(await admin(baseUrl, { action: 'admin-inbox', key: 'T00014' }), 'invalid_request');
  }, { adminPasswordHash });

  await withServer(async ({ baseUrl, clock }) => {
    for (let index = 0; index < 100; index++) await adminStatus(baseUrl);
    await rejected(await admin(baseUrl, { action: 'admin-inbox', key: '*' }), 'rate_limited');
    for (let index = 0; index < 20; index++) {
      assert.equal((await admin(baseUrl, { action: 'admin-lock', key: '*', closed: false })).status, 200);
    }
    await rejected(await admin(baseUrl, { action: 'admin-lock', key: '*', closed: false }), 'rate_limited');
    assert.equal((await vote(baseUrl)).status, 200);
    clock.advance(600000);
    await adminStatus(baseUrl);
  }, { adminPasswordHash });
});

test('version two migrates only on a write while preserving visitor profiles and messages', async () => {
  await withServer(async ({ commentsPath, clock, restart }) => {
    const authorHash = createHash('sha256').update(token(1)).digest('hex');
    const legacy = { version: 2, users: { [authorHash]: 'userVisitor123' }, globalClosed: false, closedKeys: [],
      messages: [{ id: 'a'.repeat(32), key: 'T00014', text: 'Сохранённая запись версии 2', authorHash,
        createdAt: clock.value, updatedAt: clock.value, replyTo: null, deleted: false }] };
    writeFileSync(commentsPath, JSON.stringify(legacy));
    const bytes = readFileSync(commentsPath);
    const restartedUrl = await restart();
    assert.equal((await list(restartedUrl)).messages[0].name, 'userVisitor123');
    assert.equal((await inbox(restartedUrl)).unreadCount, 0);
    assert.deepEqual(readFileSync(commentsPath), bytes);
    assert.equal((await admin(restartedUrl, { action: 'admin-lock', key: 'T00016', closed: true })).status, 200);
    const migrated = JSON.parse(readFileSync(commentsPath, 'utf8'));
    assert.equal(migrated.version, 3);
    assert.deepEqual(migrated.users, legacy.users);
    assert.deepEqual(migrated.messages, legacy.messages);
    assert.deepEqual(migrated.inboxRead, {});
    clock.advance();
    const incoming = await publicMessage(await create(restartedUrl, 'Обращение прежнего пользователя', token(1), { replyTo: 'user_001' }), 201);
    assert.equal(incoming.name, 'userVisitor123');
    const latestUrl = await restart();
    assert.equal((await inbox(latestUrl)).messages[0].id, incoming.id);
  }, { adminPasswordHash });
});

test('reserved owner usernames cannot be loaded as visitor profiles in old or new storage', async () => {
  for (const version of [2, 3]) {
    for (const username of ['user_001', 'user_050', 'user_100']) {
      await withServer(async ({ commentsPath, restart }) => {
        const authorHash = createHash('sha256').update(token(1)).digest('hex');
        writeFileSync(commentsPath, JSON.stringify({ version, users: { [authorHash]: username }, messages: [],
          globalClosed: false, closedKeys: [], ...(version === 3 ? { inboxRead: {} } : {}) }));
        const restartedUrl = await restart();
        assert.equal((await fetch(`${restartedUrl}${endpoint}?key=T00014`)).status, 503);
        assert.equal((await fetch(`${restartedUrl}/glossaliae/reactions`)).status, 200);
      });
    }
  }
});

test('retired chats leave the inbox and preserve read state until their key is restored', async () => {
  await withServer(async ({ storagePath, commentsPath, clock, restart }) => {
    const authorHash = createHash('sha256').update(token(1)).digest('hex');
    const make = (id, key) => ({ id, key, text: `Обращение ${key}`, authorHash, createdAt: clock.value,
      updatedAt: clock.value, replyTo: 'user_001', deleted: false });
    const retired = make('a'.repeat(32), 'T00017');
    const active = make('b'.repeat(32), 'T00014');
    writeFileSync(commentsPath, JSON.stringify({ version: 3, users: { [authorHash]: 'userVisitor123' },
      messages: [retired, active], globalClosed: false, closedKeys: [], inboxRead: { [retired.id]: retired.updatedAt } }));
    const restartedUrl = await restart();
    const queue = await inbox(restartedUrl);
    assert.deepEqual(queue.messages.map((message) => message.id), [active.id]);
    assert.equal(queue.unreadCount, 1);
    assert.equal((await markRead(restartedUrl, active)).status, 200);
    assert.equal(JSON.parse(readFileSync(commentsPath, 'utf8')).inboxRead[retired.id], retired.updatedAt);
    const restored = createReactionServer({ storagePath, allowedOrigin,
      allowedKeys: [...allowedKeys, 'T00017'], adminPasswordHash, now: () => clock.value });
    restored.listen(0, '127.0.0.1');
    await once(restored, 'listening');
    const restoredUrl = `http://127.0.0.1:${restored.address().port}`;
    try {
      await login(restoredUrl);
      assert.deepEqual((await inbox(restoredUrl)).messages.map((message) => [message.id, message.read]),
        [[retired.id, true], [active.id, true]]);
    } finally {
      restored.close();
      await once(restored, 'close');
      adminSessions.delete(restoredUrl);
    }
  }, { adminPasswordHash });
});

test('version three rejects impersonated owner metadata, invalid reply links and forged read state', async () => {
  const authorHash = createHash('sha256').update(token(1)).digest('hex');
  const visitor = (id, replyTo, timestamp) => ({ id, key: 'T00014', text: `Текст ${id.slice(0, 1)}`, authorHash,
    createdAt: timestamp, updatedAt: timestamp, replyTo, deleted: false });
  const base = { version: 3, users: { [authorHash]: 'userVisitor123' }, globalClosed: false, closedKeys: [],
    messages: [visitor('a'.repeat(32), 'user_001', 1000000),
      { id: 'b'.repeat(32), key: 'T00014', text: 'Ответ владельца', owner: true, createdAt: 1000001,
        updatedAt: 1000001, replyTo: 'a'.repeat(32), deleted: false },
      visitor('c'.repeat(32), 'b'.repeat(32), 1000002), visitor('d'.repeat(32), null, 1000003)],
    inboxRead: { ['a'.repeat(32)]: 1000000, ['c'.repeat(32)]: 1000002 } };
  const mutations = [
    (stored) => { stored.messages[0].owner = true; },
    (stored) => { stored.messages[1].authorHash = authorHash; },
    (stored) => { stored.messages[1].owner = false; },
    (stored) => { stored.messages[1].replyTo = null; },
    (stored) => { stored.messages[1].replyTo = 'user_001'; },
    (stored) => { stored.messages[1].replyTo = stored.messages[1].id; },
    (stored) => { stored.messages[2].key = 'T00016'; },
    (stored) => { stored.messages[0].deleted = true; },
    (stored) => { delete stored.inboxRead; },
    (stored) => { stored.inboxRead[stored.messages[1].id] = stored.messages[1].updatedAt; },
    (stored) => { stored.inboxRead[stored.messages[3].id] = stored.messages[3].updatedAt; },
    (stored) => { stored.inboxRead['f'.repeat(32)] = 1000000; },
    (stored) => { stored.inboxRead[stored.messages[0].id] = 1000001; },
    (stored) => { stored.inboxRead[stored.messages[0].id] = '1000000'; },
  ];
  for (const mutate of mutations) {
    await withServer(async ({ commentsPath, restart }) => {
      const stored = structuredClone(base);
      mutate(stored);
      writeFileSync(commentsPath, JSON.stringify(stored));
      const restartedUrl = await restart();
      assert.equal((await fetch(`${restartedUrl}${endpoint}?key=T00014`)).status, 503);
      assert.equal((await fetch(`${restartedUrl}/glossaliae/reactions`)).status, 200);
      assert.deepEqual(JSON.parse(readFileSync(commentsPath, 'utf8')), stored);
    });
  }
});
