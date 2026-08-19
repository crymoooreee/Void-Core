const si = require("systeminformation");

const {
    startFPSMonitor,
    stopFPSMonitor,
    getFPSData
} = require("./fps-monitor");

const HISTORY_LENGTH = 30;

let history = [];

let lastSample = null;
let monitoredGamePid = null;

// PERFORMANCE SAMPLE

async function collectPerformance() {

    const game =
        await getActiveGame();

    // ========================================
    // FPS MONITOR
    // ========================================

    if (game) {

        if (
            monitoredGamePid !== game.pid
        ) {

            console.log(
                `[Performance] Starting FPS monitor for PID: ${game.pid}`
            );


            try {

                if (
                    monitoredGamePid !== null
                ) {

                    await stopFPSMonitor();

                }


                await startFPSMonitor(
                    game.pid
                );


                monitoredGamePid =
                    game.pid;


            } catch (error) {

                console.error(
                    "[Performance] Failed to start FPS monitor:",
                    error
                );


                monitoredGamePid =
                    null;

            }

        }

    }


    // ========================================
    // NO GAME
    // ========================================

    if (!game) {

        if (
            monitoredGamePid !== null
        ) {

            try {

                await stopFPSMonitor();

            } catch (error) {

                console.error(
                    "[Performance] Failed to stop FPS monitor:",
                    error
                );

            }

            monitoredGamePid =
                null;

        }


        lastSample = null;


        return {

            active: false,

            game: null,

            sample: null,

            history

        };

    }


    // ========================================
    // HARDWARE
    // ========================================

    const hardware =
        await getHardware();


    // ========================================
    // FPS
    // ========================================

    let fpsData = null;

    try {

        fpsData =
            await getFPSData();

        console.log(
            "[Performance] RAW FPS DATA:",
            fpsData
        );

    } catch (error) {

        console.error(
            "[Performance] FPS error:",
            error
        );

    }


    // ========================================
    // SAMPLE
    // ========================================

    const sample = {

        timestamp:
            Date.now(),


        // ========================================
        // GAME
        // ========================================

        game: {

            name:
                game.name,

            pid:
                game.pid,

            cpu:
                game.cpu,

            memory:
                game.memory

        },


        // ========================================
        // FPS
        // ========================================

        fps:
            fpsData?.fps ??
            null,


        frameTime:
            fpsData?.frameTime ??
            null,


        onePercentLow:
            fpsData?.onePercentLow ??
            null,


        // ========================================
        // CPU
        // ========================================

        cpu: {

            usage:
                hardware.cpu

        },


        // ========================================
        // GPU
        // ========================================

        gpu: {

            usage:
                hardware.gpu

        },


        // ========================================
        // RAM
        // ========================================

        ram: {

            used:
                hardware.ram.used,

            total:
                hardware.ram.total

        },


        // ========================================
        // VRAM
        // ========================================

        vram: {

            used:
                hardware.vram.used,

            total:
                hardware.vram.total

        }

    };


    // ========================================
    // HISTORY
    // ========================================

    history.push(
        sample
    );


    if (
        history.length >
        HISTORY_LENGTH
    ) {

        history.shift();

    }


    lastSample =
        sample;


    // ========================================
    // DEBUG
    // ========================================

    console.log(
        "[Performance]",
        {
            fps:
                sample.fps,

            frameTime:
                sample.frameTime,

            cpu:
                sample.cpu.usage,

            gpu:
                sample.gpu.usage
        }
    );


    // ========================================
    // RETURN
    // ========================================

    return {

        active: true,

        game,

        sample,

        history

    };

}

// ACTIVE GAME

async function getActiveGame() {

    const processes =
        await si.processes();


    // Здесь используем тот же список, который использует Game Detector.

    const {
        GAMES
    } = require("../games/games-list");


    for (const process of processes.list) {

        const game =
            GAMES.find((item) =>

                item.executables.some(
                    executable =>
                        executable.toLowerCase() ===
                        process.name.toLowerCase()
                )

            );


        if (!game) {
            continue;
        }


        return {

            name:
                game.name,

            platform:
                game.platform,

            image:
                game.image,

            pid:
                process.pid,

            cpu:
                process.cpu,

            memory:
                process.mem

        };

    }


    return null;

}

// HARDWARE

async function getHardware() {

    const [

        load,

        mem,

        graphics

    ] = await Promise.all([

        si.currentLoad(),

        si.mem(),

        si.graphics()

    ]);


    const gpu =
        graphics.controllers?.[0];


    return {

        cpu:
            load.currentLoad,


        gpu:
            gpu?.utilizationGpu || 0,


        ram: {

            used:
                mem.used / 1024 ** 3,

            total:
                mem.total / 1024 ** 3

        },


        vram: {

            used:
                gpu?.vramDynamic
                    ? gpu.vramDynamic / 1024
                    : 0,

            total:
                gpu?.vram
                    ? gpu.vram / 1024
                    : 0

        }

    };

}

// GET HISTORY

function getPerformanceHistory() {

    return history;

}

// RESET

function resetPerformanceHistory() {

    history = [];

    lastSample = null;

}


module.exports = {

    collectPerformance,

    getPerformanceHistory,

    resetPerformanceHistory

};