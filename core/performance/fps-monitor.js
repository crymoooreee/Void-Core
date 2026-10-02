const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const os = require("os");

const HISTORY_LENGTH = 1200;
const LIVE_WINDOW_MS = 500;
const MAX_VALID_FRAME_TIME_MS = 1000;
const RESULT_UPDATE_INTERVAL_MS = 250;
const LOW_UPDATE_INTERVAL_MS = 1000;
const HISTORY_TRIM_THRESHOLD = HISTORY_LENGTH + 300;

let presentMonProcess = null;
let monitoredPid = null;
let sessionName = null;
let stdoutBuffer = "";
let columnIndex = null;
let frameHistory = [];
let totalFrameCount = 0;
let lastError = null;
let lastResult = createEmptyResult();
let lastFrameAt = null;
let calculatedFrameCount = 0;
let lastResultUpdateAt = 0;
let lastLowUpdateAt = 0;
let cachedOnePercentLow = null;

function createEmptyResult() {
    return {
        fps: null,
        frameTime: null,
        onePercentLow: null,
        cpuBusy: null,
        cpuWait: null,
        gpuLatency: null,
        gpuTime: null,
        gpuBusy: null,
        gpuWait: null,
        displayLatency: null,
        displayedTime: null,
        frameCount: 0,
        sampledAt: null,
        running: false,
        pid: null,
        error: null
    };
}

function resetFPSData() {
    stdoutBuffer = "";
    columnIndex = null;
    frameHistory = [];
    totalFrameCount = 0;
    lastError = null;
    lastResult = createEmptyResult();
    lastFrameAt = null;
    calculatedFrameCount = 0;
    lastResultUpdateAt = 0;
    lastLowUpdateAt = 0;
    cachedOnePercentLow = null;
}

function getProjectRoot() {
    return path.resolve(__dirname, "../..");
}

function getPresentMonPath() {
    const candidates = [
        process.resourcesPath
            ? path.join(process.resourcesPath, "tools", "presentmon", "PresentMon.exe")
            : null,
        path.join(getProjectRoot(), "tools", "presentmon", "PresentMon.exe")
    ].filter(Boolean);

    return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function parseCSVLine(line) {
    const result = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (insideQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
            continue;
        }

        if (char === "," && !insideQuotes) {
            result.push(current.trim());
            current = "";
            continue;
        }

        current += char;
    }

    result.push(current.trim());
    return result;
}

function parseNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const text = String(value).trim();
    if (!text || ["NA", "N/A", "null", "undefined"].includes(text)) {
        return null;
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
}

function createColumnIndex(headerLine) {
    const header = parseCSVLine(headerLine.replace(/^\uFEFF/, ""));
    const index = {};

    header.forEach((name, i) => {
        index[String(name).trim()] = i;
    });

    return index.FrameTime === undefined ? null : index;
}

function parseFrame(line) {
    if (!columnIndex) {
        return null;
    }

    const values = parseCSVLine(line);
    const getMetric = name => {
        const index = columnIndex[name];
        return index === undefined || index >= values.length
            ? null
            : parseNumber(values[index]);
    };

    const frameTime = getMetric("FrameTime");
    if (
        frameTime === null ||
        frameTime <= 0 ||
        frameTime > MAX_VALID_FRAME_TIME_MS
    ) {
        return null;
    }

    return {
        frameTime,
        cpuBusy: getMetric("CPUBusy"),
        cpuWait: getMetric("CPUWait"),
        gpuLatency: getMetric("GPULatency"),
        gpuTime: getMetric("GPUTime"),
        gpuBusy: getMetric("GPUBusy"),
        gpuWait: getMetric("GPUWait"),
        displayLatency: getMetric("DisplayLatency"),
        displayedTime: getMetric("DisplayedTime")
    };
}

function getRecentFramesByTime(frames, durationMs) {
    const recent = [];
    let elapsed = 0;

    for (let i = frames.length - 1; i >= 0; i--) {
        recent.unshift(frames[i]);
        elapsed += frames[i].frameTime;
        if (elapsed >= durationMs) {
            break;
        }
    }

    return recent;
}

function calculateFPS(frames) {
    if (!frames.length) {
        return null;
    }

    const totalTime = frames.reduce((sum, frame) => sum + frame.frameTime, 0);
    return totalTime > 0 ? (frames.length * 1000) / totalTime : null;
}

