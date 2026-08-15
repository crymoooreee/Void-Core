const si = require("systeminformation");

const HISTORY_LENGTH = 30;

let history = [];

let lastSample = null;

// PERFORMANCE SAMPLE

async function collectPerformance() {

    const game =
        await getActiveGame();


    if (!game) {

        lastSample = null;

        return {
            active: false,
            game: null,
            history
        };

    }


    const hardware =
        await getHardware();


    const sample = {

        timestamp: Date.now(),

        game: {

            name: game.name,

            pid: game.pid,

            cpu: game.cpu,

            memory: game.memory

        },

        cpu: {

            usage:
                hardware.cpu

        },

        gpu: {

            usage:
                hardware.gpu

        },

        ram: {

            used:
                hardware.ram.used,

            total:
                hardware.ram.total

        },

        vram: {

            used:
                hardware.vram.used,

            total:
                hardware.vram.total

        }

    };


    history.push(sample);


    if (
        history.length >
        HISTORY_LENGTH
    ) {

        history.shift();

    }


    lastSample = sample;


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