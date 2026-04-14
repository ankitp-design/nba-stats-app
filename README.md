# NBA Streak Finder

Small web application for finding active NBA player stat streaks during the **2025-26 regular season**.

## What it does

- Loads all current-season NBA players dynamically from the NBA stats API.
- Lets you choose a stat category, comparison operator, and numeric target.
- Calculates how many games in a row a player has satisfied that condition using the player's live 2025-26 regular-season game log.

## Run locally

```powershell
node server.js
```

Then open `http://localhost:3000`.
