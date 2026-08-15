const si = require("systeminformation");

const {
  GAMES
} = require("./games-list");


function normalize(value) {
  return value
    .toLowerCase()
    .trim();
}


function findGame(processName) {

  const normalized =
    normalize(processName);


  return GAMES.find((game) => {

    return game.executables.some(
      (executable) =>
        normalize(executable) === normalized
    );

  }) || null;
}


async function getRunningGames() {

  const processes =
    await si.processes();


  const games = [];


  for (const process of processes.list) {

    const game =
      findGame(process.name);


    if (!game) {
      continue;
    }


    games.push({
        name: game.name,
        platform: game.platform,
        image: game.image || "default.jpg",
        executable: process.name,
        pid: process.pid,
        cpu: process.cpu,
        memory: process.mem,
        startedAt: process.started || null
    });

  }


  return games;
}


async function getActiveGame() {

  const games =
    await getRunningGames();


  if (games.length === 0) {
    return null;
  }


  // Если одновременно запущено несколько игр - выбирается та которая потребляет больше CPU.

  games.sort(
    (a, b) =>
      b.cpu - a.cpu
  );


  return games[0];

}


module.exports = {

  getRunningGames,

  getActiveGame

};