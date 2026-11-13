import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { newGame, engine, autoplay } from './helpers.ts';
import { step, legalActions } from '../src/kernel/engine.ts';
import { view } from '../src/kernel/view.ts';
import { K } from '../src/kernel/ctx.ts';
import { Store, VersionConflict } from '../src/adapter/store.ts';
import { EVENT_KINDS, generic } from '../src/adapter/narration/generic.ts';
import { gatheringPack } from '../src/adapter/narration/gathering.ts';
import { SILENT, narrate } from '../src/adapter/narration/engine.ts';
import { cleanHow } from '../src/adapter/narration/vocab.ts';
import { loadDeck, parseDeckJson } from '../src/adapter/deckSource.ts';
import { ROLAND_STARTER } from '../src/kernel/deck.ts';
import type { GameState } from '../src/kernel/types.ts';

function walk(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(dir + '/' + d.name) : [dir + '/' + d.name]); }

test('every event kind the kernel can emit is known to the narration layer, and has at least a fallback line or is silent on purpose', () => {
  const seen = new Set<string>();
  for (const f of walk('src/kernel').filter(f => f.endsWith('.ts'))) for (const m of readFileSync(f, 'utf8').matchAll(/emit\('([A-Za-z]+)'/g)) seen.add(m[1]!);
  for (const k of seen) assert.ok((EVENT_KINDS as readonly string[]).includes(k), `EVENT_KINDS is missing ${k}`);
  const fallback = new Set(generic.templates.map(t => t.event));
  for (const k of EVENT_KINDS) assert.ok(SILENT.has(k) || fallback.has(k), `no neutral line for ${k}`);
});

test('every event that actually fires in play has a narration line or is silent on purpose', () => {
  const E = engine(); const fired = new Set<string>();
  for (const players of [1, 2, 4]) for (let seed = 1; seed <= 25; seed++) for (const e of autoplay(E, newGame(seed, players, 'hard').state).events) fired.add(e.kind);
  const fallback = new Set(generic.templates.map(t => t.event));
  for (const k of fired) { assert.ok((EVENT_KINDS as readonly string[]).includes(k), `EVENT_KINDS is missing ${k}`); assert.ok(SILENT.has(k) || fallback.has(k), `no neutral line for ${k}`); }
  assert.ok(fired.size > 25, `only ${fired.size} kinds fired`);
});

test('narration text never uses rules words, and every placeholder is one the narrator fills', () => {
  const banned = [/\bskill test\b/i, /\bchaos bag\b/i, /\bdoom\b/i, /\bactions?\b/i, /\bclues?\b/i, /\bexhaust/i, /\bresources?\b/i, /\bhorror\b/i, /\bdamage\b/i, /\bengaged?\b/i];
  const known = new Set(['who', 'place', 'name', 'enemy', 'from', 'to', 'target', 'count', 'feel']);
  for (const p of [generic, gatheringPack]) for (const t of p.templates) for (const v of t.variants) {
    for (const b of banned) assert.doesNotMatch(v, b, `${p.id}/${t.event}: "${v}"`);
    for (const m of v.matchAll(/\{(\w+)\}/g)) assert.ok(known.has(m[1]!), `${p.id}/${t.event}: unknown placeholder {${m[1]}}`);
    assert.ok(v.length <= 300, 'lines stay short');
  }
});

test('narration is deterministic for a given game and step, and independent of the kernel generator', () => {
  const { state } = newGame(3, 1);
  const ev = [{ kind: 'moved', seat: 's1', from: 'study', to: 'hallway', firstVisit: true, name: 'Hallway' }];
  const a = narrate(ev, { state, version: 7, gameId: 'abcd', pack: [gatheringPack, generic] });
  const b = narrate(ev, { state, version: 7, gameId: 'abcd', pack: [gatheringPack, generic] });
  assert.deepEqual(a, b);
  const rngBefore = state.rngN; narrate(ev, { state, version: 9, gameId: 'abcd', pack: [gatheringPack, generic] });
  assert.equal(state.rngN, rngBefore, 'narration never touches the game RNG');
  // the first arrival in the hallway is the authored line, not the neutral one
  assert.match(a.find(x => x.target.kind === 'loc' && x.target.loc === 'hallway')!.text, /hallway/i);
});

test('the how line is stripped of markdown, mentions and length before it reaches the narrator', () => {
  const out = cleanHow('**bold** `code` @everyone <@123> <#456> _it_ ' + 'x'.repeat(400));
  assert.doesNotMatch(out, /[*`_]/); assert.doesNotMatch(out, /<@|<#/); assert.ok(out.length <= 300);
  assert.match(out, /@​everyone/);
});

test('view(): a seat sees its own hand and nobody else’s, and never deck order, the encounter deck or bag order', () => {
  const { state } = newGame(5, 2);
  let s = state;
  for (const seat of s.seats) s = step(engine(), s, { seat, kind: 'mulligan', cards: [] }).state;
  const v = view(engine(), s, 's1'); const json = JSON.stringify(v);
  for (const id of s.investigators.s2!.hand) assert.ok(!json.includes(`"${id}"`), 'the other hand leaked: ' + id);
  for (const id of s.investigators.s2!.deck) assert.ok(!json.includes(`"${id}"`), 'deck leaked');
  for (const id of s.investigators.s1!.deck) assert.ok(!json.includes(`"${id}"`), 'own deck order leaked');
  for (const id of s.encounterDeck) assert.ok(!json.includes(`"${id}"`), 'encounter deck leaked');
  assert.equal(v.me!.hand.length, s.investigators.s1!.hand.length);
  assert.equal(v.party.find(p => p.seat === 's2')!.handCount, s.investigators.s2!.hand.length);
  assert.ok(!JSON.stringify(v).includes('chaosBag'));
  assert.equal(v.me && 'deck' in v.me, false);
  // hidden places show as unopened doors, never by name
  const unopened = Object.values(v.places).filter(p => !p.revealed);
  for (const p of unopened) { assert.equal(p.name, 'an unopened door'); assert.equal(p.leadsLeft, 0); assert.equal(p.enemies.length, 0); }
  assert.ok(!json.includes('"Attic"') && !json.includes('"Cellar"') && !json.includes('"Parlor"'), 'unrevealed place names leaked');
  assert.equal(view(engine(), s, null).me, null);
});

test('store: a second writer with a stale version is refused; repeated interaction ids are ignored and then pruned', () => {
  const st = new Store();
  st.createGame({ id: 'g', guildId: 'x', scenario: 'gathering', seed: 1, difficulty: 'standard', status: 'active', pace: 'slow', hostUserId: 'h', roleId: null, categoryId: null, behindCategoryId: null, archiveAt: null, paused: false, version: 0 });
  st.appendStep('g', 0, { ver: 1, ts: 1, seat: null, answer: null, events: [] });
  assert.throws(() => st.appendStep('g', 0, { ver: 1, ts: 2, seat: null, answer: null, events: [] }), VersionConflict);
  assert.equal(st.getGame('g')!.version, 1);
  assert.equal(st.seen('i1', 1000), false); assert.equal(st.seen('i1', 1001), true);
  assert.equal(st.seen('i1', 1000 + 16 * 60_000), false, 'forgotten after the interaction token expires');
  // a failed append leaves nothing behind
  assert.equal(st.steps('g').length, 1);
});

test('deck sources: JSON, ids and links are understood; a bad source says so in words; the network is never touched in tests', async () => {
  const slots = Object.fromEntries(ROLAND_STARTER.reduce<Map<string, number>>((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map()));
  const json = JSON.stringify({ investigator_code: '01001', slots, name: 'x' });
  const never = async () => { throw new Error('network'); };
  const r = await loadDeck(json, never); assert.equal(r.deck?.codes.length, 30); assert.equal(r.deck?.investigator, '01001');
  assert.ok((await loadDeck('hello', never)).error);
  assert.ok((await loadDeck('{not json', never)).error);
  const calls: string[] = [];
  const ok = await loadDeck('https://arkhamdb.com/decklist/view/12345/some-deck', async url => { calls.push(url); return { ok: true, status: 200, json: async () => ({ investigator_code: '01001', slots }) }; });
  assert.equal(ok.deck?.codes.length, 30); assert.ok(calls[0]!.endsWith('/12345'));
  const fail = await loadDeck('12345', async () => ({ ok: false, status: 404, json: async () => ({}) })); assert.match(fail.error!, /could not fetch/);
  assert.equal(parseDeckJson({ nope: 1 }), null);
});

// ───────────────────────────────────────────────────────────────────────── the two scripted upgrades

const clone = <T,>(x: T): T => structuredClone(x);
function turn(seed: number): GameState {
  let { state } = newGame(seed, 1); state = step(engine(), state, { seat: 's1', kind: 'mulligan', cards: [] }).state;
  const inv = state.investigators.s1!; inv.deck.push(...inv.hand); inv.hand = [];
  return state;
}

test('Extra Ammunition: puts three ammo on a firearm at your location, and cannot be played without one', () => {
  const s = clone(turn(3)); const E = engine(); const k = new K(s, E.cat, E.reg);
  const ex = k.newCard('01026', 's1'); s.investigators.s1!.hand.push(ex);
  assert.equal(legalActions(E, s, 's1').filter(o => o.group === 'play').length, 0, 'no firearm, no play');
  const gun = k.newCard('01016', 's1'); s.investigators.s1!.inPlay.push(gun); s.cards[gun]!.tokens.uses.ammo = 1;
  const play = legalActions(E, s, 's1').find(o => o.group === 'play')!; assert.ok(play);
  let r = step(E, s, { seat: 's1', kind: 'action', action: play.action, decisionId: s.pending!.id });
  assert.ok(!r.error, r.error?.message ?? '');
  if (r.state.pending?.kind === 'choose') r = step(E, r.state, { seat: 's1', kind: 'choose', optionIds: [gun], decisionId: r.state.pending.id });
  assert.equal(r.state.cards[gun]!.tokens.uses.ammo, 4);
});

test('Beat Cop (2): a fast shot that wounds itself rather than leaving, and falls when its health is gone', () => {
  const s = clone(turn(4)); const E = engine(); const k = new K(s, E.cat, E.reg);
  const cop = k.newCard('01028', 's1'); s.investigators.s1!.inPlay.push(cop);
  const rat = k.newCard('01159', null); k.spawnEnemy(rat, { loc: 'study' });
  const shot = legalActions(E, s, 's1').find(o => o.group === 'activate' && o.sourceCardId === cop)!; assert.ok(shot, 'the shot is offered');
  assert.equal(shot.actions, 0, 'it is fast');
  let r = step(E, s, { seat: 's1', kind: 'action', action: shot.action, decisionId: s.pending!.id });
  while (r.state.pending && r.state.pending.kind !== 'turn') {
    const p = r.state.pending;
    r = step(E, r.state, p.kind === 'choose' ? { seat: p.seat, kind: 'choose', optionIds: p.options.slice(0, p.min).map(o => o.id), decisionId: p.id } : p.kind === 'reaction' ? { seat: p.seat, kind: 'react', optionId: null, decisionId: p.id } : { seat: 's1', kind: 'done', decisionId: p.id });
  }
  assert.equal(r.state.cards[cop]!.tokens.damage, 1, 'it took the wound');
  assert.ok(r.state.investigators.s1!.inPlay.includes(cop), 'and stayed');
  assert.equal(r.state.cards[cop]!.exhausted, true);
});
