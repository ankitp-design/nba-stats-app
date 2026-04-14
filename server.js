const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const SEASON = "2025-26";
const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive"
};

const PUBLIC_DIR = path.join(__dirname, "public");

const STAT_CONFIG = {
  PTS: { label: "Points", description: "PTS" },
  REB: { label: "Rebounds", description: "REB" },
  AST: { label: "Assists", description: "AST" },
  STL: { label: "Steals", description: "STL" },
  BLK: { label: "Blocks", description: "BLK" },
  TOV: { label: "Turnovers", description: "TOV" },
  FG3M: { label: "Three-Pointers Made", description: "FG3M" },
  FGM: { label: "Field Goals Made", description: "FGM" },
  FGA: { label: "Field Goal Attempts", description: "FGA" },
  FTM: { label: "Free Throws Made", description: "FTM" },
  FTA: { label: "Free Throw Attempts", description: "FTA" },
  MIN: { label: "Minutes", description: "MIN" },
  PLUS_MINUS: { label: "Plus / Minus", description: "+/-" }
};

const OPERATORS = {
  gt: {
    label: "greater than",
    test: (value, target) => value > target
  },
  gte: {
    label: "greater than or equal to",
    test: (value, target) => value >= target
  },
  eq: {
    label: "equal to",
    test: (value, target) => value === target
  },
  lte: {
    label: "less than or equal to",
    test: (value, target) => value <= target
  },
  lt: {
    label: "less than",
    test: (value, target) => value < target
  }
};

let playerCache = null;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    response.end(data);
  });
}

async function fetchNbaJson(url) {
  const nbaResponse = await fetch(url, { headers: NBA_HEADERS });

  if (!nbaResponse.ok) {
    throw new Error(`NBA API request failed with ${nbaResponse.status} ${nbaResponse.statusText}`);
  }

  return nbaResponse.json();
}

function resultSetRows(payload) {
  const resultSet = payload.resultSets?.[0];

  if (!resultSet || !Array.isArray(resultSet.headers) || !Array.isArray(resultSet.rowSet)) {
    throw new Error("Unexpected NBA API response format.");
  }

  return resultSet.rowSet.map((row) => Object.fromEntries(resultSet.headers.map((header, index) => [header, row[index]])));
}

async function getPlayers() {
  if (playerCache) {
    return playerCache;
  }

  const playerUrl = new URL("https://stats.nba.com/stats/commonallplayers");
  playerUrl.searchParams.set("IsOnlyCurrentSeason", "1");
  playerUrl.searchParams.set("LeagueID", "00");
  playerUrl.searchParams.set("Season", SEASON);

  const payload = await fetchNbaJson(playerUrl);
  const players = resultSetRows(payload)
    .filter((player) => player.ROSTERSTATUS === 1)
    .map((player) => ({
      id: String(player.PERSON_ID),
      name: player.DISPLAY_FIRST_LAST,
      team: player.TEAM_NAME || "Free Agent"
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  playerCache = players;
  return players;
}

async function getPlayerGameLog(playerId) {
  const logUrl = new URL("https://stats.nba.com/stats/playergamelog");
  logUrl.searchParams.set("DateFrom", "");
  logUrl.searchParams.set("DateTo", "");
  logUrl.searchParams.set("LeagueID", "00");
  logUrl.searchParams.set("PlayerID", playerId);
  logUrl.searchParams.set("Season", SEASON);
  logUrl.searchParams.set("SeasonType", "Regular Season");

  const payload = await fetchNbaJson(logUrl);
  return resultSetRows(payload);
}

function parseMinutes(value) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }

  if (!value.includes(":")) {
    return Number(value) || 0;
  }

  const [minutes, seconds] = value.split(":").map(Number);
  return minutes + ((seconds || 0) / 60);
}

function normalizeStatValue(game, statKey) {
  if (statKey === "MIN") {
    return parseMinutes(game.MIN);
  }

  return Number(game[statKey]) || 0;
}

function computeCurrentStreak(games, statKey, operatorKey, targetValue) {
  const operator = OPERATORS[operatorKey];

  if (!operator) {
    throw new Error("Unsupported operator.");
  }

  let streak = 0;
  let stillCounting = true;
  const evaluatedGames = games.map((game) => {
    const statValue = normalizeStatValue(game, statKey);
    const hit = operator.test(statValue, targetValue);

    if (stillCounting && hit) {
      streak += 1;
    } else {
      stillCounting = false;
    }

    return {
      gameDate: game.GAME_DATE,
      matchup: game.MATCHUP,
      result: game.WL,
      statValue,
      hit
    };
  });

  return { streak, evaluatedGames };
}

function buildStreakResponse({ player, games, statKey, operatorKey, targetValue }) {
  if (!STAT_CONFIG[statKey]) {
    throw new Error("Unsupported stat category.");
  }

  const { streak, evaluatedGames } = computeCurrentStreak(games, statKey, operatorKey, targetValue);
  const latestGame = evaluatedGames[0] || null;
  const totalHits = evaluatedGames.filter((game) => game.hit).length;

  return {
    season: SEASON,
    player,
    stat: STAT_CONFIG[statKey],
    operator: OPERATORS[operatorKey].label,
    target: targetValue,
    streak,
    totalHits,
    totalGames: evaluatedGames.length,
    latestGame,
    evaluatedGames: evaluatedGames.slice(0, 15)
  };
}

function routeApi(requestUrl, response) {
  if (requestUrl.pathname === "/api/meta") {
    sendJson(response, 200, {
      season: SEASON,
      stats: Object.entries(STAT_CONFIG).map(([value, config]) => ({
        value,
        label: config.label
      })),
      operators: Object.entries(OPERATORS).map(([value, config]) => ({
        value,
        label: config.label
      }))
    });
    return true;
  }

  if (requestUrl.pathname === "/api/players") {
    getPlayers()
      .then((players) => sendJson(response, 200, { season: SEASON, players }))
      .catch((error) => {
        sendJson(response, 500, { error: error.message });
      });
    return true;
  }

  if (requestUrl.pathname === "/api/streak") {
    const playerId = requestUrl.searchParams.get("playerId");
    const stat = requestUrl.searchParams.get("stat");
    const operator = requestUrl.searchParams.get("operator");
    const value = Number(requestUrl.searchParams.get("value"));

    if (!playerId || !stat || !operator || Number.isNaN(value)) {
      sendJson(response, 400, {
        error: "Missing or invalid query parameters. Expected playerId, stat, operator, and value."
      });
      return true;
    }

    Promise.all([getPlayers(), getPlayerGameLog(playerId)])
      .then(([players, games]) => {
        const player = players.find((item) => item.id === playerId);

        if (!player) {
          sendJson(response, 404, { error: "Player was not found in the 2025-26 current-season player pool." });
          return;
        }

        const payload = buildStreakResponse({
          player,
          games,
          statKey: stat,
          operatorKey: operator,
          targetValue: value
        });

        sendJson(response, 200, payload);
      })
      .catch((error) => {
        sendJson(response, 500, { error: error.message });
      });
    return true;
  }

  return false;
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname.startsWith("/api/")) {
    if (!routeApi(requestUrl, response)) {
      sendJson(response, 404, { error: "API route not found." });
    }
    return;
  }

  const requestedPath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
  const safePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!safePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  sendFile(response, safePath);
});

server.listen(PORT, () => {
  console.log(`NBA streak finder running at http://localhost:${PORT}`);
});
