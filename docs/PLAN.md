# Plan: what is done, what to verify, what is left

Status as of 2026-11-13. The bot is a deterministic (no AI) rules kernel plus a Discord adapter for an Arkham-style cooperative card game, first scenario *The Gathering*. Design documents: *Player Experience and Commands* (https://claude.ai/artifact/HdXvHGr84QuSZyvKdJPTR5) and *Discord Adapter Spec* (https://claude.ai/artifact/4HtRfJHWDFhNVCPg6WJsHG).

Legend: **[x]** done and covered by tests, **[~]** done with a known simplification, **[?]** needs checking by a human or against the real service, **[ ]** not started.

## 1. Decisions that are settled

- No AI anywhere. Narration is hand-authored templates chosen by a seeded counter; the engine is deterministic (same seed + same answers = same game).
- No card text or art is shipped. Card data is read from your own clone of `Kamalisk/arkhamdb-json-data` (git-ignored here); card faces are linked from ArkhamDB, never copied.
- Player-facing text avoids rules vocabulary (moments, means, leads, dread/hour, wounds/nerves). A test enforces a banned-word list.
- Every location is a channel, each player has a private channel, trackers are channels. Buttons first, slash commands second. One spotlight player at a time. Slow, async pace by default.
- Scope: through milestone 5, scenario = Night of the Zealot / The Gathering. Milestone 6 (hardening) was not requested.

## 2. Done

### Kernel (`src/kernel/`)
- [x] `step(state, answer)` with plain-JSON state, counter RNG, frame stack, replayable log.
- [x] Skill tests with a staged chaos-token reveal, commits, reaction windows, effects that resolve before the test does (fixed a double-resolution bug that could put a card in two zones; guarded by a test).
- [x] Combat (fight, evade, engage, attacks of opportunity, enemy phase, hunters, retaliate), harm and defeat, spotlight and turn order, mulligans, upkeep.
- [x] Scenario *The Gathering*: agendas, acts, locations, setup for 1-4 investigators, the resolutions and the "ghouls loose" ending.
- [x] All 99 Core Set player cards scripted, plus Roland, Daisy, "Skids", Agnes and Wendy with their signature cards, weaknesses and a validated 30-card starter list each (`STARTERS`).
- [x] Encounter cards used by The Gathering (15 of the 41 in the set).
- [x] Deck validation, starter decks, imported deck JSON, `/improve` (experience stored per user).

### Adapter (`src/adapter/`)
- [x] Lobby, join, starter or imported deck, ready, start; location channels appear on first reveal; permissions follow travel.
- [x] Commands: travel, search, fight, slip away, confront, talk, rummage, scrounge, play, use, pool, withdraw, hold, look, self, hand, party, case, map, bag, journal, card, rules, settings, `/improve`, and the `/host` set.
- [x] Prompts go to private channels with buttons; stale or forged buttons are refused; interactions are idempotent.
- [x] Timers (optional prompts time out; required ones nudge and then flag the host), pause, hold, away seats.
- [x] sqlite persistence: one row per step plus a snapshot every 10 steps; recovery after restart; purge after the 7-day retention while keeping the log.
- [x] Card faces by link (hour, trail, place, foe, treachery, "Look closely at a card" menu, `/card`); configurable or switchable off.
- [x] Visible moment counter (`●●○`) on the scene panel and in replies.
- [x] Hour panel shows "N of T before the hour turns" (the number printed on the agenda is the threshold T, not the current count).
- [x] Plain result lines under the story: passed/failed with the margin, the sum (skill + lent cards + gear ± token = total against difficulty), tokens drawn, hit or miss, damage dealt and health left on foes, damage and horror taken with health/sanity left, leads found, dread against the hour. Details shows the same sum in words.
- [x] Player channel opens with the investigator's card face, health and sanity as bars and numbers, and skills; the same figures on Self, the party line, the trail panel and the scene panel (not in `story` immersion).
- [x] Journal written per player from templates at the ending.
- [x] `.env` loading, default card-data path, `.gitignore`, `.env.example` (from the repo owner).
- [x] `/host new` clears the channels of finished stories in that server first (from the repo owner), and this patch makes the reported count honest: stories whose channels were already cleared are no longer counted again.

### Tests and tooling
- [x] 149 tests (kernel rules, every scripted card, adapter against an in-memory fake Discord, narration coverage, banned-word check); no network or Discord needed.
- [x] `npm run simulate` (headless games, `MIX=all` mixes investigators): 600 games across 1-4 players all reach an ending; no card is ever in two zones.
- [x] `npm run coverage` (narration and card-script coverage).

## 3. To verify

Needs a human, a real server, or an official rulebook. Listed roughly by risk.

1. [?] **First contact with real Discord.** `src/adapter/discord.ts` type-checks but has never talked to Discord. Expect a first bug or two in: channel permission overwrites and their order, rate limits when many channels change at once, role creation and deletion, embeds and button limits (5 rows of 5, select menus of 25), modals and autocomplete, the optional narrator webhook, and `REQUIRED_PERMISSIONS`.
2. [?] **Smoke-test script on a throwaway server** (do this before inviting anyone):
   - `npm run register`, start the bot, `/host new`, join with two accounts, ready, start.
   - Keep hands, take a few actions, check the moment counter drops on draw and resource as well as on move.
   - Travel: the new location channel appears, the old one stays readable, a non-present player can read but not write.
   - Let a prompt time out; pause and resume; kill the bot mid-game and restart it (state should recover).
   - Finish or `/host end` a story, then `/host new` again: old channels cleared, count in the reply is right.
3. [x] **Card image path** confirmed against ArkhamDB's public API (`/api/public/card/<code>` gives `imagesrc: /bundles/cards/<code>.png` for investigators, locations, agendas and the rest, plus `<code>b.png` for the back of double-sided cards). Every image in the bot is that URL placed in an embed, so Discord fetches it straight from ArkhamDB; nothing is stored. Still worth a look on a real server that they render.
4. [?] **Scenario data written from memory:** chaos bag contents per difficulty, the resolutions, and the "ghouls loose" ending after agenda 3. Compare against your rulebook before trusting balance.
5. [?] **ArkhamDB deck-import endpoint shape** (from memory). Pasting deck JSON is the dependable path.
6. [?] **The four non-Roland starter decks** are my own assembly from the cards each investigator can use, not the publisher's recommended lists.
7. [?] **Reported "actions not counting for draw/resource".** Not reproducible in the engine (each costs one moment). If it recurs, capture the investigator, the panel and the exact buttons used.
8. [?] **Approximated cards** (section 4) behave close to print but not exactly; check any ruling that surprises you against these first.
9. [?] **Win paths.** The simple simulation policy nearly always loses, so winning endings are covered by unit tests, not by simulation. Play one full scenario by hand.
10. [?] **Result lines and sheet on real Discord.** Check the emoji and `>` quote blocks look right on phone and desktop, the investigator card image loads, and a long fight does not post too many messages in a row.
11. [?] **CI.** There is none; card data is git-ignored, so any CI job must fetch it (or set `ARKHAM_DATA`) before `npm test`.

## 4. Known simplifications (candidates to fix)

- Police Badge's extra actions can only be given on your own turn.
- Shotgun: damage by margin works; the "fail and would damage another investigator" clause is not modelled.
- Grotesque Statue keeps whichever of the two tokens has the better modifier instead of asking.
- Sure Gamble flips only numeric minus tokens, not symbols with a negative modifier.
- Wendy's reaction is offered on the first token drawn in a test, once per test.
- Mind Wipe blanks keywords (hunter, retaliate, aloof) and forced effects, not every kind of enemy text.
- Revelation cards that are not weaknesses (The Necronomicon) are set aside from the opening hand and replaced, then shuffled back.
- Daisy's tome-only action is spent automatically on the first tome action.
- Scrying reorders the top three through successive picks. Disc of Itzamna is offered only to investigators at the spawn place.
- Hospital Debts' experience penalty applies to the scenario's tally only; nothing carries to a later scenario.
- A few one-off two-card interactions may resolve in a simpler order than printed.

## 5. To implement

### Near term
- [ ] Fix the items in section 4, starting with Police Badge (needs fast abilities offered to a non-active player) and Grotesque Statue (ask the player).
- [ ] Show the back (`<code>b.png`) of an agenda or act when it turns, so the players can read what the card says on its other side.
- [ ] Per-player choice of whether result lines show (they are shared messages, so today it is the same for everyone; a host-level switch would be simplest).
- [ ] Show the sum inside the commit prompt as cards are picked, not only before.
- [ ] Mulligan prompts currently go to personal channels, not the shared lobby channel; decide which is better and make it consistent.
- [ ] `/host swap` takes a seat id plus a user; make it friendlier.
- [ ] Make the retention period a setting (it is a constant, 7 days).
- [ ] The `voice` setting exists but does nothing; implement or remove it.
- [ ] Patch the README test count whenever tests change (it says 141 now).

### Milestone 6: hardening
- [ ] Rate-limit load test with a 4-player table and many channel changes; batch or queue Discord calls accordingly.
- [ ] Permission self-check at start-up and a clear message when a permission is missing.
- [ ] Repair paths for deleted channels or roles mid-game (`channels.ts` has repair; test it against real Discord).
- [ ] Backups of the sqlite file; a documented restore.
- [ ] Multi-guild behaviour and per-guild host roles.
- [ ] Structured logging, and a health check.

### Content
- [ ] The other 26 encounter cards in the Core Set (they are drawn, reported as a no-op, and discarded; a deck or scenario that needs them fails validation).
- [ ] Night of the Zealot scenarios 2 and 3 (*The Midnight Masks*, *The Devourer Below*) and a campaign log with carry-over (experience, trauma, notable choices) instead of the minimal `/improve`.
- [ ] Narration pass: more variants per event so long games repeat less; keep the no-rules-words test green.
- [ ] Tune balance with real play, then with a smarter simulation policy that can win.

### Nice to have
- [ ] Opt-in voice mode from the design doc.
- [ ] A spectator role and a replay viewer built from the stored log.
- [ ] Optional per-player pace settings (live vs slow) beyond the host-wide one.

## 6. How to run the checks

```
git clone https://github.com/Kamalisk/arkhamdb-json-data   # then put it at ./arkhamdb-json-data-master or set ARKHAM_DATA
npm install
npx tsc --noEmit
npm test            # 149 tests
npm run simulate -- 150 4   # MIX=all for mixed investigators
npm run coverage
```
