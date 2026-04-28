# Arkham Horror LCG — Discord Bot Design Reference

## Overview

A fully self-running Discord bot for playing Arkham Horror: The Card Game over Discord.
No AI. Fully deterministic. Bot tracks all game state. Players issue commands to take actions.
One game at a time per server. Campaign mode supported.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js |
| Bot Framework | discord.js v14 |
| Database | better-sqlite3 (synchronous SQLite) |
| Data Source | Local files (images + JSON from ArkhamDB) |
| Commands | Discord Application Commands (slash commands + message components) |

---

## Local Data Structure

Pack image folders live at the **repo root**, not inside a subdirectory.

```
arkham-horror/
├── 01_Core_Set/
│   ├── 006_Roland_s_38_Special.png
│   ├── cards.json           ← full ArkhamDB card data (includes text, backimagesrc)
│   └── cards_index.json     ← lightweight index (bot uses this for most lookups)
├── 02_The_Dunwich_Legacy/
│   └── ...
├── bot/
│   └── ...
└── ...
```

`config.js` sets `cardDataRoot: path.join(__dirname, '..')` so `engine/cardLookup.js` walks pack directories from the repo root.

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

When `text` or `backimagesrc` is needed (charge parsing, back-face images), read the full `cards.json` directly — see `getCardCharges()` and `findBackImageSrc()` in `cardLookup.js`. Do not add `text` to the index.

---

## Project Structure

```
arkham-horror/
├── 01_Core_Set/                        # Pack folders at repo root
├── 02_The_Dunwich_Legacy/
├── ...
│
└── bot/
    ├── index.js                        # Bot entry point, event handlers, component dispatcher
    ├── deploy-commands.js              # Register slash commands with Discord
    ├── config.js                       # Token, guild ID, paths, constants
    │
    ├── commands/
    │   ├── pregame/
    │   │   ├── join.js                 # /join
    │   │   ├── investigator.js         # /investigator <name>
    │   │   └── startgame.js            # /startgame <campaign> <scenario> <difficulty>
    │   │
    │   ├── game/
    │   │   ├── move.js                 # /move <location> (autocomplete filtered to current act)
    │   │   ├── draw.js                 # /draw [count]
    │   │   ├── play.js                 # /play <card>
    │   │   ├── discard.js              # /discard <card> (autocomplete from hand)
    │   │   ├── resource.js             # /resource
    │   │   ├── stats.js                # /stats [investigator]
    │   │   ├── dashboard.js            # /dashboard — embed + action buttons
    │   │   ├── hand.js                 # /hand — show current hand
    │   │   ├── commit.js               # /commit <card> — commit skill card to test
    │   │   ├── use.js                  # /use <asset> — use charge/ability on asset
    │   │   ├── exhaust.js              # /exhaust <asset> — toggle exhausted state
    │   │   ├── subdeck.js              # /subdeck — manage asset-attached subdecks
    │   │   ├── scry.js                 # /scry — peek and reorder top deck cards
    │   │   ├── clue.js                 # /clue <add|remove> <location> <count>
    │   │   ├── doom.js                 # /doom <add|remove> <count>
    │   │   ├── damage.js               # /damage <target> <amount> (self or asset soak)
    │   │   ├── horror.js               # /horror <target> <amount> (self or asset soak)
    │   │   ├── heal.js                 # /heal <amount>
    │   │   ├── heal-horror.js          # /heal-horror <amount>
    │   │   ├── pull.js                 # /pull (chaos bag)
    │   │   ├── investigate.js          # /investigate [bonus] — intellect vs shroud
    │   │   ├── fight.js                # /fight <enemy> [bonus] — combat vs fight rating
    │   │   ├── evade.js                # /evade <enemy> [bonus] — agility vs evade rating
    │   │   ├── test.js                 # /test <stat> — generic skill test
    │   │   ├── reveal.js               # /reveal <location>
    │   │   ├── mythos.js               # /mythos (trigger mythos phase)
    │   │   ├── resolved.js             # /resolved (confirm encounter card done)
    │   │   ├── enemy.js                # /enemy <spawn|damage|defeat>
    │   │   ├── enemyphase.js           # /enemyphase — trigger enemy activation
    │   │   ├── advance.js              # /advance <act|agenda>
    │   │   ├── nextphase.js            # /nextphase — advance phase, auto-upkeep
    │   │   └── card.js                 # /card <name>
    │   │
    │   ├── campaign/
    │   │   ├── endscenario.js          # /endscenario <victory|defeat> <resolution>
    │   │   ├── upgrade.js              # /upgrade
    │   │   └── campaignlog.js          # /campaignlog
    │   │
    │   └── system/
    │       ├── newgame.js              # /newgame
    │       └── clear.js               # /clear
    │
    ├── engine/
    │   ├── cardLookup.js
    │   ├── chaosBag.js
    │   ├── deck.js
    │   ├── gameState.js
    │   ├── locationManager.js
    │   ├── encounterEngine.js
    │   ├── enemyEngine.js
    │   ├── combatEngine.js
    │   ├── serverBuilder.js
    │   └── deckImport.js
    │
    ├── data/
    │   ├── scenarios/
    │   │   ├── night_of_zealot/
    │   │   ├── dunwich_legacy/
    │   │   ├── path_to_carcosa/
    │   │   ├── forgotten_age/
    │   │   └── ...
    │   ├── investigators/
    │   │   ├── investigators.json
    │   │   └── starter_decks.json
    │   └── chaos_bags.json
    │
    ├── db/
    │   ├── database.js
    │   └── arkham.db
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
├── 🔍・your-house    ← revealed
├── 🔒・study         ← hidden
└── ...

🔒 ACT 2 — <ACT NAME> (entire category hidden)
└── ...

👤 INVESTIGATORS
├── #roland-hand      ← private, only Roland's player + bot can see
├── #daisy-hand       ← private, only Daisy's player + bot can see
└── ...
```

