import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedKeys = ['T00014', 'T00016', 'T00017', 'T00018', 'T00019', 'T00020'];
const maxBodyBytes = 256;
const maxVoters = 10000;
const rateWindowMs = 10 * 60 * 1000;
const maxVotesPerIp = 40;
const maxVotesPerVoter = 12;
const maxIpBuckets = 2048;

function canRecordVote(buckets, key, limit, capacity, now) {
  const bucket = buckets.get(key);
  if (bucket && bucket.resetAt > now) return bucket.count < limit;

  for (const [storedKey, storedBucket] of buckets) {
    if (storedBucket.resetAt <= now) buckets.delete(storedKey);
  }
  return buckets.size < capacity;
}

function recordVote(buckets, key, now) {
  const bucket = buckets.get(key);
  if (bucket && bucket.resetAt > now) {
    bucket.count++;
  } else {
    buckets.set(key, { count: 1, resetAt: now + rateWindowMs });
  }
}

function countsFor(votes, key) {
  const values = Object.values(votes[key] || {});
  return {
    likes: values.filter((vote) => vote === 1).length,
    dislikes: values.filter((vote) => vote === -1).length,
  };
}

function loadVotes(storagePath) {
  if (!existsSync(storagePath)) {
    return Object.fromEntries(allowedKeys.map((key) => [key, {}]));
  }

  const parsed = JSON.parse(readFileSync(storagePath, 'utf8'));
  if (parsed?.version !== 1 || !parsed.votes || typeof parsed.votes !== 'object' || Array.isArray(parsed.votes)) {
    throw new Error('Invalid reaction storage');
  }

  for (const key of allowedKeys) {
    const voters = parsed.votes[key];
    if (!voters || typeof voters !== 'object' || Array.isArray(voters)) {
      throw new Error('Invalid reaction storage');
    }

    for (const [hash, vote] of Object.entries(voters)) {
      if (!/^[0-9a-f]{64}$/.test(hash) || ![-1, 1].includes(vote)) {
        throw new Error('Invalid reaction storage');
      }
    }
  }

  if (Object.keys(parsed.votes).length !== allowedKeys.length) {
    throw new Error('Invalid reaction storage');
  }

  return parsed.votes;
}

function saveVotes(storagePath, votes, sequence) {
  const temporaryPath = `${storagePath}.${process.pid}.${sequence}.tmp`;

  try {
    writeFileSync(temporaryPath, JSON.stringify({ version: 1, votes }), { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporaryPath, storagePath);

    // На Debian синхронизация каталога сохраняет переименование после сбоя питания
    if (process.platform !== 'win32') {
      const directoryFd = openSync(dirname(storagePath), 'r');
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  } catch (error) {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
}

function sendJson(response, status, body, origin, allowedOrigin) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
    ...(origin === allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let oversized = false;

    request.on('data', (chunk) => {
      if (oversized) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        oversized = true;
        reject(new RangeError('Request is too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export function createReactionServer({ storagePath, allowedOrigin, now = Date.now }) {
  if (!storagePath || !allowedOrigin) {
    throw new Error('Storage path and origin are required');
  }

  let votes = loadVotes(storagePath);
  let sequence = 0;
  let totalVoters = Object.values(votes).reduce((sum, voters) => sum + Object.keys(voters).length, 0);
  const ipBuckets = new Map();
  const voterBuckets = new Map();
  if (totalVoters > maxVoters) {
    throw new Error('Reaction storage exceeds limit');
  }

  return createServer(async (request, response) => {
    const origin = request.headers.origin || '';
    if (request.url !== '/glossaliae/reactions') {
      sendJson(response, 404, { error: 'Not found' }, origin, allowedOrigin);
      return;
    }

    if (request.method === 'GET') {
      sendJson(response, 200, Object.fromEntries(allowedKeys.map((key) => [key, countsFor(votes, key)])), origin, allowedOrigin);
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method is not allowed' }, origin, allowedOrigin);
      return;
    }

    if (origin !== allowedOrigin) {
      sendJson(response, 403, { error: 'Origin is not allowed' }, origin, allowedOrigin);
      return;
    }

    if (!/^text\/plain(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) {
      sendJson(response, 415, { error: 'Content type is not allowed' }, origin, allowedOrigin);
      return;
    }

    // Caddy перезаписывает этот заголовок фактическим адресом клиента
    const clientIp = request.headers['x-glossaliae-client-ip'];
    if (typeof clientIp !== 'string' || !isIP(clientIp)) {
      sendJson(response, 403, { error: 'Trusted client address is required' }, origin, allowedOrigin);
      return;
    }

    let input;
    try {
      input = JSON.parse(await readBody(request));
    } catch (error) {
      sendJson(response, error instanceof RangeError ? 413 : 400, { error: 'Invalid request' }, origin, allowedOrigin);
      return;
    }

    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join(',') !== 'key,vote,voterId'
      || !allowedKeys.includes(input.key)
      || ![-1, 0, 1].includes(input.vote)
      || typeof input.voterId !== 'string'
      || !/^[0-9a-f]{32}$/.test(input.voterId)) {
      sendJson(response, 400, { error: 'Invalid reaction' }, origin, allowedOrigin);
      return;
    }

    const voterHash = createHash('sha256').update(input.voterId).digest('hex');
    const currentVote = votes[input.key][voterHash];
    if (currentVote === input.vote || (currentVote === undefined && input.vote === 0)) {
      sendJson(response, 200, countsFor(votes, input.key), origin, allowedOrigin);
      return;
    }

    if (currentVote === undefined && input.vote !== 0 && totalVoters >= maxVoters) {
      sendJson(response, 503, { error: 'Reaction storage is full' }, origin, allowedOrigin);
      return;
    }

    const timestamp = now();
    if (!canRecordVote(ipBuckets, clientIp, maxVotesPerIp, maxIpBuckets, timestamp)
      || !canRecordVote(voterBuckets, voterHash, maxVotesPerVoter, maxVoters, timestamp)) {
      sendJson(response, 429, { error: 'Too many votes; try again later' }, origin, allowedOrigin);
      return;
    }

    const nextVotes = { ...votes, [input.key]: { ...votes[input.key] } };
    if (input.vote === 0) {
      delete nextVotes[input.key][voterHash];
    } else {
      nextVotes[input.key][voterHash] = input.vote;
    }

    try {
      saveVotes(storagePath, nextVotes, ++sequence);
    } catch {
      // После ошибки синхронизации переименованный файл мог уже стать текущим
      votes = loadVotes(storagePath);
      totalVoters = Object.values(votes).reduce((sum, voters) => sum + Object.keys(voters).length, 0);
      sendJson(response, 503, { error: 'Reactions are unavailable' }, origin, allowedOrigin);
      return;
    }

    votes = nextVotes;
    recordVote(ipBuckets, clientIp, timestamp);
    recordVote(voterBuckets, voterHash, timestamp);
    if (currentVote === undefined && input.vote !== 0) totalVoters++;
    if (currentVote !== undefined && input.vote === 0) totalVoters--;
    sendJson(response, 200, countsFor(votes, input.key), origin, allowedOrigin);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const storagePath = process.env.REACTIONS_DATA_FILE;
  const allowedOrigin = process.env.REACTIONS_ALLOWED_ORIGIN;
  const port = Number(process.env.REACTIONS_PORT || 8791);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port');
  }

  createReactionServer({ storagePath, allowedOrigin }).listen(port, '127.0.0.1');
}
