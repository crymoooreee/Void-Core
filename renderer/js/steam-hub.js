(() => {
  const api = window.voidCore?.account, steam = window.voidCore?.steam;
  const page = document.getElementById('steamPage');
  if (!api || !steam || !page) return;
  const $ = id => document.getElementById(id);
  let state = null, busy = false, reading = false, historyPending = false, ticks = 0, lastMetrics = null, lastHistory = null;
  const visible = () => page.classList.contains('active') && !document.hidden && document.hasFocus();
  const number = (value, digits = 0) => Number.isFinite(value) && value > 0 ? value.toFixed(digits) : '—';
  function renderProfile(value) {
    if (value) state = value;
    if (!state) return;
    const user = state.user, profile = user?.steam;
    $('steamHubName').textContent = profile?.name || (profile ? vcT("Steam-профиль") : vcT("Steam не привязан"));
    $('steamHubID').textContent = profile ? `SteamID ${profile.id}` : user ? vcT("Привяжите Steam через официальный вход в браузере.") : vcT("Войдите в Account, затем привяжите Steam.");
    $('steamHubStatus').textContent = state.linking ? vcT("ПРИВЯЗКА…") : profile ? vcT("ПРИВЯЗАН") : vcT("НЕ ПРИВЯЗАН");
    $('steamHubStatus').className = 'badge ' + (profile ? 'accent' : 'neutral');
    $('steamHubMessage').textContent = vcMsg(state.message);
    const image = $('steamHubAvatar'); image.hidden = true; image.removeAttribute('src');
    try {
      const url = new URL(profile?.avatar);
      if (url.protocol === 'https:' && ['avatars.steamstatic.com','avatars.cloudflare.steamstatic.com','avatars.akamai.steamstatic.com'].includes(url.hostname)) { image.src = url.href; image.hidden = false; }
    } catch {}
    $('steamHubLink').disabled = busy || !user || Boolean(profile) || state.linking;
    $('steamHubUnlink').disabled = busy || !profile;
    $('steamHubProfile').disabled = busy || !profile;
    $('steamHubStop').disabled = busy || !state.linking;
    $('steamHubRefresh').disabled = busy || !user;
    $('steamHubOpen').disabled = busy;
  }
  async function action(fn) {
    if (busy) return; busy = true; renderProfile(); let error = null;
    try { const result = await fn(); if (result?.ok === false) error = vcMsg(result.message); }
    catch { error = vcT("Действие не выполнено. Проверьте соединение или установленный Steam."); }
    finally { busy = false; renderProfile(); if (error) $('steamHubMessage').textContent = error; }
  }
  function navigate(name) { document.querySelector(`.nav-item[data-page="${name}"]`)?.click(); }
  $('steamHubAccount').addEventListener('click', () => navigate('account'));
  $('steamHubSessions').addEventListener('click', () => navigate('sessions'));
  $('steamHubLink').addEventListener('click', () => { if (confirm(vcT("Открыть браузер и привязать Steam к вашему аккаунту VoidCore? Вводите пароль только на официальном сайте Steam."))) action(() => api.linkSteam()); });
  $('steamHubUnlink').addEventListener('click', () => { if (confirm(vcT("Отвязать Steam от аккаунта VoidCore?"))) action(() => api.unlinkSteam()); });
  $('steamHubStop').addEventListener('click', () => action(() => api.stopSteam()));
  $('steamHubRefresh').addEventListener('click', () => action(() => api.refresh()));
  $('steamHubProfile').addEventListener('click', () => action(() => api.openSteamProfile()));
  $('steamHubOpen').addEventListener('click', () => action(() => steam.open()));
  function renderMetrics(performance,fps) {
      const game = performance?.active ? performance.game : null;
      const fresh = game && fps?.running && !fps.stale && fps.pid === game.pid && Number.isFinite(fps.sampledAt) && Date.now() - fps.sampledAt <= 1500;
      $('steamHubGame').textContent = game?.name || vcT("Нет распознанной игры");
      $('steamHubCapture').textContent = fresh ? vcT("ЗАХВАТ КАДРОВ") : game ? vcT("ОЖИДАНИЕ КАДРОВ") : vcT("ОЖИДАНИЕ");
      $('steamHubCapture').className = 'badge ' + (fresh ? 'accent' : 'neutral');
      $('steamHubFPS').textContent = fresh ? number(fps.fps) : '—';
      $('steamHubFrameTime').textContent = fresh && Number.isFinite(fps.frameTime) && fps.frameTime > 0 ? vcMsg(`${number(fps.frameTime, 2)} ${vcT("мс")}`) : '—';
      $('steamHubOneLow').textContent = fresh ? number(fps.onePercentLow, 1) : '—';
      $('steamHubPointOneLow').textContent = fresh ? number(fps.pointOnePercentLow, 1) : '—';
      $('steamHubGameNote').textContent = game ? vcMsg(`${game.platform || vcT("Неизвестная платформа")} · PID ${game.pid}. Локальный детектор VoidCore, не статус игры из Steam. Low появляется после накопления кадров и относится к скользящему окну.`) : vcT("Метрики локальны и не берутся из Steam. Запустите поддерживаемую игру.");
  }
  async function refreshMetrics() {
    if (!visible() || reading) return; reading = true;
    try {
      const [performance, fps] = await Promise.all([window.voidCore.performance.get(), window.voidCore.fps.get()]);
      lastMetrics = [performance,fps]; renderMetrics(performance,fps);
    } catch {
      for (const id of ['steamHubFPS','steamHubFrameTime','steamHubOneLow','steamHubPointOneLow']) $(id).textContent = '—';
      $('steamHubGame').textContent = vcT("Мониторинг недоступен");
      $('steamHubCapture').textContent = vcT("НЕТ ДАННЫХ"); $('steamHubCapture').className = 'badge neutral';
    } finally { reading = false; }
  }
  function renderHistory(result) {
      const target = $('steamHubHistory'); target.replaceChildren();
      for (const item of result.items || []) {
        const row = document.createElement('article'); row.className = 'steam-hub-session';
        const info = document.createElement('div'), title = document.createElement('h3'), details = document.createElement('p'), fps = document.createElement('strong');
        title.textContent = item.game?.name || vcT("Игра");
        const minutes = Number.isFinite(item.durationMs) ? Math.floor(item.durationMs / 60000) : 0;
        details.textContent = vcMsg(`${Number.isFinite(item.startedAt) ? new Date(item.startedAt).toLocaleString(window.VoidCoreI18n.locale()) : '—'} · ${minutes} ${vcT("мин")} · ${{active:vcT("В процессе"),completed:vcT("Завершена"),interrupted:vcT("Прервана")}[item.status] || '—'}`);
        fps.textContent = `${number(item.averageSampledFps,1)} FPS`;
        info.append(title,details); row.append(info,fps); target.append(row);
      }
      $('steamHubHistoryMessage').textContent = result.error || (result.items?.length ? vcT("Показаны последние три сессии этого компьютера.") : vcT("Сессий пока нет. Запустите поддерживаемую игру с VoidCore."));
  }
  async function refreshHistory() {
    if (!visible() || historyPending) return; historyPending = true;
    try {
      const result = await window.voidCore.sessions.list({ limit: 3, offset: 0 });
      lastHistory = result; renderHistory(result);
    } catch { $('steamHubHistoryMessage').textContent = vcT("Не удалось прочитать локальную историю."); }
    finally { historyPending = false; }
  }
  function refresh() { refreshMetrics(); refreshHistory(); }
  document.addEventListener('voidcore:page-changed', event => { if (event.detail?.page === 'steam') refresh(); });
  document.addEventListener('visibilitychange', () => { if (visible()) refresh(); });
  window.addEventListener('focus', refresh);
  setInterval(() => { if (!visible()) return; refreshMetrics(); if (++ticks % 5 === 0) refreshHistory(); }, 2000);
  let notified = false;
  api.onState(value => { notified = true; renderProfile(value); });
  api.getState().then(value => { if (!notified) renderProfile(value); }).catch(() => { $('steamHubMessage').textContent = vcT("Сервис аккаунтов недоступен. Мониторинг и локальная история работают независимо."); });
  window.addEventListener('voidcore:language-changed',()=>{renderProfile();if(lastMetrics)renderMetrics(...lastMetrics);if(lastHistory)renderHistory(lastHistory);});
})();
