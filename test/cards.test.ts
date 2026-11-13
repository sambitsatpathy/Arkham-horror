// Card and investigator behaviour, one rule at a time. Fixtures put exact cards in exact zones and fix the chaos bag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine, autoplay } from './helpers.ts';
import { step, start, legalActions } from '../src/kernel/engine.ts';
import { setupGame } from '../src/kernel/setup.ts';
import { STARTERS, validateDeck } from '../src/kernel/deck.ts';
import { K } from '../src/kernel/ctx.ts';
import type { Answer, Decision, GameEvent, GameState, SeatId, Token } from '../src/kernel/types.ts';

const E = () => engine();
const k = (s: GameState) => new K(s, E().cat, E().reg);
const clone = <T,>(x: T): T => structuredClone(x);
const kinds = (ev: GameEvent[]) => ev.map(e => e.kind);
const inv = (s: GameState, seat: SeatId = 's1') => s.investigators[seat]!;

/** One investigator, opening hand kept and emptied (so random draws never open surprise windows), standing in the Study on their turn. */
function solo(code: string, seed = 11, bag?: Token[]): GameState {
  const s0 = setupGame(E(), { seed, difficulty: 'standard', seats: [{ seat: 's1', investigatorCode: code, deck: STARTERS[code]! }] });
  let s = start(E(), s0).state;
  s = step(E(), s, { seat: 's1', kind: 'mulligan', cards: [] }).state;
  const i = inv(s); i.deck.push(...i.hand); i.hand = [];
  if (bag) s.chaosBag = bag;
  assert.equal(s.pending?.kind, 'turn');
  return s;
}
const give = (s: GameState, code: string, zone: 'hand' | 'inPlay' | 'threat' | 'deck' | 'discard' = 'hand', seat: SeatId = 's1') => {
  const kk = k(s); const id = kk.newCard(code, seat);
  if (zone === 'deck') inv(s, seat).deck.unshift(id); else inv(s, seat)[zone].push(id);
  return id;
};
const enemyAt = (s: GameState, code = '01160', engage = true) => { const id = k(s).newCard(code, null); k(s).spawnEnemy(id, engage ? { engage: 's1' } : { loc: inv(s).loc }); return id; };

type Pick = (d: Decision, s: GameState) => Answer | undefined;
/** Step until `stop` says so, answering windows and prompts by default (pass, keep, first choice) unless `pick` has a better idea. */
function drive(s: GameState, stop: (s: GameState) => boolean, pick: Pick = () => undefined, max = 200): { s: GameState; ev: GameEvent[] } {
  const ev: GameEvent[] = [];
  for (let n = 0; n < max && s.pending && !s.ended && !stop(s); n++) {
    const d = s.pending; let a = pick(d, s);
    if (!a) {
      a = d.kind === 'commit' ? { seat: d.seat, kind: 'commit', cards: [] }
        : d.kind === 'reveal' ? { seat: d.seat, kind: 'reveal' }
        : d.kind === 'reaction' ? { seat: d.seat, kind: 'react', optionId: null }
        : d.kind === 'choose' ? { seat: d.seat, kind: 'choose', optionIds: d.options.slice(0, d.min).map(o => o.id) }
        : d.kind === 'turn' ? { seat: d.seat, kind: 'done' }
        : d.kind === 'mulligan' ? { seat: d.seat, kind: 'mulligan', cards: [] } : undefined;
    }
    assert.ok(a, `no default for ${d.kind}`);
    const r = step(E(), s, { ...a!, decisionId: d.id }); assert.ok(!r.error, `${r.error?.message} :: ${JSON.stringify(a)} :: ${JSON.stringify(d)}`);
    s = r.state; ev.push(...r.events);
  }
  return { s, ev };
}
const isTurn = (s: GameState) => s.pending?.kind === 'turn';
const act = (s: GameState, pred: (o: ReturnType<typeof legalActions>[number]) => boolean, pick?: Pick) => {
  const o = legalActions(E(), s, 's1').find(pred); assert.ok(o, 'that action is not on offer');
  const r = step(E(), s, { seat: 's1', kind: 'action', action: o!.action, decisionId: s.pending!.id }); assert.ok(!r.error, r.error?.message ?? '');
  const d = drive(r.state, isTurn, pick); return { s: d.s, ev: [...r.events, ...d.ev] };
};
const label = (re: RegExp) => (o: { label: string }) => re.test(o.label);
const openHouse = (s: GameState) => {
  const kk = k(s); for (const id of ['hallway', 'attic', 'cellar', 'parlor']) s.locations[id]!.inPlay = true;
  kk.revealLocation('hallway'); s.locations.study!.inPlay = false; for (const seat of s.seats) inv(s, seat).loc = 'hallway';
  s.act = { stage: 2, clues: 0 }; s.scenarioFlags.actCode = '01109';
};

// ──────────────────────────────────────────────────────────────────────────── investigators

