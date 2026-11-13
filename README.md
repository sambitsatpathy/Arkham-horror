# Arkham-style Discord bot (no AI)

A deterministic rules kernel plus a Discord adapter. Every location is a channel, every player has a private channel, the doom and turn trackers are channels. Nothing in it calls a language model: narration is hand-authored templates picked by a seeded counter.

**Status: milestones 0-5 are built and tested against a fake Discord. It has never been run against a real Discord server.** Read "What is not proven" before you invite it anywhere.

## Run it

Requires Node >= 22.18 (type-stripping and `node:sqlite`).

```
npm install
npm test                      # 140 tests, no network, no Discord
npm run simulate              # headless games with a simple policy
npm run coverage              # narration + card-script coverage report
```

Card data is not included in the repo. A clone of [Kamalisk/arkhamdb-json-data](https://github.com/Kamalisk/arkhamdb-json-data) is expected at `./arkhamdb-json-data-master` (the default for `ARKHAM_DATA`). To update it:

```
git -C arkhamdb-json-data-master pull
```

Environment (any of these can also be set in a `.env` file at the project root; `load-env.ts` reads it at startup, and real environment variables take precedence — see `.env.example`):

| var | meaning |
|---|---|
| `DISCORD_TOKEN` | bot token |
| `ARKHAM_DATA` | path to your clone of arkhamdb-json-data (default `./arkhamdb-json-data-master`) |
| `DB_PATH` | sqlite file (default `arkham.sqlite`) |
| `HOST_ROLE_ID` | role allowed to use `/host` (server admins always can) |
| `ARCHIVE_CATEGORY_ID` | optional; finished games' categories are moved here |
| `NARRATOR_WEBHOOK` | optional; narration posted via webhook. Off by default |
| `CARD_IMAGES` | `off` hides card faces (default on) |
| `CARD_IMAGE_BASE` / `CARD_IMAGE_EXT` | where card faces are linked from (default `https://arkhamdb.com/bundles/cards/` and `.png`) |

```
npm run register   # once: slash commands (DISCORD_TOKEN, APP_ID, GUILD_ID from .env or the environment)
npm start
```

The bot needs: Manage Channels, Manage Roles, View Channels, Send Messages, Embed Links, Read Message History, Manage Messages (pins). The permission list is in `src/adapter/discord.ts` (`REQUIRED_PERMISSIONS`).

## How it is laid out

- `src/kernel/`: pure rules engine. `step(state, answer) -> {state, events, pending}`. State is plain JSON; RNG is a counter. Same seed and same answers always give the same game.
- `src/adapter/`: Discord side. `store.ts` (sqlite, optimistic version check), `channels.ts` (channel plan, permissions, repair), `host.ts` (per-game pipeline and timers), `bot.ts` (command routing), `render.ts` (panels, prompts), `narration/` (the authored voice), `discord.ts` (discord.js port).
- Everything in the adapter talks to a `DiscordPort`. `fake.ts` implements it in memory and follows Discord's permission order, which is how the whole adapter is tested.
- Persistence: one log row per step (answer + events) plus a snapshot every 10 steps. Replay from seed + log reproduces the game exactly; recovery after a restart uses the newest snapshot plus the tail.

## What is built (M0-M5)

- Lobby, join, starter deck or imported deck, ready, start. Location channels appear on first reveal; revealed ones are view-only to everyone, writable to investigators standing there.
- Travel, search, fight, slip away, confront, talk, rummage, scrounge, play, use, pool, withdraw, hold, look, self, hand, party, case, map, bag, journal, card, rules, settings, `/improve`, and the `/host` set.
- Prompts go to the player's private channel with buttons; stale or forged buttons are refused; interactions are idempotent.
- Timers: optional prompts time out; required ones nudge, and a third nudge flags the host. Pause, hold and away seats work.
- The whole Night of the Zealot first scenario (The Gathering) plays from start to ending, locks every channel, writes a first-person journal per player from templates, and purges after the retention period (7 days) while keeping the log. Opening a new story (`/host new`) clears the channels of finished stories in that server straight away, so the old game does not linger for the retention week.

## Card faces

Real card images are shown by link only: the bot builds a URL to the image ArkhamDB serves and Discord fetches it; nothing is copied or stored. A place's face is posted in its channel when it opens, a foe's when it arrives, a treachery's where it strikes, the current agenda and act sit on the hour and trail panels, and your own hand and board have a "Look closely at a card" menu that shows the face to you alone. `/card` shows the face plus the text from your data clone. Nothing hidden is shown: unopened places and undrawn cards post nothing.
The URL pattern is ArkhamDB's own (`https://arkhamdb.com/bundles/cards/{code}.png`), checked to return `image/png` with no referer or user-agent blocking. If ArkhamDB is unreachable or changes its paths, images may not render. Set `CARD_IMAGES=off` to hide them, or `CARD_IMAGE_BASE` / `CARD_IMAGE_EXT` to point elsewhere. Card art belongs to its publisher; this only links to it.

## What is approximated (cards)

These behave close to the printed card but not exactly. Each is a place to look first if a ruling surprises you.

- Police Badge's extra actions can only be given on your own turn (the engine only offers a fast ability to the player whose turn it is).
- Shotgun: damage by margin works; the "if you fail and would damage another investigator" clause is not modelled.
- Grotesque Statue keeps whichever of the two tokens has the better modifier instead of asking the player.
- Sure Gamble only flips numeric minus tokens (not symbols with a negative modifier).
- Wendy's reaction is offered on the first token drawn in a test, once per test; tokens that make you draw again are not offered it.
- Mind Wipe blanks keywords (hunter, retaliate, aloof) and forced effects, not every possible kind of enemy text.
- Cards with a Revelation that are not weaknesses (The Necronomicon) are set aside from the opening hand and replaced, like weaknesses, then shuffled back in.
- Daisy's tome-only action is spent automatically on the first tome action you take.
- Duplicate-card commits and revelation cards follow the rules as written, but a few one-off interactions between two cards at once may resolve in a simpler order than the printed one.
- Scrying reorders the top three with successive picks. Disc of Itzamna is offered only to investigators at the place the enemy spawns.
- Hospital Debts' experience penalty is applied to the scenario's experience tally; nothing is carried to a later scenario.

## What is not proven (please read)

- **`src/adapter/discord.ts` has never talked to Discord.** It type-checks. Permission overwrites, rate limits, webhook narration, modal and autocomplete behaviour are only proven against the fake. Expect a first-contact bug or two there.
- Hour panel: with card art on it shows "N of T before the hour turns". The number printed on the agenda card is the threshold T, not the current count.
- Player cards: **all 99 Core Set player cards are scripted** and all five Core Set investigators (Roland, Daisy, "Skids", Agnes, Wendy) are playable, each with a starter list. The four non-Roland starter lists are my own assembly from the cards each can use, not the publisher's recommended decks. Encounter cards are a different story: **15 of 41 are scripted** (every card The Gathering uses); encounter cards from other scenarios are unscripted, and a deck or scenario using them fails validation rather than playing wrongly.
- Duplicate investigators are off by default (`allowDuplicates`); the host can enable them for a table that wants two of the same.
- Scenario data written from memory and **unverified**: chaos bag contents per difficulty, the resolutions, and the "ghouls loose" ending after agenda 3. Check these against your own copy of the rules before trusting balance.
- The ArkhamDB deck-import endpoint shape is from memory and unverified. Pasting deck JSON is the dependable path.
- Mulligan prompts go to personal channels, not the shared lobby channel.
- Campaign carry-over is minimal: `/improve` edits a saved deck using experience stored per user. There is no multi-scenario campaign log.
- The simple simulation policy nearly always loses; win paths are covered by kernel unit tests, not by simulation. Balance has not been tuned.
- M6 (hardening) is not done: no rate-limit load test, the `voice` setting exists but does nothing, `/host swap` takes a seat id plus a user, retention is a constant rather than a setting.

## Content rules

- No card text or art ships in this repo. Cards are read from your own clone of the data at start-up.
- Narration and flavor are original. Templates avoid rules vocabulary (a test enforces a banned-word list), and the tests check every event kind that fires in play has a line or is silent on purpose.