function calculateOnePercentLow(frames) {
    if (frames.length < 100) {
        return null;
    }

    const slowestCount = Math.max(1, Math.ceil(frames.length * 0.01));
    const slowest = frames
        .map(frame => frame.frameTime)
        .sort((a, b) => b - a)
        .slice(0, slowestCount);
    const average = slowest.reduce((sum, value) => sum + value, 0) / slowest.length;

    return average > 0 ? 1000 / average : null;
}

function getLastValidMetric(frames, property) {
    for (let i = frames.length - 1; i >= 0; i--) {
        const value = frames[i][property];
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}

function updateResult(now = Date.now()) {
    if (!frameHistory.length || calculatedFrameCount === totalFrameCount) return;

    const liveFrames = getRecentFramesByTime(frameHistory, LIVE_WINDOW_MS);
    const last = frameHistory[frameHistory.length - 1];

    if (now - lastLowUpdateAt >= LOW_UPDATE_INTERVAL_MS) {
        cachedOnePercentLow = calculateOnePercentLow(frameHistory);
        lastLowUpdateAt = now;
    }

    lastResult = {
        fps: calculateFPS(liveFrames),
        frameTime: last.frameTime,
        onePercentLow: cachedOnePercentLow,
        cpuBusy: getLastValidMetric(liveFrames, "cpuBusy"),
        cpuWait: getLastValidMetric(liveFrames, "cpuWait"),
        gpuLatency: getLastValidMetric(liveFrames, "gpuLatency"),
        gpuTime: getLastValidMetric(liveFrames, "gpuTime"),
        gpuBusy: getLastValidMetric(liveFrames, "gpuBusy"),
        gpuWait: getLastValidMetric(liveFrames, "gpuWait"),
        displayLatency: getLastValidMetric(liveFrames, "displayLatency"),
        displayedTime: getLastValidMetric(liveFrames, "displayedTime"),
        frameCount: totalFrameCount,
        sampledAt: lastFrameAt,
        running: Boolean(presentMonProcess),
        pid: monitoredPid,
        error: lastError
    };
    calculatedFrameCount = totalFrameCount;
    lastResultUpdateAt = now;
}

function processPresentMonLine(rawLine) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line) {
        return;
    }

    if (line.replace(/^\uFEFF/, "").startsWith("Application,") && line.includes("FrameTime")) {
        columnIndex = createColumnIndex(line);
        if (!columnIndex) {
            lastError = "PresentMon output does not contain FrameTime";
        }
        return;
    }

    const frame = parseFrame(line);
    if (!frame) {
        return;
    }

    frameHistory.push(frame);
    totalFrameCount++;
    lastFrameAt = Date.now();

    if (frameHistory.length > HISTORY_TRIM_THRESHOLD) {
        frameHistory = frameHistory.slice(-HISTORY_LENGTH);
    }
}

function consumePresentMonOutput(chunk) {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\n/);
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
        processPresentMonLine(line);
    }

    const now = Date.now();
    if (lines.length && now - lastResultUpdateAt >= RESULT_UPDATE_INTERVAL_MS) {
        updateResult(now);
    }
}

function getActiveVoidCoreSessions() {
    try {
        const output = execFileSync("logman", ["query", "-ets"], {
            encoding: "utf8",
            windowsHide: true
        });

        return output
            .split(/\r?\n/)
            .map(line => line.match(/^\s*(VoidCore_[^\s]+)\s+/i)?.[1])
            .filter(Boolean);
    } catch (error) {
        console.warn("[FPS] Could not query ETW sessions:", error.message);
        return [];
    }
}