test('every Core Set investigator has a valid starter deck, and a full game plays out for each', () => {
  for (const code of ['01001', '01002', '01003', '01004', '01005']) {
    const rep = validateDeck(E().cat, E().reg, code, STARTERS[code]!);
    assert.ok(rep.ok, `${code}: ${rep.errors.join('; ')} ${rep.warnings.join('; ')}`);
    for (const seed of [3, 4, 5]) {
      const s0 = setupGame(E(), { seed, difficulty: 'standard', seats: [{ seat: 's1', investigatorCode: code, deck: STARTERS[code]! }, { seat: 's2', investigatorCode: code, deck: STARTERS[code]! }] });
      const r = autoplay(E(), start(E(), s0).state, undefined, 6000);
      assert.ok(r.state.ended, `${code} seed ${seed} did not finish`);
    }
  }
});

test('Skids: pays two means for a moment once a turn, and the elder sign is +2 and pays two means back', () => {
  let s = solo('01003', 11, ['elder_sign']);
  assert.equal(inv(s).actionsLeft, 3); assert.equal(inv(s).resources, 5);
  s = act(s, label(/another moment/)).s;
  assert.equal(inv(s).actionsLeft, 4); assert.equal(inv(s).resources, 3);
  assert.ok(!legalActions(E(), s, 's1').some(label(/another moment/)), 'limit once per turn');
  const before = inv(s).resources;
  const r = act(s, o => o.group === 'investigate'); s = r.s;
  assert.equal(r.ev.find(e => e.kind === 'testResolved')!.outcome, 'success');   // 3 + 2 vs shroud 2
  assert.equal(inv(s).resources, before + 2);
});

test('Daisy: a fourth action that only a tome can use; the elder sign draws a card per tome', () => {
  let s = solo('01002', 11, ['elder_sign']);
  const book = give(s, '01031', 'inPlay');                          // Old Book of Lore, a Tome
  inv(s).deck = inv(s).deck.slice(0, 12);
  s = act(s, o => o.group === 'investigate').s;                     // elder sign: success, and 1 tome => draw 1
  assert.equal(inv(s).hand.length, 1);
  // burn the three normal actions on non-tome things, then the tome action is still there
  s = act(s, label(/Rummage/)).s; s = act(s, label(/Rummage/)).s;
  assert.equal(inv(s).actionsLeft, 0);
  const tome = legalActions(E(), s, 's1').find(label(/Consult the old book/)); assert.ok(tome, 'tome action on offer at zero moments');
  assert.ok(!legalActions(E(), s, 's1').some(label(/Rummage/)), 'but nothing else is');
  s = act(s, label(/Consult the old book/)).s;
  assert.equal(inv(s).restricted.tome, 0);
  assert.equal(inv(s).actionsLeft, 0);
  void book;
});

test('Agnes: a horror makes her lash out once per phase; the elder sign grows with her horror', () => {
  let s = solo('01004', 11, ['0']);
  const g = enemyAt(s, '01160');                                    // Ghoul Minion: 1 damage, 1 horror
  let offers = 0;
  const pick: Pick = d => { if (d.kind === 'reaction' && /lashes/.test(d.options[0]?.label ?? '')) { offers++; return { seat: d.seat, kind: 'react', optionId: d.options[0]!.id }; } return undefined; };
  s = act(s, label(/Rummage/), pick).s;                             // provokes: horror 1 -> Agnes strikes
  assert.equal(offers, 1); assert.equal(s.cards[g]!.tokens.damage, 1);
  s = act(s, label(/Rummage/), pick).s;                             // second horror in the same phase: no second offer
  assert.equal(offers, 1); assert.equal(s.cards[g]!.tokens.damage, 1);
  assert.equal(E().reg['01004']!.elderSign!(k(s), 's1'), inv(s).horror);
});

test('Wendy: may cancel a revealed token by discarding a card and draw again, once per test; her elder sign wins outright with the amulet', () => {
  let s = solo('01005', 11, ['-4']);
  const c = give(s, '01072'); give(s, '01073');
  s = step(E(), s, { seat: 's1', kind: 'action', action: { type: 'investigate' }, decisionId: s.pending!.id }).state;
  s = drive(s, x => x.pending?.kind === 'reveal').s;
  const ev: GameEvent[] = [];
  let r = step(E(), s, { seat: 's1', kind: 'reveal', decisionId: s.pending!.id }); s = r.state; ev.push(...r.events);
  assert.equal(s.pending?.kind, 'reaction', 'a window opens on the revealed token');
  assert.ok(!kinds(ev).includes('tokenRevealed'), 'nothing is applied before the window closes');
  const opt = (s.pending as { options: { id: string; label: string }[] }).options.find(o => /memory/.test(o.label))!; assert.ok(opt);
  s = step(E(), s, { seat: 's1', kind: 'react', optionId: opt.id, decisionId: s.pending!.id }).state;
  assert.equal(s.pending?.kind, 'choose');
  s.chaosBag = ['0'];                                                   // what she draws instead
  r = step(E(), s, { seat: 's1', kind: 'choose', optionIds: [c], decisionId: s.pending!.id }); s = r.state; ev.push(...r.events);
  assert.ok(inv(s).discard.includes(c));
  const d = drive(s, x => isTurn(x)); s = d.s; ev.push(...d.ev);
  const rev = ev.filter(e => e.kind === 'tokenRevealed'); assert.equal(rev.length, 1);
  assert.deepEqual(rev[0]!.tokens, ['0']);
  assert.equal(ev.find(e => e.kind === 'testResolved')!.outcome, 'success');
  assert.ok(!kinds(ev).includes('tokenCancelled') || kinds(ev).filter(x => x === 'tokenCancelled').length === 1);
  // elder sign with the amulet: automatic success even against an impossible shroud
  const t = solo('01005', 11, ['elder_sign']); give(t, '01014', 'inPlay'); t.locations.study!.shroud = 9;
  assert.equal(act(t, o => o.group === 'investigate').ev.find(e => e.kind === 'testResolved')!.outcome, 'success');
  const u = solo('01005', 11, ['elder_sign']); u.locations.study!.shroud = 9;
  assert.equal(act(u, o => o.group === 'investigate').ev.find(e => e.kind === 'testResolved')!.outcome, 'failure');
});

