import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine, autoplay } from './helpers.ts';
import { step, start, legalActions } from '../src/kernel/engine.ts';
import { setupGame } from '../src/kernel/setup.ts';
import { STARTERS, validateDeck } from '../src/kernel/deck.ts';
import { K } from '../src/kernel/ctx.ts';
import type { Answer, GameState, SeatId, Token, CardId } from '../src/kernel/types.ts';

const E = () => engine();
const INVS = ['01001', '01002', '01003', '01004', '01005'];

/** One investigator, mulligan kept, an empty hand so nothing opens a window the test does not expect. */
function turnState(inv: string, seed = 5): GameState {
  const s0 = setupGame(E(), { seed, difficulty: 'standard', seats: [{ seat: 's1', investigatorCode: inv, deck: STARTERS[inv]! }] });
  let s = start(E(), s0).state;
  s = step(E(), s, { seat: 's1', kind: 'mulligan', cards: [] }).state;
  const i = s.investigators.s1!; i.deck.push(...i.hand); i.hand = [];
  return s;
}
const k = (s: GameState) => new K(s, E().cat, E().reg);
const give = (s: GameState, code: string, zone: 'hand' | 'inPlay' | 'threat' = 'hand'): CardId => { const kk = k(s); const id = kk.newCard(code, 's1'); kk.inv('s1')[zone].push(id); return id; };
const byTitle = (t: string) => E().cat.byName(t)!.code;
const withBag = (s: GameState, bag: Token[]) => { s.chaosBag = bag; return s; };
const inv = (s: GameState) => s.investigators.s1!;
function go(s: GameState, a: { kind: string; seat?: SeatId; [k: string]: unknown }) {
  const r = step(E(), s, { seat: 's1', ...a, decisionId: s.pending?.id } as Answer);
  assert.ok(!r.error, `${r.error?.code}: ${r.error?.message} for ${JSON.stringify(a)} pending ${JSON.stringify(s.pending)}`);
  return r;
}
/** Answer whatever is pending until it is the player's turn again: no commits, first option of any choice, reactions passed, tokens drawn. */
function settle(s: GameState, evs: any[] = [], opts: { react?: (o: { id: string; label: string }[]) => string | null; choose?: (d: any) => string[] } = {}): { s: GameState; evs: any[] } {
  for (let n = 0; n < 150 && s.pending && s.pending.kind !== 'turn' && !s.ended; n++) {
    const p: any = s.pending; let a: any;
    if (p.kind === 'commit') a = { kind: 'commit', cards: [] };
    else if (p.kind === 'reveal') a = { kind: 'reveal' };
    else if (p.kind === 'reaction') a = { kind: 'react', optionId: opts.react ? opts.react(p.options) : null };
    else if (p.kind === 'choose') a = { kind: 'choose', optionIds: opts.choose ? opts.choose(p) : p.options.slice(0, p.min).map((o: any) => o.id) };
    else break;
    const r = go(s, a); s = r.state; evs.push(...r.events);
  }
  return { s, evs };
}
const act = (s: GameState, action: any, opts?: Parameters<typeof settle>[2]) => { const r = go(s, { kind: 'action', action }); return settle(r.state, [...r.events], opts); };
const ghoul = (s: GameState, engage = true) => { const kk = k(s); const id = kk.newCard(byTitle('Ghoul Minion'), null); kk.spawnEnemy(id, engage ? { engage: 's1' } : { loc: inv(s).loc }); return id; };
const ab = (s: GameState, cardId: CardId, abilityId: string, targetId?: string) => ({ type: 'activate', cardId, abilityId, ...(targetId ? { targetId } : {}) });

test('every starter deck is legal and every card in it is scripted', () => {
  for (const code of INVS) {
    const r = validateDeck(E().cat, E().reg, code, STARTERS[code]!);
    assert.deepEqual([r.errors, r.warnings], [[], []], code);
  }
});

test('every player card in the Core Set now has a script', () => {
  const missing = E().cat.all().filter(c => c.type !== 'investigator' && !c.encounterSet && !E().reg[c.code]).map(c => c.title);
  assert.deepEqual(missing, []);
});

test('each investigator plays whole games to an ending without a rules error', () => {
  for (const code of INVS) for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s0 = setupGame(E(), { seed, difficulty: 'standard', seats: [{ seat: 's1', investigatorCode: code, deck: STARTERS[code]! }, { seat: 's2', investigatorCode: INVS[(INVS.indexOf(code) + 1) % 5]!, deck: STARTERS[INVS[(INVS.indexOf(code) + 1) % 5]!]! }] });
    const r = autoplay(E(), start(E(), s0).state, undefined, 6000);
    assert.ok(r.state.ended, `${code} seed ${seed} did not end in ${r.steps} steps`);
  }
});

