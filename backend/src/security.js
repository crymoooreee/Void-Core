const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const email = value => {
  if (typeof value !== 'string') throw new Error('Invalid email');
  const result = value.trim().toLowerCase();
  if (result.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error('Invalid email');
  return result;
};
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value) > 128) throw new Error('Password must be 12–128 bytes');
  return value;
}
let jobs = 0;
async function derive(value, salt) {
  if (jobs >= 4) throw Object.assign(new Error('Busy'), { status: 503 });
  jobs++;
  try { return await scrypt(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
  finally { jobs--; }
}
async function encodePassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password(value), salt)).toString('hex')}`;
}
const dummy = '00000000000000000000000000000000:' + '00'.repeat(64);
async function checkPassword(value, encoded = dummy) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 128) return false;
  const [salt, expected] = encoded.split(':');
  const actual = await derive(value, salt);
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}
function bearer(req) {
  const value = req.headers.authorization || '';
  return /^Bearer [A-Za-z0-9_-]{43}$/.test(value) ? value.slice(7) : null;
}
function validToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }
function rateLimit({ now = Date.now } = {}) {
  const buckets = new Map();
  return (key, limit = 15, interval = 15 * 60 * 1000) => {
    const time = now();
    if (buckets.size > 10000) for (const [k, v] of buckets) if (v.until <= time) buckets.delete(k);
    if (buckets.size > 20000) throw Object.assign(new Error('Busy'), { status: 503 });
    let b = buckets.get(key);
    if (!b || b.until <= time) { b = { count: 0, until: time + interval }; buckets.set(key, b); }
    if (++b.count > limit) throw Object.assign(new Error('Too many requests'), { status: 429 });
  };
}
module.exports = { hash, random, email, password, encodePassword, checkPassword, bearer, validToken, rateLimit };
