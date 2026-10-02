const si = require("systeminformation");

const HISTORY_LENGTH = 30;

let history = [];
let lastSample = null;

function findActiveGame(processes) {
    for (const runningProcess of processes) {
        const processName = String(runningProcess.name || "").toLowerCase();
        const game = GAMES.find(item =>
            item.executables.some(executable => executable.toLowerCase() === processName)
        );

        if (game) {
            return {
                name: game.name,
                platform: game.platform,
                image: game.image,
                pid: runningProcess.pid,
                cpu: runningProcess.cpu,
                memory: runningProcess.mem
            };
        }
    }

    return null;
}

function toSample(game, fpsData, hardware) {
    const ramUsed = hardware.memory?.used;
    const ramTotal = hardware.memory?.total;
    const vramUsed = hardware.gpu?.vramUsed;
    const vramTotal = hardware.gpu?.vramTotal;

    return {
        timestamp: Date.now(),
        game: {
            name: game.name,
            pid: game.pid,
            cpu: game.cpu,
            memory: game.memory
        },
        fps: fpsData?.fps ?? null,
        frameTime: fpsData?.frameTime ?? null,
        onePercentLow: fpsData?.onePercentLow ?? null,
        capture: {
            running: fpsData?.running ?? false,
            stale: fpsData?.stale ?? false,
            sampledAt: fpsData?.sampledAt ?? null
        },
        cpu: {
            usage: hardware.cpu?.usage ?? null,
            temperature: hardware.cpu?.temperature ?? null
        },
        gpu: {
            usage: hardware.gpu?.usage ?? null,
            temperature: hardware.gpu?.temperature ?? null,
            name: hardware.gpu?.name ?? null
        },
        ram: {
            used: ramUsed,
            total: ramTotal,
            usage: hardware.memory?.usage ?? null
        },
        vram: {
            used: vramUsed,
            total: vramTotal,
            usage: hardware.gpu?.vramUsage ?? (
                vramTotal > 0 && Number.isFinite(vramUsed)
                    ? (vramUsed / vramTotal) * 100
                    : null
            )
        }
    };
}

async function ensureFPSMonitor(game) {
    if (!game || monitoredGamePid === game.pid) return;

    if (monitoredGamePid !== null) {
        stopFPSMonitor();
    }

    const started = startFPSMonitor(game.pid);
    if (!started) {
        monitoredGamePid = null;
        throw new Error("PresentMon could not be started");
    }

    monitoredGamePid = game.pid;
}

async function collectPerformance() {
    const processes = await getProcessSnapshot();
    const game = findActiveGame(processes);

    if (!game) {
        if (monitoredGamePid !== null) {
            stopFPSMonitor();
            monitoredGamePid = null;
        }

        lastSample = null;
        return {
            active: false,
            game: null,
            sample: null,
            history,
            diagnostic: null,
            diagnostics: getDiagnosticEvents(),
            suppressedEvents: getSuppressedEvents()
        };
    }

    try {
        await ensureFPSMonitor(game);
    } catch (error) {
        console.error("[Performance] FPS monitor:", error.message);
    }

    const [hardware, profile] = await Promise.all([
        getSystemInfo(),
        getComputerProfile()
    ]);
    const fpsData = getFPSData();
    const sample = toSample(game, fpsData, hardware);

    const diagnostic = await inspectSample({
        sample,
        history,
        processes,
        profile,
        windowStateProvider: getGameWindowState
    });

    history.push(sample);
    if (history.length > HISTORY_LENGTH) {
        history.shift();
    }

    lastSample = sample;

    return {
        active: true,
        game,
        sample,
        history,
        diagnostic,
        diagnostics: getDiagnosticEvents(),
        suppressedEvents: getSuppressedEvents()
    };
}

function getPerformanceHistory() {
    return history;
}

function getLastPerformanceSample() {
    return lastSample;
}

function resetPerformanceHistory() {
    history = [];
    lastSample = null;
    resetDiagnostics();
}

module.exports = {
    collectPerformance,
    getPerformanceHistory,
    getLastPerformanceSample,
    getDiagnosticEvents,
    resetPerformanceHistory
};
