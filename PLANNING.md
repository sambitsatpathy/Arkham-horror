# Arkham Horror LCG — Discord Bot Planning Document

## Overview

A fully self-running Discord bot for playing Arkham Horror: The Card Game over Discord.
No AI. Fully deterministic. Bot tracks all game state. Players issue commands to take actions.
One game at a time per server. Campaign mode supported.
Starting campaign: **The Night of the Zealot** (Revised Core Set).

---

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js |
| Bot Framework | discord.js v14 |
| Database | better-sqlite3 (synchronous SQLite) |
| Data Source | Local files (images + JSON from ArkhamDB) |
| Slash Commands | Discord Application Commands (registered via deploy-commands.js) |

---

## Local Data Structure

All card data lives in `arkhamdb_images/` already downloaded to disk.

```
arkhamdb_images/
├── 01_Core_Set/
│   ├── 001_Roland_Banks.jpg
│   ├── cards.json           ← full ArkhamDB card data
│   └── cards_index.json     ← lightweight index (bot uses this)
├── 02_The_Dunwich_Legacy/
│   └── ...
└── ...
```

### cards_index.json fields used by the bot

```json
{
  "code": "01001",
  "position": 1,
  "name": "Roland Banks",
  "subname": "The Fed",
  "type_code": "investigator",
  "faction_code": "guardian",
  "encounter_code": null,
  "pack_code": "core2",
  "health": 9,
  "sanity": 5,
  "cost": null,
  "xp": null,
  "deck_limit": 1,
  "restrictions": { "investigator": { "01001": "01001" } },
  "traits": "Detective. Agency.",
  "imagesrc": "/bundles/cards/01001.jpg"
}
```

---

## Project Structure

```
arkham-bot/
├── index.js                        # Bot entry point, event handlers
├── deploy-commands.js              # Register slash commands with Discord
├── config.js                       # Token, guild ID, paths, constants
│
├── commands/
│   ├── pregame/
│   │   ├── join.js                 # /join
│   │   ├── investigator.js         # /investigator <name>
│   │   └── startgame.js            # /startgame <scenario> <difficulty>
│   │
│   ├── game/
│   │   ├── move.js                 # /move <location>
│   │   ├── draw.js                 # /draw [count]
│   │   ├── play.js                 # /play <card>
│   │   ├── discard.js              # /discard <card>
│   │   ├── resource.js             # /resource
│   │   ├── stats.js                # /stats [investigator]
│   │   ├── clue.js                 # /clue <add|remove> <location> <count>
│   │   ├── doom.js                 # /doom <add|remove> <count>
│   │   ├── damage.js               # /damage <amount> (to self)
│   │   ├── horror.js               # /horror <amount> (to self)
│   │   ├── heal.js                 # /heal <amount>
│   │   ├── pull.js                 # /pull (chaos bag)
│   │   ├── reveal.js               # /reveal <location> (force reveal)
│   │   ├── mythos.js               # /mythos (trigger mythos phase)
│   │   ├── resolved.js             # /resolved (confirm encounter card done)
│   │   ├── enemy.js                # /enemy <spawn|damage|defeat>
│   │   ├── advance.js              # /advance <act|agenda>
│   │   └── card.js                 # /card <name> (look up any card image)
│   │
│   ├── campaign/
│   │   ├── endscenario.js          # /endscenario <victory|defeat>
│   │   ├── upgrade.js              # /upgrade (spend XP between scenarios)
│   │   └── campaignlog.js          # /campaignlog (show campaign log)
│   │
│   └── system/
│       └── newgame.js              # /newgame (full server wipe + reset)
│
├── engine/
│   ├── cardLookup.js               # Search local images + index by name/code
│   ├── chaosBag.js                 # Token pool, draw, reseal logic
│   ├── deck.js                     # Shuffle, draw, play, discard
│   ├── gameState.js                # Read/write game state to DB
│   ├── locationManager.js          # Reveal, lock, update, status pins
│   ├── encounterEngine.js          # Draw encounter card, route by type
│   ├── enemyEngine.js              # Spawn, attack, defeat enemies
│   ├── combatEngine.js             # Chaos pull + modifier math for combat
│   └── serverBuilder.js            # Create/destroy Discord channels + categories
│
├── data/
│   ├── scenarios/
│   │   ├── night_of_zealot/
│   │   │   ├── campaign.json       # Campaign-level metadata
│   │   │   ├── 01_the_gathering.json
│   │   │   ├── 02_the_midnight_masks.json
│   │   │   └── 03_the_devourer_below.json
│   │   └── ...
│   ├── investigators/
│   │   ├── core2.json              # Investigator configs (deck rules, starter decks)
│   │   └── starter_decks.json      # Predefined starter decks per investigator
│   └── chaos_bags.json             # Token configs per difficulty
│
├── db/
│   ├── database.js                 # Init SQLite, create tables, run migrations
│   └── arkham.db                   # Created at runtime
│
└── package.json
```

---

## Discord Server Structure

### Permanent Channels (never deleted)

```
⚙️ SYSTEM
├── #pregame          ← players register + pick investigators here
└── #bot-log          ← bot errors and system messages
```

### Built on /startgame — wiped on /newgame

```
📋 GAME INFO
├── #doom-track       ← pinned message updated live
├── #agenda           ← current agenda card image pinned
├── #act              ← current act card image pinned
├── #chaos-bag        ← all chaos token pulls posted here
└── #encounter-deck   ← encounter cards drawn + resolved here

🔍 ACT 1 — <ACT NAME> (unlocked)
├── 🔍・your-house    ← revealed (investigator entered or scenario disclosed)
├── 🔒・study         ← hidden
├── 🔒・hallway       ← hidden
├── 🔒・attic         ← hidden
├── 🔒・cellar        ← hidden
└── 🔒・parlor        ← hidden

🔒 ACT 2 — <ACT NAME> (entire category hidden)
└── ...

👤 INVESTIGATORS
├── #roland-hand      ← private, only Roland's player + bot can see
├── #daisy-hand       ← private, only Daisy's player + bot can see
└── ...               ← one per active investigator (max 4)
```

### Location Channel Naming Convention