### Location Channel Naming Convention

| State | Prefix | Example |
|---|---|---|
| Hidden | 🔒・ | 🔒・study |
| Revealed | 🔍・ | 🔍・study |
| Cleared (no clues) | ✅・ | ✅・study |

Channel rename triggered automatically on state change.

### Location Channel Pins

**Pin 1 — Card image** (static, never edited)

**Pin 2 — Live status** (edited on every state change):
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
CREATE TABLE IF NOT EXISTS campaign (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  scenario_index  INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  id                  INTEGER PRIMARY KEY,
  campaign_id         INTEGER NOT NULL,
  discord_id          TEXT NOT NULL UNIQUE,
  discord_name        TEXT NOT NULL,
  investigator_code   TEXT NOT NULL,
  investigator_name   TEXT NOT NULL,
  is_host             INTEGER DEFAULT 0,
  hp                  INTEGER NOT NULL,
  max_hp              INTEGER NOT NULL,
  sanity              INTEGER NOT NULL,
  max_sanity          INTEGER NOT NULL,
  resources           INTEGER DEFAULT 5,
  clues               INTEGER DEFAULT 0,
  action_count        INTEGER DEFAULT 3,
  deck                TEXT DEFAULT '[]',
  hand                TEXT DEFAULT '[]',
  discard             TEXT DEFAULT '[]',
  assets              TEXT DEFAULT '[]',
  arkhamdb_deck_id    TEXT,
  deck_name           TEXT,
  xp_total            INTEGER DEFAULT 0,
  xp_spent            INTEGER DEFAULT 0,
  physical_trauma     INTEGER DEFAULT 0,
  mental_trauma       INTEGER DEFAULT 0,
  is_eliminated       INTEGER DEFAULT 0,
  is_killed           INTEGER DEFAULT 0,
  is_insane           INTEGER DEFAULT 0,
  FOREIGN KEY (campaign_id) REFERENCES campaign(id)
);

CREATE TABLE IF NOT EXISTS game_session (
  id                   INTEGER PRIMARY KEY,
  campaign_id          INTEGER NOT NULL,
  scenario_code        TEXT NOT NULL,
  difficulty           TEXT NOT NULL,
  phase                TEXT DEFAULT 'pregame',
  doom                 INTEGER DEFAULT 0,
  doom_threshold       INTEGER NOT NULL,
  act_index            INTEGER DEFAULT 0,
  agenda_index         INTEGER DEFAULT 0,
  round                INTEGER DEFAULT 1,
  encounter_deck       TEXT DEFAULT '[]',
  encounter_discard    TEXT DEFAULT '[]',
  doom_channel_id      TEXT,
  agenda_channel_id    TEXT,
  act_channel_id       TEXT,
  chaos_channel_id     TEXT,
  encounter_channel_id TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaign(id)
);

