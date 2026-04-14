const form = document.querySelector("#streak-form");
const statSelect = document.querySelector("#stat");
const operatorSelect = document.querySelector("#operator");
const valueInput = document.querySelector("#value");
const playerInput = document.querySelector("#player-name");
const playerOptions = document.querySelector("#player-options");
const statusText = document.querySelector("#status");
const resultContainer = document.querySelector("#result");
const submitButton = document.querySelector("#submit-button");

let players = [];

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function renderOptions(selectElement, options) {
  selectElement.innerHTML = "";

  options.forEach((option) => {
    const optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    selectElement.append(optionElement);
  });
}

function renderPlayers(items) {
  playerOptions.innerHTML = "";

  items.forEach((player) => {
    const option = document.createElement("option");
    option.value = player.name;
    option.label = `${player.name} - ${player.team}`;
    playerOptions.append(option);
  });
}

function getSelectedPlayer() {
  const lookup = playerInput.value.trim().toLowerCase();
  return players.find((player) => player.name.toLowerCase() === lookup);
}

function formatStatValue(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(1);
}

function renderResult(payload) {
  const headline =
    payload.streak === 1 ? "1 game in a row" : `${payload.streak} games in a row`;

  const latestSummary = payload.latestGame
    ? `${payload.player.name}'s most recent game was ${payload.latestGame.gameDate} (${payload.latestGame.matchup}) with ${formatStatValue(payload.latestGame.statValue)} ${payload.stat.label.toLowerCase()}.`
    : `${payload.player.name} has no regular-season games logged yet for ${payload.season}.`;

  const gameRows = payload.evaluatedGames
    .map(
      (game) => `
        <tr>
          <td>${game.gameDate}</td>
          <td class="mono">${game.matchup}</td>
          <td>${game.result}</td>
          <td>${formatStatValue(game.statValue)}</td>
          <td class="${game.hit ? "hit" : "miss"}">${game.hit ? "Hit" : "Miss"}</td>
        </tr>
      `
    )
    .join("");

  resultContainer.innerHTML = `
    <div class="summary">
      <article class="summary-card">
        <p class="eyebrow">Current streak</p>
        <h2>${payload.player.name}</h2>
        <div class="streak-number accent">${headline}</div>
        <p>
          ${payload.player.name} has gone <strong>${headline}</strong> for <strong>${payload.stat.label}</strong>
          ${payload.operator} <strong>${formatStatValue(payload.target)}</strong>.
        </p>
        <div class="meta">
          <span class="pill">${payload.player.team}</span>
          <span class="pill">${payload.totalHits} of ${payload.totalGames} games hit</span>
          <span class="pill">${payload.totalGames} games checked</span>
          <span class="pill">${payload.season}</span>
        </div>
      </article>

      <article class="summary-card">
        <p class="eyebrow">Latest game</p>
        <h3>Recent context</h3>
        <p>${latestSummary}</p>
        <p>
          The streak is counted from the most recent regular-season game backward until the condition fails.
        </p>
        <p>
          Across the full season so far, ${payload.player.name} has hit this condition in
          <strong>${payload.totalHits} of ${payload.totalGames}</strong> regular-season games.
        </p>
      </article>
    </div>

    <section class="games">
      <h3>Recent game log checks</h3>
      ${
        payload.evaluatedGames.length
          ? `<table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Matchup</th>
                  <th>Result</th>
                  <th>${payload.stat.label}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${gameRows}</tbody>
            </table>`
          : `<p class="empty">No games were returned yet for this player in the 2025-26 regular season.</p>`
      }
    </section>
  `;

  resultContainer.classList.remove("hidden");
}

async function loadMeta() {
  const response = await fetch("/api/meta");
  if (!response.ok) {
    throw new Error("Unable to load app metadata.");
  }

  return response.json();
}

async function loadPlayers() {
  const response = await fetch("/api/players");
  if (!response.ok) {
    throw new Error("Unable to load players from the NBA API.");
  }

  return response.json();
}

async function initialize() {
  try {
    const [meta, playerPayload] = await Promise.all([loadMeta(), loadPlayers()]);
    renderOptions(statSelect, meta.stats);
    renderOptions(operatorSelect, meta.operators);
    players = playerPayload.players;
    renderPlayers(players);
    valueInput.value = "10";
    setStatus(`Loaded ${players.length} players from the live ${playerPayload.season} NBA season pool.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selectedPlayer = getSelectedPlayer();

  if (!selectedPlayer) {
    setStatus("Choose a player from the loaded 2025-26 NBA player list.", true);
    resultContainer.classList.add("hidden");
    return;
  }

  submitButton.disabled = true;
  setStatus(`Checking ${selectedPlayer.name}'s 2025-26 game log...`);

  try {
    const params = new URLSearchParams({
      playerId: selectedPlayer.id,
      stat: statSelect.value,
      operator: operatorSelect.value,
      value: valueInput.value
    });

    const response = await fetch(`/api/streak?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to calculate streak.");
    }

    renderResult(payload);
    setStatus(`Streak updated for ${selectedPlayer.name}.`);
  } catch (error) {
    resultContainer.classList.add("hidden");
    setStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

initialize();
