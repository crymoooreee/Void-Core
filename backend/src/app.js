const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const { hash, random, email, password, encodePassword, checkPassword, bearer, validToken, rateLimit } = require('./security');
const { loginURL, verifyAssertion, steamAPI } = require('./steam');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function publicUser(user) {
  return { id: user.id, email: user.email, verified: Boolean(user.verified), steam: user.steam_id ? { id: user.steam_id, name: user.steam_name, avatar: user.steam_avatar, profile: 'https://steamcommunity.com/profiles/' + user.steam_id } : null };
}
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Требуется JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 16384) fail(413, 'Запрос слишком большой.'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { fail(400, 'Некорректный JSON.'); }
}
function createApplication({ store, config, sendMail = null, verifySteam = verifyAssertion, apiSteam = steamAPI, now = Date.now }) {
  const limit = rateLimit({ now });
  const origin = new URL(config.publicURL).origin;
  const tx = fn => store.transaction(fn);
  const run = (...args) => store.run(...args);
  const get = (...args) => store.get(...args);
  const generic = { message: 'Если адрес подходит для операции, письмо будет отправлено. Проверьте почту и папку «Спам».' };
  function revokeFamily(family) {
    run('DELETE FROM access_tokens WHERE family=?', family);
    run('DELETE FROM refresh_tokens WHERE family=?', family);
    run('DELETE FROM steam_tickets WHERE family=?', family);
  }
  function revokeUser(id) {
    run('DELETE FROM access_tokens WHERE user_id=?', id);
    run('DELETE FROM refresh_tokens WHERE user_id=?', id);
    run('DELETE FROM steam_tickets WHERE user_id=?', id);
  }
  function issue(user, family = crypto.randomUUID()) {
    const accessToken = random(), refreshToken = random();
    const time = now();
    run('INSERT INTO access_tokens(hash,user_id,family,expires) VALUES(?,?,?,?)', hash(accessToken), user.id, family, time + 15 * 60000);
    run('INSERT INTO refresh_tokens(hash,user_id,family,expires) VALUES(?,?,?,?)', hash(refreshToken), user.id, family, time + 30 * 86400000);
    return { accessToken, refreshToken, expiresAt: time + 15 * 60000, user: publicUser(user) };
  }
  function authenticate(req) {
    const token = bearer(req);
    const auth = token && get('SELECT * FROM access_tokens WHERE hash=? AND expires>?', hash(token), now());
    if (!auth) fail(401, 'Требуется повторный вход.');
    return { ...auth, user: get('SELECT * FROM users WHERE id=?', auth.user_id) };
  }
  function normalizedEmail(body) { try { return email(body.email); } catch { fail(400, 'Укажите корректный email.'); } }
  async function mailToken(user, kind) {
    if (!sendMail) fail(503, 'Почтовая отправка ещё не настроена администратором.');
    const token = random();
    run('DELETE FROM email_tokens WHERE user_id=? AND kind=?', user.id, kind);
    run('INSERT INTO email_tokens(hash,user_id,kind,expires) VALUES(?,?,?,?)', hash(token), user.id, kind, now() + (kind === 'verify' ? 3600000 : 900000));
    const link = origin + (kind === 'verify' ? '/verify-email?token=' : '/reset-password?token=') + token;
    try { await sendMail({ to: user.email, subject: kind === 'verify' ? 'Подтверждение аккаунта VoidCore' : 'Сброс пароля VoidCore', text: `${kind === 'verify' ? 'Подтвердите ваш email' : 'Задайте новый пароль'}: ${link}\n\nЕсли вы не запрашивали это действие, проигнорируйте письмо.` }); }
    catch { run('DELETE FROM email_tokens WHERE hash=?', hash(token)); fail(503, 'Не удалось отправить письмо. Повторите позже.'); }
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
  }
  function html(res, title, content, script = '') {
    const nonce = random();
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} — VoidCore</title><style nonce="${nonce}">body{background:#0b0d11;color:#e8ebf4;font:17px system-ui;max-width:620px;margin:12vh auto;padding:24px}h1{color:#7c8cff}button,input{font:inherit;padding:12px;border-radius:8px;border:1px solid #394157;margin:10px 0;display:block}input{background:#151a24;color:white;width:90%}button{background:#7c8cff;color:#0b0d11;cursor:pointer}p{line-height:1.6}a{color:#a1adff}</style><h1>VOID CORE</h1><h2>${title}</h2>${content}<p id="result" role="status"></p>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</html>`);
  }
  async function route(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const forwarded = config.trustProxy && req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' && net.isIP(forwarded.trim()) ? forwarded.trim() : req.socket.remoteAddress;
    limit('all:' + ip, 180, 60000);
    const url = new URL(req.url, origin);
    const p = url.pathname, method = req.method;
    if (method === 'GET' && p === '/health') return json(res, 200, { ok: true, service: 'VoidCore API', mailConfigured: Boolean(sendMail), steamAPIConfigured: Boolean(config.steamKey) });
    if (method === 'GET' && p === '/') return html(res, 'Аккаунт VoidCore', '<p>Регистрация и вход доступны в приложении VoidCore. Подтверждение email и привязка Steam открываются в браузере.</p><p>Пароль Steam вводится только на официальном сайте Steam.</p>');
    if (method === 'GET' && ['/verify-email', '/reset-password'].includes(p)) {
      const token = url.searchParams.get('token');
      if (!validToken(token)) return html(res, 'Ссылка недействительна', '<p>Запросите новое письмо в приложении.</p>');
      const reset = p === '/reset-password';
      return html(res, reset ? 'Новый пароль' : 'Подтверждение email', `<form id="f">${reset ? '<input id="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password" placeholder="Новый пароль: минимум 12 символов">' : '<p>Нажмите кнопку, чтобы подтвердить email.</p>'}<button>${reset ? 'Сохранить пароль' : 'Подтвердить email'}</button></form>`, `document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const b=document.querySelector('button');b.disabled=true;try{const r=await fetch('${reset ? '/auth/reset' : '/auth/verify'}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)}${reset ? ",password:document.getElementById('password').value" : ''}})});const v=await r.json();document.getElementById('result').textContent=v.message||'Попробуйте позже.';if(r.ok){history.replaceState(null,'',location.pathname);document.getElementById('f').remove()}}catch{document.getElementById('result').textContent='Ошибка соединения.'}finally{b.disabled=false}});`);
    }
    if (method === 'POST' && p.startsWith('/auth/')) {
      limit('auth-ip:' + ip, 40, 15 * 60000);
      const b = await readBody(req);
      if (['/auth/register', '/auth/login', '/auth/resend', '/auth/forgot'].includes(p)) {
        const address = normalizedEmail(b); limit('email:' + hash(address), 15, 15 * 60000);
        const user = get('SELECT * FROM users WHERE email=?', address);
        if (p === '/auth/register') {
          try { password(b.password); } catch { fail(400, 'Пароль: минимум 12 символов, максимум 128 байт.'); }
          if (!sendMail) fail(503, 'Почтовая отправка ещё не настроена администратором.');
          if (user) return json(res, 200, generic);
          const encoded = await encodePassword(b.password), id = crypto.randomUUID();
          // A unique database constraint also protects concurrent registrations.
          try { run('INSERT INTO users(id,email,password,created) VALUES(?,?,?,?)', id, address, encoded, now()); }
          catch (e) { if (String(e.code).includes('CONSTRAINT')) return json(res, 200, generic); throw e; }
          await mailToken(get('SELECT * FROM users WHERE id=?', id), 'verify');
          return json(res, 200, generic);
        }
        if (p === '/auth/login') {
          const valid = await checkPassword(b.password, user?.password);
          if (!user || !valid) fail(401, 'Неверный email или пароль.');
          if (!user.verified) fail(403, 'Подтвердите email. При необходимости запросите новое письмо.');
          return json(res, 200, tx(() => issue(user)));
        }
        if (user && (p === '/auth/forgot' || !user.verified)) await mailToken(user, p === '/auth/forgot' ? 'reset' : 'verify');
        return json(res, 200, generic);
      }
      if (p === '/auth/verify' || p === '/auth/reset') {
        if (!validToken(b.token)) fail(400, 'Ссылка недействительна.');
        const kind = p === '/auth/verify' ? 'verify' : 'reset';
        const tokenHash = hash(b.token);
        const found = get('SELECT * FROM email_tokens WHERE hash=? AND kind=? AND expires>?', tokenHash, kind, now());
        if (!found) fail(400, 'Ссылка недействительна или срок её действия истёк.');
        let encoded = null;
        if (kind === 'reset') { try { password(b.password); } catch { fail(400, 'Пароль: минимум 12 символов, максимум 128 байт.'); } encoded = await encodePassword(b.password); }
        tx(() => {
          if (!get('SELECT hash FROM email_tokens WHERE hash=? AND expires>?', tokenHash, now())) fail(400, 'Ссылка уже использована.');
          if (kind === 'reset') { run('UPDATE users SET password=?,verified=1 WHERE id=?', encoded, found.user_id); revokeUser(found.user_id); }
          else run('UPDATE users SET verified=1 WHERE id=?', found.user_id);
          run('DELETE FROM email_tokens WHERE user_id=? AND kind=?', found.user_id, kind);
        });
        return json(res, 200, { message: kind === 'reset' ? 'Пароль изменён. Войдите в приложение заново.' : 'Email подтверждён. Теперь можно войти в приложение.' });
      }
      if (p === '/auth/refresh') {
        if (!validToken(b.refreshToken)) fail(401, 'Требуется повторный вход.');
        const token = get('SELECT * FROM refresh_tokens WHERE hash=? AND expires>?', hash(b.refreshToken), now());
        if (!token) fail(401, 'Требуется повторный вход.');
        if (token.used) { tx(() => revokeFamily(token.family)); fail(401, 'Сессия отозвана. Войдите заново.'); }
        const result = tx(() => {
          const updated = run('UPDATE refresh_tokens SET used=1 WHERE hash=? AND used=0', token.hash);
          if (!updated.changes) fail(401, 'Требуется повторный вход.');
          run('DELETE FROM access_tokens WHERE family=?', token.family);
          return issue(get('SELECT * FROM users WHERE id=?', token.user_id), token.family);
        });
        return json(res, 200, result);
      }
      if (p === '/auth/logout') {
        const auth = authenticate(req); tx(() => revokeFamily(auth.family)); return json(res, 200, { message: 'Вы вышли из аккаунта.' });
      }
      fail(404, 'Маршрут не найден.');
    }
    if (method === 'GET' && p === '/auth/me') return json(res, 200, { user: publicUser(authenticate(req).user) });
    if (method === 'POST' && p === '/steam/link/start') {
      const auth = authenticate(req); await readBody(req);
      limit('steam-start:' + auth.user_id, 5, 10 * 60000);
      const browser = random(), poll = random(), id = crypto.randomUUID();
      tx(() => { run('DELETE FROM steam_tickets WHERE user_id=?', auth.user_id); run('INSERT INTO steam_tickets(id,browser_hash,poll_hash,user_id,family,expires) VALUES(?,?,?,?,?,?)', id, hash(browser), hash(poll), auth.user_id, auth.family, now() + 5 * 60000); });
      return json(res, 200, { id, pollToken: poll, url: origin + '/steam/openid/start?ticket=' + browser });
    }
    if (method === 'GET' && p === '/steam/openid/start') {
      const token = url.searchParams.get('ticket');
      if (!validToken(token)) fail(400, 'Ссылка недействительна.');
      const ticket = get('SELECT * FROM steam_tickets WHERE browser_hash=? AND expires>? AND status=?', hash(token), now(), 'pending');
      if (!ticket || ticket.started) fail(400, 'Ссылка использована или истекла. Начните привязку заново.');
      run('UPDATE steam_tickets SET started=1 WHERE id=?', ticket.id);
      res.writeHead(302, { Location: loginURL(origin + '/steam/openid/callback?ticket=' + token, origin) }); return res.end();
    }
    if (method === 'GET' && p === '/steam/openid/callback') {
      const browser = url.searchParams.get('ticket');
      const ticket = validToken(browser) && get('SELECT * FROM steam_tickets WHERE browser_hash=? AND expires>? AND status=? AND started=1', hash(browser), now(), 'pending');
      if (!ticket) fail(400, 'Ссылка использована или истекла.');
      try {
        if (url.searchParams.get('openid.mode') === 'cancel') throw Error('Cancelled');
        const assertion = await verifySteam(url.searchParams, origin + '/steam/openid/callback?ticket=' + browser, now());
        tx(() => {
          if (!get('SELECT id FROM steam_tickets WHERE id=? AND expires>? AND status=?', ticket.id, now(), 'pending')) throw Error('Expired');
          const owner = get('SELECT id FROM users WHERE steam_id=?', assertion.steamId);
          if (owner && owner.id !== ticket.user_id) throw Error('Already linked');
          run('INSERT INTO steam_nonces(nonce,expires) VALUES(?,?)', assertion.nonce, now() + 10 * 60000);
          run('UPDATE users SET steam_id=?,steam_name=NULL,steam_avatar=NULL WHERE id=?', assertion.steamId, ticket.user_id);
          run('UPDATE steam_tickets SET status=? WHERE id=?', 'complete', ticket.id);
        });
        if (config.steamKey) {
          try { const profile = await apiSteam('profile', assertion.steamId, config.steamKey); run('UPDATE users SET steam_name=?,steam_avatar=? WHERE id=? AND steam_id=?', profile.name, profile.avatar, ticket.user_id, assertion.steamId); } catch {}
        }
        return html(res, 'Steam привязан', '<p>Вернитесь в VoidCore. Это окно можно закрыть.</p>');
      } catch {
        run('UPDATE steam_tickets SET status=?,error=? WHERE id=? AND status=?', 'failed', 'Привязка не завершена. Возможно, вход отменён, ссылка истекла или Steam уже связан с другим аккаунтом.', ticket.id, 'pending');
        return html(res, 'Привязка не завершена', '<p>Вернитесь в VoidCore и попробуйте ещё раз. Steam может быть уже связан с другим аккаунтом.</p>');
      }
    }
    if (method === 'POST' && p === '/steam/link/poll') {
      const auth = authenticate(req), b = await readBody(req);
      if (!validToken(b.pollToken) || typeof b.id !== 'string' || b.id.length > 40) fail(400, 'Некорректный запрос.');
      const ticket = get('SELECT * FROM steam_tickets WHERE id=? AND poll_hash=? AND user_id=? AND family=? AND expires>?', b.id, hash(b.pollToken), auth.user_id, auth.family, now());
      if (!ticket) fail(400, 'Привязка истекла. Начните заново.');
      return json(res, 200, { status: ticket.status, message: ticket.error, user: publicUser(auth.user) });
    }
    if (method === 'POST' && p === '/steam/unlink') {
      const auth = authenticate(req); await readBody(req);
      tx(() => { run('UPDATE users SET steam_id=NULL,steam_name=NULL,steam_avatar=NULL WHERE id=?', auth.user_id); run('DELETE FROM steam_tickets WHERE user_id=?', auth.user_id); });
      return json(res, 200, { user: publicUser(get('SELECT * FROM users WHERE id=?', auth.user_id)) });
    }
    if (method === 'GET' && p === '/steam/library') {
      const auth = authenticate(req); limit('library:' + auth.user_id, 10, 60000);
      if (!auth.user.steam_id) fail(409, 'Сначала привяжите Steam.');
      return json(res, 200, await apiSteam('library', auth.user.steam_id, config.steamKey));
    }
    fail(404, 'Маршрут не найден.');
  }
  const server = http.createServer((req, res) => {
    route(req, res).catch(error => {
      if (res.headersSent) return res.end();
      const status = Number.isInteger(error.status) ? error.status : 500;
      json(res, status, { message: error.status ? error.message : 'Ошибка сервера. Повторите позже.' });
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}
module.exports = { createApplication, publicUser };
