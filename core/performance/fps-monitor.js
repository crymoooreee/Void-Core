const fs = require("fs");
const path = require("path");
const {
    spawn,
    execFileSync
} = require("child_process");

const HISTORY_LENGTH = 120;

const CSV_READ_RETRIES = 8;
const CSV_READ_RETRY_DELAY = 30;

let presentMonProcess = null;

let monitoredPid = null;
let csvPath = null;
let sessionName = null;

let frameHistory = [];

let lastResult = {
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

    frameCount: 0
};


// ============================================================
// PATHS
// ============================================================

function getProjectRoot() {
    return path.resolve(
        __dirname,
        "../.."
    );
}


function getPresentMonPath() {
    return path.join(
        getProjectRoot(),
        "tools",
        "presentmon",
        "PresentMon.exe"
    );
}


function getTempDirectory() {
    const dir = path.join(
        getProjectRoot(),
        "temp"
    );

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(
            dir,
            {
                recursive: true
            }
        );
    }

    return dir;
}


// ============================================================
// RESET
// ============================================================

function resetFPSData() {
    frameHistory = [];

    lastResult = {
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

        frameCount: 0
    };
}


// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


// ============================================================
// CSV LINE PARSER
// ============================================================

function parseCSVLine(line) {
    const result = [];

    let current = "";
    let insideQuotes = false;

    for (
        let i = 0;
        i < line.length;
        i++
    ) {
        const char = line[i];

        if (char === '"') {
            if (
                insideQuotes &&
                line[i + 1] === '"'
            ) {
                current += '"';
                i++;
            } else {
                insideQuotes =
                    !insideQuotes;
            }

            continue;
        }

        if (
            char === "," &&
            !insideQuotes
        ) {
            result.push(
                current.trim()
            );

            current = "";

            continue;
        }

        current += char;
    }

    result.push(
        current.trim()
    );

    return result;
}


// ============================================================
// NUMBER
// ============================================================

function parseNumber(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const text =
        String(value)
            .trim();

    if (
        !text ||
        text === "NA" ||
        text === "N/A" ||
        text === "null" ||
        text === "undefined"
    ) {
        return null;
    }

    const number =
        Number(text);

    if (
        !Number.isFinite(number)
    ) {
        return null;
    }

    return number;
}


// ============================================================
// ETW SESSION CLEANUP
// ============================================================

function getActiveVoidCoreSessions() {
    let output;

    try {
        output =
            execFileSync(
                "logman",
                [
                    "query",
                    "-ets"
                ],
                {
                    encoding: "utf8",
                    windowsHide: true
                }
            );
    } catch (error) {
        console.warn(
            "[FPS] Could not query ETW sessions:",
            error.message
        );

        return [];
    }


    const sessions = [];

    const lines =
        output.split(
            /\r?\n/
        );


    for (const line of lines) {
        const match =
            line.match(
                /^\s*(VoidCore_[^\s]+)\s+/i
            );

        if (match) {
            sessions.push(
                match[1]
            );
        }
    }


    return sessions;
}


function stopETWSession(name) {
    if (!name) {
        return;
    }

    try {
        execFileSync(
            "logman",
            [
                "stop",
                name,
                "-ets"
            ],
            {
                encoding: "utf8",
                windowsHide: true,
                stdio: [
                    "ignore",
                    "pipe",
                    "pipe"
                ]
            }
        );

        console.log(
            "[FPS] Stopped ETW session:",
            name
        );

    } catch {
        /*
            Сессия могла уже завершиться.
            В таком случае ничего делать не нужно.
        */
    }
}


function cleanupStaleVoidCoreSessions() {
    const sessions =
        getActiveVoidCoreSessions();


    if (
        sessions.length === 0
    ) {
        return;
    }


    console.log(
        "[FPS] Found stale VoidCore ETW sessions:",
        sessions
    );


    for (const session of sessions) {
        stopETWSession(
            session
        );
    }
}


// ============================================================
// STOP PRESENTMON
// ============================================================

