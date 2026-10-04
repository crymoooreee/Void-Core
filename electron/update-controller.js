// Stable versions only; build metadata does not make a release newer.
function stableVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  return match ? match.slice(1, 4).map(BigInt) : null;
}
function isNewerStableVersion(candidate, current) {
  const next = stableVersion(candidate);
  const installed = stableVersion(current);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] > installed[i]) return true;
    if (next[i] < installed[i]) return false;
  }
  return false;
}
function publicUpdateError(error) {
  if (error?.code === 'GAME_RUNNING') return 'Закройте игру перед проверкой, скачиванием или установкой обновления.';
  const text = String(error?.message || '');
  if (/latest\.yml|channel.*file|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|sha512|checksum|signature|publisher/i.test(text)) {
    return 'Файлы обновления отсутствуют или не прошли проверку. Проверьте latest.yml, установщик и подпись релиза.';
  }
  if (/latest version on GitHub|production release|releases feed|HttpError:\s*(404|406)|status(?:Code)?[^0-9]*(404|406)/i.test(text)) {
    return 'Не удалось получить стабильный релиз GitHub. Проверьте, что Release опубликован без Draft и Pre-release. Если он уже опубликован, повторите проверку позже.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONN|network|timeout|ERR_INTERNET/i.test(text)) {
    return 'Не удалось подключиться к серверу обновлений. Проверьте интернет и повторите попытку.';
  }
  if (/403|429|rate.?limit/i.test(text)) {
    return 'GitHub временно ограничил запросы. Повторите проверку позже.';
  }
  return 'Не удалось проверить или скачать обновление. Повторите попытку и проверьте настройки релиза.';
}

// Windows NSIS updater. External dependency is installed by npm run setup:updates.
function createUpdateController({ app, ipcMain, getRunningGames, notify, loadUpdater, createToken }) {
  let updater = null;
  let checking = null;
  let downloading = null;
  let token = null;
  let automaticTimer = null;
  let disposed = false;
  let downloadInterrupted = false;
  let state = { status: 'idle', currentVersion: app.getVersion(), availableVersion: null,
    progress: 0, message: 'Обновления проверяются через GitHub Releases.' };
  const snapshot = () => ({ ...state });
  function setState(patch) {
    state = { ...state, ...patch };
    if (!disposed) notify(snapshot());
    return snapshot();
  }
  async function assertNoGame() {
    // Caller supplies a fresh query, not a five-second UI cache.
    const games = await getRunningGames();
    if (games.length) {
      const error = new Error('Game is running');
      error.code = 'GAME_RUNNING';
      throw error;
    }
  }
  function init() {
    if (!app.isPackaged || process.platform !== 'win32') {
      setState({ status: 'disabled', message: 'Обновления доступны в установленной Windows-версии.' });
      return false;
    }
    try {
      updater = loadUpdater();
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      // Repository is fixed: the renderer cannot choose download URLs.
      updater.setFeedURL({ provider: 'github', owner: 'crymoooreee', repo: 'Void-Core', private: false });
      updater.on('update-available', info => {
        if (disposed) return;
        if (!isNewerStableVersion(info?.version, state.currentVersion)) {
          setState({status:'up-to-date', availableVersion:null, progress:0,
            message:'Более новая стабильная версия не найдена.'});
          return;
        }
        setState({status:'available', availableVersion:info.version, progress:0,
          message:`Доступна версия ${info.version}. Скачивание только по вашему запросу.`});
      });
      updater.on('update-not-available', () => setState({status:'up-to-date', availableVersion:null,
        message:'Установлена актуальная версия.'}));
      updater.on('download-progress', progress => {
        if (!downloadInterrupted) setState({status:'downloading', progress:Math.max(0,Math.min(100,Number(progress.percent)||0)),
          message:'Скачивание обновления…'});
      });
      updater.on('update-downloaded', info => {
        if (!downloadInterrupted && !disposed && token && info.version === state.availableVersion &&
            isNewerStableVersion(info.version, state.currentVersion)) {
          setState({status:'downloaded', availableVersion:info.version, progress:100,
            message:'Обновление скачано. Установка и перезапуск — только по вашему запросу.'});
        }
      });
      updater.on('error', error => {
        if (!downloadInterrupted && !disposed) setState({status:'error', availableVersion:null, progress:0,
          message:publicUpdateError(error)});
      });
      return true;
    } catch (error) {
      setState({status:'disabled', message:'Компонент обновлений отсутствует или не настроен. Нужна новая сборка приложения.'});
      console.warn('[Updates] Updater initialization failed');
      return false;
    }
  }
  async function check() {
    if (!updater || disposed || downloading || state.status === 'downloaded') return snapshot();
    if (checking) return checking;
    checking = (async () => {
      try {
        await assertNoGame();
        setState({status:'checking',availableVersion:null,progress:0,message:'Проверка GitHub Releases…'});
        await updater.checkForUpdates();
      } catch (error) {
        setState({status:error?.code === 'GAME_RUNNING' ? 'idle' : 'error', availableVersion:null, progress:0, message:publicUpdateError(error)});
      }
      return snapshot();
    })().finally(() => { checking = null; });
    return checking;
  }
  async function download() {
    if (!updater || disposed || downloading || checking || state.status !== 'available' || !isNewerStableVersion(state.availableVersion, state.currentVersion)) return snapshot();
    downloading = (async () => {
      const candidate = state.availableVersion;
      try {
        await assertNoGame();
        downloadInterrupted = false;
        token = createToken();
        setState({status:'downloading',progress:0,message:'Скачивание обновления…'});
        await updater.downloadUpdate(token);
      } catch (error) {
        const retry = downloadInterrupted || error?.code === 'GAME_RUNNING';
        setState({status:retry?'available':'error', availableVersion:retry?candidate:null, progress:0,
          message:downloadInterrupted?'Скачивание отменено: запущена игра. Повторите после её закрытия.':publicUpdateError(error)});
      } finally { token = null; }
      return snapshot();
    })().finally(() => { downloading = null; });
    return downloading;
  }
  async function install() {
    if (!updater || disposed || state.status !== 'downloaded' || !isNewerStableVersion(state.availableVersion, state.currentVersion)) return snapshot();
    try {
      await assertNoGame();
      setState({status:'installing',message:'Установка обновления и перезапуск…'});
      updater.quitAndInstall(false, true);
    } catch (error) { setState({status:'downloaded',message:publicUpdateError(error)}); }
    return snapshot();
  }
  function onGameActivity(active) {
    if (active && token && !downloadInterrupted) {
      downloadInterrupted = true;
      token.cancel();
      setState({status:'available',progress:0,message:'Скачивание отменяется: запущена игра.'});
    }
  }
  function register() {
    // Only commands are exposed, never arbitrary URLs or installer paths.
    for (const [name, handler] of Object.entries({state:snapshot,check,download,install})) {
      ipcMain.handle(`updates:${name}`, handler);
    }
  }
  function start() {
    register();
    if (init()) {
      automaticTimer = setTimeout(() => { check(); }, 15000);
      automaticTimer.unref?.();
    }
  }
  function dispose() {
    disposed = true;
    clearTimeout(automaticTimer);
    token?.cancel();
  }
  return { start, check, download, install, snapshot, onGameActivity, dispose };
}
module.exports = { createUpdateController, isNewerStableVersion, publicUpdateError };
