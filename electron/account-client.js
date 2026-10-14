const fs = require('node:fs/promises');
const path = require('node:path');
function validToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }
class AccountClient {
  constructor({ baseURL, file, safeStorage, openExternal, onChange = () => {}, request = fetch, allowLocalHTTP = false }) {
    const url = new URL(baseURL);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(allowLocalHTTP && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error('Invalid API origin');
    Object.assign(this, { baseURL: url.origin, file, safeStorage, openExternal, onChange, request });
    this.tokens = null; this.user = null; this.pending = null; this.timer = null; this.queue = Promise.resolve();
    this.message = 'Войдите или создайте аккаунт. Мониторинг работает без входа.';
  }
  snapshot() { return { user: this.user, apiURL: this.baseURL, message: this.message, linking: Boolean(this.pending), secureStorage: this.canPersist() }; }
  publish(message) { if (message) this.message = message; const state = this.snapshot(); this.onChange(state); return state; }
  enqueue(fn) { const value = this.queue.then(fn); this.queue = value.catch(() => {}); return value; }
  canPersist() { try { return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'; } catch { return false; } }
  async save() {
    if (!this.tokens || !this.canPersist()) { await fs.rm(this.file, { force: true }); return; }
    const encrypted = this.safeStorage.encryptString(JSON.stringify(this.tokens));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file + '.tmp', encrypted, { mode: 0o600 });
    await fs.rename(this.file + '.tmp', this.file);
  }
  async raw(method, route, body, token = null) {
    const response = await this.request(this.baseURL + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(15000) });
    const text = await response.text(); if (text.length > 4 * 1024 * 1024) throw Error('Ответ сервера слишком большой.');
    let value; try { value = JSON.parse(text); } catch { throw Error('Сервер вернул некорректный ответ. Проверьте HTTPS и настройку API.'); }
    if (!response.ok) throw Object.assign(new Error(typeof value.message === 'string' ? value.message.slice(0, 350) : 'Запрос не выполнен.'), { status: response.status });
    return value;
  }
  async accept(data) {
    if (!validToken(data.accessToken) || !validToken(data.refreshToken) || !Number.isFinite(data.expiresAt) || !data.user?.id) throw Error('Некорректный ответ авторизации.');
    this.tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt };
    this.user = data.user;
    try { await this.save(); } catch { return this.publish('Вход выполнен, но сессию не удалось сохранить. После выхода потребуется повторный вход.'); }
    return this.publish(this.canPersist() ? 'Вы вошли в аккаунт.' : 'Вход выполнен только для текущего запуска: защищённое хранилище недоступно.');
  }
  async ensureAccess() {
    if (!this.tokens) throw Error('Сначала войдите в аккаунт.');
    if (this.tokens.expiresAt <= Date.now() + 15000) {
      try { await this.accept(await this.raw('POST', '/auth/refresh', { refreshToken: this.tokens.refreshToken })); }
      catch (error) { if (error.status === 401) { this.tokens = null; this.user = null; await this.save(); this.publish('Сессия истекла. Войдите заново.'); } throw error; }
    }
    return this.tokens.accessToken;
  }
  async authenticated(method, route, body) {
    let token = await this.ensureAccess();
    try { return await this.raw(method, route, body, token); }
    catch (error) {
      if (error.status !== 401) throw error;
      this.tokens.expiresAt = 0; token = await this.ensureAccess();
      return this.raw(method, route, body, token);
    }
  }
  async init() {
    try {
      if (!this.canPersist()) return this.snapshot();
      const value = JSON.parse(this.safeStorage.decryptString(await fs.readFile(this.file)));
      if (!validToken(value.accessToken) || !validToken(value.refreshToken) || !Number.isFinite(value.expiresAt)) throw Error();
      this.tokens = value;
      try { this.user = (await this.authenticated('GET', '/auth/me')).user; return this.publish('Сессия восстановлена.'); }
      catch { return this.publish('Сохранённую сессию не удалось проверить. Нажмите «Обновить аккаунт».'); }
    } catch (error) { if (error.code !== 'ENOENT') { this.tokens = null; await this.save(); } return this.snapshot(); }
  }
  action(fn) { return this.enqueue(async () => { try { return { ok: true, ...(await fn()) }; } catch (error) { const message = error.status ? error.message : 'Не удалось выполнить действие. Проверьте соединение, адрес API и доступность сервера.'; this.publish(message); return { ok: false, message }; } }); }
  register(data) { return this.action(async () => { const value = await this.raw('POST', '/auth/register', { email: data?.email, password: data?.password }); this.publish(value.message); return value; }); }
  login(data) { return this.action(async () => { this.stopLink(); await this.accept(await this.raw('POST', '/auth/login', { email: data?.email, password: data?.password })); return this.snapshot(); }); }
  mail(action, data) { return this.action(async () => { if (!['resend', 'forgot'].includes(action)) throw Error('Invalid action'); const value = await this.raw('POST', '/auth/' + action, { email: data?.email }); this.publish(value.message); return value; }); }
  refreshProfile() { return this.action(async () => { this.user = (await this.authenticated('GET', '/auth/me')).user; return this.publish('Аккаунт обновлён.'); }); }
  logout() { return this.action(async () => { this.stopLink(); let revoked = true; try { if (this.tokens) await this.authenticated('POST', '/auth/logout', {}); } catch { revoked = false; } this.tokens = null; this.user = null; await this.save(); return this.publish(revoked ? 'Вы вышли из аккаунта.' : 'Локальная сессия удалена. Серверный выход не подтверждён из-за ошибки соединения.'); }); }
  stopLink() { clearInterval(this.timer); this.timer = null; this.pending = null; }
  startSteam() { return this.action(async () => {
    this.stopLink(); const value = await this.authenticated('POST', '/steam/link/start', {});
    const url = new URL(value.url);
    if (url.origin !== this.baseURL || url.pathname !== '/steam/openid/start' || !validToken(value.pollToken) || typeof value.id !== 'string') throw Error('Invalid Steam redirect');
    this.pending = { id: value.id, pollToken: value.pollToken, until: Date.now() + 5 * 60000 };
    try { await this.openExternal(url.href); } catch (e) { this.stopLink(); throw e; }
    this.timer = setInterval(() => this.pollSteam(), 2500);
    return this.publish('Steam открыт в браузере. Вводите пароль только на steamcommunity.com.');
  }); }
  pollSteam() {
    if (!this.pending || this.pollBusy) return;
    this.pollBusy = true;
    this.enqueue(async () => {
      if (!this.pending) return;
      if (Date.now() > this.pending.until) { this.stopLink(); return this.publish('Привязка истекла. Начните заново.'); }
      try {
        const value = await this.authenticated('POST', '/steam/link/poll', { id: this.pending.id, pollToken: this.pending.pollToken });
        if (value.status === 'complete') { this.user = value.user; this.stopLink(); this.publish('Steam привязан.'); }
        else if (value.status === 'failed') { this.stopLink(); this.publish(value.message); }
      } catch (error) { if ([400, 401].includes(error.status)) { this.stopLink(); this.publish('Привязка прервана. Войдите и попробуйте снова.'); } }
    }).finally(() => { this.pollBusy = false; });
  }
  cancelSteam() { return this.action(async () => { this.stopLink(); return this.publish('Ожидание остановлено; ссылка в браузере истечёт автоматически.'); }); }
  unlinkSteam() { return this.action(async () => { this.stopLink(); this.user = (await this.authenticated('POST', '/steam/unlink', {})).user; return this.publish('Steam отвязан.'); }); }
  library() { return this.action(async () => this.authenticated('GET', '/steam/library')); }
  close() { this.stopLink(); }
}
module.exports = { AccountClient };