function stopFPSMonitor() {
    const processToStop =
        presentMonProcess;

    const oldSession =
        sessionName;

    const oldCsv =
        csvPath;


    presentMonProcess = null;
    monitoredPid = null;
    sessionName = null;
    csvPath = null;


    if (processToStop) {
        console.log(
            "[FPS] Stopping PresentMon..."
        );

        try {
            processToStop.kill();
        } catch (error) {
            console.error(
                "[FPS] Failed to stop PresentMon:",
                error.message
            );
        }
    }


    /*
        На Windows kill() может не сразу
        освободить ETW session.

        Поэтому дополнительно пытаемся
        остановить session через logman.
    */

    if (oldSession) {
        stopETWSession(
            oldSession
        );
    }


    /*
        Удаляем CSV немного позже,
        чтобы PresentMon успел закрыть файл.
    */

    if (oldCsv) {
        setTimeout(
            () => {
                try {
                    if (
                        fs.existsSync(
                            oldCsv
                        )
                    ) {
                        fs.unlinkSync(
                            oldCsv
                        );

                        console.log(
                            "[FPS] Removed CSV:",
                            oldCsv
                        );
                    }
                } catch (error) {
                    console.warn(
                        "[FPS] Could not remove CSV:",
                        error.message
                    );
                }
            },
            500
        );
    }
}


// ============================================================
// START PRESENTMON
// ============================================================

function startFPSMonitor(pid) {
    pid = Number(pid);


    if (
        !Number.isInteger(pid) ||
        pid <= 0
    ) {
        console.error(
            "[FPS] Invalid PID:",
            pid
        );

        return false;
    }


    /*
        Уже мониторим этот PID.
    */

    if (
        presentMonProcess &&
        monitoredPid === pid
    ) {
        return true;
    }


    /*
        Останавливаем предыдущий монитор.
    */

    if (presentMonProcess) {
        stopFPSMonitor();
    }


    /*
        Чистим старые ETW-сессии от
        предыдущих запусков VoidCore.
    */

    cleanupStaleVoidCoreSessions();


    const presentMonPath =
        getPresentMonPath();


    if (
        !fs.existsSync(
            presentMonPath
        )
    ) {
        console.error(
            "[FPS] PresentMon not found:",
            presentMonPath
        );

        return false;
    }


    const tempDirectory =
        getTempDirectory();


    const timestamp =
        Date.now();


    sessionName =
        `VoidCore_${pid}_${timestamp}`;


    csvPath =
        path.join(
            tempDirectory,
            `presentmon_${pid}_${timestamp}.csv`
        );


    resetFPSData();


    console.log(
        "[FPS] Starting PresentMon for PID:",
        pid
    );

    console.log(
        "[FPS] PresentMon path:",
        presentMonPath
    );

    console.log(
        "[FPS] Session:",
        sessionName
    );

    console.log(
        "[FPS] CSV:",
        csvPath
    );


    const args = [
        "--process_id",
        String(pid),

        "--output_file",
        csvPath,

        "--v2_metrics",

        "--no_console_stats",

        "--terminate_on_proc_exit",

        "--session_name",
        sessionName,

        "--stop_existing_session"
    ];


    console.log(
        "[FPS] Arguments:",
        args
    );


    try {
        const child =
            spawn(
                presentMonPath,
                args,
                {
                    windowsHide: true,

                    stdio: [
                        "ignore",
                        "pipe",
                        "pipe"
                    ]
                }
            );


        presentMonProcess =
            child;

        monitoredPid =
            pid;


        child.stdout.setEncoding(
            "utf8"
        );

        child.stderr.setEncoding(
            "utf8"
        );


        child.stdout.on(
            "data",
            data => {
                const text =
                    data
                        .toString()
                        .trim();

                if (text) {
                    console.log(
                        "[PresentMon]",
                        text
                    );
                }
            }
        );


        child.stderr.on(
            "data",
            data => {
                const text =
                    data
                        .toString()
                        .trim();

                if (text) {
                    console.error(
                        "[PresentMon STDERR]",
                        text
                    );
                }
            }
        );


        child.on(
            "error",
            error => {
                console.error(
                    "[PresentMon ERROR]",
                    error.message
                );


                if (
                    presentMonProcess === child
                ) {
                    presentMonProcess =
                        null;
                }
            }
        );


        child.on(
            "exit",
            (code, signal) => {
                console.log(
                    "[PresentMon EXIT]",
                    {
                        code,
                        signal
                    }
                );


                if (
                    presentMonProcess === child
                ) {
                    presentMonProcess =
                        null;
                }


                /*
                    После завершения PresentMon
                    даём Windows немного времени
                    закрыть CSV и ETW.
                */

                if (
                    sessionName
                ) {
                    stopETWSession(
                        sessionName
                    );
                }
            }
        );


        console.log(
            "[FPS] PresentMon started"
        );


        return true;

    } catch (error) {
        console.error(
            "[FPS] Failed to start PresentMon:",
            error
        );


        presentMonProcess =
            null;

        monitoredPid =
            null;


        return false;
    }
}