| State | Prefix | Example |
|---|---|---|
| Hidden | 🔒・ | 🔒・study |
| Revealed | 🔍・ | 🔍・study |
| Cleared (no clues) | ✅・ | ✅・study |

Channel rename is triggered automatically by bot on state change.

### Location Channel Pins (two separate pinned messages)

**Pin 1 — Card image** (static, never edited):
- The location card image from local folder

**Pin 2 — Live status** (bot edits this message on every state change):
```
📍 STUDY
━━━━━━━━━━━━━━━━━
Shroud:       3
Clues:        2 🔎
Doom:         0 💀
━━━━━━━━━━━━━━━━━
Enemies:      Ghoul Minion 🐀
Investigators: @Roland
━━━━━━━━━━━━━━━━━
```

---

## Database Schema

```sql
-- Active campaign
CREATE TABLE IF NOT EXISTS campaign (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,        -- "Night of the Zealot"
  scenario_index  INTEGER DEFAULT 0,    -- which scenario we're on (0-based)
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Players registered for current campaign
CREATE TABLE IF NOT EXISTS players (
  id                  INTEGER PRIMARY KEY,
  campaign_id         INTEGER NOT NULL,
  discord_id          TEXT NOT NULL UNIQUE,
  discord_name        TEXT NOT NULL,
  investigator_code   TEXT NOT NULL,    -- ArkhamDB card code e.g. "01001"
  investigator_name   TEXT NOT NULL,
  is_host             INTEGER DEFAULT 0,
  -- Per-scenario state (reset each scenario)
  hp                  INTEGER NOT NULL,
  max_hp              INTEGER NOT NULL,
  sanity              INTEGER NOT NULL,
  max_sanity          INTEGER NOT NULL,
  resources           INTEGER DEFAULT 5,
  clues               INTEGER DEFAULT 0,
  action_count        INTEGER DEFAULT 3,
  -- Card state (JSON arrays of card codes)
  deck                TEXT DEFAULT '[]',
  hand                TEXT DEFAULT '[]',
  discard             TEXT DEFAULT '[]',
  -- Campaign persistent state
  xp_total            INTEGER DEFAULT 0,
  xp_spent            INTEGER DEFAULT 0,
  physical_trauma     INTEGER DEFAULT 0,
  mental_trauma       INTEGER DEFAULT 0,
  is_eliminated       INTEGER DEFAULT 0,  -- defeated this scenario
  is_killed           INTEGER DEFAULT 0,  -- permanently dead
  is_insane           INTEGER DEFAULT 0,  -- permanently insane
  FOREIGN KEY (campaign_id) REFERENCES campaign(id)
);

-- Active game session (one per scenario run)
CREATE TABLE IF NOT EXISTS game_session (
  id              INTEGER PRIMARY KEY,
  campaign_id     INTEGER NOT NULL,
  scenario_code   TEXT NOT NULL,        -- "01_the_gathering"
  difficulty      TEXT NOT NULL,        -- easy / standard / hard / expert
  phase           TEXT DEFAULT 'pregame', -- pregame / investigation / enemy / upkeep / mythos / end
  doom            INTEGER DEFAULT 0,
  doom_threshold  INTEGER NOT NULL,
  act_index       INTEGER DEFAULT 0,
  agenda_index    INTEGER DEFAULT 0,
  round           INTEGER DEFAULT 1,
  -- Encounter deck (JSON arrays of card codes)
  encounter_deck  TEXT DEFAULT '[]',
  encounter_discard TEXT DEFAULT '[]',
  -- Channel IDs for live updates
  doom_channel_id     TEXT,
  agenda_channel_id   TEXT,
  act_channel_id      TEXT,
  chaos_channel_id    TEXT,
  encounter_channel_id TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaign(id)
);

-- Locations for current scenario
CREATE TABLE IF NOT EXISTS locations (
  id              INTEGER PRIMARY KEY,
  session_id      INTEGER NOT NULL,
  code            TEXT NOT NULL,        -- e.g. "study"
  name            TEXT NOT NULL,
  channel_id      TEXT,                 -- Discord channel ID once created
  status          TEXT DEFAULT 'hidden', -- hidden / revealed / cleared
  clues           INTEGER DEFAULT 0,
  doom            INTEGER DEFAULT 0,
  act_index       INTEGER DEFAULT 0,   -- which act this location belongs to
  status_message_id TEXT,              -- ID of the live status pin
  card_message_id   TEXT,              -- ID of the card image pin
  FOREIGN KEY (session_id) REFERENCES game_session(id)
);

-- Enemies currently in play
CREATE TABLE IF NOT EXISTS enemies (
  id              INTEGER PRIMARY KEY,
  session_id      INTEGER NOT NULL,
  location_code   TEXT NOT NULL,
  card_code       TEXT NOT NULL,
  name            TEXT NOT NULL,
  hp              INTEGER NOT NULL,
  max_hp          INTEGER NOT NULL,
  fight           INTEGER NOT NULL,
  evade           INTEGER NOT NULL,
  damage          INTEGER NOT NULL,
  horror          INTEGER NOT NULL,
  is_alerted      INTEGER DEFAULT 0,
  is_exhausted    INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES game_session(id)
);

-- Campaign log entries
CREATE TABLE IF NOT EXISTS campaign_log (
  id              INTEGER PRIMARY KEY,
  campaign_id     INTEGER NOT NULL,
  scenario_code   TEXT,
  entry           TEXT NOT NULL,
  is_crossed_out  INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaign(id)
);
```

---

## Scenario JSON Format

### campaign.json

```json
{
  "code": "night_of_zealot",
  "name": "The Night of the Zealot",
  "scenarios": [
    "01_the_gathering",
    "02_the_midnight_masks",
    "03_the_devourer_below"
  ]
}
```

### Scenario JSON (e.g. 01_the_gathering.json)

