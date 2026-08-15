const pages = {
  dashboard: document.getElementById("dashboardPage"),
  games: document.getElementById("gamesPage"),
  optimizer: document.getElementById("optimizerPage"),
  diagnostic: document.getElementById("diagnosticPage"),
  settings: document.getElementById("settingsPage")
};

const navItems = document.querySelectorAll(".nav-item[data-page]");

function showPage(pageName) {
  Object.values(pages).forEach((page) => page.classList.remove("active"));

  if (pages[pageName]) {
    pages[pageName].classList.add("active");
  }

  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageName);
  });
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    showPage(item.dataset.page);
  });
});

document.getElementById("minimizeBtn").addEventListener("click", () => {
  window.voidCore.window.minimize();
});

document.getElementById("maximizeBtn").addEventListener("click", async () => {
  const maximized = await window.voidCore.window.maximize();
  document.getElementById("maximizeBtn").textContent = maximized ? "❐" : "□";
});

document.getElementById("closeBtn").addEventListener("click", () => {
  window.voidCore.window.close();
});

document.getElementById("optimizeBtn").addEventListener("click", async () => {
  const button = document.getElementById("optimizeBtn");
  const result = document.getElementById("optimizeResult");

  button.disabled = true;
  button.innerHTML = "<span>⌁</span> Preparing...";

  const response = await window.voidCore.core.optimize();

  result.textContent = response.message;
  result.classList.remove("hidden");

  setTimeout(() => {
    button.disabled = false;
    button.innerHTML = "<span>⚡</span> Optimize PC";
  }, 800);
});

// VOIDCORE HARDWARE MONITOR

function formatNumber(value, decimals = 1) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return "--";
  }

  return value.toFixed(decimals);
}


function updateMetric(
  index,
  value,
  unit,
  label,
  footer
) {
  const cards =
    document.querySelectorAll(".metric-card");

  const card = cards[index];

  if (!card) {
    return;
  }

  const valueElement =
    card.querySelector(".metric-value");

  const footerLabel =
    card.querySelector(".metric-footer span");

  const footerValue =
    card.querySelector(".metric-footer strong");


  valueElement.innerHTML =
    `${value}<small>${unit}</small>`;

  footerLabel.textContent = label;

  footerValue.textContent = footer;
}


function updateHardwareUI(data) {
  if (!data || data.error) {
    return;
  }

  // CPU

  updateMetric(
    0,

    formatNumber(
      data.cpu.usage,
      0
    ),

    "%",

    "Temperature",

    data.cpu.temperature == null
      ? "--°C"
      : `${formatNumber(
          data.cpu.temperature,
          0
        )}°C`
  );

  // GPU

  updateMetric(
    1,

    formatNumber(
      data.gpu.usage,
      0
    ),

    "%",

    "Temperature",

    data.gpu.temperature == null
      ? "--°C"
      : `${formatNumber(
          data.gpu.temperature,
          0
        )}°C`
  );

  // RAM

  updateMetric(
    2,

    formatNumber(
      data.memory.used
    ),

    " GB",

    "Available",

    `${formatNumber(
      data.memory.available
    )} GB`
  );

  // VRAM

  let vramAvailable = "-- GB";


  if (
    data.gpu.vramTotal != null &&
    data.gpu.vramUsed != null
  ) {
    vramAvailable =
      `${formatNumber(
        data.gpu.vramTotal -
        data.gpu.vramUsed
      )} GB`;
  }


  updateMetric(
    3,

    formatNumber(
      data.gpu.vramUsed
    ),

    " GB",

    "Available",

    vramAvailable
  );
}


async function refreshHardware() {
  try {

    const data =
      await window.voidCore.monitor
        .getSystemInfo();

    updateHardwareUI(data);

  } catch (error) {

    console.error(
      "VoidCore Hardware Monitor:",
      error
    );

  }
}


refreshHardware();


// Обновление каждую секунду
setInterval(
  refreshHardware,
  1000
);