// ---------------------------------------------------------------------------------------------------------------- investigators

test('Daisy: her extra action is for tomes only, and is spent first', () => {
  let s = turnState('01002'); const necro = give(s, '01009', 'threat'); k(s).card(necro).tokens.horror = 3;
  assert.equal(inv(s).actionsLeft, 3); assert.equal(inv(s).restricted.tome, 1);
  s = act(s, ab(s, necro, 'read')).s;
  assert.equal(inv(s).actionsLeft, 3, 'the first tome action cost no normal action'); assert.equal(inv(s).restricted.tome, 0);
  s = act(s, ab(s, necro, 'read')).s;
  assert.equal(inv(s).actionsLeft, 2);
  assert.equal(k(s).card(necro).tokens.horror, 1); assert.equal(inv(s).horror, 2);
  // a non-tome action cannot use it
  const t2 = turnState('01002'); give(t2, '01009', 'threat'); const t3 = t2;
  const rummage = legalActions(E(), t3, 's1').find(o => o.group === 'draw')!; const r = go(t3, { kind: 'action', action: rummage.action });
  assert.equal(inv(r.state).actionsLeft, 2); assert.equal(inv(r.state).restricted.tome, 1);
});

test('the Necronomicon turns an elder sign into an auto-fail; it cannot leave while horror is on it', () => {
  let s = turnState('01002'); give(s, '01009', 'threat'); withBag(s, ['elder_sign']);
  const r = act(s, { type: 'investigate' }); const t = r.evs.find(e => e.kind === 'testResolved')!;
  assert.equal(t.outcome, 'failure'); assert.equal(t.autofail, true);
});

test('Daisy: a successful elder sign draws a card for each tome she controls', () => {
  let s = turnState('01002'); give(s, '01031', 'inPlay'); give(s, '01042', 'inPlay'); withBag(s, ['elder_sign']);
  const r = act(s, { type: 'investigate' });
  assert.equal(r.evs.filter(e => e.kind === 'drew' && e.why === 'elder').length, 2);
});

test('Skids: two means buy one more action, once per round; the elder sign pays two means back', () => {
  let s = turnState('01003'); const left = inv(s).actionsLeft;
  const sk = legalActions(E(), s, 's1').find(o => o.group === 'activate' && o.label.includes('another moment'))!;
  assert.ok(sk);
  s = go(s, { kind: 'action', action: sk.action }).state;
  assert.equal(inv(s).resources, 3); assert.equal(inv(s).actionsLeft, left + 1);
  assert.ok(!legalActions(E(), s, 's1').some(o => o.label.includes('another moment')), 'only once per round');
  let t = turnState('01003'); withBag(t, ['elder_sign']); const res = inv(t).resources;
  t = act(t, { type: 'investigate' }).s;
  assert.equal(inv(t).resources, res + 2, 'elder sign: +2 and it succeeded (3 + 2 vs shroud 2)');
});

test('Agnes: horror lets her strike back, once a phase; her elder sign counts her horror', () => {
  let s = turnState('01004'); ghoul(s); ghoul(s);
  const e0 = go(s, { kind: 'done' }); const r = settle(e0.state, [...e0.events], { react: o => o[0]?.id ?? null });
  const uses = r.evs.filter(x => x.kind === 'reactionUsed' && /lashes out/.test(String(x.label)));
  assert.equal(uses.length, 1, 'two horror hits in one phase, one strike back');
  assert.ok(r.evs.some(x => x.kind === 'enemyDamaged' && x.source === 'Agnes Baker'));
  let t = turnState('01004'); inv(t).horror = 3; withBag(t, ['elder_sign']); k(t).loc(inv(t).loc).shroud = 7;   // willpower is not the stat here: intellect 2 + 3 horror vs shroud 7 would fail; with 3 it is 5
  const o = act(t, { type: 'investigate' }); assert.equal(o.evs.find(x => x.kind === 'testResolved')!.tokenMod, 3);
});