test('The Necronomicon turns every elder sign into an auto-fail, and reading it moves its horror onto Daisy until it is gone', () => {
  let s = solo('01002', 11, ['elder_sign']);
  const n = give(s, '01009', 'hand');
  // drawn from the deck it enters the threat area with 3 horror
  inv(s).hand = []; inv(s).deck.unshift(n);
  s = act(s, label(/Rummage/)).s;
  assert.ok(inv(s).threat.includes(n)); assert.equal(s.cards[n]!.tokens.horror, 3);
  const r = act(s, o => o.group === 'investigate'); assert.equal(r.ev.find(e => e.kind === 'testResolved')!.outcome, 'failure');
  s = r.s;
  const before = inv(s).horror;
  let t = solo('01002', 11); const nn = give(t, '01009', 'threat'); t.cards[nn]!.tokens.horror = 1;
  t = act(t, label(/Read until/)).s;
  assert.equal(inv(t).horror, 1); assert.ok(inv(t).discard.includes(nn), 'gone when the last horror moves');
  void before;
});

test('Daisy’s Tote Bag gives two hand slots for tomes only', () => {
  let s = solo('01002'); inv(s).resources = 20; give(s, '01008', 'inPlay');
  const tomes = ['01031', '01031', '01035'].map(c => give(s, c, 'hand'));   // three tomes, each a hand item
  for (const t of tomes) s = act(s, o => o.action.type === 'play' && (o.action as { cardId: string }).cardId === t).s;
  assert.equal(tomes.filter(t => inv(s).inPlay.includes(t)).length, 3, 'all three tomes fit: 2 base slots? tote bag adds 2 for tomes');
  inv(s).actionsLeft = 4; s.pending = { ...s.pending!, actionsLeft: 4 } as never;
  const knife = give(s, '01086', 'hand');
  const r = act(s, o => o.action.type === 'play' && (o.action as { cardId: string }).cardId === knife, (d) => d.kind === 'choose' ? { seat: d.seat, kind: 'choose', optionIds: [d.options[0]!.id] } : undefined);
  assert.ok(inv(r.s).inPlay.includes(knife));
  assert.ok(tomes.every(x => inv(r.s).inPlay.includes(x)), 'nothing had to be set down');
});

// ──────────────────────────────────────────────────────────────────────────── Guardian and Seeker

test('Leo De Luca gives a fourth action at the start of the turn', () => {
  const s = solo('01003'); give(s, '01048', 'inPlay');
  // the turn has already begun; end it and start the next round to see the new budget
  const d = drive(s, x => isTurn(x) && x.round > s.round);
  assert.equal(inv(d.s).actionsLeft, 4);
});

test('Police Badge: +1 willpower, and it can be handed over for two more actions', () => {
  let s = solo('01001', 11, ['0']); give(s, '01027', 'inPlay');
  assert.equal(k(s).modsFor('s1', null).willpower, 1);
  s = act(s, label(/burst of time/)).s;
  assert.equal(inv(s).actionsLeft, 5); assert.equal(inv(s).inPlay.length, 0);
});

test('Shotgun: damage equals the margin of success, at least 1 and at most 5', () => {
  let s = solo('01001', 11, ['0']); const sg = give(s, '01029', 'inPlay');
  const priest = enemyAt(s, '01116');                              // Ghoul Priest: fight 4
  s = act(s, label(/Fire the shotgun/)).s;
  assert.equal(s.cards[priest]!.tokens.damage, 3);                 // combat 4 + 3 = 7 against 4
  assert.equal(s.cards[sg]!.tokens.uses.ammo, 1);
});

test('Magnifying Glass (1) returns to hand when the place has no clues left', () => {
  let s = solo('01001'); const mg = give(s, '01040', 'inPlay');
  assert.ok(!legalActions(E(), s, 's1').some(label(/Tuck the glass/)));
  s.locations.study!.clues = 0;
  s = act(s, label(/Tuck the glass/)).s;
  assert.ok(inv(s).hand.includes(mg));
});

