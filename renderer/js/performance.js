let performanceData = null;

let selectedMetrics = [
    "fps",
    "cpu"
];

// METRIC COLORS

const metricColors = {

    fps: "#50E3C2",
    frameTime: "#FFB86C",
    cpu: "#7AA2F7",
    gpu: "#F7768E",
    ram: "#BB9AF7",
    vram: "#73DACA"

};

// METRIC CONFIG

function getMetricConfig(metric) {

    switch (metric) {

        case "fps":
            return {
                label: "FPS",
                unit: "",
                max: null
            };

        case "frameTime":
            return {
                label: "FRAME TIME",
                unit: " ms",
                max: null
            };

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

// GET METRIC VALUE

function getMetricValue(
    item,
    metric
) {

    switch (metric) {

        case "fps":
            return Number(
                item.fps ?? 0
            );

        case "frameTime":
            return Number(
                item.frameTime ?? 0
            );

        case "cpu":
            return Number(
                item.cpu?.usage ?? 0
            );

        case "gpu":
            return Number(
                item.gpu?.usage ?? 0
            );

        case "ram":
            return Number(
                item.ram?.used ?? 0
            );

        case "vram":
            return Number(
                item.vram?.used ?? 0
            );

        default:
            return 0;
    }
}

// REFRESH PERFORMANCE

async function refreshPerformance() {

    try {

        const data =
            await window.voidCore.performance.get();


        performanceData =
            data;


        updatePerformanceUI(
            data
        );


        drawPerformanceChart(
            data.history || []
        );


    } catch (error) {

        console.error(
            "VoidCore Performance:",
            error
        );

    }

}

// FPS TEST

async function testFPS() {

    if (
        !window.voidCore.fps
    ) {

        console.error(
            "FPS API not found"
        );

        return;

    }


    const data =
        await window.voidCore.fps.get();


    console.log(
        "FPS DATA:",
        data
    );

}

// FPS COLLECTOR TEST

async function testFPSCollector() {

    if (
        !window.voidCore.fps
    ) {

        return;

    }


    const data =
        await window.voidCore.fps.get();


    console.log(
        "VOIDCORE FPS:",
        data
    );

}

// UPDATE PERFORMANCE UI

function updatePerformanceUI(
    data
) {

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

    if (
        !data.active
    ) {

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
            status.textContent = "WAITING";
            status.className = "badge neutral";
        }

        drawPerformanceChart( [] );

        return;
    }

    const sample = data.sample;

    // FPS

    if (fps) {

        fps.textContent =
            sample.fps !== null &&
            sample.fps !== undefined
                ? Math.round(
                    sample.fps
                )
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
                sample.cpu?.usage ?? 0
            ).toFixed(0)}%`;
    }

    // GPU

    if (gpu) {

        gpu.textContent =
            `${Number(
                sample.gpu?.usage ?? 0
            ).toFixed(0)}%`;
    }

    // RAM

    if (ram) {

        ram.textContent =
            `${Number(
                sample.ram?.used ?? 0
            ).toFixed(1)} GB`;
    }

    // VRAM

    if (vram) {

        vram.textContent =
            `${Number(
                sample.vram?.used ?? 0
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

// CALCULATE MAX

function getMetricMax(
    history,
    metric
) {

    const config =
        getMetricConfig(
            metric
        );


    // CPU / GPU

    if (
        config.max !== null
    ) {

        return config.max;

    }


    const values =
        history
            .map(
                item =>
                    getMetricValue(
                        item,
                        metric
                    )
            )
            .filter(
                value =>
                    Number.isFinite(
                        value
                    )
            );


    if (!values.length) {

        return 1;

    }


    const highest =
        Math.max(
            ...values
        );


    if (
        highest <= 0
    ) {

        return 1;

    }


    // Для FPS

    if (
        metric === "fps"
    ) {

        return Math.ceil(
            highest / 10
        ) * 10;

    }


    // Frame Time / RAM / VRAM

    return Math.ceil(
        highest * 1.2
    );

}

// DRAW GRID

function drawGrid(
    ctx,
    width,
    height,
    padding
) {
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;

    for (
        let i = 0;
        i <= 4;
        i++
    ) {

        const y =
            padding +
            graphHeight *
            (
                i / 4
            );

        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo( width - padding, y);
        ctx.stroke();

    }

}

// DRAW METRIC LINE

function drawMetricLine(
    ctx,
    history,
    metric,
    width,
    height,
    padding
) {

    if (
        !history.length
    ) {

        return;

    }


    const values = history.map(item =>
                getMetricValue(
                    item,
                    metric
                )
        );

    const max = getMetricMax(history, metric);

    const min = 0;
    const graphWidth = width - padding * 2;
    const graphHeight =  height - padding * 2;

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
                Math.max(
                    0,
                    Math.min(
                        1,
                        (
                            value - min
                        ) /
                        (
                            max - min
                        )
                    )
                );


            const y = height - padding - normalized * graphHeight;

            if (
                index === 0
            ) {
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


    ctx.strokeStyle = metricColors[metric] || "#50E3C2";
    ctx.lineWidth = 2;
    ctx.stroke();
}

// DRAW CURRENT VALUES

function drawCurrentValues(
    ctx,
    history,
    width
) {

    if (
        !history.length
    ) {
        return;
    }

    let y = 12;
    ctx.font = "10px Arial";
    ctx.textAlign = "right";

    selectedMetrics.forEach(
        metric => {

            const current = getMetricValue(history[history.length - 1],metric);

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
    const canvas =
        document.getElementById(
            "performanceChart"
        );

    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const width =Math.max(300,Math.floor(rect.width));
    const height = 120;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // EMPTY

    if (
        !history.length
    ) {

        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Waiting for performance data...", width / 2, height / 2);

        return;
    }

    // GRID

    const padding = 10;
    drawGrid(ctx, width, height, padding);

    // DRAW SELECTED METRICS

    selectedMetrics.forEach(
        metric => {
            drawMetricLine(ctx, history, metric, width, height, padding);
        }
    );

    // CURRENT VALUES

    drawCurrentValues(ctx, history, width);
}

// CHART TABS

document
    .querySelectorAll(
        ".chart-tab"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    const metric =
                        button.dataset.metric;

                    // REMOVE

                    if (selectedMetrics.includes(metric)) 
                    {
                        if (selectedMetrics.length <= 1) 
                        {
                            return;
                        }


                        selectedMetrics =
                            selectedMetrics.filter(
                                item =>
                                    item !== metric
                            );

                        button.classList.remove("active");
                    }

                    // ADD

                    else {
                        selectedMetrics.push(
                            metric
                        );

                        button.classList.add(
                            "active"
                        );

                    }

                    drawPerformanceChart(
                        performanceData?.history || []
                    );
                }
            );
        }
    );

// START

refreshPerformance();

setInterval(testFPSCollector, 1000);

setInterval(refreshPerformance, 1000);

// RESIZE

window.addEventListener(
    "resize",
    () => {

        drawPerformanceChart(
            performanceData?.history || []
        );

    }
);