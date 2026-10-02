let performanceData = null;
let performanceRequestInFlight = false;
let fpsRequestInFlight = false;
let lastDiagnosticId = null;

let selectedMetric = "cpu";

// REFRESH

async function refreshPerformance() {
    if (document.hidden || !document.hasFocus()) return;

    if (performanceRequestInFlight) {
        return;
    }

    performanceRequestInFlight = true;

    try {

        const data =
            await window.voidCore.performance.get();

        performanceData = data;

        updatePerformanceUI(data);

        drawPerformanceChart(
            data.history || []
        );

<<<<<<< Updated upstream
=======
        renderDiagnostics(data.diagnostics || []);
        renderFalsePositives(data.suppressedEvents || []);
        showDiagnosticAlert(data.diagnostic || data.diagnostics?.[0]);


>>>>>>> Stashed changes
    } catch (error) {

        console.error(
            "VoidCore Performance:",
            error
        );

    } finally {
        performanceRequestInFlight = false;
    }

}

<<<<<<< Updated upstream
// UPDATE UI
=======
// LIVE FPS (lightweight; PresentMon is parsed continuously in the main process)

async function refreshLiveFPS() {
    if (document.hidden || !document.hasFocus() || !document.getElementById("dashboardPage")?.classList.contains("active")) return;
    if (fpsRequestInFlight || !window.voidCore.fps) {
        return;
    }

    fpsRequestInFlight = true;

    try {
        const data = await window.voidCore.fps.get();
        const fps = document.getElementById("performanceFPS");
        const frameTime = document.getElementById("performanceFrameTime");

        if (fps && data.fps != null) {
            fps.textContent = Math.round(data.fps);
        }

        if (frameTime && data.frameTime != null) {
            frameTime.textContent = `${Number(data.frameTime).toFixed(1)} ms`;
        }
    } catch (error) {
        console.error("VoidCore live FPS:", error);
    } finally {
        fpsRequestInFlight = false;
    }
}

// FPS TEST
>>>>>>> Stashed changes

function updatePerformanceUI(data) {

    const fps =
        document.getElementById(
            "performanceFPS"
        );

    const frametime =
        document.getElementById(
            "performanceFrameTime"
        );

    const cpu =
        document.getElementById(
            "performanceCPU"
        );

    const gpu =
        document.getElementById(
            "performanceGPU"
        );

    const ram =
        document.getElementById(
            "performanceRAM"
        );

    const vram =
        document.getElementById(
            "performanceVRAM"
        );

    const status =
        document.getElementById(
            "performanceStatus"
        );

    // NO GAME

    if (!data.active) {

        if (fps)
            fps.textContent = "--";

        if (frametime)
            frametime.textContent = "-- ms";

        if (cpu)
            cpu.textContent = "--%";

        if (gpu)
            gpu.textContent = "--%";

        if (ram)
            ram.textContent = "-- GB";

        if (vram)
            vram.textContent = "-- GB";


        if (status) {

            status.textContent =
                "WAITING";

            status.className =
                "badge neutral";

        }


        drawPerformanceChart([]);

        return;

    }


    const sample =
        data.sample;

    // FPS

    if (fps) {

        fps.textContent =
            sample.fps !== null &&
            sample.fps !== undefined
                ? Math.round(sample.fps)
                : "--";

    }

    // FRAME TIME

    if (frametime) {

        frametime.textContent =
            sample.frameTime !== null &&
            sample.frameTime !== undefined
                ? `${Number(
                    sample.frameTime
                ).toFixed(1)} ms`
                : "-- ms";

    }

    // CPU

    if (cpu) {

        cpu.textContent =
            `${Number(
                sample.cpu.usage
            ).toFixed(0)}%`;

    }

    // GPU

    if (gpu) {

        gpu.textContent =
            `${Number(
                sample.gpu.usage
            ).toFixed(0)}%`;

    }

    // RAM

    if (ram) {

        ram.textContent =
            `${Number(
                sample.ram.used
            ).toFixed(1)} GB`;

    }

    // VRAM

    if (vram) {

        vram.textContent =
            `${Number(
                sample.vram.used
            ).toFixed(1)} GB`;

    }

    // STATUS

    if (status) {

        status.textContent =
            "MONITORING";

        status.className =
            "badge accent";

    }

}

<<<<<<< Updated upstream
// GET METRIC
=======
// DIAGNOSTIC EVENTS

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function renderFalsePositives(events) {
    const summary = document.getElementById("falsePositiveSummary");
    if (!summary) return;
    if (!events.length) {
        summary.classList.add("hidden");
        return;
    }
    const latest = events[0];
    summary.textContent = `Отфильтровано ложных срабатываний: ${events.length}. Последнее: ${latest.title}.`;
    summary.classList.remove("hidden");
}