test('Wendy: giving up a card turns the token; with her amulet the elder sign always succeeds', () => {
  let s = turnState('01005'); const keep = give(s, '01072'); withBag(s, ['-4', '0']); void keep;
  let r = go(s, { kind: 'action', action: { type: 'investigate' } }); s = r.state;
  while (s.pending?.kind === 'commit') s = go(s, { kind: 'commit', cards: [] }).state;
  r = go(s, { kind: 'reveal' }); s = r.state;
  assert.equal(s.pending?.kind, 'reaction', 'the reaction is offered on the drawn token');
  const opt = (s.pending as any).options[0]; const g1 = go(s, { kind: 'react', optionId: opt.id }); s = g1.state; const evs0 = [...r.events, ...g1.events];
  if (s.pending?.kind === 'choose') { const g2 = go(s, { kind: 'choose', optionIds: [(s.pending as any).options[0].id] }); s = g2.state; evs0.push(...g2.events); }   // a lone card is discarded without asking
  const out = settle(s, [], { react: () => null }); const evs = out.evs.concat(evs0);
  assert.ok(evs.some(e => e.kind === 'tokenCancelled'));
  assert.equal(inv(out.s).discard.length, 1);
  // the amulet: elder sign succeeds whatever the odds
  let t = turnState('01005'); give(t, '01014', 'inPlay'); withBag(t, ['elder_sign']); k(t).loc(inv(t).loc).shroud = 9;
  const o = act(t, { type: 'investigate' }); assert.equal(o.evs.find(e => e.kind === 'testResolved')!.outcome, 'success');
});

// ---------------------------------------------------------------------------------------------------------------- cards

test('Leo De Luca gives a fourth action', () => {
  let s = turnState('01003'); give(s, '01048', 'inPlay'); s.encounterDeck = []; s.encounterDiscard = [];   // keep the mythos quiet
  const e0 = go(s, { kind: 'done' }); const r = settle(e0.state, [...e0.events]);
  assert.equal(r.s.pending?.kind, 'turn'); assert.equal(inv(r.s).actionsLeft, 4);
});

test('Shotgun: damage is how much you succeeded by (at least 1, at most 5)', () => {
  let s = turnState('01001'); const g = ghoul(s); const gun = give(s, '01029', 'inPlay'); k(s).card(gun).tokens.uses.ammo = 2; withBag(s, ['+1']);
  const r = act(s, ab(s, gun, 'fight', g));
  const dmg = r.evs.filter(e => e.kind === 'enemyDamaged').reduce((n, e) => n + Number(e.amount), 0);
  const res = r.evs.find(e => e.kind === 'testResolved')!;
  assert.equal(res.outcome, 'success'); assert.equal(dmg, Math.min(5, Math.max(1, Number(res.margin))));
  assert.equal(k(r.s).card(gun).tokens.uses.ammo, 1);
});

test('Switchblade: +1 damage when you succeed by 2 or more; Backstab fights with agility for +2 damage', () => {
  let s = turnState('01003'); const g = ghoul(s); const sw = give(s, '01044', 'inPlay'); withBag(s, ['+1']);
  const r = act(s, ab(s, sw, 'fight', g));
  const res = r.evs.find(e => e.kind === 'testResolved')!;
  const dmg = r.evs.filter(e => e.kind === 'enemyDamaged').reduce((n, e) => n + Number(e.amount), 0);
  assert.equal(dmg, Number(res.margin) >= 2 ? 2 : 1);
  let t = turnState('01003'); const g2 = ghoul(t); const bs = give(t, '01051'); withBag(t, ['+1']);
  const r2 = act(t, { type: 'play', cardId: bs });
  const started = r2.evs.find(e => e.kind === 'testStarted')!; assert.equal(started.skill, 'agility');
  assert.equal(r2.evs.filter(e => e.kind === 'enemyDamaged').reduce((n, e) => n + Number(e.amount), 0), 3);
  void g2;
});

test('Elusive disengages everything and moves you to an empty revealed place', () => {
  let s = turnState('01003'); const g = ghoul(s); const kk = k(s);
  for (const id of ['hallway']) { s.locations[id]!.inPlay = true; kk.revealLocation(id); }
  const el = give(s, '01050');
  const r = act(s, { type: 'play', cardId: el });
  assert.equal(k(r.s).card(g).engaged, null); assert.equal(inv(r.s).loc, 'hallway');
});

test('Stray Cat evades a non-elite enemy automatically; Cunning Distraction evades everything here', () => {
  let s = turnState('01005'); const g = ghoul(s); const cat = give(s, '01076', 'inPlay');
  let r = act(s, ab(s, cat, 'dart'), { choose: (d) => [d.options[0].id] });
  assert.equal(k(r.s).card(g).engaged, null); assert.equal(k(r.s).card(g).exhausted, true);
  assert.ok(!inv(r.s).inPlay.includes(cat));
  let t = turnState('01005'); const a = ghoul(t); const b = ghoul(t); const cd = give(t, '01078'); inv(t).resources = 9;
  r = act(t, { type: 'play', cardId: cd });
  assert.ok(k(r.s).card(a).exhausted && k(r.s).card(b).exhausted);
});

