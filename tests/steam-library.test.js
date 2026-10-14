const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../renderer/js/steam-library-model');
test('Steam library merges AppIDs, rejects bad IDs, keeps every returned game', () => {
  const list = model.merge([{ appid: 730, name: 'CS2' }, { appid: 570, name: 'Dota' }], [{ appid: 730, name: 'Counter-Strike 2', playtimeMinutes: 120 }, { appid: 10, name: 'Counter-Strike' }, { appid: '730', name: 'bad' }]);
  assert.equal(list.length, 3); assert.equal(list.find(g => g.appid === 730).installed, true);
  assert.equal(list.find(g => g.appid === 730).owned, true);
  assert.equal(model.page(list, { filter: 'installed' }).total, 2);
  assert.equal(model.page(list, { filter: 'owned' }).total, 2);
  assert.equal(model.page(list, { query: '730' }).total, 1);
  const many = Array.from({ length: 501 }, (_, i) => ({ appid: i + 1, name: `Game ${i}` }));
  assert.equal(model.merge([], many).length, 501);
  assert.equal(model.page(model.merge([], many), { index: 11 }).items.length, 21);
});
test('Cover URLs use only Steam CDN and Account has no orphan library controls', () => {
  assert.deepEqual(model.covers(730), ['https://' + 'cdn.akamai.steamstatic.com/steam/apps/730/library_600x900.jpg', 'https://' + 'cdn.akamai.steamstatic.com/steam/apps/730/header.jpg']);
  assert.deepEqual(model.covers('invalid'), []);
  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  const account = fs.readFileSync(path.join(__dirname, '../renderer/js/account.js'), 'utf8');
  for (const id of ['steamRemoteRefresh', 'steamLocalGames', 'steamRemoteGames', 'steamLocalRefresh']) { assert.ok(!html.includes(`id="${id}"`)); assert.ok(!account.includes(id)); }
  assert.ok(html.includes('cdn.akamai.steamstatic.com'));
  assert.ok(html.includes('id="gamesLibraryGrid"'));
});
