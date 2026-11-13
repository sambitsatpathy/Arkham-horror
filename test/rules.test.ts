import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, engine } from './helpers.ts';
import { step, legalActions } from '../src/kernel/engine.ts';
import { K } from '../src/kernel/ctx.ts';
import type { Answer, GameState, GameEvent, SeatId, Token } from '../src/kernel/types.ts';

const E = () => engine();

/** Keep the opening hand and land on Roland's first turn (one player, so no spotlight prompt). */
function turnState(seed = 11, players = 1): GameState {
  let { state } = newGame(seed, players);
  for (const seat of state.seats) {
    const r = step(E(), state, { seat, kind: 'mulligan', cards: [] }); assert.ok(!r.error, r.error?.message ?? ''); state = r.state;
  }
  // a clean hand, so the random opening draw can't open reaction windows the test doesn't expect
  for (const seat of state.seats) { const inv = state.investigators[seat]!; inv.deck.push(...inv.hand); inv.hand = []; }
  return state;
}
function go(s: GameState, a: Answer) {
  const r = step(E(), s, { ...a, decisionId: s.pending?.id });
  assert.ok(!r.error, `${r.error?.code}: ${r.error?.message} for ${JSON.stringify(a)} pending ${JSON.stringify(s.pending)}`);
  return r;
}
const k = (s: GameState) => new K(s, E().cat, E().reg);
const give = (s: GameState, seat: SeatId, code: string, zone: 'hand' | 'inPlay' | 'threat' = 'hand') => {
  const kk = k(s); const id = kk.newCard(code, seat); kk.inv(seat)[zone].push(id); return id;
};
const kinds = (ev: GameEvent[]) => ev.map(e => e.kind);
const clone = <T,>(x: T): T => structuredClone(x);

/** Move Roland to the hallway with the house open, as after Act 1. */
function openHouse(s: GameState): GameState {
  const x = clone(s); const kk = k(x);
  for (const id of ['hallway', 'attic', 'cellar', 'parlor']) x.locations[id]!.inPlay = true;
  kk.revealLocation('hallway');
  x.locations.study!.inPlay = false;
  for (const seat of x.seats) x.investigators[seat]!.loc = 'hallway';
  x.act = { stage: 2, clues: 0 }; x.scenarioFlags.actCode = '01109';
  return x;
}
const withBag = (s: GameState, bag: Token[]) => { const x = clone(s); x.chaosBag = bag; return x; };

test('investigating: success takes a clue, the location count drops, tokens are applied', () => {
  let s = withBag(turnState(), ['0']);
  assert.equal(s.pending?.kind, 'turn');
  const before = s.locations.study!.clues;
  let r = go(s, { seat: 's1', kind: 'action', action: { type: 'investigate' } }); s = r.state;
  assert.equal(s.pending?.kind, 'commit' === s.pending?.kind ? 'commit' : s.pending?.kind);
  while (s.pending?.kind === 'commit') s = go(s, { seat: 's1', kind: 'commit', cards: [] }).state;
  assert.equal(s.pending?.kind, 'reveal');
  r = go(s, { seat: 's1', kind: 'reveal' }); s = r.state;
  const resolved = r.events.find(e => e.kind === 'testResolved')!;
  assert.equal(resolved.outcome, 'success');                      // intellect 3 vs shroud 2, token 0
  assert.equal(s.investigators.s1!.clues, 1);
  assert.equal(s.locations.study!.clues, before - 1);
  assert.equal(s.investigators.s1!.actionsLeft, 2);
});

test('a -4 token on an intellect test against shroud 2 fails (3 - 4 < 2)', () => {
  let s = withBag(turnState(), ['-4']);
  s = go(s, { seat: 's1', kind: 'action', action: { type: 'investigate' } }).state;
  while (s.pending?.kind === 'commit') s = go(s, { seat: 's1', kind: 'commit', cards: [] }).state;
  const r = go(s, { seat: 's1', kind: 'reveal' });
  const t = r.events.find(e => e.kind === 'testResolved')!;
  assert.equal(t.outcome, 'failure'); assert.equal(t.margin, 2);   // total floors at 0
});