```json
{
  "code": "01_the_gathering",
  "name": "The Gathering",
  "pack": "core2",
  "acts": [
    {
      "index": 0,
      "name": "Trapped",
      "card_code": "01105",
      "doom_threshold": 3
    },
    {
      "index": 1,
      "name": "The Barrier",
      "card_code": "01106",
      "doom_threshold": 3
    },
    {
      "index": 2,
      "name": "What Have You Done?",
      "card_code": "01107",
      "doom_threshold": null
    }
  ],
  "agendas": [
    {
      "index": 0,
      "name": "What's Going On?!",
      "card_code": "01105a",
      "doom_threshold": 3
    },
    {
      "index": 1,
      "name": "Rise of the Ghouls",
      "card_code": "01106a",
      "doom_threshold": 7
    },
    {
      "index": 2,
      "name": "They're Getting Out!",
      "card_code": "01107a",
      "doom_threshold": 10
    }
  ],
  "locations": [
    {
      "code": "study",
      "name": "Study",
      "card_code": "01111",
      "act_index": 0,
      "shroud": 2,
      "clues_per_investigator": 2,
      "start_revealed": true,
      "starting_location": true
    },
    {
      "code": "hallway",
      "name": "Hallway",
      "card_code": "01112",
      "act_index": 0,
      "shroud": 1,
      "clues_per_investigator": 0,
      "start_revealed": false
    },
    {
      "code": "attic",
      "name": "Attic",
      "card_code": "01113",
      "act_index": 0,
      "shroud": 4,
      "clues_per_investigator": 2,
      "start_revealed": false
    },
    {
      "code": "cellar",
      "name": "Cellar",
      "card_code": "01114",
      "act_index": 0,
      "shroud": 4,
      "clues_per_investigator": 2,
      "start_revealed": false
    },
    {
      "code": "parlor",
      "name": "Parlor",
      "card_code": "01115",
      "act_index": 0,
      "shroud": 2,
      "clues_per_investigator": 0,
      "start_revealed": false
    }
  ],
  "encounter_sets": [
    "the_gathering",
    "rats",
    "ghouls",
    "striking_fear",
    "ancient_evils",
    "chilling_cold"
  ],
  "setup_instructions": [
    "Set aside Ghoul Priest.",
    "Investigators begin in the Study.",
    "Place 1 resource on each Ghoul card."
  ],
  "resolution": {
    "victory": ["01_the_gathering_resolution_1", "01_the_gathering_resolution_2"],
    "defeat": ["01_the_gathering_defeat"]
  }
}
```

---

## Chaos Bag Configuration

```json
{
  "easy": ["+1","+1","0","0","0","-1","-1","-1","-2","-2","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"],
  "standard": ["+1","0","0","-1","-1","-1","-2","-2","-3","-4","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"],
  "hard": ["0","0","0","-1","-1","-2","-2","-3","-3","-4","-5","skull","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"],
  "expert": ["0","-1","-1","-2","-2","-3","-3","-4","-4","-5","-6","-8","skull","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"]
}
```

Token display map:
- Numeric tokens: show value directly (`+1`, `-3`)
- `skull` → 💀
- `cultist` → 🗡️
- `tablet` → 📜
- `elder_thing` → 👁️
- `auto_fail` → ❌
- `elder_sign` → ✨

---

## Investigators (Revised Core Set)

```json
[
  {
    "code": "01001",
    "name": "Roland Banks",
    "subname": "The Fed",
    "faction": "guardian",
    "health": 9,
    "sanity": 5,
    "skills": { "willpower": 3, "intellect": 3, "combat": 4, "agility": 2 },
    "deck_size": 30,
    "deck_options": [
      { "faction": "guardian", "level": { "min": 0, "max": 5 } },
      { "faction": "neutral", "level": { "min": 0, "max": 5 } },
      { "faction": ["seeker"], "level": { "min": 0, "max": 2 } }
    ]
  },
  {
    "code": "01002",
    "name": "Daisy Walker",
    "subname": "The Librarian",
    "faction": "seeker",
    "health": 5,
    "sanity": 9,
    "skills": { "willpower": 3, "intellect": 5, "combat": 2, "agility": 2 },
    "deck_size": 30,
    "deck_options": [
      { "faction": "seeker", "level": { "min": 0, "max": 5 } },
      { "faction": "neutral", "level": { "min": 0, "max": 5 } },
      { "faction": ["mystic"], "level": { "min": 0, "max": 2 } }
    ]
  },
  {
    "code": "01003",
    "name": "\"Skids\" O'Toole",
    "subname": "The Ex-Con",
    "faction": "rogue",
    "health": 8,
    "sanity": 6,
    "skills": { "willpower": 2, "intellect": 3, "combat": 3, "agility": 4 },
    "deck_size": 30,
    "deck_options": [
      { "faction": "rogue", "level": { "min": 0, "max": 5 } },
      { "faction": "neutral", "level": { "min": 0, "max": 5 } },
      { "faction": ["guardian", "seeker"], "level": { "min": 0, "max": 2 } }
    ]
  },
  {
    "code": "01004",
    "name": "Agnes Baker",
    "subname": "The Waitress",
    "faction": "mystic",
    "health": 6,
    "sanity": 8,
    "skills": { "willpower": 5, "intellect": 2, "combat": 2, "agility": 3 },
    "deck_size": 30,
    "deck_options": [
      { "faction": "mystic", "level": { "min": 0, "max": 5 } },
      { "faction": "neutral", "level": { "min": 0, "max": 5 } },
      { "faction": ["survivor"], "level": { "min": 0, "max": 2 } }
    ]
  },
  {
    "code": "01005",
    "name": "Wendy Adams",
    "subname": "The Urchin",
    "faction": "survivor",
    "health": 6,
    "sanity": 7,
    "skills": { "willpower": 4, "intellect": 3, "combat": 1, "agility": 4 },
    "deck_size": 30,
    "deck_options": [
      { "faction": "survivor", "level": { "min": 0, "max": 5 } },
      { "faction": "neutral", "level": { "min": 0, "max": 5 } },
      { "faction": ["rogue"], "level": { "min": 0, "max": 2 } }
    ]
  }
]
```

---

## Command Reference

### Pregame Commands

| Command | Description | Who |
|---|---|---|
| `/join` | Register as a player. First to join becomes Host. | Anyone |
| `/investigator <name>` | Pick your investigator. Bot posts card image + confirms. First come first served. | Registered players |
| `/deck default` | Load the predefined starter deck for your investigator. No internet needed. | Registered players |
| `/deck import <url>` | Import a custom deck from ArkhamDB. Must match chosen investigator. | Registered players |
| `/startgame <scenario> <difficulty>` | Validate all players have investigators + decks imported, build server, start game. | Host only |

