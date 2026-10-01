import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname } from 'node:path';

const productionOrigin = 'https://glossalia-explorer.tuqo.ru';
const endpoint = '/glossaliae/comments';
const idPattern = /^[0-9a-f]{32}$/;
const keyPattern = /^T[0-9]{5}(?:-[A-Za-z0-9_-]{1,100})?$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const maxBodyBytes = 16 * 1024;
// Лимит оставляет запас памяти для сериализации JSON в общей службе с голосованием
const maxStoreBytes = 8 * 1024 * 1024;
const maxMessages = 10000;
const maxProfiles = 10000;
const usernamePattern = /^user[A-Za-z0-9]{3,16}$/;
const usernameAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ownerName = 'user_001';
const reservedUsernames = new Set(Array.from({ length: 100 }, (_, index) => `user_${String(index + 1).padStart(3, '0')}`));
const pageSize = 50;
const rateWindowMs = 10 * 60 * 1000;
const minimumIntervalMs = 10000;
const maxIpBuckets = 2048;
const maxAuthorBuckets = 10000;
const limits = { messageLength: 2000, nameLength: 40, editWindowMs: 300000 };
const adminSessionMs = 30 * 60 * 1000;
const maxAdminSessions = 32;
const profanity = /(?<!\p{L})(?:fuck(?:ing|er|ers)?|motherfucker|shit|bullshit|cunt|хуй|хуя|хуем|хуём|пизда|пиздец|блядь|блять|ебать|ёбать|сука)(?!\p{L})/u;

function validPassword(password) {
  return typeof password === 'string' && password.length > 0
    && Array.from(password).length <= 256 && Buffer.byteLength(password, 'utf8') <= 1024;
}

export function hashAdminPassword(password) {
  if (!validPassword(password)) throw new Error('Invalid administrator password');

  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.origin === origin
      && (!url.port || Number(url.port) > 0);
  } catch {
    return false;
  }
}

function normalized(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[\u200B-\u200F\u2060-\u206F\uFEFF]/g, '').replace(/\s+/gu, ' ').trim();
}

function validText(value, maximum) {
  return typeof value === 'string' && value === value.trim()
    && normalized(value).length > 0 && Array.from(value).length <= maximum;
}

function allocateUsername(users) {
  const existing = new Set(Object.values(users));
  for (let attempt = 0; attempt < 32; attempt++) {
    const suffix = Array.from({ length: 12 }, () => usernameAlphabet[randomInt(usernameAlphabet.length)]).join('');
    const username = `user${suffix}`;
    if (/[A-Za-z]/.test(suffix) && /[0-9]/.test(suffix) && !reservedUsernames.has(username) && !existing.has(username)) return username;
  }
  throw new Error('Cannot allocate a unique comment username');
}

