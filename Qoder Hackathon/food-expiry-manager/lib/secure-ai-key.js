const crypto = require('crypto');

const COOKIE_NAME = 'freshtrack_ai_key';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const VERSION = 'v1';

class AiKeyConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiKeyConfigError';
    this.code = 'AI_KEY_CONFIG_MISSING';
    this.status = 503;
  }
}

function hasEncryptionSecret() {
  return typeof process.env.APP_ENCRYPTION_SECRET === 'string'
    && process.env.APP_ENCRYPTION_SECRET.length >= 32;
}

function encryptionKey() {
  if (!hasEncryptionSecret()) {
    throw new AiKeyConfigError(
      'APP_ENCRYPTION_SECRET must be configured with at least 32 characters before browser API keys can be saved.'
    );
  }
  return crypto.createHash('sha256').update(process.env.APP_ENCRYPTION_SECRET, 'utf8').digest();
}

function encode(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function decode(value) {
  return Buffer.from(String(value), 'base64url');
}

function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, encode(iv), encode(tag), encode(encrypted)].join('.');
}

function decryptPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Invalid encrypted key token');
  const [, ivValue, tagValue, encryptedValue] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), decode(ivValue));
  decipher.setAuthTag(decode(tagValue));
  const plaintext = Buffer.concat([
    decipher.update(decode(encryptedValue)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function parseCookies(req) {
  const header = String(req?.headers?.cookie || '');
  const cookies = {};
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function isSecureRequest(req) {
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return forwarded === 'https' || Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

function setCookieHeader(res, value) {
  const current = res.getHeader?.('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  const list = Array.isArray(current) ? current : [current];
  res.setHeader('Set-Cookie', [...list, value]);
}

function writeUserKeyCookie(req, res, apiKey) {
  const token = encryptPayload({
    key: apiKey,
    suffix: apiKey.slice(-4),
    createdAt: new Date().toISOString(),
  });
  const secure = isSecureRequest(req) ? '; Secure' : '';
  setCookieHeader(
    res,
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${COOKIE_MAX_AGE}; Path=/api; HttpOnly; SameSite=Strict${secure}`
  );
}

function clearUserKeyCookie(req, res) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  setCookieHeader(
    res,
    `${COOKIE_NAME}=; Max-Age=0; Path=/api; HttpOnly; SameSite=Strict${secure}`
  );
}

function readUserKey(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !hasEncryptionSecret()) return null;
  try {
    const payload = decryptPayload(token);
    if (!payload || typeof payload.key !== 'string' || payload.key.length < 20) return null;
    return {
      key: payload.key,
      suffix: String(payload.suffix || payload.key.slice(-4)),
      createdAt: payload.createdAt || null,
    };
  } catch {
    return null;
  }
}

function resolveApiKey(req) {
  const user = readUserKey(req);
  if (user) return { key: user.key, source: 'user', suffix: user.suffix };
  const serverKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (serverKey) return { key: serverKey, source: 'server', suffix: null };
  return { key: null, source: 'none', suffix: null };
}

function keyStatus(req) {
  const resolved = resolveApiKey(req);
  return {
    connected: Boolean(resolved.key),
    source: resolved.source,
    suffix: resolved.source === 'user' ? resolved.suffix : null,
    canSaveBrowserKey: hasEncryptionSecret(),
  };
}

function assertSameOrigin(req) {
  const origin = req?.headers?.origin;
  if (!origin) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    const error = new Error('Invalid request origin');
    error.status = 403;
    error.code = 'INVALID_ORIGIN';
    throw error;
  }
  if (originHost !== host) {
    const error = new Error('Cross-site API key changes are not allowed');
    error.status = 403;
    error.code = 'INVALID_ORIGIN';
    throw error;
  }
}

module.exports = {
  AiKeyConfigError,
  assertSameOrigin,
  clearUserKeyCookie,
  hasEncryptionSecret,
  keyStatus,
  readUserKey,
  resolveApiKey,
  writeUserKeyCookie,
};