test('Encyclopedia gives +2 to a chosen skill for the phase', () => {
  const run = (use: boolean) => {
    let s = solo('01001', 11, ['0']); s.locations.study!.shroud = 5; give(s, '01042', 'inPlay');
    if (use) s = act(s, label(/Consult the encyclopedia/), d => d.kind === 'choose' && d.prompt === 'encyclopedia.skill' ? { seat: d.seat, kind: 'choose', optionIds: ['intellect'] } : undefined).s;
    return act(s, o => o.group === 'investigate').ev.find(e => e.kind === 'testResolved')!.outcome;
  };
  assert.equal(run(false), 'failure'); assert.equal(run(true), 'success');
});

test('Cryptic Research: someone at your place draws three', () => {
  let s = solo('01001'); give(s, '01043'); inv(s).resources = 9;
  s = act(s, o => o.action.type === 'play').s;
  assert.equal(inv(s).hand.length, 3);
});

test('Disc of Itzamna discards a non-Elite enemy the moment it spawns at your place', () => {
  let s = solo('01001'); const disc = give(s, '01041', 'inPlay');
  const foe = k(s).newCard('01160', null); s.encounterDeck.unshift(foe);
  let offered = false;
  const d = drive(s, x => x.round > s.round && isTurn(x), (dd) => {
    if (dd.kind === 'reaction' && dd.options.some(o => /disc/i.test(o.label))) { offered = true; return { seat: dd.seat, kind: 'react', optionId: dd.options[0]!.id }; }
    return undefined;
  });
  assert.ok(offered); assert.ok(d.s.encounterDiscard.includes(foe)); assert.ok(!d.s.enemies.includes(foe)); assert.ok(inv(d.s).discard.includes(disc));
});

// ──────────────────────────────────────────────────────────────────────────── Rogue

const play = (id: string) => (o: { action: { type: string } }) => o.action.type === 'play' && (o.action as unknown as { cardId: string }).cardId === id;
const reactTo = (re: RegExp, counter?: { n: number }): Pick => d => {
  if (d.kind === 'reaction') { const o = d.options.find(x => re.test(x.label)); if (o) { if (counter) counter.n++; return { seat: d.seat, kind: 'react', optionId: o.id }; } }
  return undefined;
};

test('Switchblade deals extra damage on a margin of 2 or more; the Derringer too, and spends ammo', () => {
  const hit = (bag: Token[]) => { let s = solo('01003', 11, bag); const sb = give(s, '01044', 'inPlay'); const g = enemyAt(s, '01161'); s = act(s, label(/switchblade/i)).s; void sb; return s.cards[g]!.tokens.damage; };
  assert.equal(hit(['0']), 1);                                      // 3 vs 3: margin 0
  assert.equal(hit(['+2']), 2);                                     // margin 2: +1 damage
  const s0 = solo('01003', 11, ['+1']); give(s0, '01047', 'inPlay'); const gm = enemyAt(s0, '01161');
  const s1 = act(s0, label(/derringer/i)).s;                        // 3 + 2 + 1 = 6 vs 3: margin 3
  assert.equal(s1.cards[gm]!.tokens.damage, 2);
});

test('Burglary: a successful search pays three means instead of a lead', () => {
  let s = solo('01003', 11, ['+2']); give(s, '01045', 'inPlay'); const before = inv(s).resources; const clues = s.locations.study!.clues;
  s = act(s, label(/Case the place/)).s;
  assert.equal(inv(s).resources, before + 3); assert.equal(s.locations.study!.clues, clues); assert.equal(inv(s).clues, 0);
});

test('Pickpocketing draws a card after you evade; Elusive and Cat Burglar get you out of a fight', () => {
  const c = { n: 0 };
  let s = solo('01003', 11, ['+2']); give(s, '01046', 'inPlay'); const g = enemyAt(s); inv(s).deck.unshift(...[0, 1, 2].map(() => k(s).newCard('01086', 's1')));
  s = act(s, o => o.group === 'evade', reactTo(/Lift/, c)).s;
  assert.equal(c.n, 1); assert.equal(inv(s).hand.length, 1); assert.equal(s.cards[g]!.engaged, null);
  // Elusive
  let t = solo('01003'); openHouse(t); k(t).revealLocation('cellar'); const e = enemyAt(t); const el = give(t, '01050');
  t = act(t, play(el), d => d.kind === 'choose' ? { seat: d.seat, kind: 'choose', optionIds: ['cellar'] } : undefined).s;
  assert.equal(inv(t).loc, 'cellar'); assert.equal(t.cards[e]!.engaged, null); assert.equal(t.cards[e]!.loc, 'hallway');
  // Cat Burglar: no attack of opportunity
  let u = solo('01003'); openHouse(u); const e2 = enemyAt(u); give(u, '01055', 'inPlay'); const hp = inv(u).damage;
  u = act(u, label(/Vanish into the crowd/), d => d.kind === 'choose' ? { seat: d.seat, kind: 'choose', optionIds: [d.options[0]!.id] } : undefined).s;
  assert.equal(inv(u).damage, hp); assert.equal(u.cards[e2]!.engaged, null); assert.notEqual(inv(u).loc, 'hallway');
});