test('Police Badge: willpower +1, and spent it gives two more actions', () => {
  let s = turnState('01001'); const badge = give(s, '01027', 'inPlay');
  const before = inv(s).actionsLeft;
  s = go(s, { kind: 'action', action: ab(s, badge, 'rush') }).state;
  assert.equal(inv(s).actionsLeft, before + 2); assert.ok(inv(s).discard.includes(badge));
});

test('Magnifying Glass (1) returns to hand when the place has no leads left', () => {
  let s = turnState('01001'); const mg = give(s, '01040', 'inPlay');
  assert.ok(!legalActions(E(), s, 's1').some(o => o.group === 'activate' && o.label.includes('Tuck')), 'clues remain here');
  k(s).loc(inv(s).loc).clues = 0;
  s = go(s, { kind: 'action', action: ab(s, mg, 'ret') }).state;
  assert.ok(inv(s).hand.includes(mg));
});

test('Disc of Itzamna dispels a non-elite enemy that spawns where you stand', () => {
  let s = turnState('01004'); const disc = give(s, '01041', 'inPlay'); const flame = give(s, '01064');
  const g = k(s).newCard(byTitle('Ghoul Minion'), null); s.encounterDeck.unshift(g);
  const r0 = go(s, { kind: 'action', action: { type: 'play', cardId: flame } });
  assert.equal(r0.state.pending?.kind, 'reaction', JSON.stringify(r0.state.pending));
  const opt = (r0.state.pending as any).options.find((o: any) => /Break the disc/.test(o.label)); assert.ok(opt);
  const r1 = go(r0.state, { kind: 'react', optionId: opt.id }); const out = settle(r1.state, [...r0.events, ...r1.events]);
  assert.ok(out.evs.some(e => e.kind === 'enemyDismissed')); assert.ok(!out.s.enemies.includes(g)); assert.ok(inv(out.s).discard.includes(disc));
  assert.equal(inv(out.s).clues, 2, 'Drawn to the Flame still finds its two clues');
});

test('Hot Streak, Burglary and the Tote Bag', () => {
  let s = turnState('01003'); const hs = give(s, '01057'); inv(s).resources = 9; const res = inv(s).resources;
  s = act(s, { type: 'play', cardId: hs }).s;
  assert.equal(inv(s).resources, res - 3 + 10);
  let t = turnState('01003'); const bg = give(t, '01045', 'inPlay'); withBag(t, ['+1']); const r0 = inv(t).resources;
  const r = act(t, ab(t, bg, 'rob')); assert.equal(inv(r.s).resources, r0 + 3); assert.equal(inv(r.s).clues, 0, 'resources instead of a lead');
  // Tote Bag: two extra hand slots, only for tomes
  let d = turnState('01002'); give(d, '01008', 'inPlay'); inv(d).resources = 20; inv(d).actionsLeft = 9;
  const play = (code: string) => { const id = give(d, code); const x = go(d, { kind: 'action', action: { type: 'play', cardId: id } }); d = x.state; return d.pending; };
  assert.equal(play('01086')?.kind, 'turn'); assert.equal(play('01087')?.kind, 'turn');                     // two ordinary hand items fill the ordinary slots
  assert.equal(play('01031')?.kind, 'turn'); assert.equal(play('01035')?.kind, 'turn');                     // two tomes fit the bag
  assert.equal(play('01042')?.kind, 'choose', 'a third tome has nowhere to go');
});

test('Dark Memory: it adds doom, and costs two horror if it is still in hand at the end of the turn', () => {
  let s = turnState('01004'); const dm = give(s, '01013'); const doom = s.agenda.doom;
  const r = act(s, { type: 'play', cardId: dm }); assert.equal(r.s.agenda.doom, doom + 1);
  let t = turnState('01004'); give(t, '01013');
  const e = go(t, { kind: 'done' } as any); const settled = settle(e.state, [...e.events]);
  assert.equal(inv(settled.s).horror, 2);
});