CREATE TABLE IF NOT EXISTS locations (
  id               INTEGER PRIMARY KEY,
  session_id       INTEGER NOT NULL,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  channel_id       TEXT,
  status           TEXT DEFAULT 'hidden',
  clues            INTEGER DEFAULT 0,
  doom             INTEGER DEFAULT 0,
  act_index        INTEGER DEFAULT 0,
  status_message_id TEXT,
  card_message_id   TEXT,
  FOREIGN KEY (session_id) REFERENCES game_session(id)
);

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
  is_hunter       INTEGER DEFAULT 0,   -- moves toward investigators each enemy phase
  is_alerted      INTEGER DEFAULT 0,
  is_exhausted    INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES game_session(id)
);

CREATE TABLE IF NOT EXISTS campaign_log (
  id              INTEGER PRIMARY KEY,
  campaign_id     INTEGER NOT NULL,
  scenario_code   TEXT,
  entry           TEXT NOT NULL,
  is_crossed_out  INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaign(id)
);

CREATE TABLE IF NOT EXISTS deck_upgrades (
  id              INTEGER PRIMARY KEY,
  campaign_id     INTEGER NOT NULL,
  player_id       INTEGER NOT NULL,
  scenario_index  INTEGER NOT NULL,
  card_added      TEXT NOT NULL,
  card_removed    TEXT,
  xp_spent        INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaign(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);
```

**Migrations:** add new columns after the `init()` schema block by checking `PRAGMA table_info(players)` first.

---

## Scenario JSON Format

### campaign.json

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

### Scenario JSON schema

```json
{
  "code": "01_the_gathering",
  "name": "The Gathering",
  "pack": "core2",
  "intro_text": ["Paragraph 1...", "Paragraph 2..."],
  "acts": [
    {
      "index": 0,
      "name": "Trapped",
      "card_code": "01105",
      "doom_threshold": 3,
      "move_investigators_to": null
    }
  ],
  "agendas": [
    {
      "index": 0,
      "name": "What's Going On?!",
      "card_code": "01105a",
      "doom_threshold": 3
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
    }
  ],
  "encounter_sets": ["the_gathering", "rats", "ghouls"],
  "setup_instructions": ["Set aside Ghoul Priest.", "Investigators begin in the Study."],
  "resolutions": {
    "A": { "label": "Resolution A — Title", "text": ["Paragraph 1...", "Paragraph 2..."] },
    "defeat": { "label": "Defeat", "text": ["..."] }
  }
}
```

`acts[].move_investigators_to`: optional location code — if set, all investigators auto-move there and the location is revealed when this act is reached.

---

## Chaos Bag Configuration

```json
{
  "easy":     ["+1","+1","0","0","0","-1","-1","-1","-2","-2","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"],
  "standard": ["+1","0","0","-1","-1","-1","-2","-2","-3","-4","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"],
  "hard":     ["0","0","0","-1","-1","-2","-2","-3","-3","-4","-5","skull","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"],
  "expert":   ["0","-1","-1","-2","-2","-3","-3","-4","-4","-5","-6","-8","skull","skull","skull","cultist","tablet","elder_thing","auto_fail","elder_sign"]
}
```

Token display: `skull` → 💀, `cultist` → 🗡️, `tablet` → 📜, `elder_thing` → 👁️, `auto_fail` → ❌, `elder_sign` → ✨

---

## Investigators

Format (stored in `bot/data/investigators/investigators.json`):

```json
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
    { "faction": "neutral",  "level": { "min": 0, "max": 5 } },
    { "faction": ["seeker"], "level": { "min": 0, "max": 2 } }
  ]
}
```

Values sourced from each pack's `cards.json` for `type_code === "investigator"` entries. `/investigator` uses autocomplete (not static `addChoices`) to support the full roster.

---

## Command Reference

### Pregame

| Command | Description | Who |
|---|---|---|
| `/join` | Register as player. First to join becomes Host. | Anyone |
| `/investigator <name>` | Pick investigator + load starter deck. Autocomplete full roster. | Registered players |
| `/startgame <campaign> <scenario> <difficulty>` | Validate all players ready, build server, start game. Campaign autocomplete + scenario autocomplete filtered to campaign. | Host only |

### In-Game

| Command | Description | Who |
|---|---|---|
| `/move <location>` | Move to location. Reveals if hidden. Autocomplete filtered to current act locations. | Active player |
| `/draw [count]` | Draw cards. Updates pinned hand display. | Active player |
| `/play <card>` | Play card from hand. | Active player |
| `/discard <card>` | Discard from hand. Autocomplete from current hand. | Active player |
| `/hand` | Show current hand contents. | Active player |
| `/dashboard` | Show investigator embed with action buttons. | Active player |
| `/resource` | Gain 1 resource. | Active player |
| `/use <asset>` | Use charge or activate ability on in-play asset. | Active player |
| `/exhaust <asset>` | Toggle asset exhausted/ready state. | Active player |
| `/subdeck` | Manage asset-attached subdecks (e.g. Spells, Knowledges). | Active player |
| `/scry [count]` | Peek top N deck cards, optionally reorder. | Active player |
| `/commit <card>` | Commit skill card from hand to active skill test. | Active player |
| `/pull` | Draw chaos token. Posts to #chaos-bag. | Active player |
| `/investigate [bonus]` | Intellect vs shroud. Chaos token drawn. On success, take 1 clue from location. | Active player |
| `/fight <enemy> [bonus]` | Combat vs enemy Fight rating. Chaos token drawn. On success, deal damage. | Active player |
| `/evade <enemy> [bonus]` | Agility vs enemy Evade rating. Chaos token drawn. On success, exhaust enemy. | Active player |
| `/test <stat>` | Generic skill test (for treacheries, parley). Stat autocomplete. | Active player |
| `/stats [investigator]` | Show HP, sanity, resources, clues, hand size. | Anyone |
| `/clue <add\|remove> <location> <count>` | Modify location clue count. Updates pin. | Active player |
| `/doom <add\|remove> <count>` | Modify doom. Updates #doom-track. | Host |
| `/damage <target> <amount>` | Deal HP damage to self or in-play asset (ally/equipment soak). Autocomplete includes self + all assets. | Active player |
| `/horror <target> <amount>` | Deal sanity damage to self or in-play asset. Autocomplete includes self + all assets. | Active player |
| `/heal <amount>` | Heal HP. Cannot exceed max. | Active player |
| `/heal-horror <amount>` | Heal sanity. Cannot exceed max. | Active player |
| `/reveal <location>` | Force-reveal a location. | Host |
| `/enemy spawn <name> <location>` | Spawn enemy at location. | Host |
| `/enemy damage <id> <amount>` | Deal damage to enemy. Auto-defeats at 0 HP. | Active player |
| `/enemy defeat <id>` | Manually defeat enemy. | Active player |
| `/mythos` | Trigger Mythos phase. Places doom, checks agenda threshold at phase end, draws encounter cards per investigator. | Host |
| `/enemyphase` | Trigger enemy activation. Hunter enemies move + attack. Engaged enemies attack. | Host |
| `/nextphase` | Advance phase. Auto-processes upkeep (resource + draw + ready assets) when entering upkeep phase. | Host |
| `/resolved` | Confirm encounter card resolved. Bot advances to next. | Active player |
| `/advance <act\|agenda>` | Advance act or agenda manually. | Host |
| `/card <name>` | Look up any card image. | Anyone |

### Campaign

| Command | Description | Who |
|---|---|---|
| `/endscenario <victory\|defeat> <resolution>` | End scenario. Calculates XP, applies trauma, posts resolution text, records campaign log. | Host |
| `/upgrade list` | Show deck with XP costs + available XP. | Each player |
| `/upgrade add <card> remove <card>` | Spend XP to upgrade card. | Each player |
| `/upgrade done` | Lock in upgrades for next scenario. | Each player |
| `/campaignlog` | Show all campaign log entries. | Anyone |

### System

| Command | Description | Who |
|---|---|---|
| `/newgame` | Wipe game channels, reset DB. | Host |
| `/clear` | Clear bot messages in current channel. | Host |

---

## Game Flow

### Pregame Phase

```
1. Players run /join (up to 4)
2. Each player runs /investigator <name>
   - Picks investigator + loads starter deck in one command
   - Bot posts investigator card image in #pregame
