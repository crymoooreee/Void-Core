let performanceData = null;

let selectedMetric = "cpu";

// REFRESH

async function refreshPerformance() {

    try {

        const data =
            await window.voidCore.performance.get();

        performanceData = data;

        updatePerformanceUI(data);

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

// UPDATE UI

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

// GET METRIC

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

        ctx.fillText(
            `${current.toFixed(1)}${config.unit}`,
            width - padding,
            12
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


setInterval(
    refreshPerformance,
    1000
);

// RESIZE

window.addEventListener(
    "resize",
    () => {

        drawPerformanceChart(
            performanceData?.history || []
        );

    }
);