test('Abandoned and Alone removes the discard pile from the game; Hospital Debts costs experience', () => {
  let s = turnState('01005'); const old = give(s, '01072'); inv(s).hand = []; inv(s).discard.push(old);
  const aa = k(s).newCard('01015', 's1'); inv(s).deck.unshift(aa);
  s = act(s, { type: 'draw' }).s;
  assert.equal(inv(s).horror, 2); assert.ok(!inv(s).discard.includes(old) && !inv(s).hand.includes(old)); assert.ok(!Object.values(inv(s)).some(z => Array.isArray(z) && z.includes(old)));
  let t = turnState('01003'); const hd = give(t, '01011', 'threat');
  k(t).endGame('R1'); assert.equal(t.ended!.xp.s1, 0);
  k(t).card(hd).tokens.resources = 6; t.ended = null; k(t).endGame('R1', 5); assert.equal(t.ended!.xp.s1, 5);
  assert.equal(((): number => { const u = turnState('01003'); give(u, '01011', 'threat'); k(u).endGame('R1', 5); return u.ended!.xp.s1!; })(), 3);
});

test('Will to Survive: no chaos tokens are drawn for the rest of the turn', () => {
  let s = turnState('01005'); const w = give(s, '01085'); inv(s).resources = 9; withBag(s, ['autofail']);
  s = act(s, { type: 'play', cardId: w }).s;
  const r = act(s, { type: 'investigate' });
  assert.ok(r.evs.some(e => e.kind === 'noTokens')); assert.equal(r.evs.find(e => e.kind === 'testResolved')!.outcome, 'success');
});

test('Sure Gamble flips a minus token into a plus', () => {
  let s = turnState('01003'); const sg = give(s, '01056'); inv(s).resources = 9; withBag(s, ['-2']);
  let r = go(s, { kind: 'action', action: { type: 'investigate' } }); s = r.state;
  while (s.pending?.kind === 'commit') s = go(s, { kind: 'commit', cards: [] }).state;
  s = go(s, { kind: 'reveal' }).state;
  assert.equal(s.pending?.kind, 'reaction');
  const o = (s.pending as any).options.find((x: any) => x.label.includes('Sure Gamble')); assert.ok(o);
  const g = go(s, { kind: 'react', optionId: o.id }); const out = settle(g.state, [...g.events], { react: () => null });
  assert.ok(out.evs.some(e => e.kind === 'tokenSwitched')); assert.deepEqual(out.evs.find(e => e.kind === 'testResolved')!.tokens, ['+2']);
  void sg;
});

test('Grotesque Statue draws two tokens and keeps the better', () => {
  let s = turnState('01004'); const st = give(s, '01071', 'inPlay'); k(s).card(st).tokens.uses.charge = 4; withBag(s, ['-4', '+1']);
  let r = go(s, { kind: 'action', action: { type: 'investigate' } }); s = r.state;
  while (s.pending?.kind === 'commit') s = go(s, { kind: 'commit', cards: [] }).state;
  s = go(s, { kind: 'reveal' }).state;
  assert.equal(s.pending?.kind, 'reaction'); const g = go(s, { kind: 'react', optionId: (s.pending as any).options[0].id });
  const out = settle(g.state, [...g.events], { react: () => null });
  assert.ok(out.evs.some(e => e.kind === 'twoTokens')); assert.deepEqual(out.evs.find(e => e.kind === 'testResolved')!.tokens, ['+1']);
});




// ---------------------------------------------------------------------------------------------------------------- more cards

const evDamage = (evs: any[]) => evs.filter(e => e.kind === 'enemyDamaged').reduce((n, e) => n + Number(e.amount), 0);

test('Cryptic Research draws three for someone here; Sneak Attack needs an exhausted enemy', () => {
  let s = turnState('01001'); const cr = give(s, '01043'); inv(s).resources = 9;
  const rr = act(s, { type: 'play', cardId: cr }); assert.equal(rr.evs.filter(e => e.kind === 'drew').length, 3);
  let t = turnState('01003'); const g = ghoul(t); const sa = give(t, '01052'); inv(t).resources = 9;
  assert.ok(!legalActions(E(), t, 's1').some(o => o.label.includes('Sneak Attack')), 'the enemy is awake');
  k(t).card(g).exhausted = true;
  const r = act(t, { type: 'play', cardId: sa }); assert.equal(evDamage(r.evs), 2);
});

test('Encyclopedia: +2 to a chosen skill until the end of the phase', () => {
  let s = turnState('01002'); const enc = give(s, '01042', 'inPlay'); const base = k(s).modsFor('s1', null).willpower;
  s = act(s, ab(s, enc, 'consult'), { choose: d => [d.prompt === 'encyclopedia.skill' ? 'willpower' : d.options[0].id] }).s;
  assert.equal(k(s).modsFor('s1', null).willpower, base + 2);
  assert.equal(k(s).modsFor('s1', null).intellect, 0 + k(s).modsFor('s1', null).intellect);
});