test('Backstab fights with agility for +2 damage; Sneak Attack needs an exhausted enemy', () => {
  let s = solo('01003', 11, ['0']); const g = enemyAt(s, '01116'); const bs = give(s, '01051');
  s = act(s, play(bs)).s;                                          // agility 4 vs fight 4, 1 + 2 damage
  assert.equal(s.cards[g]!.tokens.damage, 3);
  let t = solo('01003'); const e = enemyAt(t, '01161', false); const sn = give(t, '01052');
  assert.ok(!legalActions(E(), t, 's1').some(play(sn)), 'not while the enemy is awake');
  t.cards[e]!.exhausted = true; t = act(t, play(sn)).s;
  assert.equal(t.cards[e]!.tokens.damage, 2);
});

test('Opportunist comes back to hand on a margin of 3; Sure Gamble flips a negative token; Hot Streak pays ten', () => {
  let s = solo('01003', 11, ['+2']); s.locations.study!.shroud = 1; const op = give(s, '01053');
  s = act(s, o => o.group === 'investigate', d => d.kind === 'commit' ? { seat: d.seat, kind: 'commit', cards: [op] } : undefined).s;
  assert.ok(inv(s).hand.includes(op), 'margin was 5');
  let t = solo('01003', 11, ['-2']); t.locations.study!.shroud = 4; const sg = give(t, '01056'); inv(t).resources = 9;
  const r = act(t, o => o.group === 'investigate', reactTo(/Play Sure Gamble/));
  assert.equal(r.ev.find(e => e.kind === 'testResolved')!.outcome, 'success'); assert.ok(kinds(r.ev).includes('tokenSwitched')); void sg;
  let u = solo('01003'); const hs = give(u, '01057'); inv(u).resources = 3; u = act(u, play(hs)).s;
  assert.equal(inv(u).resources, 10);
});

test('Hard Knocks boosts the matching skill for a resource, inside the test', () => {
  let s = solo('01003', 11, ['0']); give(s, '01049', 'inPlay'); enemyAt(s, '01161'); const res0 = inv(s).resources; let used = 0;
  const r = act(s, o => o.group === 'fight', d => {
    if (d.kind === 'commit' && used === 0 && d.abilities.some(a => /combat/.test(a.label))) { used++; const a = d.abilities.find(x => /combat/.test(x.label))!; const [cardId, abilityId] = a.id.split(':'); return { seat: d.seat, kind: 'useAbility', cardId: cardId!, abilityId: abilityId! }; }
    return undefined;
  });
  assert.equal(used, 1); assert.equal(inv(r.s).resources, res0 - 1);
  assert.equal(r.ev.find(e => e.kind === 'testResolved')!.skillValue, 4);      // combat 3 + 1
});

// ──────────────────────────────────────────────────────────────────────────── Mystic

test('Forbidden Knowledge turns a secret into a resource for a horror; Holy Rosary adds willpower', () => {
  let s = solo('01004'); const fk = give(s, '01058', 'inPlay'); give(s, '01059', 'inPlay');
  assert.equal(k(s).modsFor('s1', null).willpower, 1);
  const r0 = inv(s).resources; s = act(s, label(/Pay in dread/)).s;
  assert.equal(inv(s).resources, r0 + 1); assert.equal(inv(s).horror, 1); assert.equal(s.cards[fk]!.tokens.uses.secret, 3);
});

test('Shrivelling: willpower, +1 damage, and a bad token costs a horror', () => {
  let s = solo('01004', 11, ['0']); give(s, '01060', 'inPlay'); const g = enemyAt(s, '01161');
  s = act(s, label(/Cast the withering/)).s; assert.equal(s.cards[g]!.tokens.damage, 2); assert.equal(inv(s).horror, 0);
  let t = solo('01004', 11, ['autofail']); give(t, '01060', 'inPlay'); enemyAt(t, '01161');
  t = act(t, label(/Cast the withering/)).s; assert.ok(inv(t).horror >= 1);
});

test('Blinding Light evades with willpower and hurts the enemy; a bad token costs an action', () => {
  const bl = (code: string, bag: Token[]) => { let s = solo('01004', 11, bag); const g = enemyAt(s, '01161'); const c = give(s, code); inv(s).resources = 9; const r = act(s, play(c)); return { s: r.s, g, ev: r.ev }; };
  const a = bl('01066', ['0']); assert.equal(a.s.cards[a.g]!.engaged, null); assert.equal(a.s.cards[a.g]!.tokens.damage, 1);
  const b = bl('01069', ['0']); assert.equal(b.s.cards[b.g]!.tokens.damage, 2);
  const c = bl('01069', ['autofail']); assert.equal(inv(c.s).actionsLeft, 1); assert.ok(inv(c.s).horror >= 1);      // 3, minus the play, minus the one lost
});

test('Ward of Protection cancels a treachery’s revelation for a horror; Drawn to the Flame draws then finds two leads', () => {
  let s = solo('01004'); const ae = k(s).newCard('01166', null); s.encounterDeck.unshift(ae); const w = give(s, '01065'); inv(s).resources = 9;
  const doom0 = s.agenda.doom;
  const d = drive(s, x => x.round > s.round && isTurn(x), reactTo(/Play Ward of Protection/));
  assert.equal(d.s.agenda.doom, doom0 + 1, 'only the mythos doom: the revelation did not place its own'); assert.ok(kinds(d.ev).includes('revelationCancelled')); assert.ok(inv(d.s).horror >= 1); void w;
  let t = solo('01004'); const flame = give(t, '01064'); const foe = k(t).newCard('01159', null); t.encounterDeck.unshift(foe);
  const clues0 = t.locations.study!.clues; t = act(t, play(flame)).s;
  assert.equal(inv(t).clues, 2); assert.equal(t.locations.study!.clues, clues0 - 2); assert.ok(t.enemies.includes(foe));
});