function loadStore(storagePath) {
  if (!existsSync(storagePath)) return { users: {}, messages: [], globalClosed: false, closedKeys: [], inboxRead: {} };
  if (statSync(storagePath).size > maxStoreBytes) throw new Error('Comment storage exceeds byte limit');

  const parsed = JSON.parse(readFileSync(storagePath, 'utf8'));
  if (![1, 2, 3].includes(parsed?.version) || !Array.isArray(parsed.messages) || parsed.messages.length > maxMessages) {
    throw new Error('Invalid comment storage');
  }
  const globalClosed = parsed.globalClosed ?? false;
  const closedKeys = parsed.closedKeys ?? [];
  if (typeof globalClosed !== 'boolean' || !Array.isArray(closedKeys) || closedKeys.length > maxMessages + 1
    || closedKeys.some((key) => typeof key !== 'string' || !(key === 'for-ai' || keyPattern.test(key)))
    || new Set(closedKeys).size !== closedKeys.length) {
    throw new Error('Invalid comment lock state');
  }

  const users = parsed.version >= 2 ? parsed.users : {};
  if (!users || typeof users !== 'object' || Array.isArray(users) || Object.keys(users).length > maxProfiles
    || Object.entries(users).some(([hash, username]) => !tokenPattern.test(hash)
      || typeof username !== 'string' || reservedUsernames.has(username) || !usernamePattern.test(username) || !/[0-9]/.test(username))
    || new Set(Object.values(users)).size !== Object.keys(users).length) {
    throw new Error('Invalid comment profiles');
  }

  const byId = new Map();
  for (const message of parsed.messages) {
    const deleted = message?.deleted === true;
    const owner = parsed.version === 3 && message?.owner === true;
    const expected = deleted ? (owner ? 'createdAt,deleted,id,key,owner,replyTo,updatedAt' : 'createdAt,deleted,id,key,replyTo,updatedAt')
      : (owner ? 'createdAt,deleted,id,key,owner,replyTo,text,updatedAt'
        : (parsed.version >= 2 ? 'authorHash,createdAt,deleted,id,key,replyTo,text,updatedAt'
        : (Object.hasOwn(message || {}, 'deleted') ? 'authorHash,createdAt,deleted,id,key,name,replyTo,text,updatedAt' : 'authorHash,createdAt,id,key,name,replyTo,text,updatedAt')));
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.keys(message).sort().join(',') !== expected
      || (Object.hasOwn(message, 'deleted') && typeof message.deleted !== 'boolean')
      || typeof message.id !== 'string' || !idPattern.test(message.id) || byId.has(message.id)
      || typeof message.key !== 'string' || !(message.key === 'for-ai' || keyPattern.test(message.key))
      || (!deleted && (!validText(message.text, limits.messageLength)
        || (!owner && (typeof message.authorHash !== 'string' || !tokenPattern.test(message.authorHash)
          || (parsed.version === 1 && !validText(message.name, limits.nameLength))
          || (parsed.version >= 2 && !Object.hasOwn(users, message.authorHash))))))
      || !Number.isSafeInteger(message.createdAt) || message.createdAt < 0
      || !Number.isSafeInteger(message.updatedAt) || message.updatedAt < message.createdAt
      || !(message.replyTo === null || (parsed.version === 3 && !owner && message.replyTo === ownerName)
        || (typeof message.replyTo === 'string' && idPattern.test(message.replyTo)))
      || (owner && (message.replyTo === null || message.replyTo === ownerName))) {
      throw new Error('Invalid comment storage');
    }
    byId.set(message.id, message);
  }

  for (const message of parsed.messages) {
    if (message.replyTo !== null && message.replyTo !== ownerName) {
      const parent = byId.get(message.replyTo);
      if (!parent || parent.key !== message.key || parent.id === message.id || parent.createdAt > message.createdAt
        || (message.owner === true && parent.owner === true)) {
        throw new Error('Invalid comment reply');
      }
    }
  }

  const inboxRead = parsed.version === 3 ? parsed.inboxRead : {};
  if (!inboxRead || typeof inboxRead !== 'object' || Array.isArray(inboxRead) || Object.keys(inboxRead).length > maxMessages
    || Object.entries(inboxRead).some(([id, updatedAt]) => {
      const message = byId.get(id);
      return !idPattern.test(id) || !message || !isInboxMessage(message, byId)
        || !Number.isSafeInteger(updatedAt) || updatedAt < message.createdAt || updatedAt > message.updatedAt;
    })) {
    throw new Error('Invalid comment inbox state');
  }

  const messages = parsed.messages.map((message) => {
    if (message.deleted || message.owner === true) return message;
    if (!Object.hasOwn(users, message.authorHash)) users[message.authorHash] = allocateUsername(users);
    const { name, ...stored } = message;
    return { ...stored, deleted: false };
  });
  return { users, messages, globalClosed, closedKeys, inboxRead };
}