function showDiagnosticAlert(event) {
    if (!event || event.id === lastDiagnosticId) return;
    lastDiagnosticId = event.id;

    const alert = document.getElementById("diagnosticAlert");
    const title = document.getElementById("diagnosticAlertTitle");
    const text = document.getElementById("diagnosticAlertText");
    const fix = document.getElementById("diagnosticAlertFix");
    if (!alert || !title || !text || !fix) return;

    title.textContent = `${event.beforeFps} → ${event.fps} FPS: ${event.title}`;
    text.textContent = event.explanation;
    fix.textContent = event.recommendations?.[0] || "Откройте Diagnostic для подробностей.";
    alert.classList.remove("hidden");
}

let diagnosticRenderKey = null;
function renderDiagnostics(events) {
    const key = events.map(event => event.id).join("|");
    if (key === diagnosticRenderKey) return;
    diagnosticRenderKey = key;
    const container = document.getElementById("diagnosticEvents");
    if (!container) return;

    if (!events.length) {
        container.innerHTML = `
            <div id="diagnosticEmpty" class="empty-page">
                <div class="empty-icon">◉</div>
                <h2>No FPS drops detected</h2>
                <p>VoidCore will show the probable cause and recommendations here.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = events.map(event => {
        const metrics = event.metrics || {};
        const recommendations = (event.recommendations || [])
            .map(item => `<li>${escapeHTML(item)}</li>`)
            .join("");
        const processes = (event.topProcesses || [])
            .slice(0, 3)
            .map(item => `<span>${escapeHTML(item.name)} · CPU ${escapeHTML(item.cpu)}%</span>`)
            .join("");
        const time = new Date(event.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });

        return `
            <article class="diagnostic-card severity-${escapeHTML(event.severity)}">
                <div class="diagnostic-card-header">
                    <div>
                        <p class="eyebrow">${escapeHTML(event.game?.name)} · ${time}</p>
                        <h2>${escapeHTML(event.title)}</h2>
                    </div>
                    <div class="fps-drop-value">
                        <strong>${escapeHTML(event.beforeFps)} → ${escapeHTML(event.fps)}</strong>
                        <span>FPS · −${escapeHTML(event.dropPercent)}%</span>
                    </div>
                </div>
                <p class="diagnostic-explanation">${escapeHTML(event.explanation)}</p>
                <div class="diagnostic-metrics">
                    <span>CPU <b>${escapeHTML(metrics.cpu ?? "--")}%</b></span>
                    <span>GPU <b>${escapeHTML(metrics.gpu ?? "--")}%</b></span>
                    <span>RAM <b>${escapeHTML(metrics.ram ?? "--")}%</b></span>
                    <span>VRAM <b>${escapeHTML(metrics.vram ?? "--")}%</b></span>
                    <span>Frame Time <b>${escapeHTML(event.frameTime ?? "--")} ms</b></span>
                </div>
                ${processes ? `<div class="diagnostic-processes"><strong>Активные процессы</strong>${processes}</div>` : ""}
                <div class="diagnostic-recommendations">
                    <strong>Как исправить</strong>
                    <ul>${recommendations}</ul>
                </div>
            </article>
        `;
    }).join("");
}

const dismissDiagnostic = document.getElementById("dismissDiagnostic");
if (dismissDiagnostic) {
    dismissDiagnostic.addEventListener("click", () => {
        document.getElementById("diagnosticAlert")?.classList.add("hidden");
    });
}

// CALCULATE MAX
>>>>>>> Stashed changes

function getMetricValue(
    item,
    metric
) {

    switch (metric) {


        case "cpu":

            return Number(
                item.cpu?.usage || 0
            );


        case "gpu":

            return Number(
                item.gpu?.usage || 0
            );


        case "ram":

            return Number(
                item.ram?.used || 0
            );


        case "vram":

            return Number(
                item.vram?.used || 0
            );


        default:

            return 0;

    }

}

// METRIC CONFIG

function getMetricConfig(
    metric
) {

    switch (metric) {


        case "cpu":

            return {

                label: "CPU",

                unit: "%",

                max: 100

            };


        case "gpu":

            return {

                label: "GPU",

                unit: "%",

                max: 100

            };


        case "ram":

            return {

                label: "RAM",

                unit: " GB",

                max: null

            };


        case "vram":

            return {

                label: "VRAM",

                unit: " GB",

                max: null

            };


        default:

            return {

                label: "",

                unit: "",

                max: 100

            };

    }

}

// DRAW CHART

function drawPerformanceChart(
    history
) {

    const canvas =
        document.getElementById(
            "performanceChart"
        );


    if (!canvas) {
        return;
    }


    const ctx =
        canvas.getContext("2d");


    const rect =
        canvas.getBoundingClientRect();


    const width =
        Math.max(
            300,
            Math.floor(rect.width)
        );


    const height =
        120;


    const dpr =
        window.devicePixelRatio || 1;


    canvas.width =
        width * dpr;

    canvas.height =
        height * dpr;


    canvas.style.height =
        `${height}px`;


    ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
    );


    ctx.clearRect(
        0,
        0,
        width,
        height
    );

    // EMPTY

    if (!history.length) {

        ctx.fillStyle =
            "rgba(255,255,255,0.25)";

        ctx.font =
            "12px Arial";

        ctx.textAlign =
            "center";

        ctx.fillText(
            "Waiting for performance data...",
            width / 2,
            height / 2
        );

        return;

    }


    const config =
        getMetricConfig(
            selectedMetric
        );


    const values =
        history.map(
            item =>
                getMetricValue(
                    item,
                    selectedMetric
                )
        );


    // SCALE

    let max =
        config.max;


    if (
        max === null
    ) {

        max =
            Math.max(
                1,
                ...values
            );


        max =
            Math.ceil(
                max / 10
            ) * 10;

    }


    const min = 0;


    const padding = 10;


    const graphWidth =
        width -
        padding * 2;


    const graphHeight =
        height -
        padding * 2;


    // GRID

    ctx.strokeStyle =
        "rgba(255,255,255,0.06)";

    ctx.lineWidth = 1;


    for (
        let i = 0;
        i <= 4;
        i++
    ) {

        const y =
            padding +
            graphHeight *
            (i / 4);


        ctx.beginPath();

        ctx.moveTo(
            padding,
            y
        );

        ctx.lineTo(
            width - padding,
            y
        );

        ctx.stroke();

    }

    // LINE

    ctx.beginPath();


    values.forEach(
        (
            value,
            index
        ) => {

            const x =
                padding +
                (
                    index /
                    Math.max(
                        1,
                        values.length - 1
                    )
                ) *
                graphWidth;


            const normalized =
                (
                    value - min
                ) /
                (
                    max - min
                );


            const y =
                height -
                padding -
                normalized *
                graphHeight;


            if (index === 0) {

                ctx.moveTo(
                    x,
                    y
                );

            } else {

                ctx.lineTo(
                    x,
                    y
                );

            }

        }
    );


    ctx.strokeStyle =
        "#50E3C2";

    ctx.lineWidth = 2;

    ctx.stroke();

    // CURRENT VALUE

    const current =
        values[
            values.length - 1
        ];


    if (
        current !== undefined
    ) {

        ctx.fillStyle =
            "rgba(255,255,255,0.55)";

        ctx.font =
            "10px Arial";

        ctx.textAlign =
            "right";

<<<<<<< Updated upstream
        ctx.fillText(
            `${current.toFixed(1)}${config.unit}`,
            width - padding,
            12
=======
            const config = getMetricConfig(metric);

            ctx.fillStyle = metricColors[metric] || "#50E3C2";

            ctx.fillText(`${config.label}: ${current.toFixed(1)}${config.unit}`, width - 10,y);
            y += 13;
        }
    );
}

// DRAW CHART

function drawPerformanceChart(
    history
) {
    if (document.hidden || !document.hasFocus() || !document.getElementById("dashboardPage")?.classList.contains("active")) return;
    const canvas =
        document.getElementById(
            "performanceChart"
>>>>>>> Stashed changes
        );

    }

}

// TABS

document
    .querySelectorAll(
        ".chart-tab"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(
                            ".chart-tab"
                        )
                        .forEach(
                            item =>
                                item.classList.remove(
                                    "active"
                                )
                        );


                    button.classList.add(
                        "active"
                    );


                    selectedMetric =
                        button.dataset.metric;


                    drawPerformanceChart(
                        performanceData?.history || []
                    );

                }
            );

        }
    );

// START

refreshPerformance();

<<<<<<< Updated upstream

setInterval(
    refreshPerformance,
    1000
);
=======
refreshLiveFPS();

setInterval(refreshLiveFPS, 250);

setInterval(refreshPerformance, 2000);
>>>>>>> Stashed changes

// RESIZE

window.addEventListener(
    "resize",
    () => {

        drawPerformanceChart(
            performanceData?.history || []
        );

    }
);