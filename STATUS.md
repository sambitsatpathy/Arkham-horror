# Arkham Horror Bot — Implementation Status

## Phase 1 — Foundation ✅

- [x] `package.json` with dependencies
- [x] `config.js`
- [x] `db/database.js` — schema + init + migrations
- [x] `index.js` — bot login, command loader, event handler
- [x] `deploy-commands.js`
- [x] `engine/cardLookup.js`
- [x] `commands/game/card.js` — `/card`

## Phase 2 — Pregame ✅

- [x] `commands/pregame/join.js`
- [x] `commands/pregame/investigator.js` — investigator pick + starter deck in one command; autocomplete full roster
- [x] `engine/deckImport.js`
- [x] `engine/serverBuilder.js`
- [x] `commands/pregame/startgame.js` — campaign + scenario autocomplete
- [x] `commands/system/newgame.js`

## Phase 3 — Core Game Loop ✅

- [x] `engine/locationManager.js`
- [x] `commands/game/move.js` — autocomplete filtered to current act
- [x] `engine/deck.js`
- [x] `commands/game/draw.js`
- [x] `commands/game/play.js`
- [x] `commands/game/discard.js` — autocomplete from hand
- [x] `commands/game/resource.js`
- [x] `commands/game/stats.js`
- [x] `commands/game/doom.js`
- [x] `commands/game/clue.js`

## Phase 4 — Combat & Chaos ✅

- [x] `engine/chaosBag.js`
- [x] `commands/game/pull.js`
- [x] `engine/enemyEngine.js`
- [x] `commands/game/enemy.js`
- [x] `commands/game/fight.js`
- [x] `commands/game/evade.js`
- [x] `commands/game/damage.js` — supports self + asset soak (allies, equipment)
- [x] `commands/game/horror.js` — supports self + asset soak
- [x] `commands/game/heal.js`
- [x] `commands/game/heal-horror.js`

## Phase 5 — Mythos & Encounter ✅

- [x] `engine/encounterEngine.js`
- [x] `commands/game/mythos.js`
- [x] `commands/game/resolved.js`
- [x] `commands/game/advance.js`
- [x] `commands/game/nextphase.js`

## Phase 6 — Campaign ✅

- [x] `commands/campaign/endscenario.js` — resolution narration
- [x] `commands/campaign/upgrade.js`
- [x] `commands/campaign/campaignlog.js`

## Phase 7 — Scenario Data

- [x] Night of the Zealot (3 scenarios + narrative text)
- [x] The Dunwich Legacy (8 scenarios + narrative text)
- [x] The Path to Carcosa (8 scenarios + narrative text)
- [x] The Forgotten Age (8 scenarios)
- [ ] The Circle Undone (8 scenarios)
- [ ] The Dream-Eaters (8 scenarios)
- [ ] The Innsmouth Conspiracy (8 scenarios)
- [ ] Edge of the Earth (8 scenarios)
- [ ] The Scarlet Keys (8 scenarios)
- [ ] Feast of Hemlock Vale (8 scenarios)
- [ ] The Drowned City (8 scenarios)

## Phase 8 — Additional Commands ✅

- [x] `commands/game/exhaust.js`
- [x] `commands/game/test.js`
- [x] `commands/game/commit.js`
- [x] `commands/game/hand.js`
- [x] `commands/game/dashboard.js`
- [x] `commands/game/use.js`
- [x] `commands/game/scry.js`
- [x] `commands/game/subdeck.js`

## Phase 9 — Polish & Bug Fixes ✅

- [x] Game-info channels read-only for @everyone in `serverBuilder.js`
- [x] `investigate.js` — fixed `getPlayer(player.id)` → `getPlayer(interaction.user.id)`
- [x] `nextphase.js` — fixed upkeep loop using `getPlayerById`
- [x] `deckImport.js` — fixed `buildStarterDeck` field name handling
- [x] Pinned hand display (single edited message replacing per-draw posts)
- [x] `CHEATSHEET.md` — full player reference
- [x] `README.md`

## Phase 10 — Starter Decks

- [x] Core Set (Roland, Daisy, Skids, Agnes, Wendy)
- [x] Dunwich Legacy (Rex Murphy, Jenny Barnes, Jim Culver, "Ashcan" Pete)
- [x] Path to Carcosa (Mark Harrigan, Minh Thi Phan, Sefina Rousseau, Akachi Onyele, William Yorick)
- [x] Forgotten Age (Leo Anderson, Ursula Downs, Finn Edwards, Father Mateo, Calvin Wright) — *verify card codes*
- [ ] **Fix Zoey Samaras** — illegal Mystic/Seeker cards (Shrivelling, Laboratory Assistant, Strange Solution, Shortcut)
- [ ] Circle Undone (Carolyn Fern, Joe Diamond, Preston Fairmont, Diana Stanley, Rita Young, Marie Lambeau)
- [ ] Dream-Eaters (Tommy Muldoon, Mandy Thompson, Tony Morgan, Luke Robinson, Patrice Hathaway)
- [ ] Innsmouth (Sister Mary, Amanda Sharpe, Trish Scarborough, Dexter Drake, Silas Marsh)
- [ ] Edge of Earth (Daniela Reyes, Norman Withers, Monterey Jack, Lily Chen, Bob Jenkins)
- [ ] Scarlet Keys (Carson Sinclair, Vincent Lee, Kymani Jones, Amina Zidane, Darrell Simmons, Charlie Kane)
- [ ] Feast of Hemlock Vale (Wilson Richards, Kate Winthrop, Alessandra Zorzi, Kōhaku Narukami, Hank Samson)
- [ ] Drowned City (Marion Tavares, Lucius Galloway, Agatha Crane, Michael McGlen, Gloria Goldberg, George Barnaby)
- [ ] Standalone (Nathaniel Cho, Harvey Walters, Winifred Habbamock, Jacqueline Fine, Stella Clark)
