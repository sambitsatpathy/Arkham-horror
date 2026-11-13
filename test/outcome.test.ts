// The plain-numbers layer: every result says whether it went through, shows the sum, and gives the damage and what is left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './helpers.ts';
import { step, start, legalActions } from '../src/kernel/engine.ts';
import { setupGame } from '../src/kernel/setup.ts';
import { STARTERS } from '../src/kernel/deck.ts';
import { K } from '../src/kernel/ctx.ts';
import { narrate } from '../src/adapter/narration/engine.ts';
import { generic } from '../src/adapter/narration/generic.ts';
import { gatheringPack } from '../src/adapter/narration/gathering.ts';
import { detailsBody } from '../src/adapter/render.ts';
import type { Answer, Decision, GameEvent, GameState, SeatId, Token } from '../src/kernel/types.ts';

const E = () => engine();
const k = (s: GameState) => new K(s, E().cat, E().reg);
const inv = (s: GameState, seat: SeatId = 's1') => s.investigators[seat]!;

function solo(code: string, bag: Token[]): GameState {
  const s0 = setupGame(E(), { seed: 11, difficulty: 'standard', seats: [{ seat: 's1', investigatorCode: code, deck: STARTERS[code]! }] });
  let s = start(E(), s0).state;
  s = step(E(), s, { seat: 's1', kind: 'mulligan', cards: [] }).state;
  const i = inv(s); i.deck.push(...i.hand); i.hand = []; s.chaosBag = bag;
  return s;
}
const enemyAt = (s: GameState, code: string) => { const id = k(s).newCard(code, null); k(s).spawnEnemy(id, { engage: 's1' }); return id; };
function drive(s: GameState, stop: (s: GameState) => boolean): { s: GameState; ev: GameEvent[] } {
  const ev: GameEvent[] = [];
  for (let n = 0; n < 200 && s.pending && !s.ended && !stop(s); n++) {
    const d: Decision = s.pending;
    const a: Answer = d.kind === 'commit' ? { seat: d.seat, kind: 'commit', cards: [] } : d.kind === 'reveal' ? { seat: d.seat, kind: 'reveal' }
      : d.kind === 'reaction' ? { seat: d.seat, kind: 'react', optionId: null } : d.kind === 'choose' ? { seat: d.seat, kind: 'choose', optionIds: d.options.slice(0, d.min).map(o => o.id) }
      : d.kind === 'turn' ? { seat: d.seat, kind: 'done' } : { seat: (d as { seat: string }).seat, kind: 'mulligan', cards: [] };
    const r = step(E(), s, { ...a, decisionId: d.id }); assert.ok(!r.error, r.error?.message ?? ''); s = r.state; ev.push(...r.events);
  }
  return { s, ev };
}
const doAction = (s: GameState, re: RegExp) => {
  const o = legalActions(E(), s, 's1').find(x => re.test(x.label)); assert.ok(o, `no action like ${re}`);
  const r = step(E(), s, { seat: 's1', kind: 'action', action: o!.action, decisionId: s.pending!.id }); assert.ok(!r.error, r.error?.message ?? '');
  const d = drive(r.state, x => x.pending?.kind === 'turn'); return { s: d.s, ev: [...r.events, ...d.ev] };
};
const say = (ev: GameEvent[], s: GameState) => narrate(ev, { state: s, version: 3, gameId: 'abcd', pack: [gatheringPack, generic] }).map(n => n.text).join('\n');

test('a fight that lands says it passed, shows the sum, the damage dealt and the health left', () => {
  const s = solo('01001', ['+1']); enemyAt(s, '01161');
  const { s: after, ev } = doAction(s, /strike at/i); const text = say(ev, after);
  assert.match(text, /✅ \*\*Passed\*\* — Fight \(combat\), by \d+/);
  assert.match(text, /Skill \d+ .*\+ 1 token = \*\*\d+\*\* against difficulty \*\*\d+\*\*/);
  assert.match(text, /Drew: \+1/);
  assert.match(text, /🗡️ \*\*Hit!\*\* Ravenous Ghoul takes \*\*\d+ damage\*\* — \d+ of \d+ health left/);
  assert.doesNotMatch(text, /no damage dealt/);
});

test('a fight that misses says so plainly and shows no damage', () => {
  const s = solo('01001', ['-5']); enemyAt(s, '01161');
  const { s: after, ev } = doAction(s, /strike at/i); const text = say(ev, after);
  assert.match(text, /❌ \*\*Failed\*\* — Fight \(combat\), short by \d+/);
  assert.match(text, /5 token/); assert.match(text, /The attack misses Ravenous Ghoul: no damage dealt\./);
  assert.doesNotMatch(text, /Hit!/);
});

test('the auto-fail token is named as such and the sum shows it counting as zero', () => {
  const s = solo('01001', ['autofail']); enemyAt(s, '01161');
  const { s: after, ev } = doAction(s, /strike at/i); const text = say(ev, after);
  assert.match(text, /❌ \*\*Failed\*\* — Fight \(combat\): auto-fail/); assert.match(text, /Drew: Auto-fail/); assert.match(text, /counts as 0 = \*\*0\*\*/);
});

test('an investigation reports the leads found and how many are left', () => {
  const s = solo('01001', ['+1']);
  const { s: after, ev } = doAction(s, /search the place/i); const text = say(ev, after);
  assert.match(text, /✅ \*\*Passed\*\* — Investigate \(intellect\)/);
  assert.match(text, /🔎 \*\*1 lead\*\* found — \d+ left here/);
});

test('an enemy attack is one line: who hit whom, for how much, and what is left', () => {
  const s = solo('01001', ['0']); enemyAt(s, '01160');
  const before = inv(s).damage;
  const { s: after, ev } = drive(s, x => x.phase === 'mythos' || x.round > 1);
  const text = say(ev, after); const hurt = inv(after).damage - before;
  assert.ok(hurt > 0, 'the ghoul hurt him');
  assert.match(text, new RegExp(`⚔️ Ghoul Minion hits Roland Banks for \\*\\*${hurt} damage\\*\\*.*health ${inv(after).maxHealth - inv(after).damage}/${inv(after).maxHealth}`));
});

test('Details reads as a sum in words, not as data', () => {
  const s = solo('01001', ['-1']); enemyAt(s, '01161');
  const { ev } = doAction(s, /strike at/i);
  const body = detailsBody(ev); const text = String(body.content);
  assert.match(text, /• Your combat: \*\*\d+\*\*/); assert.match(text, /• Token drawn: \*\*−1\*\*/); assert.match(text, /• Total: \*\*\d+\*\*, needed \*\*\d+\*\* → (passed|failed) by \d+/);
  assert.doesNotMatch(text, /[{}"]|kind:/, 'no JSON');
  assert.equal(body.ephemeral, true);
});

test('the dread line shows where the count stands against the hour', () => {
  const s = solo('01001', ['0']); k(s).placeDoom(1);
  const ev: GameEvent[] = [{ kind: 'doomPlaced', count: 1, total: 1, threshold: 3 }];
  assert.match(say(ev, s), /🕯️ Dread \*\*\+1\*\* — now \*\*1\*\* of 3 before the hour turns/);
});