3. Host runs /startgame <campaign> <scenario> <difficulty>
   - Bot validates: all players have investigators
   - Bot loads scenario JSON
   - Bot creates Discord server structure
   - Bot initialises DB: session, locations, encounter deck
   - Bot posts intro_text then setup_instructions in #pregame
   - Bot posts initial doom track, agenda + act cards
   - Game begins
```

### Investigation Phase (each round)

```
1. Upkeep (/nextphase entering upkeep)
   - Bot auto-processes ALL investigators:
     +1 resource each, draw 1 card each, ready all exhausted assets
   - Bot posts upkeep summary in #doom-track

2. Investigation
   - Players take turns (up to 3 actions each):
     /move, /draw, /play, /resource, /pull, /investigate, /fight, /evade
   - Bot updates location pins on any state change

3. Enemy Phase (/enemyphase)
   - Bot activates each enemy per rules (see Enemy Activation)

4. Mythos Phase (/mythos)
   - Bot places 1 doom on agenda → updates #doom-track
   - Bot draws 1 encounter card per investigator
   - After all resolved: bot checks doom threshold → if reached, auto-advances agenda
   - Bot posts "Round X complete"
```

### Enemy Activation (/enemyphase)

```
For each active enemy:
  Hunter + not engaged:
    → Bot moves enemy to nearest investigator's location
    → Enemy attacks: deals damage + horror to investigator
  Engaged (any):
    → Enemy attacks: deals damage + horror to investigator
  Non-hunter + not engaged:
    → No action