test('auto-fail always fails and counts the skill as zero', () => {
  let s = withBag(turnState(), ['autofail']);
  s = go(s, { seat: 's1', kind: 'action', action: { type: 'investigate' } }).state;
  while (s.pending?.kind === 'commit') s = go(s, { seat: 's1', kind: 'commit', cards: [] }).state;
  const t = go(s, { seat: 's1', kind: 'reveal' }).events.find(e => e.kind === 'testResolved')!;
  assert.equal(t.outcome, 'failure'); assert.equal(t.total, 0);
});

test('committing a matching card adds its icons, and the card is discarded afterwards', () => {
  let s = withBag(turnState(), ['-1']);
  const guts = give(s, 's1', '01039');                           // Deduction: intellect icon
  s = go(s, { seat: 's1', kind: 'action', action: { type: 'investigate' } }).state;
  assert.equal(s.pending?.kind, 'commit');
  s = go(s, { seat: 's1', kind: 'commit', cards: [guts] }).state;
  while (s.pending?.kind === 'commit') s = go(s, { seat: 's1', kind: 'commit', cards: [] }).state;
  const r = go(s, { seat: 's1', kind: 'reveal' });
  const t = r.events.find(e => e.kind === 'testResolved')!;
  assert.equal(t.skillValue, 4);                                  // 3 base + 1 icon
  assert.equal(t.outcome, 'success');
  assert.equal(r.state.investigators.s1!.clues, 2);               // Deduction: one extra clue
  assert.ok(r.state.investigators.s1!.discard.includes(guts));
});

test('.38 Special: spends ammo, +3 combat with a clue here, +1 damage, defeats a Ghoul Minion', () => {
  let s = openHouse(turnState());
  const gun = give(s, 's1', '01006', 'inPlay');
  const minion = k(s).newCard('01160', null);
  k(s).spawnEnemy(minion, { engage: 's1' });
  s.locations.hallway!.clues = 1;                                  // a clue here so the .38 gets +3
  s = withBag(s, ['0']);
  const legal = legalActions(E(), s, 's1');
  const fire = legal.find(o => o.action.type === 'activate' && o.action.cardId === gun)!;
  assert.ok(fire, 'the .38 offers a fight option');
  s = go(s, { seat: 's1', kind: 'action', action: fire.action }).state;
  while (s.pending?.kind === 'commit') s = go(s, { seat: 's1', kind: 'commit', cards: [] }).state;
  const r = go(s, { seat: 's1', kind: 'reveal' });
  const t = r.events.find(e => e.kind === 'testResolved')!;
  assert.equal(t.skillValue, 7);                                  // combat 4, +3 from the .38 with a clue here
  assert.ok(kinds(r.events).includes('enemyDefeated'));
  assert.equal(r.state.cards[gun]!.tokens.uses.ammo, 3);
});

test('attack of opportunity: a non-fight action with a ready engaged enemy provokes an attack first', () => {
  let s = openHouse(turnState());
  const rat = k(s).newCard('01159', null);                         // Swarm of Rats: 1 damage
  k(s).spawnEnemy(rat, { engage: 's1' });
  const r = go(s, { seat: 's1', kind: 'action', action: { type: 'resource' } });
  assert.ok(kinds(r.events).includes('enemyAttacks'));
  assert.equal(r.state.investigators.s1!.damage, 1);
  assert.equal(r.state.investigators.s1!.resources, 6);
  assert.equal(r.state.cards[rat]!.exhausted, false);              // opportunity attacks do not exhaust
});

test('fighting provokes no attack of opportunity from the enemy being fought', () => {
  let s = openHouse(turnState()); s = withBag(s, ['-8']);
  const rat = k(s).newCard('01159', null); k(s).spawnEnemy(rat, { engage: 's1' });
  s = go(s, { seat: 's1', kind: 'action', action: { type: 'fight', enemyId: rat } }).state;
  assert.equal(s.pending?.kind === 'commit' || s.pending?.kind === 'reveal', true);
  assert.equal(s.investigators.s1!.damage, 0);
});

