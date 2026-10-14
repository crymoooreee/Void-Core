const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { AccountClient } = require('../electron/account-client');
test('Session encrypted, passwords not persisted, renderer receives no tokens, restart restores profile', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voidcore-account-'));
  const file = path.join(directory, 'session.bin'), key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.getAuthTag ? Buffer.alloc(0) : Buffer.alloc(0), cipher.update(value), cipher.final(), cipher.getAuthTag()]); },
    decryptString: value => { const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString(); }
  };
  const session = { accessToken: crypto.randomBytes(32).toString('base64url'), refreshToken: crypto.randomBytes(32).toString('base64url'), expiresAt: Date.now() + 900000, user: { id: 'user', email: 'person@example.com', verified: true, steam: null } };
  const request = async (url, options) => new Response(JSON.stringify(url.endsWith('/auth/me') ? { user: session.user } : url.endsWith('/auth/logout') ? { message: 'Logged out' } : session), { status: 200 });
  const create = () => new AccountClient({ baseURL: 'https://api.crymoooreee.ru', file, safeStorage, request, openExternal: async () => {} });
  try {
    let client = create(); const result = await client.login({ email: session.user.email, password: 'Do not store this password' });
    assert.equal(result.ok, true); assert.equal(result.accessToken, undefined); assert.equal(result.refreshToken, undefined);
    const data = await fs.readFile(file); assert.equal(data.includes(Buffer.from(session.accessToken)), false); assert.equal(data.includes(Buffer.from('Do not store this password')), false);
    client.close(); client = create(); await client.init(); assert.equal(client.snapshot().user.email, session.user.email);
    await client.logout(); await assert.rejects(fs.readFile(file)); client.close();
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('Plaintext storage and unsafe API origins rejected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voidcore-no-store-'));
  const options = { baseURL: 'https://api.crymoooreee.ru', file: path.join(dir, 'session'), safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }, openExternal: async () => {} };
  try {
    const client = new AccountClient(options); assert.equal(client.canPersist(), false);
    assert.throws(() => new AccountClient({ ...options, baseURL: 'http://31.76.64.235' }));
    assert.throws(() => new AccountClient({ ...options, baseURL: 'https://api.crymoooreee.ru/path' }));
    const insecure = new AccountClient({ ...options, baseURL: 'http://127.0.0.1:3000', allowLocalHTTP: true }); insecure.close();
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
