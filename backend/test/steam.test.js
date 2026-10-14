const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyAssertion, PROVIDER } = require('../src/steam');
const { openStore } = require('../src/store');
const { createApplication } = require('../src/app');
test('OpenID requires signed fields, exact callback, official endpoint and live provider verification', async () => {
  const callback = 'https://api.crymoooreee.ru/steam/openid/callback?ticket=state';
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res',
    'openid.op_endpoint': PROVIDER, 'openid.return_to': callback,
    'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000000',
    'openid.response_nonce': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') + 'unique',
    'openid.assoc_handle': 'handle',
    'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle'
  });
  const check = async (url, options) => { assert.equal(url, PROVIDER); assert.equal(options.body.get('openid.mode'), 'check_authentication'); return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'); };
  assert.equal((await verifyAssertion(params, callback, Date.now(), check)).steamId, '76561198000000000');
  await assert.rejects(verifyAssertion(params, 'https://attacker.test', Date.now(), check));
  const unsigned = new URLSearchParams(params); unsigned.set('openid.signed', 'identity');
  await assert.rejects(verifyAssertion(unsigned, callback, Date.now(), check));
  await assert.rejects(verifyAssertion(params, callback, Date.now(), async () => new Response('is_valid:false\n')));
  const duplicate = new URLSearchParams(params); duplicate.append('openid.identity', params.get('openid.identity'));
  await assert.rejects(verifyAssertion(duplicate, callback, Date.now(), check));
});
test('Steam tickets bound to account/session; callback replay and cross-account reuse blocked', async () => {
  const store = openStore(':memory:'), mails = [];
  const server = createApplication({ store, config: { publicURL: 'https://api.crymoooreee.ru', steamKey: '' }, sendMail: async m => mails.push(m), verifySteam: async () => ({ steamId: '76561198000000000', nonce: 'unique' + mails.length }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, body, token) { const r = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' }); return { status: r.status, value: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; }
  try {
    const sessions = [];
    for (const email of ['a@example.com', 'b@example.com']) {
      await call('/auth/register', { email, password: 'Secure long test password' });
      const token = new URL(mails.at(-1).text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
      await call('/auth/verify', { token }); sessions.push((await call('/auth/login', { email, password: 'Secure long test password' })).value);
    }
    const ticket = (await call('/steam/link/start', {}, sessions[0].accessToken)).value;
    assert.equal((await call('/steam/link/poll', { id: ticket.id, pollToken: ticket.pollToken }, sessions[1].accessToken)).status, 400);
    const browser = new URL(ticket.url).searchParams.get('ticket');
    assert.equal((await call('/steam/openid/start?ticket=' + browser)).status, 302);
    assert.equal((await call('/steam/openid/start?ticket=' + browser)).status, 400);
    assert.equal((await call('/steam/openid/callback?ticket=' + browser)).status, 200);
    assert.equal((await call('/steam/openid/callback?ticket=' + browser)).status, 400);
    assert.equal((await call('/steam/link/poll', { id: ticket.id, pollToken: ticket.pollToken }, sessions[0].accessToken)).value.status, 'complete');
    const second = (await call('/steam/link/start', {}, sessions[1].accessToken)).value;
    const browser2 = new URL(second.url).searchParams.get('ticket');
    await call('/steam/openid/start?ticket=' + browser2); await call('/steam/openid/callback?ticket=' + browser2);
    assert.equal((await call('/steam/link/poll', { id: second.id, pollToken: second.pollToken }, sessions[1].accessToken)).value.status, 'failed');
    assert.equal((await call('/steam/library', undefined, sessions[0].accessToken)).status, 503);
    assert.equal((await call('/steam/unlink', {}, sessions[0].accessToken)).value.user.steam, null);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); }
});
