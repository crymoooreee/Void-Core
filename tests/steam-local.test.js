const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { parseVDF, LocalSteamLibrary } = require('../core/steam/local-library');
test('VDF parsing safe keys, local manifests, installed validation and launch whitelist', async () => {
  assert.equal(parseVDF('"__proto__" { "key" "value" }').__proto__.key, 'value');
  assert.throws(() => parseVDF('"a" { "b" "c"'));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voidcore-steam-'));
  try {
    const apps = path.join(directory, 'steamapps'); await fs.mkdir(path.join(apps, 'common', 'Game'), { recursive: true });
    await fs.writeFile(path.join(apps, 'appmanifest_730.acf'), '"AppState" { "appid" "730" "name" "Counter-Strike 2" "StateFlags" "4" "installdir" "Game" }');
    await fs.writeFile(path.join(apps, 'appmanifest_999.acf'), '"AppState" { "appid" "999" "name" "Bad" "StateFlags" "4" "installdir" "../escape" }');
    let opened = null; const library = new LocalSteamLibrary({ roots: [directory], openExternal: async url => { opened = url; } });
    const result = await library.scan(); assert.equal(result.games.length, 1); assert.equal(result.games[0].appid, 730);
    await library.launch(730); assert.equal(opened, 'steam://rungameid/730');
    await assert.rejects(library.launch('730;evil')); await assert.rejects(library.launch(999));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