function stopETWSession(name) {
    if (!name) {
        return;
    }

    try {
        execFileSync("logman", ["stop", name, "-ets"], {
            encoding: "utf8",
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
    } catch {
    }
}

function cleanupStaleVoidCoreSessions() {
    for (const session of getActiveVoidCoreSessions()) {
        stopETWSession(session);
    }
}

function stopFPSMonitor() {
    const processToStop = presentMonProcess;
    const oldSession = sessionName;

    presentMonProcess = null;
    monitoredPid = null;
    sessionName = null;

    if (processToStop) {
        try {
            processToStop.kill();
        } catch (error) {
            console.warn("[FPS] Failed to stop PresentMon:", error.message);
        }
    }

    stopETWSession(oldSession);
    lastResult = {
        ...lastResult,
        running: false,
        pid: null
    };

    return true;
}

function startFPSMonitor(pid) {
    const parsedPid = Number(pid);
    if (!Number.isInteger(parsedPid) || parsedPid <= 0) {
        lastError = `Invalid PID: ${pid}`;
        return false;
    }

    if (presentMonProcess && monitoredPid === parsedPid) {
        return true;
    }

    if (presentMonProcess) {
        stopFPSMonitor();
    }

    cleanupStaleVoidCoreSessions();

    const presentMonPath = getPresentMonPath();
    if (!presentMonPath || !fs.existsSync(presentMonPath)) {
        lastError = `PresentMon not found: ${presentMonPath || "unknown path"}`;
        console.error("[FPS]", lastError);
        return false;
    }

    resetFPSData();
    monitoredPid = parsedPid;
    sessionName = `VoidCore_${parsedPid}_${Date.now()}`;
    const childSession = sessionName;

    const args = [
        "--process_id", String(parsedPid),
        "--output_stdout",
        "--v2_metrics",
        "--no_console_stats",
        "--terminate_on_proc_exit",
        "--session_name", sessionName
    ];

    try {
        const child = spawn(presentMonPath, args, {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });

        presentMonProcess = child;

        try {
            os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
        } catch (error) {
            console.warn("[FPS] Could not lower PresentMon priority:", error.message);
        }

        lastResult = {
            ...lastResult,
            running: true,
            pid: parsedPid
        };

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", consumePresentMonOutput);
        child.stderr.on("data", data => {
            const text = String(data).trim();
            if (text) {
                lastError = text;
                console.error("[PresentMon]", text);
            }
        });

        child.on("error", error => {
            lastError = error.message;
            console.error("[PresentMon]", error.message);
            if (presentMonProcess === child) {
                presentMonProcess = null;
                lastResult = { ...lastResult, running: false, error: lastError };
            }
        });

        child.on("exit", (code, signal) => {
            if (stdoutBuffer) {
                processPresentMonLine(stdoutBuffer);
                stdoutBuffer = "";
            }

            if (presentMonProcess === child) {
                presentMonProcess = null;
                lastResult = {
                    ...lastResult,
                    running: false,
                    error: code && code !== 0
                        ? `PresentMon exited with code ${code}${signal ? ` (${signal})` : ""}`
                        : lastError
                };
            }

            stopETWSession(childSession);
        });

        console.log(`[FPS] Streaming PresentMon data for PID ${parsedPid}`);
        return true;
    } catch (error) {
        presentMonProcess = null;
        monitoredPid = null;
        lastError = error.message;
        lastResult = { ...lastResult, error: lastError };
        console.error("[FPS] Failed to start PresentMon:", error);
        return false;
    }
}

function getFPSData() {
    const now = Date.now();
    if (frameHistory.length && now - lastResultUpdateAt >= RESULT_UPDATE_INTERVAL_MS) {
        updateResult(now);
    }

    const isStale = Boolean(
        presentMonProcess &&
        lastResult.sampledAt &&
        Date.now() - lastResult.sampledAt > 1500
    );

    return {
        ...lastResult,
        fps: isStale ? 0 : lastResult.fps,
        frameTime: isStale ? null : lastResult.frameTime,
        running: Boolean(presentMonProcess),
        pid: monitoredPid,
        error: lastError,
        stale: isStale
    };
}

function getFPSMonitorStatus() {
    return {
        running: Boolean(presentMonProcess),
        pid: monitoredPid,
        sessionName,
        frameHistoryLength: frameHistory.length,
        frameCount: totalFrameCount,
        data: getFPSData()
    };
}

function cleanupOnExit() {
    if (presentMonProcess || sessionName) {
        stopFPSMonitor();
    }
}

process.on("exit", cleanupOnExit);
process.on("SIGINT", () => {
    cleanupOnExit();
    process.exit(0);
});
process.on("SIGTERM", () => {
    cleanupOnExit();
    process.exit(0);
});

module.exports = {
    startFPSMonitor,
    stopFPSMonitor,
    getFPSData,
    getFPSMonitorStatus,
    _test: {
        parseCSVLine,
        createColumnIndex,
        parseNumber,
        consumePresentMonOutput,
        resetFPSData
    }
};
