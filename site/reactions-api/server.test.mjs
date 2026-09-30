import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { createReactionServer } from './server.mjs';

const allowedOrigin = 'https://glossalia-explorer.tuqo.ru';
const localOrigin = 'http://localhost:8877';
const localEndpoint = '/glossaliae/reactions-local';
const legacyKeys = ['T00014', 'T00016', 'T00017', 'T00018', 'T00019', 'T00020'];

async function withServer(callback, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'glossaliae-reactions-'));
  const storagePath = join(directory, 'reactions.json');
  const server = createReactionServer({ storagePath, allowedOrigin, allowedKeys: legacyKeys, ...options });
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

async function withRestartedServer(storagePath, allowedKeys, callback, options = {}) {
  const server = createReactionServer({ storagePath, allowedOrigin, allowedKeys, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function vote(baseUrl, voterId, value, key = 'T00014', origin = allowedOrigin, clientIp = '203.0.113.10', endpoint = '/glossaliae/reactions') {
  return fetch(`${baseUrl}${endpoint}`, {
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
    const reloaded = createReactionServer({ storagePath, allowedOrigin, allowedKeys: legacyKeys });
    reloaded.listen(0, '127.0.0.1');
    await once(reloaded, 'listening');
    const reloadedCounts = await (await fetch(`http://127.0.0.1:${reloaded.address().port}/glossaliae/reactions`)).json();
    assert.deepEqual(reloadedCounts.T00014, { likes: 0, dislikes: 0 });
    reloaded.close();
    await once(reloaded, 'close');
  });
});

test('local mode permits canonical loopback origins and reflects their exact CORS origin', async () => {
  await withServer(async (baseUrl) => {
    const origins = ['http://localhost', 'https://localhost:65535', 'http://127.0.0.1:1',
      'https://127.0.0.1:8443', 'http://[::1]', 'https://[::1]:9443'];
    for (const [index, origin] of origins.entries()) {
      const response = await vote(baseUrl, '6'.repeat(32), index % 2 ? -1 : 1, 'T00014', origin, '203.0.113.10', localEndpoint);
      assert.equal(response.status, 200, origin);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);

      const get = await fetch(`${baseUrl}${localEndpoint}`, { headers: { Origin: origin } });
      assert.equal(get.status, 200);
      assert.equal(get.headers.get('access-control-allow-origin'), origin);
    }
  }, { environment: 'local', allowedOrigin: undefined });
});

test('local mode rejects near loopback hosts and noncanonical origins without CORS', async () => {
  await withServer(async (baseUrl) => {
    const origins = ['null', '', allowedOrigin, 'http://localhost.evil.example:8877', 'http://evil.localhost:8877',
      'http://127.0.0.2:8877', 'http://127.1:8877', 'http://2130706433:8877', 'http://127.0.0.1.evil.example',
      'http://[::ffff:127.0.0.1]:8877', 'http://localhost.:8877', 'ftp://localhost:8877', 'http://localhost:0',
      'http://localhost:65536', 'http://user@localhost:8877', 'http://localhost:8877/',
      'http://localhost:8877/path', 'http://localhost:8877?query=1', 'http://localhost:8877#fragment'];
    for (const origin of origins) {
      const response = await vote(baseUrl, '7'.repeat(32), 1, 'T00014', origin, '203.0.113.10', localEndpoint);
      assert.equal(response.status, 403, origin);
      assert.equal(response.headers.get('access-control-allow-origin'), null);

      const get = await fetch(`${baseUrl}${localEndpoint}`, { headers: { Origin: origin } });
      assert.equal(get.status, 200);
      assert.equal(get.headers.get('access-control-allow-origin'), null);
      assert.deepEqual((await get.json()).T00014, { likes: 0, dislikes: 0 });
    }
  }, { environment: 'local', allowedOrigin: undefined });
});

test('production and local routes and POST origins remain separate', async () => {
  await withServer(async (productionUrl) => {
    await withServer(async (localUrl) => {
      assert.equal((await fetch(`${productionUrl}${localEndpoint}`)).status, 404);
      assert.equal((await fetch(`${localUrl}/glossaliae/reactions`)).status, 404);

      const productionResponse = await vote(productionUrl, '8'.repeat(32), 1, 'T00014', localOrigin);
      assert.equal(productionResponse.status, 403);
      assert.equal(productionResponse.headers.get('access-control-allow-origin'), null);

      const localResponse = await vote(localUrl, '8'.repeat(32), 1, 'T00014', allowedOrigin, '203.0.113.10', localEndpoint);
      assert.equal(localResponse.status, 403);
      assert.equal(localResponse.headers.get('access-control-allow-origin'), null);
    }, { environment: 'local', allowedOrigin: undefined });
  });
});

test('mode validation keeps the exact production origin and allows local mode without it', async () => {
  await withServer(async (_baseUrl, storagePath) => {
    assert.throws(() => createReactionServer({ storagePath, allowedOrigin, environment: 'unknown' }), /Invalid reaction environment/);
    for (const origin of [undefined, '', localOrigin, 'https://glossalia-explorer.tuqo.ru/', 'https://other.example']) {
      assert.throws(() => createReactionServer({ storagePath, allowedOrigin: origin }), /production origin are required/);
    }
  });
});

test('independent environments preserve different votes and separate browser limits across restarts', async () => {
  await withServer(async (productionUrl, productionStoragePath) => {
    await withServer(async (localUrl, localStoragePath) => {
      const voterId = '9'.repeat(32);
      assert.notEqual(localStoragePath, productionStoragePath);
      assert.equal((await vote(productionUrl, voterId, 1)).status, 200);
      assert.equal((await vote(localUrl, voterId, -1, 'T00014', localOrigin, '203.0.113.10', localEndpoint)).status, 200);
      const productionCounts = await (await fetch(`${productionUrl}/glossaliae/reactions`)).json();
      const localCounts = await (await fetch(`${localUrl}${localEndpoint}`)).json();
      assert.deepEqual(productionCounts.T00014, { likes: 1, dislikes: 0 });
      assert.deepEqual(localCounts.T00014, { likes: 0, dislikes: 1 });

      for (let index = 0; index < 11; index++) {
        assert.equal((await vote(productionUrl, voterId, index % 2 ? 1 : -1)).status, 200);
      }
      assert.equal((await vote(productionUrl, voterId, 1)).status, 429);
      assert.equal((await vote(localUrl, voterId, 1, 'T00014', localOrigin, '203.0.113.10', localEndpoint)).status, 200);

      for (let index = 0; index < 10; index++) {
        assert.equal((await vote(localUrl, voterId, index % 2 ? 1 : -1, 'T00014', localOrigin, '203.0.113.10', localEndpoint)).status, 200);
      }
      assert.equal((await vote(localUrl, voterId, -1, 'T00014', localOrigin, '203.0.113.10', localEndpoint)).status, 429);

      await withRestartedServer(productionStoragePath, legacyKeys, async (restartedUrl) => {
        const counts = await (await fetch(`${restartedUrl}/glossaliae/reactions`)).json();
        assert.deepEqual(counts.T00014, { likes: 0, dislikes: 1 });
      });
      await withRestartedServer(localStoragePath, legacyKeys, async (restartedUrl) => {
        const counts = await (await fetch(`${restartedUrl}${localEndpoint}`)).json();
        assert.deepEqual(counts.T00014, { likes: 1, dislikes: 0 });
      }, { environment: 'local', allowedOrigin: undefined });
    }, { environment: 'local', allowedOrigin: undefined });
  });
});

test('exhausting the production IP limit leaves the local IP limit independent', async () => {
  await withServer(async (productionUrl) => {
    await withServer(async (localUrl) => {
      for (let index = 0; index < 40; index++) {
        const voterId = index.toString(16).padStart(32, '0');
        assert.equal((await vote(productionUrl, voterId, 1)).status, 200);
      }
      assert.equal((await vote(productionUrl, 'a'.repeat(32), 1)).status, 429);
      for (let index = 0; index < 40; index++) {
        const voterId = index.toString(16).padStart(32, '0');
        assert.equal((await vote(localUrl, voterId, -1, 'T00014', localOrigin, '203.0.113.10', localEndpoint)).status, 200);
      }
      assert.equal((await vote(localUrl, 'a'.repeat(32), 1, 'T00014', localOrigin, '203.0.113.10', localEndpoint)).status, 429);
    }, { environment: 'local', allowedOrigin: undefined });
  });
});

test('published parts accept votes while unpublished valid keys are rejected', async () => {
  const keys = [...legacyKeys, 'T00027-part_8', 'T00035-script12_analysis_full', 'T00035-2026-09-25-dialogue'];
  await withServer(async (baseUrl) => {
    const voterId = '1'.repeat(32);
    assert.equal((await vote(baseUrl, voterId, 1, 'T00027-part_8')).status, 200);
    assert.equal((await vote(baseUrl, voterId, -1, 'T00035-script12_analysis_full')).status, 200);
    assert.equal((await vote(baseUrl, voterId, 1, 'T00035-2026-09-25-dialogue')).status, 200);
    assert.equal((await vote(baseUrl, voterId, 1, 'T00027-part_99')).status, 400);

    const counts = await (await fetch(`${baseUrl}/glossaliae/reactions`)).json();
    assert.deepEqual(counts['T00027-part_8'], { likes: 1, dislikes: 0 });
    assert.deepEqual(counts['T00035-script12_analysis_full'], { likes: 0, dislikes: 1 });
    assert.equal(Object.hasOwn(counts, 'T00027-part_99'), false);
  }, { allowedKeys: keys });
});

test('legacy votes and separate part votes survive expanding the published list and restarting', async () => {
  await withServer(async (baseUrl, storagePath) => {
    const voterId = '2'.repeat(32);
    assert.equal((await vote(baseUrl, voterId, 1, 'T00014')).status, 200);
    assert.equal((await vote(baseUrl, voterId, -1, 'T00019')).status, 200);
    const keys = [...legacyKeys, 'T00027-part_8', 'T00027-part_7'];

    await withRestartedServer(storagePath, keys, async (restartedUrl) => {
      const counts = await (await fetch(`${restartedUrl}/glossaliae/reactions`)).json();
      assert.deepEqual(counts.T00014, { likes: 1, dislikes: 0 });
      assert.deepEqual(counts.T00019, { likes: 0, dislikes: 1 });
      assert.deepEqual(counts['T00027-part_8'], { likes: 0, dislikes: 0 });
      assert.equal((await vote(restartedUrl, voterId, 1, 'T00027-part_8')).status, 200);
      assert.equal((await vote(restartedUrl, voterId, -1, 'T00027-part_7')).status, 200);
    });

    await withRestartedServer(storagePath, keys, async (restartedUrl) => {
      const counts = await (await fetch(`${restartedUrl}/glossaliae/reactions`)).json();
      assert.deepEqual(counts.T00014, { likes: 1, dislikes: 0 });
      assert.deepEqual(counts.T00019, { likes: 0, dislikes: 1 });
      assert.deepEqual(counts['T00027-part_8'], { likes: 1, dislikes: 0 });
      assert.deepEqual(counts['T00027-part_7'], { likes: 0, dislikes: 1 });
    });
  });
});

test('unpublished collections remain in storage and return when published again', async () => {
  await withServer(async (baseUrl, storagePath) => {
    assert.equal((await vote(baseUrl, '3'.repeat(32), -1, 'T00019')).status, 200);
    const keys = legacyKeys.filter((key) => key !== 'T00019');

    await withRestartedServer(storagePath, keys, async (restartedUrl) => {
      const counts = await (await fetch(`${restartedUrl}/glossaliae/reactions`)).json();
      assert.equal(Object.hasOwn(counts, 'T00019'), false);
      assert.equal((await vote(restartedUrl, '3'.repeat(32), 1, 'T00019')).status, 400);
      assert.equal((await vote(restartedUrl, '4'.repeat(32), 1, 'T00014')).status, 200);
      assert.equal(Object.keys(JSON.parse(readFileSync(storagePath, 'utf8')).votes.T00019).length, 1);
    });

    await withRestartedServer(storagePath, legacyKeys, async (restartedUrl) => {
      const counts = await (await fetch(`${restartedUrl}/glossaliae/reactions`)).json();
      assert.deepEqual(counts.T00019, { likes: 0, dislikes: 1 });
      assert.deepEqual(counts.T00014, { likes: 1, dislikes: 0 });
    });
  });
});

test('default server uses the adjacent generated transcription manifest', async () => {
  const manifest = JSON.parse(readFileSync(new URL('./transcriptions.json', import.meta.url), 'utf8'));
  assert.equal(manifest.schema, 1);
  assert.ok(manifest.keys.length > legacyKeys.length);
  assert.ok(legacyKeys.every((key) => manifest.keys.includes(key)));

  await withServer(async (baseUrl) => {
    const counts = await (await fetch(`${baseUrl}/glossaliae/reactions`)).json();
    assert.deepEqual(Object.keys(counts), manifest.keys);
    const partKey = manifest.keys.find((key) => key.includes('-part_'));
    assert.ok(partKey);
    assert.equal((await vote(baseUrl, '5'.repeat(32), 1, partKey)).status, 200);
  }, { allowedKeys: undefined });
});

test('invalid publication lists and corrupt archived collections fail closed', async () => {
  await withServer(async (_baseUrl, storagePath) => {
    for (const allowedKeys of [[], ['T00014', 'T00014'], ['__proto__'], ['T00014/part_1'], [14], new Array(1), new Array(10001).fill('T00014')]) {
      assert.throws(() => createReactionServer({ storagePath, allowedOrigin, allowedKeys }), /Invalid reaction transcription manifest/);
    }

    writeFileSync(storagePath, JSON.stringify({ version: 1, votes: { T00019: { ['a'.repeat(64)]: 2 } } }));
    assert.throws(() => createReactionServer({ storagePath, allowedOrigin, allowedKeys: ['T00014'] }), /Invalid reaction storage/);
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

test('unreadable storage returns 503 without crashing or overwriting uncertain votes', async () => {
  await withServer(async (baseUrl, storagePath) => {
    assert.equal((await vote(baseUrl, 'e'.repeat(32), 1)).status, 200);
    rmSync(storagePath);
    mkdirSync(storagePath);

    assert.equal((await vote(baseUrl, 'f'.repeat(32), 1)).status, 503);
    assert.equal((await fetch(`${baseUrl}/glossaliae/reactions`)).status, 503);

    rmSync(storagePath, { recursive: true });
    assert.equal((await vote(baseUrl, 'f'.repeat(32), 1)).status, 503);
  });
});
