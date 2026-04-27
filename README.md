# Arkham Horror LCG — Discord Bot

A fully self-running Discord bot for playing **Arkham Horror: The Card Game** over Discord. No AI. Fully deterministic. The bot tracks all game state and players issue slash commands to take actions.

One game at a time per server. Full campaign mode supported.

---

## Features

- Full investigator roster with stats, signature cards, and starter decks
- Campaign progression across multiple scenarios with XP, trauma, and campaign log
- Deck management — draw, play, discard, commit skill cards, import from ArkhamDB
- Skill tests with automatic chaos token draws (Investigate, Fight, Evade, and generic stat tests)
- Enemy tracking — spawn, fight, evade, damage, and defeat enemies
- Location system — hidden/revealed locations, clue placement, investigator movement
- Phase engine — Investigation → Enemy → Upkeep → Mythos loop with automated bookkeeping
- Per-player private hand channels; read-only game-info channels (doom track, agenda, act, chaos bag)
- Card image posting from local ArkhamDB data

## Supported Campaigns

| # | Campaign |
|---|----------|
| 1 | The Night of the Zealot (Revised Core Set) |
| 2 | The Dunwich Legacy |
| 3 | The Path to Carcosa |
| 4 | The Forgotten Age |

## Tech Stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js |
| Bot Framework | discord.js v14 |
| Database | better-sqlite3 (SQLite) |
| Card Data | Local ArkhamDB JSON + images |
| Commands | Discord Application Commands (slash commands) |

---

## Setup

### Prerequisites

- Node.js 18+
- A Discord application with a bot token ([discord.com/developers](https://discord.com/developers))
- Bot granted **Administrator** permission in your server

### Install

```bash
git clone https://github.com/sambitsatpathy/Arkham-horror.git
cd Arkham-horror/bot
npm install
```

### Configure

Create `bot/.env`:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
GUILD_ID=your_server_id_here
```

### Deploy Commands & Run

```bash
cd bot
node deploy-commands.js   # register slash commands with Discord (run once, or after any command change)
node index.js             # start the bot
```

Run in the background with logging:

```bash
node index.js >> /tmp/arkham-bot.log 2>&1 &
```

---

## How to Play

See **[CHEATSHEET.md](CHEATSHEET.md)** for a full player reference including all commands, the round flow, skill test rules, and a worked example turn.

### Quick Round Flow

```
1. MYTHOS PHASE      → Host runs /mythos
2. INVESTIGATION     → Each investigator takes 3 actions
3. ENEMY PHASE       → Host runs /nextphase
4. UPKEEP            → Host runs /nextphase  (auto-draws, gains resource, readies cards)
5. Repeat from 1
```

### Starting a Game

```
/join                                          ← all players join
/investigator name:<search>                    ← pick your investigator
/deck default  OR  /deck import url:<url>      ← load a deck
/startgame campaign:<c> scenario:<s> difficulty:<d>   ← host starts the game
```

---

## Command Reference

| Category | Commands |
|----------|----------|
| **Pregame** | `/join`, `/investigator`, `/deck` |
| **Actions** | `/move`, `/investigate`, `/fight`, `/evade`, `/draw`, `/resource`, `/play`, `/use` |
| **Skill Tests** | `/test` (generic stat test for treacheries/parley) |
| **Cards** | `/hand`, `/commit`, `/discard`, `/exhaust`, `/card` |
| **Health** | `/damage`, `/horror`, `/heal`, `/stats`, `/dashboard` |
| **Enemies** | `/enemy` (list/spawn/damage/defeat) |
| **Locations** | `/reveal`, `/clue` |
| **Phase (Host)** | `/mythos`, `/nextphase`, `/advance`, `/doom`, `/resolved` |
| **Chaos Bag** | `/pull` |
| **Campaign** | `/campaignlog`, `/endscenario`, `/upgrade` |
| **System (Host)** | `/clear`, `/newgame` |

---

## Project Structure

```
bot/
├── commands/
│   ├── game/        ← in-game actions (fight, investigate, evade, etc.)
│   ├── pregame/     ← join, investigator, deck, startgame
│   ├── campaign/    ← endscenario, campaignlog, upgrade
│   └── system/      ← newgame, clear
├── engine/
│   ├── gameState.js       ← all DB reads/writes
│   ├── deck.js            ← hand/deck/discard/asset manipulation
│   ├── cardLookup.js      ← card search and image resolution
│   ├── chaosBag.js        ← chaos token draws
│   ├── enemyEngine.js     ← enemy spawn/damage
│   ├── encounterEngine.js ← encounter deck draw
│   ├── locationManager.js ← location reveal and status
│   ├── serverBuilder.js   ← Discord channel creation/teardown
│   └── doomTrack.js       ← doom counter updates
├── data/
│   ├── investigators/     ← investigator stats + starter decks
│   ├── scenarios/         ← scenario JSON files per campaign
│   └── chaos_bags.json    ← token pools by difficulty
├── db/
│   └── arkham.db          ← SQLite database
└── index.js               ← bot entry point
```

Card images and JSON data live in pack folders at the repo root (e.g. `01_Core_Set/`, `02_The_Dunwich_Legacy/`).