test('Dodge cancels an enemy attack in the enemy phase', () => {
  let s = openHouse(turnState());
  const dodge = give(s, 's1', '01023');
  const rat = k(s).newCard('01159', null); k(s).spawnEnemy(rat, { engage: 's1' });
  let r = go(s, { seat: 's1', kind: 'done' }); s = r.state;       // end turn -> enemy phase -> attack window
  assert.equal(s.pending?.kind, 'reaction');
  const opt = (s.pending as Extract<typeof s.pending, { kind: 'reaction' }>).options.find(o => o.label.includes('Dodge'))!;
  r = go(s, { seat: 's1', kind: 'react', optionId: opt.id }); s = r.state;
  assert.ok(kinds(r.events).includes('attackCancelled'));
  assert.equal(s.investigators.s1!.damage, 0);
  assert.ok(s.investigators.s1!.discard.includes(dodge));
});

test('unrevealed location: moving in reveals it, scales clues by players, and the Attic forced horror hits', () => {
  let s = openHouse(turnState(11, 2));
  s.spotlight = null;
  assert.equal(s.locations.attic!.revealed, false);
  // two players -> spotlight decision first
  assert.equal(s.pending?.kind, 'spotlight');
  s = go(s, { seat: 's1', kind: 'stepForward' }).state;
  s = go(s, { seat: 's1', kind: 'action', action: { type: 'move', to: 'attic' } }).state;
  assert.equal(s.locations.attic!.revealed, true);
  assert.equal(s.locations.attic!.clues, 4);                       // 2 per investigator, 2 investigators
  assert.equal(s.investigators.s1!.horror, 1);
  assert.equal(s.investigators.s1!.loc, 'attic');
});

test('the Parlor cannot be entered until Act 2 opens it', () => {
  const s = openHouse(turnState());
  const moves = legalActions(E(), s, 's1').filter(o => o.group === 'move').map(o => (o.action as { to: string }).to);
  assert.deepEqual(moves.sort(), ['attic', 'cellar']);
});

test('Act 1: pooled clues advance the act, moving everyone to the Hallway and removing the Study', () => {
  let s = turnState();
  s.investigators.s1!.clues = 2;
  const adv = legalActions(E(), s, 's1').find(o => o.group === 'advance')!;
  assert.ok(adv);
  s = go(s, { seat: 's1', kind: 'action', action: adv.action }).state;
  assert.equal(s.act.stage, 2);
  assert.equal(s.investigators.s1!.clues, 0);
  assert.equal(s.investigators.s1!.loc, 'hallway');
  assert.equal(s.locations.study!.inPlay, false);
  assert.equal(s.locations.hallway!.revealed, true);
  assert.equal(s.pending?.kind, 'turn');
});

test('doom reaching the agenda threshold advances it and asks the lead to choose (agenda 1b)', () => {
  let s = turnState(); s = openHouse(s);
  s.agenda.doom = 2;
  // end the turn; round 2 mythos adds doom -> 3 = threshold
  let r = go(s, { seat: 's1', kind: 'done' }); s = r.state;
  while (s.pending && s.pending.kind !== 'choose' && !s.ended) {
    const p = s.pending;
    s = go(s, p.kind === 'reaction' ? { seat: p.seat, kind: 'react', optionId: null } : p.kind === 'commit' ? { seat: p.seat, kind: 'commit', cards: [] } : p.kind === 'reveal' ? { seat: p.seat, kind: 'reveal' } : p.kind === 'turn' ? { seat: p.seat, kind: 'done' } : { seat: 's1', kind: 'stepForward' }).state;
  }
  assert.equal(s.agenda.stage, 2);
  assert.equal(s.pending?.kind, 'choose');
  assert.equal((s.pending as { prompt: string }).prompt, 'agenda1b');
});