### In-Game Commands

| Command | Description | Who |
|---|---|---|
| `/move <location>` | Move to location. Reveals it if hidden. Updates position. | Active player |
| `/draw [count]` | Draw cards from deck into hand. Default 1. | Active player |
| `/play <card>` | Play a card from hand. Bot removes from hand, prompts for target if needed. | Active player |
| `/discard <card>` | Discard a card from hand. | Active player |
| `/resource` | Gain 1 resource. | Active player |
| `/pull` | Draw chaos token. Posts result in #chaos-bag. | Active player |
| `/investigate [bonus]` | Investigate current location. Draws chaos token, compares intellect + token vs shroud. On success, transfers 1 clue from location to player. Posts result to location channel. | Active player |
| `/stats [investigator]` | Show HP, sanity, resources, clues, hand size. | Anyone |
| `/clue <add\|remove> <location> <count>` | Modify clue count on a location. Updates pin. | Active player |
| `/doom <add\|remove> <count>` | Modify doom. Updates #doom-track. Checks agenda threshold. | Host |
| `/damage <amount>` | Deal HP damage to yourself. | Active player |
| `/horror <amount>` | Deal sanity damage to yourself. | Active player |
| `/heal <amount>` | Heal HP. Cannot exceed max. | Active player |
| `/heal-horror <amount>` | Heal sanity. Cannot exceed max. | Active player |
| `/reveal <location>` | Force-reveal a location (scenario instruction). | Host |
| `/enemy spawn <name> <location>` | Spawn an enemy at a location. Updates location pin. | Host |
| `/enemy damage <id> <amount>` | Deal damage to an enemy. Defeat if HP reaches 0. | Active player |
| `/enemy defeat <id>` | Manually defeat an enemy. | Active player |
| `/mythos` | Trigger Mythos phase. Bot places doom, checks agenda, draws encounter cards per investigator. | Host |
| `/resolved` | Confirm encounter card has been resolved. Bot moves to next. | Active player |
| `/advance <act\|agenda>` | Advance act or agenda. Bot unlocks next category/card, updates pins. | Host |
| `/card <name>` | Look up any card image from local folder. | Anyone |

### Campaign Commands

| Command | Description | Who |
|---|---|---|
| `/endscenario <victory\|defeat>` | End current scenario. Bot calculates XP, applies trauma, records campaign log. | Host |
| `/upgrade` | Between scenarios: spend XP to upgrade deck. Bot tracks cards added/removed. | Each player |
| `/campaignlog` | Show all campaign log entries. | Anyone |

### System Commands

| Command | Description | Who |
|---|---|---|
| `/newgame` | Wipe all game channels/categories. Reset DB. Return to pregame state. | Host |

---

## Game Flow

### Pregame Phase

```
1. Players run /join (up to 4)
2. Each player runs /investigator <name>
   - Bot posts investigator card image in #pregame
   - Bot confirms pick (locked in)
   - No duplicates allowed
3. Host runs /startgame <scenario> <difficulty>
   - Bot validates: all players have investigators
   - Bot loads scenario JSON
   - Bot creates Discord server structure:
       → GAME INFO category + channels
       → Act categories (first unlocked, rest hidden)
       → Location channels per act (🔒 prefix, channel locked)
       → Private #<name>-hand channels per investigator
   - Bot initialises DB: session, locations, encounter deck
   - Bot pins location cards on revealed starting locations
   - Bot posts setup instructions in #pregame
   - Bot posts initial doom track in #doom-track
   - Bot posts initial agenda + act cards
   - Game begins
```

### Investigation Phase (each round)

```
1. Upkeep
   - Bot posts "Upkeep phase" in #doom-track
   - Each investigator: gains 1 resource (/resource to confirm)
   - Each investigator: draws 1 card (/draw to confirm)
   - Exhausted cards ready (manual confirm)

2. Investigation
   - Players take turns (up to 3 actions each):
       /move, /draw, /play, /resource, /pull (for skill tests)
   - Bot updates location pins on any state change

3. Mythos Phase (/mythos)
   - Bot places 1 doom on agenda → updates #doom-track
   - Bot checks agenda doom threshold:
       → If reached: /advance agenda triggers automatically
   - Bot draws 1 encounter card per investigator
   - Each card posted in #encounter-deck with image
   - Bot reads card type:
       → Enemy: bot asks "Which location to spawn?" → /enemy spawn
       → Treachery: bot posts card, waits for /resolved
       → Location: handled per card text (manual)
   - Bot posts "Round X complete" when all resolved
```

### Act/Agenda Advancement

```
/advance act
  → Bot posts new act card in #act
  → Bot unlocks next act category (makes visible)
  → Bot locks previous act category (read-only)
  → Bot updates act doom threshold
  → Posts announcement in #doom-track

/advance agenda
  → Bot posts new agenda card in #agenda
  → Updates doom threshold
  → Applies agenda consequences (adds doom, spawns enemies — manual confirm)
  → If final agenda: triggers defeat sequence
```

### End Scenario

```
/endscenario <victory|defeat>
  → Bot calculates XP:
      Base XP from scenario
      +1 per defeated enemy (tracked in DB)
      +1 per agenda that didn't advance
  → Bot applies trauma from scenario result
  → Bot records campaign log entries
  → Bot posts scenario summary in #pregame:
      XP earned per investigator
      Trauma taken
      Campaign log additions
  → Bot asks: "Ready for next scenario?" 
  → Host runs /startgame <next_scenario> to continue
     OR /newgame to start fresh campaign
```

---

## Location Reveal Logic

```
Trigger: /move <location>
  1. Check location status in DB
  2. If hidden:
     a. Update DB status → "revealed"
     b. Rename Discord channel: 🔒・name → 🔍・name
     c. Unlock channel permissions for all investigators
     d. Pin location card image (static)
     e. Post + pin live status message
     f. Post "Roland Banks enters the Study" in channel
  3. If already revealed:
     a. Update investigator position in DB
     b. Edit live status pin (add investigator name)
     c. Post "Roland Banks enters the Study" in channel
  4. Check if all clues collected:
     a. If clues = 0 and was > 0: rename → ✅・name

Trigger: /reveal <location> (force)
  → Same as above but no movement, no investigator position update
```

