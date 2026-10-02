const MAX_EVENTS = 50;
const BASELINE_SAMPLES = 12;
const MIN_BASELINE_SAMPLES = 5;
const DROP_RATIO = 0.72;
const MIN_DROP_FPS = 12;
const EVENT_COOLDOWN_MS = 8000;

let events = [];
let pendingDrop = null;
let lastEventAt = 0;
let suppressedEvents = [];
let lastSuppressedAt = 0;

function round(value, digits = 0) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getBaseline(history) {
    const valid = history
        .filter(item => Number.isFinite(item.fps) && item.fps > 0)
        .slice(-BASELINE_SAMPLES);

    if (valid.length < MIN_BASELINE_SAMPLES) return null;

    return {
        fps: median(valid.map(item => item.fps)),
        frameTime: median(valid.map(item => item.frameTime))
    };
}

function getTopProcesses(processes, gamePid) {
    return (processes || [])
        .filter(item => item.pid !== gamePid && item.pid !== process.pid)
        .filter(item => {
            const name = String(item.name || "")
                .replace(/[\[\]]/g, "")
                .trim()
                .toLowerCase();
            return item.pid !== 0 && name !== "system idle process" && name !== "idle";
        })
        .filter(item => Number(item.cpu) > 0.2 || Number(item.mem) > 0.2)
        .sort((a, b) => Number(b.cpu || 0) - Number(a.cpu || 0))
        .slice(0, 5)
        .map(item => ({
            name: item.name || "Unknown process",
            pid: item.pid,
            cpu: round(Number(item.cpu || 0), 1),
            memory: round(Number(item.mem || 0), 1)
        }));
}

function analyzeCauses(sample, processes) {
    const causes = [];
    const cpu = Number(sample.cpu?.usage);
    const cpuTemperature = Number(sample.cpu?.temperature);
    const gpu = Number(sample.gpu?.usage);
    const gpuTemperature = Number(sample.gpu?.temperature);
    const ramUsage = Number(sample.ram?.usage);
    const vramUsage = Number(sample.vram?.usage);
    const topProcesses = getTopProcesses(processes, sample.game?.pid);
    const heavyProcess = topProcesses.find(item => item.cpu >= 15 || item.memory >= 8);

    if (cpuTemperature >= 90 || gpuTemperature >= 85) {
        const part = gpuTemperature >= 85 ? "GPU" : "CPU";
        const temperature = gpuTemperature >= 85 ? gpuTemperature : cpuTemperature;
        causes.push({
            score: 100,
            code: "thermal",
            title: "Возможен перегрев и троттлинг",
            explanation: `${part} нагрелся до ${round(temperature)}°C. При высокой температуре частоты могут автоматически снижаться.`,
            recommendations: [
                "Проверьте работу вентиляторов и очистите систему охлаждения от пыли.",
                "Улучшите приток воздуха или настройте более агрессивную кривую вентиляторов.",
                "Проверьте частоты CPU/GPU во время следующего падения FPS."
            ]
        });
    }

    if (vramUsage >= 90) {
        causes.push({
            score: 95,
            code: "vram",
            title: "Заканчивается видеопамять",
            explanation: `Использовано ${round(vramUsage)}% VRAM. Подгрузка ресурсов из RAM может вызывать фризы.`,
            recommendations: [
                "Уменьшите качество текстур и дальность прорисовки.",
                "Отключите HD-текстуры и закройте приложения с аппаратным ускорением.",
                "Перезапустите игру, если видеопамять не освобождается после смены сцены."
            ]
        });
    }

    if (ramUsage >= 90) {
        causes.push({
            score: 90,
            code: "ram",
            title: "Высокая загрузка оперативной памяти",
            explanation: `Использовано ${round(ramUsage)}% RAM. Windows может обращаться к более медленному файлу подкачки.`,
            recommendations: [
                "Закройте браузер, лаунчеры и другие необязательные приложения.",
                "Оставьте файл подкачки включённым и освободите место на системном диске.",
                "Если проблема повторяется постоянно, рассмотрите увеличение объёма RAM."
            ]
        });
    }

    if (cpu >= 90 && gpu < 90) {
        causes.push({
            score: 85,
            code: "cpu",
            title: "Процессорная нагрузка ограничивает FPS",
            explanation: `CPU загружен на ${round(cpu)}%, а GPU — на ${round(gpu)}%. Игра может упираться в процессор.`,
            recommendations: [
                "Закройте фоновые процессы с высокой загрузкой CPU.",
                "Уменьшите настройки толпы, физики, теней и дальности прорисовки.",
                "Проверьте план электропитания Windows и частоты процессора."
            ]
        });
    }

    if (gpu >= 96) {
        causes.push({
            score: 80,
            code: "gpu",
            title: "Видеокарта работает на пределе",
            explanation: `Загрузка GPU достигла ${round(gpu)}%. FPS, вероятно, ограничен производительностью видеокарты.`,
            recommendations: [
                "Снизьте разрешение, качество теней, отражений и сглаживания.",
                "Включите DLSS, FSR или XeSS, если игра это поддерживает.",
                "Ограничьте FPS немного ниже среднего значения для более стабильного Frame Time."
            ]
        });
    }

    if (heavyProcess) {
        causes.push({
            score: 75,
            code: "background-process",
            title: `Фоновый процесс: ${heavyProcess.name}`,
            explanation: `${heavyProcess.name} использовал ${heavyProcess.cpu}% CPU и ${heavyProcess.memory}% RAM в момент просадки.`,
            recommendations: [
                `Закройте ${heavyProcess.name}, если процесс не нужен во время игры.`,
                "Отключите ненужные оверлеи, запись экрана и фоновые обновления.",
                "Не завершайте системные процессы Windows, если не уверены в их назначении."
            ]
        });
    }

    if (!causes.length) {
        causes.push({
            score: 40,
            code: "transient",
            title: "Кратковременная задержка игры",
            explanation: "В момент просадки не обнаружено критической загрузки CPU, GPU, RAM или VRAM. Возможна компиляция шейдеров, загрузка ресурсов или внутриигровая задержка.",
            recommendations: [
                "Обновите драйвер видеокарты и дождитесь завершения компиляции шейдеров.",
                "Проверьте целостность файлов игры и свободное место на диске.",
                "Сравните несколько событий: единичная просадка не всегда указывает на системную проблему."
            ]
        });
    }

    causes.sort((a, b) => b.score - a.score);
    return { primary: causes[0], alternatives: causes.slice(1, 3), topProcesses };
}