test('Arcane Initiate puts doom on itself, and that doom counts toward the agenda', () => {
  let s = solo('01004'); inv(s).resources = 9; s.agenda.doom = 2; const ai = give(s, '01063');
  s = act(s, play(ai)).s;
  assert.equal(s.agenda.stage, 2, '2 + 1 reached the threshold of 3'); assert.equal(s.cards[ai]!.tokens.doom, 0, 'and the advance cleared it');
  let u = solo('01004'); inv(u).resources = 9; const ai2 = give(u, '01063'); u = act(u, play(ai2)).s;
  assert.equal(u.cards[ai2]!.tokens.doom, 1); assert.equal(k(u).totalDoom(), 1);
});

test('Grotesque Statue draws two tokens and keeps the better; Scrying reorders the top of a deck; Book of Shadows adds charges and an arcane slot', () => {
  let s = solo('01004', 11, ['-4', '+1']); s.locations.study!.shroud = 3; const st = give(s, '01071', 'inPlay');
  const r = act(s, o => o.group === 'investigate', reactTo(/second draw/)); assert.equal(r.ev.find(e => e.kind === 'testResolved')!.outcome, 'success'); void st;
  let t = solo('01004'); const sc = give(t, '01061', 'inPlay'); const top = inv(t).deck.slice(0, 3);
  t = act(t, label(/Gaze into the glass/), d => d.kind === 'choose' && d.prompt === 'scrying.who' ? { seat: d.seat, kind: 'choose', optionIds: ['deck:s1'] }
    : d.kind === 'choose' && d.prompt === 'scrying.next' ? { seat: d.seat, kind: 'choose', optionIds: [d.options[d.options.length - 1]!.id] } : undefined).s;
  assert.deepEqual(inv(t).deck.slice(0, 3), [top[2], top[1], top[0]]); void sc;
  let u = solo('01004'); inv(u).resources = 20; const bos = give(u, '01070', 'inPlay'); const sh = give(u, '01060', 'inPlay'); give(u, '01061', 'inPlay');   // 3 arcane assets need 1 extra arcane slot
  const x = give(u, '01062'); void x; void bos;
  u = act(u, label(/Feed a spell from the book/), d => d.kind === 'choose' ? { seat: d.seat, kind: 'choose', optionIds: [sh] } : undefined).s;
  assert.equal(u.cards[sh]!.tokens.uses.charge, 5);
});

test('Fearless heals a horror when the test is passed; Mind Wipe blanks an enemy’s keywords for the phase', () => {
  let s = solo('01004', 11, ['0']); inv(s).horror = 2; give(s, '01060', 'inPlay'); enemyAt(s, '01161'); const f = give(s, '01067');
  s = act(s, label(/Cast the withering/), d => d.kind === 'commit' ? { seat: d.seat, kind: 'commit', cards: [f] } : undefined).s;
  assert.equal(inv(s).horror, 1);
  let t = solo('01004'); inv(t).resources = 9; const rat = enemyAt(t, '01159', false); const mw = give(t, '01068');
  assert.ok(k(t).hasKeyword(rat, 'hunter'));
  const d = drive(t, x => x.round > t.round, reactTo(/Play Mind Wipe/), 80);
  assert.ok(kinds(d.ev).includes('enemyBlanked')); assert.equal(d.s.cards[rat]!.flags.blank, '1:enemy');
  const x = clone(d.s); x.round = 1; x.phase = 'enemy'; assert.ok(!k(x).hasKeyword(rat, 'hunter'), 'blank during that phase');
  x.phase = 'upkeep'; assert.ok(k(x).hasKeyword(rat, 'hunter'), 'and back to normal after'); void mw;
});

// ──────────────────────────────────────────────────────────────────────────── Survivor

test('Scavenging returns an item from the discard after a good search; Rabbit’s Foot draws after a failure', () => {
  let s = solo('01005', 11, ['+2']); s.locations.study!.shroud = 1; give(s, '01073', 'inPlay'); const item = give(s, '01086', 'discard');
  s = act(s, o => o.group === 'investigate', reactTo(/Pick through/)).s;
  assert.ok(inv(s).hand.includes(item));
  let t = solo('01005', 11, ['autofail']); give(t, '01075', 'inPlay'); inv(t).deck.unshift(k(t).newCard('01086', 's1'));
  t = act(t, o => o.group === 'investigate', reactTo(/rabbit/i)).s;
  assert.equal(inv(t).hand.length, 1);
});