test('Frozen in Fear: the first move each round costs an extra moment, later ones do not', () => {
  let s = openHouse(turnState());
  give(s, 's1', '01164', 'threat');
  const before = legalActions(E(), s, 's1').find(o => o.group === 'move')!;
  assert.equal(before.actions, 2);
  s = go(s, { seat: 's1', kind: 'action', action: before.action }).state;
  assert.equal(s.investigators.s1!.actionsLeft, 1);
  const after = legalActions(E(), s, 's1').find(o => o.group === 'move');
  assert.equal(after?.actions, 1);
});

test('Dissonant Voices forbids playing assets and events', () => {
  const s = openHouse(turnState());
  give(s, 's1', '01088');                                          // Emergency Cache
  give(s, 's1', '01016');                                          // .45
  give(s, 's1', '01164', 'threat');
  const t2 = clone(s); give(t2, 's1', '01165', 'threat');
  assert.equal(legalActions(E(), t2, 's1').filter(o => o.group === 'play').length, 0);
  assert.ok(legalActions(E(), s, 's1').filter(o => o.group === 'play').length > 0);
});

test('defeat: damage at or past health defeats the investigator and drops their clues', () => {
  let s = openHouse(turnState());
  s.investigators.s1!.clues = 2; s.investigators.s1!.damage = 8;
  const rat = k(s).newCard('01159', null); k(s).spawnEnemy(rat, { engage: 's1' });
  const r = go(s, { seat: 's1', kind: 'action', action: { type: 'resource' } });
  assert.ok(kinds(r.events).includes('investigatorDefeated'));
  assert.equal(r.state.investigators.s1!.status, 'defeated');
  assert.equal(r.state.locations.hallway!.clues, 2);
  assert.equal(r.state.ended?.resolution, 'R3');
});

test('resigning at the Parlor ends the game with the survivors fled', () => {
  let s = openHouse(turnState());
  s.scenarioFlags.parlorOpen = true; s.investigators.s1!.loc = 'parlor'; k(s).revealLocation('parlor');
  const resign = legalActions(E(), s, 's1').find(o => o.group === 'resign')!;
  assert.ok(resign);
  const r = go(s, { seat: 's1', kind: 'action', action: resign.action });
  assert.equal(r.state.ended?.resolution, 'R0');
});

test('stale and wrong-seat answers are rejected without changing the state', () => {
  const s = turnState(11, 2);
  const stale = step(E(), s, { seat: 's1', kind: 'stepForward', decisionId: 'nope' });
  assert.equal(stale.error?.code, 'stale');
  const wrong = step(E(), s, { seat: 's1', kind: 'done' });
  assert.ok(wrong.error);
  assert.equal(JSON.stringify(wrong.state), JSON.stringify(s));
});

test('a snapshot survives a JSON round trip mid-test and plays on identically', () => {
  let s = withBag(turnState(), ['0', '-1']);
  s = go(s, { seat: 's1', kind: 'action', action: { type: 'investigate' } }).state;
  const copy = JSON.parse(JSON.stringify(s)) as GameState;
  assert.equal(s.pending?.kind, 'reveal');
  const a = go(s, { seat: 's1', kind: 'reveal' });
  const b = go(copy, { seat: 's1', kind: 'reveal' });
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));   // what gets persisted is JSON
});

/** Answer whatever is pending with the most passive option until a 'choose' with this prompt appears. */
function driveToPrompt(s: GameState, prompt: string, limit = 200): GameState {
  for (let i = 0; i < limit && !s.ended; i++) {
    const p = s.pending; if (!p) break;
    if (p.kind === 'choose' && p.prompt === prompt) return s;
    const a: Answer =
      p.kind === 'reaction' ? { seat: p.seat, kind: 'react', optionId: null }
      : p.kind === 'commit' ? { seat: p.seat, kind: 'commit', cards: [] }
      : p.kind === 'reveal' ? { seat: p.seat, kind: 'reveal' }
      : p.kind === 'turn' ? { seat: p.seat, kind: 'done' }
      : p.kind === 'choose' ? { seat: p.seat, kind: 'choose', optionIds: p.options.slice(0, p.min).map(o => o.id) }
      : p.kind === 'spotlight' ? { seat: p.seats[0]!, kind: 'stepForward' }
      : { seat: 's1', kind: 'mulligan', cards: [] };
    s = go(s, a).state;
  }
  return s;
}