---

## Encounter Card Engine

```
/mythos called by Host

For each investigator (in player order):
  1. Bot draws top card from encounter_deck in DB
  2. Bot posts card image in #encounter-deck
  3. Bot reads type_code from card data:

  ENEMY:
    → Bot posts: "Enemy drawn: [name]. Where does it spawn?"
    → Bot shows list of revealed locations as buttons
    → Player/Host selects location
    → Bot runs /enemy spawn internally
    → Updates location pin

  TREACHERY:
    → Bot posts card image + name
    → Bot posts: "Resolve this treachery, then run /resolved"
    → Bot waits (sets session phase = "awaiting_resolve")
    → /resolved → Bot continues to next investigator

  SURGE:
    → Bot draws another card immediately, repeats flow

4. When all investigators resolved:
   → Bot posts "Mythos phase complete. Round [N] begins."
   → Increments round counter in DB
```

---

## Chaos Bag Engine

```
/pull called by player (during skill test)

1. Read difficulty from game_session
2. Load token pool from chaos_bags.json
3. Remove tokens already drawn this round (if tracking)
4. Random pick from remaining tokens
5. Post in #chaos-bag:
   ┌─────────────────────────┐
   │ 🎲 CHAOS TOKEN DRAW      │
   │ Player: @Roland          │
   │ Result: 💀 Skull         │
   │                          │
   │ Resolve skull effect     │
   │ for current scenario.    │
   └─────────────────────────┘
6. Token goes back in bag (standard rules)
```

---

## Card Lookup Engine

```
cardLookup.js

Input: card name string (fuzzy)
Process:
  1. Normalise input (lowercase, strip punctuation)
  2. Walk arkhamdb_images/ recursively
  3. Load each pack's cards_index.json
  4. Match by name (exact first, then fuzzy/partial)
  5. Return: { imagePath, cardData }

Image serving:
  - Read file with fs.readFileSync
  - Pass as Discord AttachmentBuilder
  - Never need a CDN or web server
```

---

## Private Hand Channels

Each investigator gets a private channel: `#roland-hand`

**Permissions:**
- Bot: full access
- Investigator's Discord user: read + send
- Everyone else: no access

**Bot posts to this channel on:**
- `/draw` → shows drawn card images
- `/play` → confirms card played, removes from display
- `/discard` → confirms discarded

**Bot maintains a pinned hand summary message:**
```
🃏 ROLAND'S HAND (4 cards)
━━━━━━━━━━━━━━━━━
[1] .38 Special
[2] Flashlight
[3] Emergency Cache
[4] Evidence!
━━━━━━━━━━━━━━━━━
Deck: 22 cards remaining
Discard: 3 cards
```

---

## Campaign Persistence

Between scenarios the following persists per player:

- `xp_total` / `xp_spent`
- `physical_trauma` / `mental_trauma`
- `is_killed` / `is_insane`
- Deck composition (after upgrades via /upgrade)
- Campaign log entries

Between scenarios the following resets:

- `hp` → max_hp minus physical_trauma
- `sanity` → max_sanity minus mental_trauma
- `resources` → 5
- `clues` → 0
- `hand` → []
- `discard` → []
- `deck` → reshuffled full deck

---

## Deck Building