function createEvent(sample, baseline, processes, profile) {
    const analysis = analyzeCauses(sample, processes);
    const dropPercent = baseline.fps > 0
        ? ((baseline.fps - sample.fps) / baseline.fps) * 100
        : 0;

    return {
        id: `${sample.timestamp}-${sample.game?.pid || 0}`,
        timestamp: sample.timestamp,
        game: sample.game,
        beforeFps: round(baseline.fps),
        fps: round(sample.fps),
        dropPercent: round(dropPercent),
        frameTime: round(sample.frameTime, 1),
        severity: dropPercent >= 50 ? "critical" : dropPercent >= 35 ? "high" : "medium",
        cause: analysis.primary.code,
        title: analysis.primary.title,
        explanation: analysis.primary.explanation,
        confidence: analysis.primary.score,
        recommendations: analysis.primary.recommendations,
        alternatives: analysis.alternatives.map(item => ({
            cause: item.code,
            title: item.title,
            explanation: item.explanation
        })),
        metrics: {
            cpu: round(sample.cpu?.usage),
            cpuTemperature: round(sample.cpu?.temperature),
            gpu: round(sample.gpu?.usage),
            gpuTemperature: round(sample.gpu?.temperature),
            ram: round(sample.ram?.usage),
            vram: round(sample.vram?.usage)
        },
        topProcesses: analysis.topProcesses,
        computer: profile || null
    };
}

async function inspectSample({ sample, history, processes, profile, windowStateProvider }) {
    if (!sample || !Number.isFinite(sample.fps) || !sample.game) {
        pendingDrop = null;
        return null;
    }

    const baseline = getBaseline(history);
    if (!baseline || baseline.fps <= 0) return null;

    const fpsDifference = baseline.fps - sample.fps;
    const isDrop = sample.fps <= baseline.fps * DROP_RATIO && fpsDifference >= MIN_DROP_FPS;
    if (!isDrop) {
        pendingDrop = null;
        return null;
    }

    const suppress = (reason, title) => {
        pendingDrop = null;
        if (sample.timestamp - lastSuppressedAt > 3000) {
            suppressedEvents.unshift({ id: `${sample.timestamp}-${reason}`, timestamp: sample.timestamp, game: sample.game, reason, title, beforeFps: round(baseline.fps), fps: round(sample.fps) });
            suppressedEvents = suppressedEvents.slice(0, 30);
            lastSuppressedAt = sample.timestamp;
        }
        return null;
    };

    if (sample.capture?.stale || sample.capture?.running === false) {
        return suppress("capture-paused", "Нет свежих кадров от игры");
    }

    if (windowStateProvider) {
        const state = await windowStateProvider(sample.game.pid);
        if (state?.supported && state.isMinimized) {
            return suppress("game-minimized", "Игра свернута");
        }
        if (state?.supported && !state.isForeground) {
            return suppress("game-not-foreground", "Игра не находится в фокусе");
        }
        if (state?.supported && state.hasVisibleWindow === false) {
            return suppress("game-window-hidden", "Окно игры скрыто");
        }
    }

    const now = sample.timestamp;
    if (now - lastEventAt < EVENT_COOLDOWN_MS) return null;
    const severe = sample.fps <= baseline.fps * 0.5;
    if (!pendingDrop && !severe) {
        pendingDrop = { timestamp: now };
        return null;
    }
    if (pendingDrop && now - pendingDrop.timestamp > 3500) {
        pendingDrop = { timestamp: now };
        return null;
    }

    const event = createEvent(sample, baseline, processes, profile);
    events.unshift(event);
    events = events.slice(0, MAX_EVENTS);
    pendingDrop = null;
    lastEventAt = now;
    return event;
}

function getDiagnosticEvents() {
    return events.map(event => ({ ...event }));
}

function getSuppressedEvents() {
    return suppressedEvents.map(event => ({ ...event }));
}

function resetDiagnostics() {
    events = [];
    pendingDrop = null;
    lastEventAt = 0;
    suppressedEvents = [];
    lastSuppressedAt = 0;
}

module.exports = {
    inspectSample,
    getDiagnosticEvents,
    getSuppressedEvents,
    resetDiagnostics,
    _test: { getBaseline, analyzeCauses }
};
