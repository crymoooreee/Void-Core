const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../src/store');
const { createApplication } = require('../src/app');
const { hash } = require('../src/security');
async function fixture(options = {}) {
  const store = openStore(':memory:'), mails = [];
  const server = createApplication({ store, config: { publicURL: 'https://api.crymoooreee.ru', steamKey: '', trustProxy: false }, sendMail: async mail => mails.push(mail), ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(route, body, token) {
    const r = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json() };
  }
  return { store, mails, request, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); } };
}
const address = 'person@example.com', password = 'Correct horse battery staple';
function mailToken(mails) { return new URL(mails.at(-1).text.match(/https:\/\/\S+/)[0]).searchParams.get('token'); }
test('Registration, verification, refresh rotation/reuse, reset and logout', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/auth/register', { email: address, password })).status, 200);
    const user = f.store.get('SELECT * FROM users WHERE email=?', address);
    assert.notEqual(user.password, password);
    assert.equal((await f.request('/auth/login', { email: address, password })).status, 403);
    const token = mailToken(f.mails);
    assert.ok(f.store.get('SELECT hash FROM email_tokens WHERE hash=?', hash(token)));
    assert.equal((await f.request('/auth/verify', { token })).status, 200);
    assert.equal((await f.request('/auth/verify', { token })).status, 400);
    let login = await f.request('/auth/login', { email: address, password });
    assert.equal(login.status, 200); let session = login.data;
    const me = await f.request('/auth/me', undefined, session.accessToken);
    assert.equal(me.data.user.email, address); assert.equal(me.data.user.password, undefined);
    assert.equal((await f.request('/auth/me')).status, 401);
    const rotated = await f.request('/auth/refresh', { refreshToken: session.refreshToken });
    assert.equal(rotated.status, 200); assert.notEqual(rotated.data.refreshToken, session.refreshToken);
    assert.equal((await f.request('/auth/refresh', { refreshToken: session.refreshToken })).status, 401);
    assert.equal((await f.request('/auth/me', undefined, rotated.data.accessToken)).status, 401);
    session = (await f.request('/auth/login', { email: address, password })).data;
    await f.request('/auth/forgot', { email: address }); const reset = mailToken(f.mails);
    const newer = 'New secure password long enough';
    assert.equal((await f.request('/auth/reset', { token: reset, password: newer })).status, 200);
    assert.equal((await f.request('/auth/me', undefined, session.accessToken)).status, 401);
    assert.equal((await f.request('/auth/login', { email: address, password })).status, 401);
    assert.equal((await f.request('/auth/reset', { token: reset, password: newer })).status, 400);
    session = (await f.request('/auth/login', { email: address, password: newer })).data;
    assert.equal((await f.request('/auth/logout', {}, session.accessToken)).status, 200);
    assert.equal((await f.request('/auth/refresh', { refreshToken: session.refreshToken })).status, 401);
  } finally { await f.close(); }
});
test('No SMTP means no pretend registration; email validation and rate limit', async () => {
  const f = await fixture({ sendMail: null });
  try {
    assert.equal((await f.request('/auth/register', { email: address, password })).status, 503);
    assert.equal(f.store.get('SELECT COUNT(*) AS n FROM users').n, 0);
    assert.equal((await f.request('/auth/register', { email: 'bad', password })).status, 400);
    let result;
    for (let i = 0; i < 16; i++) result = await f.request('/auth/login', { email: 'blocked@example.com', password: 'no' });
    assert.equal(result.status, 429);
  } finally { await f.close(); }
});
module.exports = { fixture, mailToken };