Attack = auto-applies damage/horror to investigator in DB, updates doom track pin
```

### Act/Agenda Advancement

```
/advance act
  → Bot posts new act card in #act
  → Bot unlocks next act category
  → If act has move_investigators_to: auto-moves all investigators, reveals location
  → Posts announcement in #doom-track

/advance agenda (manual or auto-triggered at end of /mythos)
  → Bot posts new agenda card in #agenda
  → Updates doom threshold
  → Posts announcement
  → If final agenda: triggers defeat sequence
```

### End Scenario

```
/endscenario <victory|defeat> <resolution>
  → Bot posts resolution text from scenario JSON in #pregame
  → Bot calculates XP: base + defeated enemies + unadvanced agendas
  → Bot applies trauma from scenario result
  → Bot records campaign log entries
  → Bot posts scenario summary: XP earned, trauma taken, log additions
```

---

## Location Reveal Logic

```
Trigger: /move <location>
  1. Check location status in DB
  2. If hidden:
     a. Update DB status → "revealed"
     b. Rename channel: 🔒・name → 🔍・name
     c. Unlock channel permissions for all investigators
     d. Pin location card image (static)
     e. Post + pin live status message
     f. Post "Roland Banks enters the Study"
  3. If already revealed:
     a. Update investigator position in DB
     b. Edit live status pin
     c. Post "Roland Banks enters the Study"
  4. If clues = 0 and was > 0: rename → ✅・name

Trigger: /reveal <location> (force)
  → Same as step 2, no movement or position update
```

---

## Encounter Card Engine

```
/mythos called by Host

For each investigator (in player order):
  1. Draw top card from encounter_deck
  2. Post card image in #encounter-deck
  3. Read type_code:

  ENEMY:
    → Post: "Enemy drawn: [name]. Where does it spawn?"
    → Show revealed locations as select menu
    → Bot runs enemy spawn internally → updates location pin

  TREACHERY:
    → Post card image + name
    → Post: "Resolve this treachery, then run /resolved"
    → Set session phase = "awaiting_resolve"
    → /resolved → continue to next investigator

  SURGE:
    → Draw another card immediately

After all resolved:
  → Check doom threshold → auto-advance agenda if reached
  → Post "Mythos phase complete. Round [N] begins."
  → Increment round counter
```

---

## Chaos Bag Engine

```
/pull or any skill test

1. Read difficulty from game_session
2. Load token pool from chaos_bags.json
3. Random pick
4. Post in #chaos-bag:
   ┌─────────────────────────┐
   │ 🎲 CHAOS TOKEN DRAW      │
   │ Player: @Roland          │
   │ Result: 💀 Skull         │
   │ Resolve skull effect.    │
   └─────────────────────────┘
5. Token returns to bag (standard rules)
```

---

## Card Lookup Engine

```
cardLookup.js