// ============================================================
// READ CSV WITH RETRIES
// ============================================================

async function readCSVContent() {
    if (!csvPath) {
        return null;
    }


    if (
        !fs.existsSync(
            csvPath
        )
    ) {
        return null;
    }


    for (
        let attempt = 0;
        attempt < CSV_READ_RETRIES;
        attempt++
    ) {
        try {
            return fs.readFileSync(
                csvPath,
                "utf8"
            );

        } catch (error) {
            if (
                error.code !== "EBUSY" &&
                error.code !== "EPERM" &&
                error.code !== "EACCES"
            ) {
                console.error(
                    "[FPS] Failed to read CSV:",
                    error.message
                );

                return null;
            }


            if (
                attempt <
                CSV_READ_RETRIES - 1
            ) {
                await sleep(
                    CSV_READ_RETRY_DELAY
                );
            }
        }
    }


    return null;
}


// ============================================================
// PARSE PRESENTMON CSV
// ============================================================

function parseCSVContent(content) {
    if (
        !content ||
        !content.trim()
    ) {
        return [];
    }


    content =
        content.replace(
            /^\uFEFF/,
            ""
        );


    const lines =
        content.split(
            /\r?\n/
        );


    if (
        lines.length < 2
    ) {
        return [];
    }


    const header =
        parseCSVLine(
            lines[0]
        ).map(
            value =>
                String(value)
                    .trim()
        );


    const index = {};


    header.forEach(
        (name, i) => {
            index[name] = i;
        }
    );


    /*
        PresentMon 2.x v2 metrics
        должен содержать FrameTime.
    */

    if (
        index.FrameTime === undefined
    ) {
        console.error(
            "[FPS] PresentMon FrameTime column not found."
        );

        console.error(
            "[FPS] Headers:",
            header
        );

        return [];
    }


    const frames = [];


    for (
        let i = 1;
        i < lines.length;
        i++
    ) {
        const line =
            lines[i];


        if (
            !line ||
            !line.trim()
        ) {
            continue;
        }


        const values =
            parseCSVLine(
                line
            );


        /*
            Последняя строка может быть
            ещё не полностью записана.
        */

        if (
            values.length <=
            index.FrameTime
        ) {
            continue;
        }


        const frameTime =
            parseNumber(
                values[
                    index.FrameTime
                ]
            );


        if (
            frameTime === null ||
            frameTime <= 0
        ) {
            continue;
        }


        const getMetric =
            name => {
                const i =
                    index[name];

                if (
                    i === undefined ||
                    i >= values.length
                ) {
                    return null;
                }

                return parseNumber(
                    values[i]
                );
            };


        frames.push({
            frameTime,

            cpuBusy:
                getMetric(
                    "CPUBusy"
                ),

            cpuWait:
                getMetric(
                    "CPUWait"
                ),

            gpuLatency:
                getMetric(
                    "GPULatency"
                ),

            gpuTime:
                getMetric(
                    "GPUTime"
                ),

            gpuBusy:
                getMetric(
                    "GPUBusy"
                ),

            gpuWait:
                getMetric(
                    "GPUWait"
                ),

            displayLatency:
                getMetric(
                    "DisplayLatency"
                ),

            displayedTime:
                getMetric(
                    "DisplayedTime"
                )
        });
    }


    return frames;
}


// ============================================================
// READ CSV
// ============================================================

async function readCSV() {
    const content =
        await readCSVContent();


    if (!content) {
        return [];
    }


    return parseCSVContent(
        content
    );
}


// ============================================================
// FPS
// ============================================================

function calculateFPS(frames) {
    if (
        !frames ||
        frames.length === 0
    ) {
        return null;
    }


    const frameTimes =
        frames
            .map(
                frame =>
                    frame.frameTime
            )
            .filter(
                value =>
                    Number.isFinite(value) &&
                    value > 0
            );


    if (
        frameTimes.length === 0
    ) {
        return null;
    }


    const average =
        frameTimes.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
        frameTimes.length;


    if (
        average <= 0
    ) {
        return null;
    }


    return (
        1000 /
        average
    );
}