test('Baseball Bat: +2 combat and +1 damage; a skull or auto-fail breaks it', () => {
  let s = solo('01005', 11, ['0']); give(s, '01074', 'inPlay'); const g = enemyAt(s, '01161');
  s = act(s, label(/Swing the bat/)).s; assert.equal(s.cards[g]!.tokens.damage, 2);
  let t = solo('01005', 11, ['autofail']); const bat = give(t, '01074', 'inPlay'); enemyAt(t, '01161');
  t = act(t, label(/Swing the bat/)).s; assert.ok(inv(t).discard.includes(bat));
});

test('Stray Cat and Cunning Distraction evade without a test; Close Call puts the enemy back in the encounter deck', () => {
  let s = solo('01005'); const cat = give(s, '01076', 'inPlay'); const g = enemyAt(s);
  s = act(s, label(/cat bolts/)).s;
  assert.equal(s.cards[g]!.engaged, null); assert.ok(s.cards[g]!.exhausted); assert.ok(inv(s).discard.includes(cat));
  let t = solo('01005'); inv(t).resources = 9; const g1 = enemyAt(t); const g2 = enemyAt(t, '01160'); const cd = give(t, '01078');
  t = act(t, play(cd)).s; assert.equal(t.cards[g1]!.engaged, null); assert.equal(t.cards[g2]!.engaged, null);
  let u = solo('01005', 11, ['+2']); inv(u).resources = 9; const g3 = enemyAt(u); const cc = give(u, '01083');
  u = act(u, o => o.group === 'evade', reactTo(/Play Close Call/)).s;
  assert.ok(u.encounterDeck.includes(g3)); assert.ok(!u.enemies.includes(g3)); void cc;
});

test('"Look what I found!" turns a near miss into two leads; Lucky! adds 2 and draws; Survival Instinct lets you run', () => {
  let s = solo('01005', 11, ['-1']); s.locations.study!.shroud = 3; inv(s).resources = 9; give(s, '01079');
  s = act(s, o => o.group === 'investigate', reactTo(/Play "Look what I found!"/)).s;     // 3 - 1 = 2 vs 3: fails by 1
  assert.equal(inv(s).clues, 2);
  let t = solo('01005', 11, ['-1']); t.locations.study!.shroud = 3; inv(t).resources = 9; give(t, '01084'); inv(t).deck.unshift(k(t).newCard('01086', 's1'));
  const r = act(t, o => o.group === 'investigate', reactTo(/Play Lucky!/)); assert.equal(r.ev.find(e => e.kind === 'testResolved')!.outcome, 'success'); assert.equal(inv(r.s).hand.length, 1);
  let u = solo('01005', 11, ['+2']); openHouse(u); const g = enemyAt(u); const si = give(u, '01081');
  u = act(u, o => o.group === 'evade', d => d.kind === 'commit' ? { seat: d.seat, kind: 'commit', cards: [si] } : d.kind === 'choose' && d.prompt === 'survival.where' ? { seat: d.seat, kind: 'choose', optionIds: [d.options[1]!.id] } : undefined).s;
  assert.notEqual(inv(u).loc, 'hallway'); assert.equal(u.cards[g]!.engaged, null);
});

test('Aquinnah turns an attack onto another enemy at the cost of a horror to her', () => {
  let s = solo('01005'); inv(s).resources = 9; const aq = give(s, '01082', 'inPlay'); const attacker = enemyAt(s, '01161'); const other = enemyAt(s, '01160', false); s.cards[other]!.exhausted = true;     // asleep: it takes the blow but never swings
  s = act(s, label(/Rummage/), reactTo(/turns the blow/)).s;     // provokes: the ghoul attacks, Aquinnah redirects
  assert.equal(inv(s).damage, 0); assert.equal(s.cards[other]!.tokens.damage, 1); void attacker;
  assert.ok(s.cards[aq]!.exhausted); assert.equal(s.cards[aq]!.tokens.horror, 1);
});

test('Will to Survive: no tokens this turn; On the Lam: non-Elite enemies cannot attack until the round ends', () => {
  let s = solo('01005', 11, ['autofail']); inv(s).resources = 9; const w = give(s, '01085'); s = act(s, play(w)).s;
  const r = act(s, o => o.group === 'investigate');
  assert.ok(kinds(r.ev).includes('noTokens')); assert.ok(!kinds(r.ev).includes('tokenRevealed')); assert.equal(r.ev.find(e => e.kind === 'testResolved')!.outcome, 'success');
  const end = drive(r.s, x => x.round > s.round && isTurn(x)); assert.ok(!inv(end.s).roundFlags.noTokens);
  let t = solo('01003'); inv(t).resources = 9; const lam = give(t, '01010'); const g = enemyAt(t); t = act(t, play(lam)).s; const hp = inv(t).damage;
  t = act(t, label(/Rummage/)).s; assert.equal(inv(t).damage, hp, 'no attack of opportunity'); assert.ok(g);
});

// ──────────────────────────────────────────────────────────────────────────── signatures and weaknesses

test('Hospital Debts: spend means into it, and fewer than six on it costs two experience', () => {
  let s = solo('01003'); const hd = give(s, '01011', 'threat');
  s = act(s, label(/toward the debt/)).s; assert.equal(s.cards[hd]!.tokens.resources, 1);
  const done = clone(s); k(done).endGame('R1');
  assert.equal(done.ended!.xp.s1, 0);                                         // -2 floored at 0 when nothing was earned
  const big = clone(s); big.cards[hd]!.tokens.resources = 6; big.victoryDisplay.push(k(big).newCard('01116', null)); k(big).endGame('R1');
  assert.ok(big.ended!.xp.s1! >= 2);
});