Input: card name string (fuzzy) or card code
Process:
  1. Normalise input (lowercase, strip punctuation)
  2. Walk pack directories from cardDataRoot (repo root)
  3. Load each pack's cards_index.json (cached singleton _allCards)
  4. Match by name (exact first, then fuzzy/partial)
  5. Return: { card, imagePath }

For text/backimagesrc: read full cards.json directly (not cached in index)

Image serving:
  - Read with fs.readFileSync
  - Pass as Discord AttachmentBuilder
  - No CDN or web server needed
```

---

## Private Hand Channels

Each investigator: `#roland-hand`

**Permissions:** Bot full access. Investigator's Discord user: read + send. Everyone else: no access.

**Pinned hand summary** (single message, edited on every draw/play/discard):
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

## Dashboard Embed

`/dashboard` posts an ephemeral embed with action buttons:

```
[Roland Banks]                    [investigator card thumbnail]
Roland Banks — The Fed
─────────────────────────────────
HP:        7 / 9   ████████░░
Sanity:    4 / 5   ████████░░
Resources: 3 💰
Clues:     2 🔎
Location:  Study
─────────────────────────────────
[Draw]  [Resource]  [Play Card]  [Discard]
[Move]  [Commit]
```

Button interactions dispatch to same handlers as slash commands. Select menus used for card/location selection where choices exist.

---

## Doom Track Display

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

## Campaign Persistence

**Persists between scenarios:** `xp_total`, `xp_spent`, `physical_trauma`, `mental_trauma`, `is_killed`, `is_insane`, deck composition, campaign log

**Resets each scenario:** `hp` → max minus physical_trauma, `sanity` → max minus mental_trauma, `resources` → 5, `clues` → 0, `hand` → [], `discard` → [], `deck` → reshuffled

---

## Deck Management

Players build decks externally on ArkhamDB. Bot trusts ArkhamDB validation for faction/XP rules.

**Flow:**
```
1. /join
2. /investigator <name>  ← picks investigator + loads starter deck
3. (optional) /investigator import <url>  ← override with custom ArkhamDB deck
4. /startgame  ← host validates all players ready
```

**Deck import:** Bot fetches `https://arkhamdb.com/api/public/deck/<id>.json`, flattens `slots` map to card code array, validates investigator match, adds signature cards + 1 random basic weakness.

**Starter decks:** `bot/data/investigators/starter_decks.json`, keyed by investigator code. Each deck is 30 cards (signature cards added automatically).

**Between-scenario upgrades:**
- `/upgrade add <card> remove <card>` — cost = XP level difference
- `/upgrade add <card>` — cost = card XP level
- `/upgrade remove <card>` — free
- `/upgrade done` — lock in, ready for next scenario

---

## Permissions & Roles

Bot auto-assigns **🎲 Game Host** role to first `/join`.

Host-only: `/startgame`, `/newgame`, `/endscenario`, `/mythos`, `/enemyphase`, `/reveal`, `/advance`, `/doom`, `/enemy spawn`

**Required bot permissions:** Manage Channels, Manage Roles, Send Messages, Embed Links, Attach Files, Manage Messages, Read Message History, View Channels

---

## Error Handling

- All commands check active game session. If none: reject with clear message.
- Phase-locked commands: `/draw`, `/play`, `/move` reject during Mythos phase.
- Duplicate investigator picks: "Already taken by @player".
- Invalid location names: fuzzy-match + confirm before acting.
- Missing card images: post card name as text embed with ⚠️ instead of crashing.
- DB errors: logged to #bot-log, command fails gracefully.

---

## Key Constraints

- **Deck building is external.** ArkhamDB enforces faction/XP rules. Bot trusts imported decks.
- **One game per server.** No multi-session logic.
- **Max 4 players.** Hard cap in `/join`.
- **No AI.** All logic deterministic + RNG.
- **Images as file attachments.** `new AttachmentBuilder(path)`. Never a URL.
- **Card lookup is local.** Read from pack folders using `cards_index.json`.
- **SQLite is synchronous.** Use `better-sqlite3`. No async/await for DB calls.
- **All Discord channel operations are async.** Always await them.
- **Live status messages are edits.** Store message IDs in DB, fetch and edit.
- **Scenario JSON is source of truth** for locations, acts, agendas, encounter sets.
- **Bot only tracks what players tell it.** Card effects not auto-resolved. Bot displays, players resolve, bot updates on command. Exceptions: upkeep, enemy activation, doom threshold check — all strictly rules-timed.