function saveStore(storagePath, state, sequence) {
  const content = JSON.stringify({ version: 3, ...state });
  if (Buffer.byteLength(content, 'utf8') > maxStoreBytes) throw new RangeError('Comment storage exceeds byte limit');

  const temporaryPath = `${storagePath}.${process.pid}.${sequence}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporaryPath, storagePath);

    // Синхронизация каталога закрепляет атомарную замену файла после сбоя питания
    if (process.platform !== 'win32') {
      const directoryFd = openSync(dirname(storagePath), 'r');
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let oversized = false;
    request.on('data', (chunk) => {
      if (oversized) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        oversized = true;
        reject(new RangeError('Comment body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
    request.on('aborted', () => reject(new Error('Comment request aborted')));
  });
}

function consumeAttempt(buckets, key, maximum, capacity, timestamp) {
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= capacity) {
      for (const [storedKey, stored] of buckets) {
        if (stored.lastSeen <= timestamp - rateWindowMs) buckets.delete(storedKey);
      }
    }
    if (buckets.size >= capacity) return null;
    bucket = { attempts: [], lastPost: null, lastSeen: timestamp, recent: [] };
    buckets.set(key, bucket);
  }

  bucket.attempts = bucket.attempts.filter((time) => time > timestamp - rateWindowMs);
  bucket.lastSeen = timestamp;
  if (bucket.attempts.length >= maximum) return null;
  bucket.attempts.push(timestamp);
  return bucket;
}

function canPost(bucket, timestamp) {
  return bucket.lastPost === null || timestamp - bucket.lastPost >= minimumIntervalMs;
}

function ordered(messages) {
  return [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function neighboringMessages(messages, existing) {
  if (!existing) return messages.slice(-2);

  const index = messages.findIndex((message) => message.id === existing.id);
  // Правка затрагивает окна из трёх сообщений как до записи, так и после неё
  return [...messages.slice(Math.max(0, index - 2), index), ...messages.slice(index + 1, index + 3)];
}

function isInboxMessage(message, byId, includeDeleted = false) {
  return (includeDeleted || !message.deleted) && message.owner !== true
    && (message.replyTo === ownerName || byId.get(message.replyTo)?.owner === true);
}

function inboxMessages(state, keys) {
  const byId = new Map(state.messages.map((message) => [message.id, message]));
  return state.messages.filter((message) => (!keys || keys.has(message.key)) && isInboxMessage(message, byId));
}

function unreadCount(state, keys) {
  return inboxMessages(state, keys).filter((message) => state.inboxRead[message.id] !== message.updatedAt).length;
}

function publicMessage(message, messages, users) {
  const parent = message.replyTo === null ? null : messages.find((item) => item.id === message.replyTo && item.key === message.key);
  return {
    id: message.id,
    name: message.deleted ? '' : (message.owner === true ? ownerName : users[message.authorHash]),
    text: message.deleted ? '' : message.text,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    replyTo: message.replyTo,
    replyPreview: parent ? { id: parent.id, name: parent.deleted ? '' : (parent.owner === true ? ownerName : users[parent.authorHash]),
      text: parent.deleted ? 'Сообщение удалено владельцем' : Array.from(parent.text).slice(0, 200).join('') } : null,
    deleted: message.deleted === true,
  };
}

export function createCommentHandler({ storagePath, allowedKeys, adminPasswordHash, now = Date.now }) {
  if (!storagePath || !Array.isArray(allowedKeys) || allowedKeys.length > maxMessages
    || allowedKeys.some((key) => typeof key !== 'string' || !keyPattern.test(key))) {
    throw new Error('Comment storage and transcription keys are required');
  }

  const keys = new Set([...allowedKeys, 'for-ai']);
  let state = { users: {}, messages: [], globalClosed: false, closedKeys: [], inboxRead: {} };
  let storageUnavailable = false;
  let sequence = 0;
  try {
    state = loadStore(storagePath);
  } catch {
    // Повреждение комментариев не останавливает независимый обработчик голосов
    storageUnavailable = true;
  }
  const configuredAdminHash = typeof adminPasswordHash === 'string'
    ? /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(adminPasswordHash) : null;
  const adminSessions = new Map();
  const bodyBuckets = new Map();
  const ipBuckets = new Map();
  const adminBuckets = new Map();
  const adminReadBuckets = new Map();
  const loginBuckets = new Map();
  const authorBuckets = new Map();

  return async (request, response) => {
    const origin = request.headers.origin || '';
    const originAllowed = origin === productionOrigin || isLocalOrigin(origin);
    const timestamp = now();
    const send = (status, body) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Vary': 'Origin',
        ...(originAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
      });
      response.end(JSON.stringify(body));
    };
    const error = (status, code, message) => send(status, { error: code, message });
    const persist = (next) => {
      try {
        saveStore(storagePath, next, ++sequence);
        state = next;
        return true;
      } catch (saveError) {
        try {
          state = loadStore(storagePath);
        } catch {
          storageUnavailable = true;
        }
        error(503, saveError instanceof RangeError ? 'storage_full' : 'storage_unavailable', 'Комментарии временно недоступны.');
        return false;
      }
    };
    let url;
    try {
      if (!request.url || request.url.length > 512 || !request.url.startsWith(endpoint)) throw new Error('Invalid comment URL');
      url = new URL(request.url, 'http://localhost');
      if (url.pathname !== endpoint || url.hash) throw new Error('Invalid comment URL');
    } catch {
      error(400, 'invalid_request', 'Некорректный адрес комментариев.');
      return;
    }

    if (storageUnavailable) {
      error(503, 'storage_unavailable', 'Комментарии временно недоступны.');
      return;
    }

    if (request.method === 'GET') {
      const names = [...url.searchParams.keys()];
      if (names.some((name) => !['key', 'before', 'id'].includes(name))
        || new Set(names).size !== names.length || !url.searchParams.has('key')
        || (url.searchParams.has('before') && url.searchParams.has('id'))) {
        error(400, 'invalid_request', 'Некорректные параметры комментариев.');
        return;
      }

      const key = url.searchParams.get('key');
      if (!keys.has(key)) {
        error(400, 'invalid_key', 'Обсуждение этого материала недоступно.');
        return;
      }

      const before = url.searchParams.get('before');
      const id = url.searchParams.get('id');
      if ((before !== null && !idPattern.test(before)) || (id !== null && !idPattern.test(id))) {
        error(400, 'invalid_request', 'Некорректный идентификатор комментария.');
        return;
      }

      const chat = ordered(state.messages.filter((message) => message.key === key));
      const closed = state.globalClosed || state.closedKeys.includes(key);
      if (id !== null) {
        const found = chat.find((message) => message.id === id);
        if (!found) error(404, 'not_found', 'Комментарий не найден.');
        else send(200, { messages: [publicMessage(found, state.messages, state.users)], nextBefore: null, serverTime: timestamp, limits, closed });
        return;
      }

      const end = before === null ? chat.length : chat.findIndex((message) => message.id === before);
      if (end < 0) {
        error(404, 'not_found', 'Комментарий не найден.');
        return;
      }
      const start = Math.max(0, end - pageSize);
      const page = chat.slice(start, end);
      send(200, { messages: page.map((message) => publicMessage(message, state.messages, state.users)), nextBefore: start > 0 ? page[0].id : null, serverTime: timestamp, limits, closed });
      return;
    }

    if (request.method !== 'POST') {
      error(405, 'method_not_allowed', 'Метод не поддерживается.');
      return;
    }
    if (url.search || request.url !== endpoint) {
      error(400, 'invalid_request', 'Параметры публикации передаются в теле запроса.');
      return;
    }
    if (!originAllowed) {
      error(403, 'origin_not_allowed', 'Источник запроса не разрешён.');
      return;
    }

    const clientIp = request.headers['x-glossaliae-client-ip'];
    if (typeof clientIp !== 'string' || !isIP(clientIp)) {
      error(403, 'trusted_address_required', 'Не определён адрес посетителя.');
      return;
    }

    // Общий лимит защищает чтение тела до разделения обычных и административных действий
    if (!consumeAttempt(bodyBuckets, clientIp, 200, maxIpBuckets, timestamp)) {
      error(429, 'rate_limited', 'Подождите перед следующей отправкой сообщения.');
      return;
    }
    if (!/^text\/plain(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) {
      error(415, 'unsupported_content_type', 'Неподдерживаемый формат сообщения.');
      return;
    }

    let input;
    try {
      input = JSON.parse(await readBody(request));
    } catch (bodyError) {
      const invalidBucket = consumeAttempt(ipBuckets, clientIp, 20, maxIpBuckets, now());
      if (!invalidBucket && !(bodyError instanceof RangeError)) {
        error(429, 'rate_limited', 'Подождите перед следующей отправкой сообщения.');
        return;
      }
      error(bodyError instanceof RangeError ? 413 : 400, 'invalid_request', 'Некорректное или слишком большое сообщение.');
      return;
    }

    const postTime = now();
    if (input && typeof input === 'object' && !Array.isArray(input)
      && typeof input.action === 'string' && input.action.startsWith('admin-')) {
      if (!isLocalOrigin(origin)) {
        error(403, 'admin_origin_not_allowed', 'Управление доступно только из локальной версии сайта.');
        return;
      }
      const login = input.action === 'admin-login';
      const reading = ['admin-status', 'admin-inbox'].includes(input.action);
      const buckets = login ? loginBuckets : (reading ? adminReadBuckets : adminBuckets);
      if (!consumeAttempt(buckets, clientIp, login ? 5 : (reading ? 100 : 20), maxIpBuckets, postTime)) {
        error(429, 'rate_limited', 'Слишком много попыток управления.');
        return;
      }
      if (!configuredAdminHash) {
        error(503, 'admin_unavailable', 'Управление комментариями пока не настроено.');
        return;
      }
      const expectedFields = {
        'admin-login': 'action,key,password',
        'admin-status': 'action,adminToken,key',
        'admin-lock': 'action,adminToken,closed,key',
        'admin-delete': 'action,adminToken,id,key',
        'admin-read': 'action,adminToken,id,key,updatedAt',
        'admin-reply': 'action,adminToken,id,key,text',
        'admin-inbox': Object.hasOwn(input, 'before') ? 'action,adminToken,before,key' : 'action,adminToken,key',
      }[input.action];
      const globalAction = ['admin-status', 'admin-login', 'admin-inbox'].includes(input.action);
      if (!expectedFields || Object.keys(input).sort().join(',') !== expectedFields
        || (globalAction && input.key !== '*')
        || (!globalAction && !(keys.has(input.key) || (input.action === 'admin-lock' && input.key === '*')))
        || (input.action === 'admin-lock' && typeof input.closed !== 'boolean')
        || (input.action === 'admin-read' && (!Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0))) {
        error(400, 'invalid_request', 'Некорректные параметры управления.');
        return;
      }

      if (login) {
        if (!validPassword(input.password)) {
          error(400, 'invalid_request', 'Некорректный пароль управления.');
          return;
        }
        let passwordMatches = false;
        try {
          const candidate = scryptSync(input.password, Buffer.from(configuredAdminHash[1], 'hex'), 64, { N: 16384, r: 8, p: 1 });
          passwordMatches = timingSafeEqual(candidate, Buffer.from(configuredAdminHash[2], 'hex'));
        } catch {
          error(503, 'admin_unavailable', 'Управление комментариями временно недоступно.');
          return;
        }
        if (!passwordMatches) {
          error(401, 'admin_not_authorized', 'Неверный пароль управления.');
          return;
        }

        for (const [hash, session] of adminSessions) {
          if (session.expiresAt <= postTime) adminSessions.delete(hash);
        }
        if (adminSessions.size >= maxAdminSessions) {
          error(503, 'admin_sessions_full', 'Достигнут лимит активных сеансов управления.');
          return;
        }
        const adminToken = randomBytes(32).toString('hex');
        const expiresAt = postTime + adminSessionMs;
        adminSessions.set(createHash('sha256').update(adminToken).digest('hex'), { expiresAt });
        send(200, { adminToken, expiresAt, globalClosed: state.globalClosed, closedKeys: [...state.closedKeys],
          discussionKeys: Array.from(keys), unreadCount: unreadCount(state, keys), serverTime: postTime, limits });
        return;
      }

      if (typeof input.adminToken !== 'string' || !tokenPattern.test(input.adminToken)) {
        error(401, 'admin_not_authorized', 'Войдите в управление комментариями.');
        return;
      }
      const sessionHash = createHash('sha256').update(input.adminToken).digest('hex');
      const session = adminSessions.get(sessionHash);
      if (!session || session.expiresAt <= postTime) {
        if (session) adminSessions.delete(sessionHash);
        error(401, session ? 'admin_session_expired' : 'admin_not_authorized', 'Войдите в управление комментариями повторно.');
        return;
      }

      if (input.action === 'admin-inbox') {
        if (Object.hasOwn(input, 'before') && (typeof input.before !== 'string' || !idPattern.test(input.before))) {
          error(400, 'invalid_request', 'Некорректный идентификатор обращения.');
          return;
        }
        let messages = ordered(inboxMessages(state, keys));
        if (Object.hasOwn(input, 'before')) {
          const byId = new Map(state.messages.map((message) => [message.id, message]));
          const anchor = byId.get(input.before);
          if (!anchor || !keys.has(anchor.key) || !isInboxMessage(anchor, byId, true)) {
            error(404, 'not_found', 'Обращение не найдено.');
            return;
          }
          messages = messages.filter((message) => message.createdAt < anchor.createdAt
            || (message.createdAt === anchor.createdAt && message.id.localeCompare(anchor.id) < 0));
        }
        const end = messages.length;
        const start = Math.max(0, end - pageSize);
        const page = messages.slice(start, end);
        send(200, { messages: page.map((message) => ({ ...publicMessage(message, state.messages, state.users),
          key: message.key, read: state.inboxRead[message.id] === message.updatedAt })), nextBefore: start > 0 ? page[0].id : null,
          unreadCount: unreadCount(state, keys), serverTime: postTime, limits });
        return;
      }

      if (input.action === 'admin-read' || input.action === 'admin-reply') {
        const existing = state.messages.find((message) => message.id === input.id && message.key === input.key);
        if (typeof input.id !== 'string' || !idPattern.test(input.id) || !existing) {
          error(404, 'not_found', 'Комментарий не найден.');
          return;
        }
        if (input.action === 'admin-read') {
          if (!inboxMessages(state, keys).some((message) => message.id === existing.id)) {
            error(404, 'not_found', 'Обращение не найдено.');
            return;
          }
          if (input.updatedAt !== existing.updatedAt) {
            error(409, 'stale_message', 'Сообщение изменилось. Обновите список обращений.');
            return;
          }
          if (state.inboxRead[existing.id] !== existing.updatedAt
            && !persist({ ...state, inboxRead: { ...state.inboxRead, [existing.id]: existing.updatedAt } })) return;
          send(200, { unreadCount: unreadCount(state, keys), serverTime: postTime, limits });
          return;
        }
        if (existing.deleted) {
          error(410, 'message_deleted', 'Сообщение удалено владельцем.');
          return;
        }
        if (existing.owner === true) {
          error(400, 'reply_not_found', 'Ответ владельца должен быть адресован сообщению посетителя.');
          return;
        }

        const text = typeof input.text === 'string' ? input.text.trim() : input.text;
        if (!validText(text, limits.messageLength)) {
          error(400, 'invalid_text', 'Введите сообщение до 2000 символов.');
          return;
        }
        if (profanity.test(normalized(text))) {
          error(400, 'profanity', 'Сообщение содержит недопустимую лексику.');
          return;
        }
        const activeMessages = ordered(state.messages.filter((message) => !message.deleted));
        const previousOwner = activeMessages.filter((message) => message.owner === true).slice(-2);
        const previousChat = activeMessages.filter((message) => message.key === input.key).slice(-2);
        if ([...previousOwner, ...previousChat].some((message) => normalized(message.text) === normalized(text))) {
          error(409, 'duplicate', 'Такое сообщение повторяется в окне из трёх сообщений.');
          return;
        }
        if (state.messages.length >= maxMessages) {
          error(503, 'storage_full', 'Хранилище комментариев заполнено.');
          return;
        }
        if (postTime < existing.createdAt) {
          error(503, 'clock_unavailable', 'Комментарии временно недоступны.');
          return;
        }
        const message = { id: randomBytes(16).toString('hex'), key: existing.key, text, createdAt: postTime,
          updatedAt: postTime, replyTo: existing.id, owner: true, deleted: false };
        if (!persist({ ...state, messages: [...state.messages, message] })) return;
        send(201, { message: publicMessage(message, state.messages, state.users), unreadCount: unreadCount(state, keys), serverTime: postTime, limits });
        return;
      }

      if (input.action === 'admin-delete') {
        const existing = state.messages.find((message) => message.id === input.id && message.key === input.key);
        if (typeof input.id !== 'string' || !idPattern.test(input.id) || !existing) {
          error(404, 'not_found', 'Комментарий не найден.');
          return;
        }
        const deleted = { id: existing.id, key: existing.key, createdAt: existing.createdAt,
          updatedAt: postTime, replyTo: existing.replyTo, deleted: true, ...(existing.owner === true ? { owner: true } : {}) };
        const inboxRead = { ...state.inboxRead };
        delete inboxRead[existing.id];
        if (!persist({ ...state, inboxRead, messages: state.messages.map((message) => message.id === existing.id ? deleted : message) })) return;
        for (const bucket of ipBuckets.values()) bucket.recent = bucket.recent.filter((message) => message.id !== existing.id);
        send(200, { message: publicMessage(deleted, state.messages, state.users), unreadCount: unreadCount(state, keys), serverTime: postTime, limits });
        return;
      }

      if (input.action === 'admin-lock') {
        const next = input.key === '*' ? { ...state, globalClosed: input.closed }
          : { ...state, closedKeys: input.closed ? [...new Set([...state.closedKeys, input.key])] : state.closedKeys.filter((key) => key !== input.key) };
        if (!persist(next)) return;
      }
      send(200, { globalClosed: state.globalClosed, closedKeys: [...state.closedKeys],
        discussionKeys: Array.from(keys), unreadCount: unreadCount(state, keys), serverTime: postTime, limits });
      return;
    }

    const ipBucket = consumeAttempt(ipBuckets, clientIp, 20, maxIpBuckets, postTime);
    if (!ipBucket || !canPost(ipBucket, postTime)) {
      error(429, 'rate_limited', 'Подождите перед следующей отправкой сообщения.');
      return;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.authorToken !== 'string' || !tokenPattern.test(input.authorToken)) {
      error(400, 'invalid_request', 'Некорректные данные автора сообщения.');
      return;
    }

    const authorHash = createHash('sha256').update(input.authorToken).digest('hex');
    const authorBucket = consumeAttempt(authorBuckets, authorHash, 8, maxAuthorBuckets, postTime);
    if (!authorBucket || !canPost(authorBucket, postTime) || !canPost(ipBucket, postTime)) {
      error(429, 'rate_limited', 'Подождите перед следующей отправкой сообщения.');
      return;
    }

    const fields = input.action === 'create' ? 'action,authorToken,key,replyTo,text' : 'action,authorToken,id,key,text';
    if (!['create', 'edit'].includes(input.action) || Object.keys(input).sort().join(',') !== fields
      || typeof input.text !== 'string') {
      error(400, 'invalid_request', 'Некорректные поля сообщения.');
      return;
    }
    if (!keys.has(input.key)) {
      error(400, 'invalid_key', 'Обсуждение этого материала недоступно.');
      return;
    }
    if (input.action === 'create' && (state.globalClosed || state.closedKeys.includes(input.key))) {
      error(403, 'chat_closed', 'Владелец временно закрыл отправку новых сообщений.');
      return;
    }

    const text = input.text.trim();
    if (!validText(text, limits.messageLength)) {
      error(400, 'invalid_text', 'Введите сообщение до 2000 символов.');
      return;
    }
    if (profanity.test(normalized(text))) {
      error(400, 'profanity', 'Сообщение содержит недопустимую лексику.');
      return;
    }

    let existing = null;
    const messages = state.messages;
    if (input.action === 'edit') {
      existing = messages.find((message) => message.id === input.id && message.key === input.key);
      if (!idPattern.test(input.id) || !existing) {
        error(404, 'not_found', 'Комментарий не найден.');
        return;
      }
      if (existing.deleted) {
        error(410, 'message_deleted', 'Сообщение удалено владельцем.');
        return;
      }
      if (existing.authorHash !== authorHash) {
        error(403, 'not_author', 'Изменить сообщение может только его автор.');
        return;
      }
      if (postTime - existing.createdAt >= limits.editWindowMs || postTime < existing.createdAt) {
        error(403, 'edit_expired', 'Пять минут для редактирования уже истекли.');
        return;
      }
    } else {
      if (!(input.replyTo === null || input.replyTo === ownerName || (typeof input.replyTo === 'string' && idPattern.test(input.replyTo)))) {
        error(400, 'invalid_request', 'Некорректная ссылка на родительское сообщение.');
        return;
      }
      if (input.replyTo !== null && input.replyTo !== ownerName
        && !messages.some((message) => message.id === input.replyTo && message.key === input.key && !message.deleted)) {
        error(400, 'reply_not_found', 'Родительское сообщение не найдено в этом обсуждении.');
        return;
      }
      if (messages.length >= maxMessages) {
        error(503, 'storage_full', 'Хранилище комментариев заполнено.');
        return;
      }
    }

    const activeMessages = ordered(messages.filter((message) => !message.deleted));
    const previousAuthor = neighboringMessages(activeMessages.filter((message) => message.authorHash === authorHash), existing);
    const previousChat = neighboringMessages(activeMessages.filter((message) => message.key === input.key), existing);
    const previousIp = ipBucket.recent.filter((message) => message.id !== existing?.id).slice(-2);
    const candidate = normalized(text);
    if ([...previousAuthor, ...previousChat, ...previousIp].some((message) => normalized(message.text) === candidate)) {
      error(409, 'duplicate', 'Такое сообщение повторяется в окне из трёх сообщений.');
      return;
    }

    let users = state.users;
    if (!Object.hasOwn(users, authorHash)) {
      if (Object.keys(users).length >= maxProfiles) {
        error(503, 'storage_full', 'Хранилище пользователей комментариев заполнено.');
        return;
      }
      try {
        users = { ...users, [authorHash]: allocateUsername(users) };
      } catch {
        error(503, 'storage_unavailable', 'Не удалось создать имя пользователя.');
        return;
      }
    }

    const message = existing ? { ...existing, text, updatedAt: postTime, deleted: false } : {
      id: randomBytes(16).toString('hex'), key: input.key, text,
      createdAt: postTime, updatedAt: postTime, replyTo: input.replyTo, authorHash, deleted: false,
    };
    const next = existing ? messages.map((item) => item.id === existing.id ? message : item) : [...messages, message];
    if (!persist({ ...state, users, messages: next })) return;

    ipBucket.lastPost = postTime;
    authorBucket.lastPost = postTime;
    ipBucket.recent = [...ipBucket.recent.filter((item) => item.id !== message.id), { id: message.id, text }].slice(-2);
    send(existing ? 200 : 201, { message: publicMessage(message, state.messages, state.users), serverTime: postTime, limits });
  };
}
