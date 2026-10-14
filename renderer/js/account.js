(() => {
  const api = window.voidCore?.account;
  if (!api) return;
  const $ = id => document.getElementById(id);
  let state = null, busy = false;
  function render(value) {
    if (value) state = value;
    if (!state) return;
    const user = state.user;
    $('accountMessage').textContent = vcMsg(state.message);
    $('accountForm').hidden = Boolean(user);
    $('accountProfile').hidden = !user;
    $('accountProfileEmail').textContent = user?.email || '';
    $('accountStorageHint').textContent = state.secureStorage ? vcT("Сессия сохраняется зашифрованной средствами ОС.") : vcT("Защищённое хранилище недоступно: сессия сохранится только до закрытия приложения.");
    for (const button of $('accountPage').querySelectorAll('button')) button.disabled = busy;
  }
  async function action(fn) {
    if (busy) return; busy = true; render();
    let message = null;
    try { const value = await fn(); if (value?.ok === false) message = vcMsg(value.message); }
    catch { message = vcT("Действие не выполнено. Проверьте подключение и настройку сервера."); }
    finally { busy = false; render(); if (message) $('accountMessage').textContent = message; }
  }
  const credentials = () => ({ email: $('accountEmail').value.trim(), password: $('accountPassword').value });
  $('accountForm').addEventListener('submit', event => { event.preventDefault(); action(async () => { try { await api.login(credentials()); } finally { $('accountPassword').value = ''; } }); });
  $('accountRegister').addEventListener('click', () => {
    if (!$('accountForm').reportValidity()) return;
    action(async () => { try { await api.register(credentials()); } finally { $('accountPassword').value = ''; } });
  });
  $('accountResend').addEventListener('click', () => action(() => api.resend({ email: $('accountEmail').value })));
  $('accountForgot').addEventListener('click', () => action(() => api.forgot({ email: $('accountEmail').value })));
  $('accountRefresh').addEventListener('click', () => action(() => api.refresh()));
  $('accountLogout').addEventListener('click', () => action(() => api.logout()));
  let changed = false;
  api.onState(value => { changed = true; render(value); });
  api.getState().then(value => { if (!changed) render(value); }).catch(() => { $('accountMessage').textContent = vcT("Сервис аккаунтов недоступен."); });
  window.addEventListener('voidcore:language-changed',()=>{render();});
})();