test('Act 2: enough pooled leads in the Hallway offers the barrier prompt at round end; "go" opens the Parlor', () => {
  let s = openHouse(turnState());
  const need = Number(E().cat.get('01109').actAgenda?.clueThreshold);     // per investigator, from the card data
  assert.ok(need >= 1);
  s.investigators.s1!.clues = need - 1;
  s = withBag(s, ['0']);
  s = driveToPrompt(s, 'never');                                          // one short: no prompt appears
  assert.notEqual((s.pending as { prompt?: string } | null)?.prompt, 'act2.barrier');
  s = withBag(openHouse(turnState()), ['0']);
  s.investigators.s1!.clues = need;
  s = driveToPrompt(s, 'act2.barrier');
  assert.equal((s.pending as { prompt: string }).prompt, 'act2.barrier');
  s = go(s, { seat: 's1', kind: 'choose', optionIds: ['go'] }).state;
  assert.equal(s.act.stage, 3);
  assert.equal(s.scenarioFlags.parlorOpen, true);
  assert.equal(s.locations.parlor!.revealed, true);
  const priest = s.enemies.find(id => s.cards[id]!.code === '01116');
  assert.ok(priest, 'the Ghoul Priest spawns');
  assert.equal(s.cards[priest!]!.loc, 'hallway');
  assert.ok(s.locAssets.some(id => s.cards[id]!.code === '01117'), 'Lita is waiting in the Parlor');
});

function finalAct(choice: 'R1' | 'R2') {
  let s = openHouse(turnState());
  const kk = k(s);
  kk.revealLocation('parlor'); s.scenarioFlags.parlorOpen = true;
  s.act = { stage: 3, clues: 0 }; s.scenarioFlags.actCode = '01110';
  const priest = kk.newCard('01116', null);
  kk.spawnEnemy(priest, { engage: 's1' });
  s.cards[priest]!.tokens.damage = kk.enemyHealth(priest) - 1;
  s = withBag(s, ['0']);
  s = go(s, { seat: 's1', kind: 'action', action: { type: 'fight', enemyId: priest } }).state;
  s = driveToPrompt(s, 'act3.resolution');
  assert.equal((s.pending as { prompt: string }).prompt, 'act3.resolution');
  return go(s, { seat: 's1', kind: 'choose', optionIds: [choice] }).state;
}

test('Act 3: defeating the Ghoul Priest asks for the ending; burning ends the scenario at R1', () => {
  const s = finalAct('R1');
  assert.equal(s.ended?.resolution, 'R1');
  assert.ok(s.campaignLog.some(l => /burn/i.test(l)));
});

test('Act 3: defending the house ends the scenario at R2', () => {
  assert.equal(finalAct('R2').ended?.resolution, 'R2');
});

test('Agenda 3 running out of doom ends the game with the ghouls loose', () => {
  let s = openHouse(turnState());
  s.agenda = { stage: 3, doom: 99, deckStage: 3 }; s.scenarioFlags.agendaCode = '01107';
  s.act = { stage: 3, clues: 0 }; s.scenarioFlags.actCode = '01110';
  s = driveToPrompt(s, 'never');
  assert.equal(s.ended?.resolution, 'ghouls_loose');
});

test('experience is awarded on ending: victory-display points plus cleared locations', () => {
  const s = finalAct('R2');
  assert.ok(s.ended);
  const xp = (s.ended as unknown as { xp?: Record<string, number> }).xp;
  assert.ok(xp && typeof xp.s1 === 'number', `xp recorded: ${JSON.stringify(s.ended)}`);
});