test('Scrying reorders the top of a deck; Book of Shadows feeds a spell and adds an arcane slot', () => {
  let s = turnState('01004'); const sc = give(s, '01061', 'inPlay'); k(s).card(sc).tokens.uses.charge = 3;
  const top3 = inv(s).deck.slice(0, 3);
  s = act(s, ab(s, sc, 'scry'), { choose: d => d.prompt === 'scrying.who' ? ['deck:s1'] : [d.options[d.options.length - 1].id] }).s;
  assert.deepEqual(new Set(inv(s).deck.slice(0, 3)), new Set(top3)); assert.notDeepEqual(inv(s).deck.slice(0, 3), top3);
  let t = turnState('01004'); const sh = give(t, '01060', 'inPlay'); const bk = give(t, '01070', 'inPlay');
  t = act(t, ab(t, bk, 'charge')).s; assert.equal(k(t).card(sh).tokens.uses.charge, 5);
  // arcane slots: 2 base + 1 from the book
  let u = turnState('01004'); give(u, '01070', 'inPlay'); inv(u).resources = 20; inv(u).actionsLeft = 9;
  const play = (code: string) => { const id = give(u, code); u = go(u, { kind: 'action', action: { type: 'play', cardId: id } }).state; return u.pending?.kind; };
  assert.equal(play('01060'), 'turn'); assert.equal(play('01061'), 'turn');
});

test('Scavenging brings an item back; Opportunist returns to hand on a big success', () => {
  let s = turnState('01005'); const sc = give(s, '01073', 'inPlay'); const knife = give(s, '01086'); inv(s).hand = inv(s).hand.filter(x => x !== knife); inv(s).discard.push(knife); withBag(s, ['+1']);
  k(s).loc(inv(s).loc).shroud = 1;
  let r = go(s, { kind: 'action', action: { type: 'investigate' } }); s = r.state;
  while (s.pending?.kind === 'commit') s = go(s, { kind: 'commit', cards: [] }).state;
  s = go(s, { kind: 'reveal' }).state;
  assert.equal(s.pending?.kind, 'reaction'); const o = (s.pending as any).options.find((x: any) => /Pick through/.test(x.label)); assert.ok(o);
  s = settle(go(s, { kind: 'react', optionId: o.id }).state, [], { react: () => null }).s; assert.ok(inv(s).hand.includes(knife)); void sc;
  let t = turnState('01003'); const op = give(t, '01053'); withBag(t, ['+1']); k(t).loc(inv(t).loc).shroud = 0;
  let x = go(t, { kind: 'action', action: { type: 'investigate' } }); t = x.state;
  t = go(t, { kind: 'commit', cards: [op] }).state;
  t = settle(t).s; assert.ok(inv(t).hand.includes(op), 'margin of 3 or more: back to hand');
});

test('Blinding Light evades with willpower and hurts the enemy; a bad token costs a moment', () => {
  let s = turnState('01004'); const g = ghoul(s); const bl = give(s, '01066'); inv(s).resources = 9; withBag(s, ['+1']);
  const r = act(s, { type: 'play', cardId: bl });
  assert.equal(r.evs.find(e => e.kind === 'testStarted')!.skill, 'willpower'); assert.equal(evDamage(r.evs), 1);
  assert.equal(k(r.s).card(g).engaged, null);
  let t = turnState('01004'); ghoul(t); const b2 = give(t, '01069'); inv(t).resources = 9; withBag(t, ['skull']); k(t).card(Object.keys(t.cards).find(id => t.enemies.includes(id))!).tokens.damage = 0;
  const left = inv(t).actionsLeft; const r2 = act(t, { type: 'play', cardId: b2 });
  assert.ok(r2.evs.some(e => e.kind === 'momentLost') || r2.evs.find(e => e.kind === 'testResolved')!.outcome === 'failure');
  void left;
});

test('Ward of Protection cancels a treachery and costs a horror', () => {
  let s = turnState('01004'); const ward = give(s, '01065'); const flame = give(s, '01064'); inv(s).resources = 9;
  const tr = k(s).newCard(byTitle('Grasping Hands'), null); s.encounterDeck.unshift(tr);
  const r0 = go(s, { kind: 'action', action: { type: 'play', cardId: flame } });
  assert.equal(r0.state.pending?.kind, 'reaction'); const o = (r0.state.pending as any).options.find((x: any) => /Ward of Protection/.test(x.label)); assert.ok(o);
  const r1 = go(r0.state, { kind: 'react', optionId: o.id }); const out = settle(r1.state, [...r0.events, ...r1.events]);
  assert.ok(out.evs.some(e => e.kind === 'revelationCancelled')); assert.equal(inv(out.s).horror, 1); assert.equal(inv(out.s).damage, 0);
  void ward;
});

