(() => {
  const api = window.voidCore.updates;
  const message = document.getElementById("updateMessage");
  const version = document.getElementById("updateAvailableVersion");
  const progress = document.getElementById("updateProgress");
  const check = document.getElementById("checkUpdateBtn");
  const download = document.getElementById("downloadUpdateBtn");
  const install = document.getElementById("installUpdateBtn");
  const notice = document.getElementById("updateNotice");
  if (!api || !message) return;
  let actionPending = false;
  let lastState = null;
  function render(state) {
    lastState = state;
    const confirmed = Boolean(state.availableVersion) && ["available", "downloading", "downloaded", "installing"].includes(state.status);
    const busy = actionPending || ["checking", "downloading", "installing"].includes(state.status);
    message.textContent = state.message;
    version.textContent = confirmed ? `Новая версия: ${state.availableVersion}` : "";
    check.disabled = busy || ["disabled", "downloaded"].includes(state.status);
    download.classList.toggle("hidden", !confirmed || state.status !== "available");
    download.disabled = busy;
    install.classList.toggle("hidden", state.status !== "downloaded");
    install.disabled = busy;
    progress.classList.toggle("hidden", state.status !== "downloading");
    progress.value = state.progress || 0;
    notice.classList.toggle("hidden", !confirmed || !["available", "downloaded"].includes(state.status));
    notice.textContent = state.status === "downloaded" ? "Обновление скачано. Открыть Settings" : "Доступно обновление. Открыть Settings";
  }
  async function action(method) {
    if (actionPending) return;
    actionPending = true;
    if (lastState) render(lastState);
    try { render(await api[method]()); }
    catch (error) { message.textContent = error.message; }
    finally { actionPending = false; if (lastState) render(lastState); }
  }
  check.addEventListener("click", () => action("check"));
  download.addEventListener("click", () => action("download"));
  install.addEventListener("click", () => {
    if (window.confirm("Установить обновление? VoidCore закроется и перезапустится. Перед этим закройте игру.")) action("install");
  });
  notice.addEventListener("click", () => document.querySelector('.nav-item[data-page="settings"]').click());
  let stateEventReceived = false;
  const unsubscribe = api.onState(state => { stateEventReceived = true; render(state); });
  api.getState().then(state => { if (!stateEventReceived) render(state); }).catch(error => { message.textContent = error.message; });
  window.addEventListener("unload", unsubscribe, { once: true });
})();
