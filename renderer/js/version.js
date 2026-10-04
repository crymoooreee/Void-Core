// One request at startup; no polling or additional monitoring overhead.
(async function displayAppVersion() {
  try {
    const info = await window.voidCore.app.getInfo();
    if (typeof info.version !== "string" || !info.version) {
      throw new Error("Application version is unavailable");
    }
    document.querySelectorAll("[data-app-version]").forEach(element => {
      element.textContent = info.version;
    });
    document.title = `VoidCore ${info.version}`;
  } catch (error) {
    document.querySelectorAll("[data-app-version]").forEach(element => {
      element.textContent = "unavailable";
    });
    console.error("[Version]", error.message);
  }
})();