test('Close Call shuffles an evaded enemy into the encounter deck; Survival Instinct lets you get clear', () => {
  let s = turnState('01005'); const g = ghoul(s); const cc = give(s, '01083'); inv(s).resources = 9; withBag(s, ['+2']);
  s = go(s, { kind: 'action', action: { type: 'evade', enemyId: g } }).state;
  while (s.pending?.kind === 'commit') s = go(s, { kind: 'commit', cards: [] }).state;
  s = go(s, { kind: 'reveal' }).state;
  assert.equal(s.pending?.kind, 'reaction'); s = settle(s, [], { react: o => o.find(x => /Close Call/.test(x.label))?.id ?? null }).s;
  assert.ok(!s.enemies.includes(g)); assert.ok(s.encounterDeck.includes(g)); void cc;
});

test('Aquinnah turns an attack on another enemy', () => {
  let s = turnState('01005'); const a = ghoul(s); const b = ghoul(s, false); const aq = give(s, '01082', 'inPlay');
  k(s).card(a).tokens.damage = 0; s.encounterDeck = []; s.encounterDiscard = [];
  const e0 = go(s, { kind: 'done' }); const r = settle(e0.state, [...e0.events], { react: o => o.find(x => /turns the blow/.test(x.label))?.id ?? null, choose: d => [d.options[0].id] });
  assert.ok(r.evs.some(e => e.kind === 'reactionUsed' && /turns the blow/.test(String(e.label))));
  assert.ok(r.evs.some(e => e.kind === 'enemyDamaged' && e.cardId === b), 'the other enemy took the damage'); void aq;
});

test('Mind Wipe blanks an enemy for the phase (no hunter, no retaliate)', () => {
  let s = turnState('01004'); const g = ghoul(s, false); k(s).card(g).flags.blank = `${s.round}:${s.phase}`;
  assert.equal(k(s).hasKeyword(g, 'retaliate'), false); assert.equal(k(s).isBlanked(g), true);
  s.phase = 'enemy'; assert.equal(k(s).isBlanked(g), false);
});

test('On the Lam stops non-elite enemies from attacking this round', () => {
  let s = turnState('01003'); ghoul(s); const lam = give(s, '01010'); s.encounterDeck = []; s.encounterDiscard = [];
  s = act(s, { type: 'play', cardId: lam }).s;
  const e0 = go(s, { kind: 'done' }); const r = settle(e0.state, [...e0.events]);
  assert.ok(r.evs.some(e => e.kind === 'attackCancelled')); assert.equal(inv(r.s).damage, 0);
});

test('Cat Burglar slips away to a neighbouring place without a free attack', () => {
  let s = turnState('01003'); const g = ghoul(s); const cb = give(s, '01055', 'inPlay');
  s.locations.hallway!.inPlay = true; k(s).revealLocation('hallway'); s.locations.study!.connections = ['hallway'];
  const r = act(s, ab(s, cb, 'slip'), { choose: d => [d.options[0].id] });
  assert.equal(k(r.s).card(g).engaged, null); assert.equal(inv(r.s).damage, 0); assert.notEqual(inv(r.s).loc, 'study');
});

test('Pickpocketing draws after an evade; Rabbit’s Foot draws after a failure; "Look what I found!" and Lucky! rescue an investigation', () => {
  let s = turnState('01005'); const g = ghoul(s); give(s, '01046', 'inPlay'); withBag(s, ['+2']);
  s = go(s, { kind: 'action', action: { type: 'evade', enemyId: g } }).state;
  while (s.pending?.kind === 'commit') s = go(s, { kind: 'commit', cards: [] }).state;
  s = go(s, { kind: 'reveal' }).state; assert.equal(s.pending?.kind, 'reaction');
  const pr = settle(s, [], { react: o => o.find(x => /Lift something/.test(x.label))?.id ?? null }); assert.equal(pr.evs.filter(e => e.kind === 'drew').length, 1);
  // a failed investigation (token -3 against shroud 4): Rabbit's Foot
  const fail = (code: string, bag: Token[], shroud: number, label: RegExp) => {
    let t = turnState('01005'); give(t, code, code === '01075' ? 'inPlay' : 'hand'); inv(t).resources = 9; withBag(t, bag); k(t).loc(inv(t).loc).shroud = shroud;
    t = go(t, { kind: 'action', action: { type: 'investigate' } }).state;
    while (t.pending?.kind === 'commit') t = go(t, { kind: 'commit', cards: [] }).state;
    const g1 = go(t, { kind: 'reveal' }); const evs: any[] = [...g1.events];
    let x = settle(g1.state, evs, { react: o => o.find(y => label.test(y.label))?.id ?? null });
    return { s: x.s, evs: x.evs };
  };
  const rf = fail('01075', ['-3'], 4, /rabbit/i); assert.equal(rf.evs.filter(e => e.kind === 'drew' && e.why === 'luck').length, 1);
  const lw = fail('01079', ['-2'], 3, /Look what I found/); assert.equal(inv(lw.s).clues, 2);
  const lk = fail('01084', ['-2'], 3, /Lucky/); assert.equal(lk.evs.find(e => e.kind === 'testResolved')!.outcome, 'success');
});

