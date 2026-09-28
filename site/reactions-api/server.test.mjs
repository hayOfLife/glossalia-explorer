import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { createReactionServer } from './server.mjs';

const allowedOrigin = 'https://glossalia-explorer.tuqo.ru';

async function withServer(callback, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'glossaliae-reactions-'));
  const storagePath = join(directory, 'reactions.json');
  const server = createReactionServer({ storagePath, allowedOrigin, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    await callback(`http://127.0.0.1:${server.address().port}`, storagePath);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(directory, { recursive: true, force: true });
  }
}

function vote(baseUrl, voterId, value, key = 'T00014', origin = allowedOrigin, clientIp = '203.0.113.10') {
  return fetch(`${baseUrl}/glossaliae/reactions`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'text/plain;charset=UTF-8', 'X-Glossaliae-Client-IP': clientIp },
    body: JSON.stringify({ key, vote: value, voterId }),
  });
}

test('counts persist and one browser can replace or remove its vote', async () => {
  await withServer(async (baseUrl, storagePath) => {
    const voterId = 'a'.repeat(32);
    assert.equal((await vote(baseUrl, voterId, 1)).status, 200);
    assert.deepEqual(await (await vote(baseUrl, voterId, -1)).json(), { likes: 0, dislikes: 1 });

    const stored = JSON.parse(readFileSync(storagePath, 'utf8'));
    assert.equal(JSON.stringify(stored).includes(voterId), false);

    const counts = await (await fetch(`${baseUrl}/glossaliae/reactions`, { headers: { Origin: allowedOrigin } })).json();
    assert.deepEqual(counts.T00014, { likes: 0, dislikes: 1 });
    assert.deepEqual(counts.T00016, { likes: 0, dislikes: 0 });

    assert.deepEqual(await (await vote(baseUrl, voterId, 0)).json(), { likes: 0, dislikes: 0 });
    const reloaded = createReactionServer({ storagePath, allowedOrigin });
    reloaded.listen(0, '127.0.0.1');
    await once(reloaded, 'listening');
    const reloadedCounts = await (await fetch(`http://127.0.0.1:${reloaded.address().port}/glossaliae/reactions`)).json();
    assert.deepEqual(reloadedCounts.T00014, { likes: 0, dislikes: 0 });
    reloaded.close();
    await once(reloaded, 'close');
  });
});

test('invalid and cross-origin requests do not change votes', async () => {
  await withServer(async (baseUrl) => {
    const voterId = 'b'.repeat(32);
    assert.equal((await vote(baseUrl, voterId, 1, 'T00014', 'https://other.example')).status, 403);
    assert.equal((await vote(baseUrl, voterId, 1, 'UNKNOWN')).status, 400);

    const extraField = await fetch(`${baseUrl}/glossaliae/reactions`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'text/plain', 'X-Glossaliae-Client-IP': '203.0.113.10' },
      body: JSON.stringify({ key: 'T00014', vote: 1, voterId, extra: true }),
    });
    assert.equal(extraField.status, 400);

    const oversized = await fetch(`${baseUrl}/glossaliae/reactions`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'text/plain', 'X-Glossaliae-Client-IP': '203.0.113.10' },
      body: 'x'.repeat(300),
    });
    assert.equal(oversized.status, 413);

    const missingTrustedIp = await fetch(`${baseUrl}/glossaliae/reactions`, {
      method: 'POST',
      headers: { Origin: allowedOrigin, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ key: 'T00014', vote: 1, voterId }),
    });
    assert.equal(missingTrustedIp.status, 403);

    const counts = await (await fetch(`${baseUrl}/glossaliae/reactions`)).json();
    assert.deepEqual(counts.T00014, { likes: 0, dislikes: 0 });
  });
});

test('a browser identifier is limited to 12 changes in ten minutes', async () => {
  let currentTime = 1000000;
  await withServer(async (baseUrl) => {
    const voterId = 'c'.repeat(32);
    for (let index = 0; index < 12; index++) {
      assert.equal((await vote(baseUrl, voterId, index % 2 === 0 ? 1 : -1)).status, 200);
    }
    assert.equal((await vote(baseUrl, voterId, 1)).status, 429);
    currentTime += 10 * 60 * 1000;
    assert.equal((await vote(baseUrl, voterId, 1)).status, 200);
  }, { now: () => currentTime });
});

test('one client address is limited to 40 changes in ten minutes', async () => {
  await withServer(async (baseUrl) => {
    for (let index = 0; index < 40; index++) {
      const voterId = index.toString(16).padStart(32, '0');
      assert.equal((await vote(baseUrl, voterId, 1)).status, 200);
    }
    assert.equal((await vote(baseUrl, 'd'.repeat(32), 1)).status, 429);
    assert.equal((await vote(baseUrl, 'd'.repeat(32), 1, 'T00014', allowedOrigin, '203.0.113.11')).status, 200);
  });
});

test('simultaneous votes are counted without lost writes', async () => {
  await withServer(async (baseUrl) => {
    const responses = await Promise.all(Array.from({ length: 40 }, (_, index) =>
      vote(baseUrl, index.toString(16).padStart(32, '0'), index % 2 === 0 ? 1 : -1)));
    assert.equal(responses.every((response) => response.status === 200), true);

    const counts = await (await fetch(`${baseUrl}/glossaliae/reactions`)).json();
    assert.deepEqual(counts.T00014, { likes: 20, dislikes: 20 });
  });
});
