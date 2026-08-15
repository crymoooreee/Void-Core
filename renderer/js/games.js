let activeGame = null;


// REFRESH GAME

async function refreshGames() {

    try {

        const game =
            await window.voidCore.games.getActive();

        activeGame = game;

        updateActiveGame(game);

    } catch (error) {

        console.error(
            "VoidCore Game Detector:",
            error
        );

    }

}

// UPDATE DASHBOARD

function updateActiveGame(game) {

    const gameName =
        document.getElementById(
            "activeGameName"
        );

    const gameBadge =
        document.getElementById(
            "activeGameBadge"
        );

    const gameContainer =
        document.getElementById(
            "activeGame"
        );


    if (
        !gameName ||
        !gameBadge ||
        !gameContainer
    ) {

        return;

    }

    // NO GAME

    if (!game) {

        gameName.textContent =
            "No game running";

        gameBadge.textContent =
            "IDLE";

        gameBadge.className =
            "badge neutral";


        gameContainer.style.backgroundImage =
            "none";


        gameContainer.classList.remove(
            "game-active"
        );


        gameContainer.innerHTML = `

            <div class="game-empty-icon">
                🎮
            </div>

            <h3>
                Ready when you are.
            </h3>

            <p>
                VoidCore is waiting for a game to start.
            </p>

        `;

        return;

    }

    // GAME RUNNING

    gameName.textContent =
        game.name;


    gameBadge.textContent =
        "RUNNING";


    gameBadge.className =
        "badge accent";

    // GAME BACKGROUND

    const image =
        game.image ||
        "default.jpg";


    gameContainer.style.backgroundImage =
        `url("../assets/games/${image}")`;

    gameContainer.classList.add(
        "game-active"
    );

    // CONTENT

    gameContainer.innerHTML = `

        <div class="game-background-overlay"></div>


        <div class="game-active-content">


            <div class="game-active-info">

                <strong>
                    ${game.name}
                </strong>

                <span>
                    ${game.platform}
                </span>

            </div>


            <div class="game-stats">


                <div class="game-stat">

                    <small>
                        CPU
                    </small>

                    <strong>
                        ${Number(game.cpu).toFixed(1)}%
                    </strong>

                </div>


                <div class="game-stat">

                    <small>
                        RAM
                    </small>

                    <strong>
                        ${Number(game.memory).toFixed(1)}%
                    </strong>

                </div>


            </div>


            <div class="running-indicator">

                <span class="status-dot"></span>

                LIVE

            </div>


        </div>

    `;

}

// START MONITOR

refreshGames();


// Проверка игры каждые 3 секунды

setInterval(
    refreshGames,
    3000
);