// ============================================================
// 1% LOW
// ============================================================

function calculateOnePercentLow(frames) {
    if (
        !frames ||
        frames.length < 10
    ) {
        return null;
    }


    const frameTimes =
        frames
            .map(
                frame =>
                    frame.frameTime
            )
            .filter(
                value =>
                    Number.isFinite(value) &&
                    value > 0
            );


    if (
        frameTimes.length < 10
    ) {
        return null;
    }


    const sorted =
        [...frameTimes]
            .sort(
                (a, b) =>
                    b - a
            );


    const count =
        Math.max(
            1,
            Math.ceil(
                sorted.length *
                0.01
            )
        );


    const slowFrames =
        sorted.slice(
            0,
            count
        );


    const average =
        slowFrames.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
        slowFrames.length;


    if (
        average <= 0
    ) {
        return null;
    }


    return (
        1000 /
        average
    );
}


// ============================================================
// LAST VALID METRIC
// ============================================================

function getLastValidMetric(
    frames,
    property
) {
    for (
        let i = frames.length - 1;
        i >= 0;
        i--
    ) {
        const value =
            frames[i][property];

        if (
            Number.isFinite(value)
        ) {
            return value;
        }
    }


    return null;
}


// ============================================================
// UPDATE
// ============================================================

async function updateFPSData() {
    const frames =
        await readCSV();


    /*
        CSV может быть временно заблокирован.
        В таком случае оставляем старые данные.
    */

    if (
        frames.length === 0
    ) {
        return lastResult;
    }


    frameHistory =
        frames.slice(
            -HISTORY_LENGTH
        );


    const recent =
        frameHistory.slice(
            -60
        );


    if (
        recent.length === 0
    ) {
        return lastResult;
    }


    const last =
        recent[
            recent.length - 1
        ];


    lastResult = {
        fps:
            calculateFPS(
                recent
            ),

        frameTime:
            last.frameTime,

        onePercentLow:
            calculateOnePercentLow(
                recent
            ),

        cpuBusy:
            getLastValidMetric(
                recent,
                "cpuBusy"
            ),

        cpuWait:
            getLastValidMetric(
                recent,
                "cpuWait"
            ),

        gpuLatency:
            getLastValidMetric(
                recent,
                "gpuLatency"
            ),

        gpuTime:
            getLastValidMetric(
                recent,
                "gpuTime"
            ),

        gpuBusy:
            getLastValidMetric(
                recent,
                "gpuBusy"
            ),

        gpuWait:
            getLastValidMetric(
                recent,
                "gpuWait"
            ),

        displayLatency:
            getLastValidMetric(
                recent,
                "displayLatency"
            ),

        displayedTime:
            getLastValidMetric(
                recent,
                "displayedTime"
            ),

        frameCount:
            frames.length
    };


    return lastResult;
}


// ============================================================
// GET DATA
// ============================================================

function getFPSData() {
    return updateFPSData();
}


// ============================================================
// STATUS
// ============================================================

function getFPSMonitorStatus() {
    let csvExists = false;
    let csvSize = 0;


    if (csvPath) {
        try {
            csvExists =
                fs.existsSync(
                    csvPath
                );


            if (csvExists) {
                csvSize =
                    fs.statSync(
                        csvPath
                    ).size;
            }

        } catch {
            csvExists = false;
        }
    }


    return {
        running:
            !!presentMonProcess,

        pid:
            monitoredPid,

        csvPath,

        sessionName,

        csvExists,

        csvSize,

        frameHistoryLength:
            frameHistory.length,

        data:
            lastResult
    };
}


// ============================================================
// PROCESS CLEANUP
// ============================================================

function cleanupOnExit() {
    if (
        presentMonProcess ||
        sessionName
    ) {
        stopFPSMonitor();
    }
}


process.on(
    "exit",
    cleanupOnExit
);


process.on(
    "SIGINT",
    () => {
        cleanupOnExit();

        process.exit(0);
    }
);


process.on(
    "SIGTERM",
    () => {
        cleanupOnExit();

        process.exit(0);
    }
);


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    startFPSMonitor,
    stopFPSMonitor,
    getFPSData,
    getFPSMonitorStatus
};