Deck building is **not handled inside the bot**. Players build their decks externally on [ArkhamDB](https://arkhamdb.com) which fully enforces all investigator-specific rules, faction restrictions, XP limits, and deck size requirements.

### Deck Options

After picking an investigator, each player either imports a custom deck or uses the default starter deck:

**Option A — Use default starter deck:**
```
/deck default
```
Bot loads the predefined starter deck for the player's chosen investigator from `data/investigators/starter_decks.json`. No internet required. Ready instantly.

**Option B — Import custom deck from ArkhamDB:**
```
/deck import <arkhamdb_deck_url>

Example:
/deck import https://arkhamdb.com/decklist/view/12345/roland-starter
```

### Deck Import Flow (Option B)

**What the bot does:**
1. Extracts the deck ID from the URL
2. Calls ArkhamDB public API: `https://arkhamdb.com/api/public/deck/12345.json`
3. Reads the returned card codes + quantities
4. Cross-references each code against local `cards_index.json` files
5. Validates the deck belongs to the player's chosen investigator
6. Loads the deck into the DB as the player's starting deck (flattened array of card codes)
7. Adds mandatory signature cards + random basic weakness automatically
8. Confirms in #pregame: "Roland's deck loaded — 30 cards ✓"

**ArkhamDB deck API response (relevant fields):**
```json
{
  "id": 12345,
  "name": "Roland Starter",
  "investigator_code": "01001",
  "slots": {
    "01006": 2,
    "01007": 2,
    "01016": 1
  },
  "sideSlots": {},
  "meta": {}
}
```

`slots` is a map of `{ card_code: quantity }`. Bot flattens this into an array of card codes for the deck engine.

### Deck Validation Rules (bot enforces)

- Deck investigator code must match the player's chosen investigator
- Total card count must be exactly 30 (excluding investigator + signature cards)
- Bot warns if any card code is not found in local `cards_index.json` files

Bot does **not** re-validate faction restrictions or XP costs — that is ArkhamDB's job. If a player imports a valid ArkhamDB deck, the bot trusts it.

### Starter Decks (data/investigators/starter_decks.json)

Predefined starter decks per investigator for the Revised Core Set. Card codes match ArkhamDB. Each deck is exactly 30 cards excluding investigator + signature cards (those are added automatically).

```json
{
  "01001": {
    "investigator": "Roland Banks",
    "deck": {
      "01006": 2,
      "01007": 2,
      "01008": 2,
      "01009": 2,
      "01010": 2,
      "01016": 2,
      "01017": 2,
      "01018": 2,
      "01019": 2,
      "01020": 2,
      "01021": 2,
      "01022": 2,
      "01023": 2,
      "01024": 2,
      "01025": 2
    },
    "signature_cards": ["01006b"],
    "weakness": "01000"
  }
}
```

**Note for Claude Code:** The exact card codes for each investigator's starter deck must be verified against the Revised Core Set (core2) card list. Use `arkhamdb_images/core2/cards_index.json` as the reference. The starter deck codes above are illustrative — replace with correct core2 codes during implementation. Each investigator's recommended starter deck can also be found on ArkhamDB under that investigator's page.

### Default Deck Flow (/deck default)

```
/deck default
  1. Bot reads player's chosen investigator from DB
  2. Loads starter deck from data/investigators/starter_decks.json
  3. Adds signature cards automatically
  4. Adds 1 random basic weakness from neutral weakness pool
  5. Loads full deck into DB
  6. Confirms in #pregame: "Roland's starter deck loaded — 32 cards ✓"
```

### Between-Scenario Upgrades (/upgrade)

After `/endscenario`, each player spends earned XP to upgrade their deck before the next scenario.

```
/upgrade list
  → Bot posts current deck as a list with card names + XP costs
  → Shows available XP

/upgrade add <card_code> remove <card_code>
  → Bot validates:
      - Player has enough XP
      - Replacement card is higher level version of removed card (same name, higher XP)
  → Bot deducts XP, updates deck in DB
  → Confirms: "Replaced Machete (0) with .41 Derringer (2). XP remaining: 1"

/upgrade add <card_code>
  → For adding new cards (uses XP equal to card level)

/upgrade remove <card_code>
  → For removing cards without replacement (no XP cost)

/upgrade done
  → Locks in upgrades, deck is ready for next scenario
```

**XP cost rules:**
- Upgrading to a higher-level version of same card: cost = difference in XP levels
- Adding a brand new card: cost = card's XP level
- Level 0 cards: free to swap in/out

### DB additions for deck management

Add to `players` table:
```sql
arkhamdb_deck_id   TEXT,    -- original ArkhamDB deck ID for reference
deck_name          TEXT,    -- deck name from ArkhamDB
```

Add new table:
```sql
CREATE TABLE IF NOT EXISTS deck_upgrades (
  id              INTEGER PRIMARY KEY,
  campaign_id     INTEGER NOT NULL,
  player_id       INTEGER NOT NULL,
  scenario_index  INTEGER NOT NULL,   -- after which scenario
  card_added      TEXT NOT NULL,      -- card code added
  card_removed    TEXT,               -- card code removed (null if new addition)
  xp_spent        INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaign(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);
```

### Updated Pregame Flow with Deck Import

```
1. /join               → register as player
2. /investigator <n>   → pick investigator
3. /deck default       → load starter deck instantly
   OR
   /deck import <url>  → import custom deck from ArkhamDB
4. (repeat 1-3 for all players)
5. /startgame          → host validates ALL players have decks loaded, then builds server
```

Bot blocks `/startgame` if any player has not imported a deck.

### engine/deckImport.js (new file)

Handles all deck import logic:
- Fetch deck JSON from ArkhamDB API
- Flatten slots into card code array
- Validate investigator match
- Cross-reference local card data
- Return structured deck object for DB storage

---

## Doom Track Display (#doom-track pinned message)

```
☠️  DOOM TRACK
━━━━━━━━━━━━━━━━━━━━━━
Agenda:  Rise of the Ghouls
Doom:    5 / 7  [████████░░]
Round:   3
Phase:   Investigation
━━━━━━━━━━━━━━━━━━━━━━
Investigators:
  🔍 Roland Banks   — Study        HP: 7/9  SAN: 4/5
  🔍 Daisy Walker   — Your House   HP: 5/5  SAN: 8/9
━━━━━━━━━━━━━━━━━━━━━━
```

Bot edits this message on every state change.

---

## Permissions & Roles

Bot auto-assigns a **🎲 Game Host** Discord role to the first player who runs `/join`.

Host-only commands: `/startgame`, `/newgame`, `/endscenario`, `/mythos`, `/reveal`, `/advance`, `/doom`, `/enemy spawn`

Bot needs these Discord permissions:
- Manage Channels
- Manage Roles
- Send Messages
- Embed Links
- Attach Files
- Manage Messages (for pinning)
- Read Message History
- View Channels

---

## Error Handling

- All commands check: is there an active game session? If not, reject with clear message.
- Phase-locked commands: `/draw`, `/play`, `/move` reject during Mythos phase.
- Duplicate investigator picks: bot rejects with "Already taken by @player".
- Invalid location names: bot fuzzy-matches and confirms before acting.
- Missing card images: bot posts card name as text embed with ⚠️ warning instead of crashing.
- DB errors: logged to #bot-log, command fails gracefully with user-facing message.

---

## Implementation Order (Suggested for Claude Code)

### Phase 1 — Foundation
1. `package.json` with dependencies
2. `config.js`
3. `db/database.js` — schema + init
4. `index.js` — bot login, command loader, event handler
5. `deploy-commands.js`
6. `engine/cardLookup.js`
7. `commands/game/card.js` — `/card` command (test card lookup)

### Phase 2 — Pregame
8. `commands/pregame/join.js`
9. `commands/pregame/investigator.js`
10. `engine/deckImport.js`
11. `commands/pregame/deck.js` — `/deck import`
12. `engine/serverBuilder.js`
13. `commands/pregame/startgame.js`
14. `commands/system/newgame.js`

### Phase 3 — Core Game Loop
13. `engine/locationManager.js`
14. `commands/game/move.js`
15. `engine/deck.js`
16. `commands/game/draw.js`, `play.js`, `discard.js`
17. `commands/game/resource.js`
18. `commands/game/stats.js`
19. `commands/game/doom.js`
20. `commands/game/clue.js`

### Phase 4 — Combat & Chaos ✅ Complete
21. `engine/chaosBag.js`
22. `commands/game/pull.js`
23. `engine/enemyEngine.js`
24. `commands/game/enemy.js`
25. `commands/game/fight.js` — Combat skill test vs enemy Fight rating, with damage and defeat
26. `commands/game/evade.js` — Agility skill test vs enemy Evade rating, exhausts enemy on success
27. `commands/game/damage.js`, `horror.js`, `heal.js`

### Phase 5 — Mythos & Encounter ✅ Complete
28. `engine/encounterEngine.js`
29. `commands/game/mythos.js`
30. `commands/game/resolved.js`
31. `commands/game/advance.js`

### Phase 6 — Campaign ✅ Complete
32. `commands/campaign/endscenario.js`
33. `commands/campaign/upgrade.js`
34. `commands/campaign/campaignlog.js`

### Phase 7 — Scenario Data ✅ Complete
35. `data/scenarios/night_of_zealot/` (3 scenarios)
36. `data/scenarios/dunwich_legacy/` (8 scenarios)
37. `data/scenarios/path_to_carcosa/` (8 scenarios)
38. `data/scenarios/forgotten_age/` (8 scenarios)
39. `data/chaos_bags.json`
40. `data/investigators/investigators.json` (all investigators across all cycles)

### Phase 8 — Additional Commands ✅ Complete
41. `commands/game/exhaust.js` — toggle asset exhausted/ready state
42. `commands/game/test.js` — generic skill test (stat autocomplete, chaos token, card commits) for treacheries and parley
43. `/discard` — added autocomplete handler with hand card lookup
44. `/commit`, `/hand`, `/dashboard`, `/use` — asset/card utility commands

### Phase 9 — Polish & Bug Fixes ✅ Complete
45. `engine/serverBuilder.js` — game-info channels (doom-track, agenda, act, chaos-bag, encounter-deck) set read-only for @everyone on creation
46. `commands/game/investigate.js` — fixed `getPlayer(player.id)` → `getPlayer(interaction.user.id)`
47. `commands/game/nextphase.js` — fixed upkeep loop using `getPlayer(row id)` → `getPlayerById(row id)`
48. `engine/deckImport.js` — fixed `buildStarterDeck` to handle both field name formats (core vs Dunwich starter decks)
49. `CHEATSHEET.md` — full player reference for all 37 commands
50. `README.md` — project overview, setup, and command reference

---

## Key Constraints & Notes for Claude Code

- **Deck building is external.** Players use ArkhamDB to build decks, bot imports via API. Bot trusts ArkhamDB validation for faction/XP rules.
- **One game per server at all times.** No multi-session logic needed anywhere.
- **Max 4 players.** Hard cap enforced in `/join`.
- **No AI.** All logic is deterministic rules + RNG. No API calls to any AI service.
- **Images served as file attachments.** Use `new AttachmentBuilder(path)` from discord.js. Never a URL.
- **Card lookup is local only.** Read from `arkhamdb_images/` using the `cards_index.json` in each pack folder.
- **SQLite is synchronous.** Use `better-sqlite3`, not `sqlite3`. No async/await needed for DB calls.
- **All Discord channel/category operations are async.** Always await them.
- **Live status messages are edits, not new messages.** Store message IDs in DB, fetch and edit them.
- **Scenario JSON is the source of truth** for locations, acts, agendas, encounter sets.
- **Bot only tracks what players tell it.** Card effects are not auto-resolved. Bot displays cards, players resolve, bot updates state on command.

---

## Expansion Roadmap

### Phase 1 — Campaign Selection in `/startgame` *(next)*

`/startgame` currently hardcodes Night of the Zealot scenarios as static `addChoices`. Replace with:
1. A `campaign` string option with static choices (one per supported campaign).
2. A `scenario` option with `setAutocomplete(true)` — autocomplete handler filters scenarios to the chosen campaign by loading that campaign's `campaign.json`.

**Campaign registry to add in `startgame.js`:**
```js
const CAMPAIGNS = {
  night_of_zealot: { name: 'The Night of the Zealot', dir: 'night_of_zealot' },
  dunwich_legacy:  { name: 'The Dunwich Legacy',       dir: 'dunwich_legacy'  },
  path_to_carcosa: { name: 'The Path to Carcosa',      dir: 'path_to_carcosa' },
  forgotten_age:   { name: 'The Forgotten Age',        dir: 'forgotten_age'   },
  circle_undone:   { name: 'The Circle Undone',        dir: 'circle_undone'   },
  dream_eaters:    { name: 'The Dream-Eaters',         dir: 'dream_eaters'    },
  innsmouth:       { name: 'The Innsmouth Conspiracy', dir: 'innsmouth'       },
  edge_of_earth:   { name: 'Edge of the Earth',        dir: 'edge_of_earth'   },
  scarlet_keys:    { name: 'The Scarlet Keys',         dir: 'scarlet_keys'    },
  feast_hemlock:   { name: 'Feast of Hemlock Vale',    dir: 'feast_hemlock'   },
  drowned_city:    { name: 'The Drowned City',         dir: 'drowned_city'    },
};
```

**`campaign.json` schema** (one per `bot/data/scenarios/<dir>/`):
```json
{
  "code": "dunwich_legacy",
  "name": "The Dunwich Legacy",
  "scenarios": [
    { "key": "extracurricular_activity", "name": "Extracurricular Activity", "file": "01_extracurricular_activity" },
    { "key": "house_always_wins",        "name": "The House Always Wins",    "file": "02_the_house_always_wins"   }
  ]
}
```

---

### Phase 2 — Investigator Expansion

Currently only the 5 core investigators are in `core2.json` and `/investigator` uses static `addChoices` (Discord cap: 25).

**Changes needed:**
- `bot/data/investigators/core2.json` → expand to `investigators.json` covering all investigators
- `bot/commands/pregame/investigator.js` → replace `addChoices` with `setAutocomplete(true)` + autocomplete handler

**Investigator data format** (same as current `core2.json` entries):
```json
{
  "code": "02001",
  "name": "Harvey Walters",
  "subname": "The Professor",
  "faction": "seeker",
  "health": 7,
  "sanity": 9,
  "skills": { "willpower": 4, "intellect": 5, "combat": 2, "agility": 1 },
  "deck_size": 30,
  "deck_options": [...]
}
```
Values can be pulled from each pack's `cards.json` for `type_code === "investigator"` entries.

**Investigators to add by cycle:**

| Cycle | Investigators |
|-------|--------------|
| Dunwich Legacy | Rex Murphy, Jenny Barnes, Jim Culver, "Ashcan" Pete |
| Path to Carcosa | Mark Harrigan, Minh Thi Phan, Sefina Rousseau, Akachi Onyele, William Yorick |
| Forgotten Age | Leo Anderson, Ursula Downs, Finn Edwards, Father Mateo, Calvin Wright |
| Circle Undone | Joe Diamond, Patrice Hathaway, Monterey Jack |
| Dream-Eaters | Luke Robinson, Diana Stanley, Rita Young, Marie Lambeau |
| Standalone starters | Jacqueline Fine, Stella Clark, Nathaniel Cho, Harvey Walters, Winifred Habbamock |
| Edge of the Earth | Carolyn Fern, Tommy Muldoon, Mandy Thompson, Tony Morgan, Lola Hayes |
| Scarlet Keys | Bob Jenkins, Kymani Jones, Amina Zidane, Hank Samson |
| Feast of Hemlock Vale | Darrell Simmons, Kate Winthrop, Alessio Rivaldi, Becca Carroll |

---

### Phase 3 — Scenario JSON Authoring

Each scenario JSON needs (see `01_the_gathering.json` for the full schema):
- `code`, `name`, `pack`
- `acts[]` — `index`, `name`, `card_code`, `doom_threshold`, `move_investigators_to?` (optional location code — if set, all investigators are automatically moved there and the location is revealed when this act is reached)
- `agendas[]` — `index`, `name`, `card_code`, `doom_threshold`
- `locations[]` — `code`, `name`, `card_code`, `act_index`, `shroud`, `clues_per_investigator`, `start_revealed`, `starting_location?`
- `encounter_sets[]` — array of `encounter_code` strings matching card data `encounter_code` field
- `setup_instructions[]` — strings shown in `#pregame` at game start

**Priority order:**
1. ✅ Dunwich Legacy (8 scenarios) — done
2. ✅ Path to Carcosa (8 scenarios) — done
3. Forgotten Age (8 scenarios) — next
4. Remaining cycles in release order

---

### Phase 4 — Starter Decks

`bot/data/investigators/starter_decks.json` currently only covers the core 5. For each new investigator add:
```json
"02001": {
  "deck": { "01000": 2, "02010": 1 },
  "signature_cards": ["02006", "02007"]
}
```
Slot data can be pulled from ArkhamDB `/api/public/decklists/by_investigator/<code>.json` or authored from official starter deck lists.

---

---

### Phase 5 — Narrative Text (parallel with Phase 3)

Each scenario JSON should carry its full narrative so the bot can narrate at the right moment without any external API calls.

**Fields to add to every scenario JSON:**

```json
{
  "intro_text": ["Paragraph 1 of the opening narration...", "Paragraph 2..."],
  "setup_instructions": ["...existing field..."],
  "resolutions": {
    "A": { "label": "Resolution A — Title", "text": ["Paragraph 1...", "Paragraph 2..."] },
    "B": { "label": "Resolution B — Title", "text": ["..."] },
    "interlude": { "label": "Interlude", "text": ["..."] }
  }
}
```

**When each field is used:**

| Field | Trigger | Where posted |
|-------|---------|-------------|
| `intro_text` | `/startgame` | `#pregame` before setup instructions |
| `setup_instructions` | `/startgame` | `#pregame` after intro |
| `resolutions.*` | `/endscenario resolution:<A/B/C>` | `#pregame` as closing narration |

**Changes needed:**
- `bot/commands/pregame/startgame.js` — post `intro_text` paragraphs before `setup_instructions`
- `bot/commands/campaign/endscenario.js` — add `resolution` string option with autocomplete from scenario's `resolutions` keys; post the chosen resolution text to `#pregame`
- All scenario JSONs — add `intro_text` and `resolutions` when authoring (source text from the physical rulebook or ArkhamDB's scenario pages)

**Source for text:** The physical scenario booklets are the canonical source. ArkhamDB's card data has act/agenda `back_text` which contains some resolution text — cross-reference when authoring.

---

### Implementation Order

| Step | Status | Track |
|------|--------|-------|
| Campaign + scenario autocomplete in `/startgame` | ✅ Done | Phase 1 |
| Investigator autocomplete in `/investigator` | ✅ Done | Phase 2 |
| Expand `investigators.json` (all investigators) | ✅ Done | Phase 2 |
| Dunwich Legacy scenario JSONs (8 scenarios) | ✅ Done | Phase 3 |
| Dunwich Legacy starter decks (5 investigators) | ✅ Done | Phase 4 |
| Narrative text fields in scenario JSONs | ✅ Done | Phase 5 |
| `/startgame` intro narration | ✅ Done | Phase 5 |
| `/endscenario` resolution narration | ✅ Done | Phase 5 |
| Path to Carcosa scenario JSONs (8 scenarios) | ✅ Done | Phase 3 |
| Path to Carcosa starter decks (6 investigators) | ✅ Done | Phase 4 |
| Forgotten Age scenario JSONs (8 scenarios) | ✅ Done | Phase 3 |
| `/fight` command (Combat skill test) | ✅ Done | Phase 8 |
| `/evade` command (Agility skill test) | ✅ Done | Phase 8 |
| `/exhaust` command (toggle asset exhausted) | ✅ Done | Phase 8 |
| `/test` command (generic stat test w/ autocomplete) | ✅ Done | Phase 8 |
| `/discard` autocomplete | ✅ Done | Phase 8 |
| Read-only game-info channels in serverBuilder | ✅ Done | Phase 9 |
| Bug fix: investigate.js getPlayer discord id | ✅ Done | Phase 9 |
| Bug fix: nextphase.js upkeep getPlayerById | ✅ Done | Phase 9 |
| Bug fix: deckImport.js starter deck field names | ✅ Done | Phase 9 |
| CHEATSHEET.md (full player reference) | ✅ Done | Phase 9 |
| README.md | ✅ Done | Phase 9 |
| Forgotten Age starter decks (5 investigators) | Pending | Phase 4 |
| Circle Undone scenario JSONs (8 scenarios) | Pending | Phase 3 |
| Dream-Eaters scenario JSONs (8 scenarios) | Pending | Phase 3 |
| Innsmouth Conspiracy scenario JSONs (8 scenarios) | Pending | Phase 3 |
| Edge of the Earth scenario JSONs (8 scenarios) | Pending | Phase 3 |
| Scarlet Keys scenario JSONs (8 scenarios) | Pending | Phase 3 |
| Feast of Hemlock Vale scenario JSONs (8 scenarios) | Pending | Phase 3 |
| Drowned City scenario JSONs (8 scenarios) | Pending | Phase 3 |
| Starter decks for remaining cycles | Pending | Phase 4 |