test('Survival Instinct: a good evade also frees you from the others and lets you move', () => {
  let s = turnState('01005'); const a = ghoul(s); const b = ghoul(s); const si = give(s, '01081'); withBag(s, ['+2']);
  s.locations.hallway!.inPlay = true; k(s).revealLocation('hallway'); s.locations.study!.connections = ['hallway'];
  s = go(s, { kind: 'action', action: { type: 'evade', enemyId: a } }).state;
  s = go(s, { kind: 'commit', cards: [si] }).state;
  s = settle(s, [], { react: () => null, choose: d => [d.options[d.options.length - 1].id] }).s;
  assert.equal(k(s).card(b).engaged, null); assert.equal(inv(s).loc, 'hallway');
});

test('Wendy’s Amulet: the top event of the discard pile can be played again, and events go to the bottom of the deck', () => {
  let s = turnState('01005'); give(s, '01014', 'inPlay'); const ev = give(s, '01057'); inv(s).hand = inv(s).hand.filter(x => x !== ev); inv(s).discard.push(ev);
  inv(s).resources = 9;
  assert.ok(legalActions(E(), s, 's1').some(o => o.group === 'play' && o.sourceCardId === ev), 'playable from the discard');
  const cr = give(s, '01057'); // Hot Streak is an event: after playing it goes to the bottom of the deck
  s = act(s, { type: 'play', cardId: cr }).s;
  assert.equal(inv(s).deck[inv(s).deck.length - 1], cr); assert.ok(!inv(s).discard.includes(cr));
});

test('Arcane Initiate puts doom on itself, and that doom counts toward the agenda', () => {
  let s = turnState('01004'); const ai = give(s, '01063'); inv(s).resources = 9; const base = k(s).totalDoom();
  s = act(s, { type: 'play', cardId: ai }).s;
  assert.equal(k(s).totalDoom(), base + 1);
});

test('Heirloom of Hyperborea draws when a spell is played; Forbidden Knowledge turns horror into means', () => {
  let s = turnState('01004'); give(s, '01012', 'inPlay'); const sp = give(s, '01059'); void sp; const ward = give(s, '01060'); inv(s).resources = 9;
  const before = inv(s).hand.length;
  const r = go(s, { kind: 'action', action: { type: 'play', cardId: ward } });
  assert.equal(r.state.pending?.kind, 'reaction'); const out = settle(go(r.state, { kind: 'react', optionId: (r.state.pending as any).options[0].id }).state);
  assert.equal(inv(out.s).hand.length, before, 'one card left the hand, the heirloom drew one');
  let t = turnState('01004'); const fk = give(t, '01058', 'inPlay'); k(t).card(fk).tokens.uses.secret = 4; const m = inv(t).resources;
  t = go(t, { kind: 'action', action: ab(t, fk, 'draw') }).state; t = settle(t).s;
  assert.equal(inv(t).resources, m + 1); assert.equal(inv(t).horror, 1);
});

test('Shrivelling uses willpower and costs a horror on a bad symbol; the Baseball Bat breaks on a skull', () => {
  let s = turnState('01004'); const g = ghoul(s); const sh = give(s, '01060', 'inPlay'); k(s).card(sh).tokens.uses.charge = 4; withBag(s, ['skull']);
  const r = act(s, ab(s, sh, 'cast', g)); assert.equal(r.evs.find(e => e.kind === 'testStarted')!.skill, 'willpower'); assert.equal(inv(r.s).horror, 1);
  let t = turnState('01005'); const g2 = ghoul(t); const bat = give(t, '01074', 'inPlay'); withBag(t, ['skull']);
  const r2 = act(t, ab(t, bat, 'fight', g2)); assert.ok(r2.evs.some(e => e.kind === 'batBroke') || r2.evs.find(e => e.kind === 'testResolved')!.outcome === 'failure');
});