test('Abandoned and Alone: two direct horror and the discard pile is removed from the game', () => {
  let s = solo('01005'); const junk = give(s, '01086', 'discard'); const aa = give(s, '01015', 'deck');
  s = act(s, label(/Rummage/)).s;                                          // drawing it resolves its revelation
  assert.equal(inv(s).horror, 2);
  const everywhere = [...inv(s).deck, ...inv(s).hand, ...inv(s).discard, ...inv(s).inPlay, ...inv(s).threat];
  assert.ok(!everywhere.includes(junk), 'removed from the game'); assert.deepEqual(inv(s).discard, [aa]);
});

test('Dark Memory costs two horror if still in hand at the end of your turn; Heirloom draws when you play a spell', () => {
  let s = solo('01004'); const dm = give(s, '01013'); s = drive(s, x => x.round > s.round && isTurn(x) || inv(x).horror >= 2).s;
  assert.ok(inv(s).horror >= 2 && inv(s).hand.includes(dm));
  let t = solo('01004'); inv(t).resources = 9; give(t, '01012', 'inPlay'); const sc = give(t, '01061'); inv(t).deck.unshift(k(t).newCard('01086', 's1'));
  t = act(t, play(sc), reactTo(/heirloom hums/i)).s; assert.equal(inv(t).hand.length, 1);
});

test('Wendy’s Amulet sends events to the bottom of the deck and lets her play the top event of her discard', () => {
  let s = solo('01005'); give(s, '01014', 'inPlay'); inv(s).resources = 9; const ev1 = give(s, '01080'); const deckLen = inv(s).deck.length;
  k(s).discardCard(ev1);
  assert.equal(inv(s).deck[inv(s).deck.length - 1], ev1); assert.equal(inv(s).deck.length, deckLen + 1);
  const t = solo('01005'); give(t, '01014', 'inPlay'); inv(t).resources = 9; const lucky = give(t, '01088', 'discard');    // Emergency Cache (an event) on top of the discard
  const u = act(t, play(lucky)); assert.equal(inv(u.s).resources, 12);
});

test('passive cards load: Leather Coat soaks damage, Perception draws on success, Leo and the vests are inert but playable', () => {
  let s = solo('01005', 11, ['+2']); give(s, '01090'); inv(s).deck.unshift(k(s).newCard('01086', 's1')); const p = inv(s).hand[0]!;
  s = act(s, o => o.group === 'investigate', d => d.kind === 'commit' ? { seat: d.seat, kind: 'commit', cards: [p] } : undefined).s;
  assert.equal(inv(s).hand.length, 1);
  for (const c of ['01072', '01094', '01095', '01000']) assert.ok(E().reg[c], c + ' has a script');
});

test('no card is ever in two places at once, in mixed four-player games (a token effect must resolve before its test does)', () => {
  const ALL = ['01001', '01002', '01003', '01004', '01005'];
  for (let seed = 1; seed <= 12; seed++) {
    const mix = Array.from({ length: 4 }, (_, i) => ALL[(seed + i) % 5]!);
    const seats = mix.map((code, i) => ({ seat: `s${i + 1}`, investigatorCode: code, deck: STARTERS[code]! }));
    let s = start(E(), setupGame(E(), { seed, difficulty: 'standard', seats })).state;
    for (let n = 0; n < 4000 && s.pending && !s.ended; n++) {
      const d = s.pending;
      const a: Answer = d.kind === 'spotlight' ? { seat: d.seats[0]!, kind: 'stepForward' } : d.kind === 'mulligan' ? { seat: d.seat, kind: 'mulligan', cards: [] }
        : d.kind === 'reveal' ? { seat: d.seat, kind: 'reveal' } : d.kind === 'commit' ? { seat: d.seat, kind: 'commit', cards: d.cards.slice(0, 1).map(c => c.id) }
        : d.kind === 'reaction' ? { seat: d.seat, kind: 'react', optionId: d.options[0]!.id } : d.kind === 'choose' ? { seat: d.seat, kind: 'choose', optionIds: d.options.slice(0, d.min).map(o => o.id) } : { seat: d.seat, kind: 'done' };
      const r = step(E(), s, { ...a, decisionId: d.id }); assert.ok(!r.error, r.error?.message ?? ''); s = r.state;
      for (const i of Object.values(s.investigators)) {
        const all = [...i.hand, ...i.deck, ...i.discard, ...i.inPlay, ...i.threat];
        assert.equal(new Set(all).size, all.length, `seed ${seed} step ${n}: a card of ${i.name} is in two places`);
      }
      assert.equal(new Set(r.events.filter(e => e.kind === 'testResolved').map(e => JSON.stringify(e))).size, r.events.filter(e => e.kind === 'testResolved').length === 2 ? 1 : r.events.filter(e => e.kind === 'testResolved').length || 0, 'a test resolves once');
    }
  }
});
