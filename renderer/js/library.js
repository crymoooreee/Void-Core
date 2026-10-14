(() => {
  const model = window.VoidCoreSteamLibrary;
  const account = window.voidCore?.account, steam = window.voidCore?.steam;
  if (!model || !account || !steam) return;
  const $ = id => document.getElementById(id);
  let local = [], remote = [], state = null, identity = '', epoch = 0, busy = false, queued = false, loaded = false, index = 1;
  const visible = () => $('gamesPage').classList.contains('active');
  const key = value => `${value?.user?.id || ''}:${value?.user?.steam?.id || ''}`;
  function message(text) { $('gamesLibraryMessage').textContent = text; }
  function placeholder(title) { const node = document.createElement('span'); node.className = 'library-cover-placeholder'; node.textContent = title.slice(0, 1).toUpperCase() || '◇'; return node; }
  function cover(game) {
    const wrapper = document.createElement('div'); wrapper.className = 'library-cover';
    const fallback = placeholder(game.name); wrapper.append(fallback);
    const image = document.createElement('img'); image.alt = `Обложка ${game.name}`; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    const sources = model.covers(game.appid); let attempt = 0;
    image.addEventListener('load', () => { fallback.hidden = true; });
    image.addEventListener('error', () => { if (++attempt < sources.length) { image.classList.add('library-cover-header'); image.src = sources[attempt]; } else { image.remove(); fallback.hidden = false; } });
    image.src = sources[0]; wrapper.append(image); return wrapper;
  }
  function render() {
    const games = model.merge(local, remote);
    const result = model.page(games, { query: $('gamesLibrarySearch').value, filter: $('gamesLibraryFilter').value, index }); index = result.index;
    $('gamesLibraryCount').textContent = `${games.length} игр · установлено ${games.filter(g => g.installed).length}`;
    $('gamesLibraryPage').textContent = `Страница ${index} из ${result.pages} · найдено ${result.total}`;
    $('gamesLibraryPrevious').disabled = index <= 1;
    $('gamesLibraryNext').disabled = index >= result.pages;
    $('gamesLibraryRefresh').disabled = busy;
    const target = $('gamesLibraryGrid'); target.replaceChildren();
    $('gamesLibraryEmpty').hidden = result.total > 0;
    $('gamesLibraryEmpty').textContent = games.length ? 'По вашему запросу игры не найдены.' : 'Нет доступных игр. Установите игру в Steam или привяжите аккаунт с открытой библиотекой.';
    for (const game of result.items) {
      const card = document.createElement('article'); card.className = 'library-card'; card.dataset.appid = String(game.appid); card.append(cover(game));
      const body = document.createElement('div'); body.className = 'library-card-body';
      const title = document.createElement('h2'); title.textContent = game.name; title.title = game.name; body.append(title);
      const status = document.createElement('span'); status.className = 'library-status' + (game.installed ? ' is-installed' : ''); status.textContent = game.installed ? 'Установлена' : 'Не найдена локально'; body.append(status);
      const time = document.createElement('p'); time.className = 'library-playtime'; time.textContent = game.owned ? `${(game.playtimeMinutes / 60).toFixed(1)} ч в Steam` : 'Локальная Steam-игра'; body.append(time);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn library-launch'; button.textContent = game.installed ? 'Запустить' : 'Не установлена'; button.disabled = !game.installed;
      button.addEventListener('click', async () => {
        if (!confirm(`Запустить ${game.name} через Steam?`)) return;
        button.disabled = true;
        try { await steam.launch(game.appid); message(`Steam получил команду запуска: ${game.name}.`); }
        catch { message('Не удалось запустить игру. Проверьте Steam и обновите список установленных игр.'); }
        finally { button.disabled = false; }
      });
      body.append(button); card.append(body); target.append(card);
    }
  }
  async function refresh() {
    if (busy) { queued = true; return; }
    busy = true; const generation = epoch, owner = identity; render(); message('Загрузка библиотеки Steam…');
    const linked = Boolean(state?.user?.steam);
    try {
      const [localResult, remoteResult] = await Promise.allSettled([steam.getLocalGames(), linked ? account.getSteamLibrary() : Promise.resolve(null)]);
      if (generation !== epoch || owner !== identity) return;
      const notes = [];
      if (localResult.status === 'fulfilled') { local = Array.isArray(localResult.value?.games) ? localResult.value.games : []; if (localResult.value?.message) notes.push(localResult.value.message); }
      else notes.push('Локальные игры не удалось обновить.');
      if (!linked) { remote = []; notes.push('Для онлайн-библиотеки войдите в VoidCore и привяжите Steam.'); }
      else if (remoteResult.status === 'fulfilled' && remoteResult.value?.ok) {
        remote = Array.isArray(remoteResult.value.games) ? remoteResult.value.games : [];
        notes.push(remoteResult.value.privateOrUnavailable ? 'Онлайн-библиотека закрыта или Steam не вернул данные; локальные игры доступны.' : 'Онлайн-библиотека Steam обновлена.');
      } else notes.push(remoteResult.status === 'fulfilled' ? remoteResult.value?.message || 'Онлайн-библиотека недоступна.' : 'Не удалось загрузить онлайн-библиотеку.');
      loaded = true; message(notes.join(' '));
    } finally {
      busy = false; render();
      if (queued && visible()) { queued = false; refresh(); }
    }
  }
  function applyState(value) {
    const next = key(value); const changed = next !== identity; state = value;
    if (changed) { identity = next; epoch++; remote = []; loaded = false; index = 1; render(); if (visible()) refresh(); }
  }
  $('gamesLibraryRefresh').addEventListener('click', refresh);
  $('gamesLibrarySearch').addEventListener('input', () => { index = 1; render(); });
  $('gamesLibraryFilter').addEventListener('change', () => { index = 1; render(); });
  $('gamesLibraryPrevious').addEventListener('click', () => { index--; render(); });
  $('gamesLibraryNext').addEventListener('click', () => { index++; render(); });
  document.addEventListener('voidcore:page-changed', event => { if (event.detail?.page === 'games' && !loaded) refresh(); });
  let notified = false;
  account.onState(value => { notified = true; applyState(value); });
  account.getState().then(value => { if (!notified) applyState(value); }).catch(() => message('Аккаунт недоступен; локальные Steam-игры можно обновить вручную.'));
  render();
})();
