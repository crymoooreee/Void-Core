const si = require("systeminformation");
const { execFile } = require("child_process");
const os = require("os");


function clamp(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
}


function execFileAsync(file, args = []) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: 3000
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}


// NVIDIA

async function getNvidiaInfo() {

  if (Date.now() < nvidiaRetryAt) return null;
  const output = await execFileAsync(
    "nvidia-smi",
    [
      "--query-gpu=name,temperature.gpu,utilization.gpu,memory.total,memory.used,memory.free",
      "--format=csv,noheader,nounits"
    ]
  );


  if (!output) {
    nvidiaRetryAt = Date.now() + 60000;
    return null;
  }


  const line = output
    .split(/\r?\n/)
    .find(Boolean);


  if (!line) {
    return null;
  }


  const parts = line
    .split(",")
    .map((value) => value.trim());


  if (parts.length < 6) {
    return null;
  }


  const [
    name,
    temperature,
    usage,
    vramTotal,
    vramUsed,
    vramFree
  ] = parts;


  return {
    available: true,

    name,

    usage:
      Number.isFinite(Number(usage))
        ? Number(usage)
        : null,

    temperature:
      Number.isFinite(Number(temperature))
        ? Number(temperature)
        : null,

    vramTotal:
      Number.isFinite(Number(vramTotal))
        ? Number(vramTotal) / 1024
        : null,

    vramUsed:
      Number.isFinite(Number(vramUsed))
        ? Number(vramUsed) / 1024
        : null,

    vramFree:
      Number.isFinite(Number(vramFree))
        ? Number(vramFree) / 1024
        : null
  };
}

let cpuTempAt = 0;
let cachedCpuTemperature = null;
let nvidiaRetryAt = 0;

// CPU

async function getCpuInfo() {

  const load = await si.currentLoad();

  let temperature = cachedCpuTemperature;


  try {

    if (Date.now() - cpuTempAt >= 15000) {
      cpuTempAt = Date.now();
      const cpuTemp = await si.cpuTemperature();

      if (
        typeof cpuTemp.main === "number" &&
        cpuTemp.main > 0
      ) {
        cachedCpuTemperature = temperature = cpuTemp.main;
      }
    }

  } catch (error) {
    console.log(
      "systeminformation CPU temperature unavailable"
    );
  }


  return {
    usage: clamp(load.currentLoad),

    temperature
  };
}

// RAM

async function getMemoryInfo() {

  const mem = await si.mem();


  const total =
    mem.total / 1024 ** 3;

  const used =
    mem.used / 1024 ** 3;

  const available =
    mem.available / 1024 ** 3;


  return {
    total,
    used,
    available,
    usage:
      total > 0
        ? (used / total) * 100
        : null

  };
}

// GPU fallback

async function readSystemInfo() {

  const [
    cpu,
    memory
  ] = await Promise.all([

    getCpuInfo(),

    getMemoryInfo()

  ]);



  const nvidia =
    await getNvidiaInfo();


  let gpu;


  if (nvidia) {

    gpu = nvidia;

  } else {

    const graphics = await si.graphics();
    const controllers =
      graphics.controllers || [];


    const controller =
      controllers
        .filter(
          (item) =>
            (item.vram || 0) > 0
        )
        .sort(
          (a, b) =>
            (b.vram || 0) -
            (a.vram || 0)
        )[0]
      ||
      controllers[0];


    const vramTotal =
      controller?.vram
        ? controller.vram / 1024
        : null;


    const vramUsed =
      controller?.vramDynamic
        ? controller.vramDynamic / 1024
        : null;


    gpu = {

      available:
        Boolean(controller),

      name:
        controller?.name || null,

      usage:
        clamp(
          controller?.utilizationGpu
        ),

      temperature:
        controller?.temperatureGpu > 0
          ? controller.temperatureGpu
          : null,

      vramTotal,

      vramUsed,

      vramFree:
        vramTotal != null &&
          vramUsed != null
          ? vramTotal - vramUsed
          : null,

      vramUsage:
        vramTotal &&
          vramUsed != null
          ? (vramUsed / vramTotal) * 100
          : null

    };

  }


  return {

    timestamp: Date.now(),
    cpu,
    memory,
    gpu

  };

}


let cachedSystemInfo = null;
let cachedSystemInfoAt = 0;
let systemInfoPromise = null;

async function getSystemInfo() {
  const now = Date.now();
  if (cachedSystemInfo && now - cachedSystemInfoAt < 5000) {
    return cachedSystemInfo;
  }
  if (!systemInfoPromise) {
    systemInfoPromise = readSystemInfo()
      .then(result => {
        cachedSystemInfo = result;
        cachedSystemInfoAt = Date.now();
        return result;
      })
      .finally(() => { systemInfoPromise = null; });
  }
  return systemInfoPromise;
}

let computerProfilePromise = null;

async function getComputerProfile() {
  if (!computerProfilePromise) {
    computerProfilePromise = Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics(),
      si.osInfo()
    ]).then(([cpu, memory, graphics, operatingSystem]) => ({
      cpu: {
        manufacturer: cpu.manufacturer || null,
        brand: cpu.brand || null,
        physicalCores: cpu.physicalCores || null,
        cores: cpu.cores || null,
        speedGHz: cpu.speed || null
      },
      memory: {
        totalGB: memory.total / 1024 ** 3
      },
      gpus: (graphics.controllers || []).map(controller => ({
        name: controller.name || controller.model || null,
        vendor: controller.vendor || null,
        vramGB: controller.vram ? controller.vram / 1024 : null
      })),
      operatingSystem: {
        platform: operatingSystem.platform || null,
        distro: operatingSystem.distro || null,
        release: operatingSystem.release || null,
        arch: operatingSystem.arch || null
      }
    })).catch(error => {
      computerProfilePromise = null;
      console.warn("Computer profile unavailable:", error.message);
      return null;
    });
  }

  return computerProfilePromise;
}

module.exports = {
  getSystemInfo,
  getComputerProfile
};