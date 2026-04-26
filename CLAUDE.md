# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `bot/`:

```bash
# Start the bot
node index.js

# Deploy slash commands to Discord (required after adding/renaming any command)
node deploy-commands.js

# Run bot and log to file
node index.js >> /tmp/arkham-bot.log 2>&1 &

# Restart bot
pkill -f "node.*index.js" && node index.js >> /tmp/arkham-bot.log 2>&1 &
```

Environment variables are in `bot/.env`: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`.

**After adding or renaming a slash command, always run `node deploy-commands.js` before restarting the bot.** The bot auto-loads all `commands/**/*.js` files at startup but Discord requires commands to be explicitly registered.

## Architecture

### Card Data (`/` root directory)
Pack image folders (e.g. `01_Core_Set/`, `02_The_Dunwich_Legacy/`) sit at the repo root, **not** inside `bot/`. Each pack folder contains:
- PNG images named `<position>_<Card_Name>.png` (e.g. `006_Roland_s_38_Special.png`)
- `cards.json` — full card data including `text`, `backimagesrc`, `cost`, `health`, etc.
- `cards_index.json` — lightweight index with `code`, `name`, `type_code`, `cost`, `position`, `pack_code`, etc. (no `text`)

`config.js` sets `cardDataRoot: path.join(__dirname, '..')` so `bot/engine/cardLookup.js` walks the pack directories from the repo root.

### Two-Tier Card Data
`cards_index.json` is fast and loaded into memory as `_allCards` (cached singleton in `cardLookup.js`). Use `findCardByCode(code)` or `findCard(query)` for most lookups — these return `{ card, imagePath }`.

When you need `text` (for charge parsing, flavor, back-face image URL), read the **full** `cards.json` directly — see `getCardCharges()` and `findBackImageSrc()` in `cardLookup.js` for the pattern. Do not add `text` to the index; it's intentionally omitted to keep the cache small.

### Command Structure
Commands live in `bot/commands/<category>/<name>.js`. Each exports `{ data, execute, autocomplete? }`.

- `pregame/` — join, investigator selection, deck import, startgame
- `game/` — all in-game actions (play, draw, move, commit, use, damage, etc.)
- `campaign/` — between-scenario actions (XP upgrades, campaign log, end scenario)
- `system/` — newgame (full reset), clear

The bot loads all commands recursively at startup. Autocomplete interactions are dispatched to `command.autocomplete(interaction)` in `index.js` before the normal `isChatInputCommand` check.

### Engine Modules
| File | Responsibility |
|------|---------------|
| `gameState.js` | All DB reads/writes — `getPlayer`, `updatePlayer`, `getSession`, `updateSession`, etc. Single source of truth for state. |
| `deck.js` | Hand/deck/discard/asset manipulation — `drawCards`, `discardCard`, `playAsset`, `useCharge`, `commitCard`. Always reads fresh player state from caller. |
| `cardLookup.js` | Card search, image path resolution, charge parsing, back-face image fetch/cache. |
| `serverBuilder.js` | Creates/tears down Discord channel structure. Two-pass teardown: delete children, then categories. |
| `locationManager.js` | Location channel status pins, reveal logic, hidden-face image posting. |
| `encounterEngine.js` | Encounter deck draw/reshuffle, posting encounter cards to Discord. |
| `enemyEngine.js` | Spawning and damaging enemies in the DB. |
| `chaosBag.js` | Token draw from `data/chaos_bags.json` keyed by difficulty. |
| `deckImport.js` | Fetches decks from ArkhamDB API, validates against investigator, flattens slots. |

### Database (`bot/db/arkham.db`)
SQLite via `better-sqlite3`. Schema in `database.js`. Key tables:
- `campaign` — one row per campaign, referenced by all other tables
- `players` — one row per Discord user per campaign; holds `hand`, `deck`, `discard`, `assets` (all JSON arrays), `resources`, `hp`, `sanity`, `location_code`
- `game_session` — one row per scenario run; holds `phase`, `round`, `doom`, `encounter_deck` (JSON), channel IDs for doom/agenda/act/chaos/encounter
- `locations` — one row per location per session; holds `status`, `clues`, `status_message_id`, `card_message_id`
- `enemies` — active enemies with stats

**Migrations**: add new columns after the `init()` schema block by checking `PRAGMA table_info(players)` first — see the `assets` column migration as the pattern.

### Discord Channel Conventions
- `#doom-track` — pinned doom track updated by `/doom`, `/nextphase`, `/mythos`
- `#encounter-deck` — encounter cards posted here during mythos phase
- `<investigator-name>-hand` — private per-player channel; receives drawn/played card images and the `/dashboard` pinned status
- Location channels — created per scenario under act categories; named `revealed-<location>` / `hidden-<location>`, renamed to `🔍・<location>` on reveal and `✅・<location>` when cleared

### Scenario Data (`bot/data/scenarios/`)
JSON files define `acts`, `agendas`, `locations`, `encounter_sets`, and `setup_instructions`. Locations reference `card_code` (for image lookup) and `act_index` (controls which Discord category they're created under). Adding a new scenario requires a JSON file here and a new entry in `startgame.js`.

### Phase Flow
`game_session.phase` tracks: `pregame` → `investigation` → `enemy` → `upkeep` → `investigation` (loop). The `/mythos` command (or `/nextphase` from upkeep) adds doom, draws encounter cards, increments `round`, and resets phase to `investigation`.

### Ephemeral Replies
All player-facing ephemeral replies use `flags: 64` (not `ephemeral: true`, which is deprecated in discord.js v14).
