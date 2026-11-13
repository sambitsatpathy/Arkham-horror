import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, autoplay, engine } from './helpers.ts';
import { validateDeck, ROLAND_STARTER } from '../src/kernel/deck.ts';

test('catalog loads and Roland starter deck validates', () => {
  const E = engine();
  assert.equal(E.cat.loadErrors.length, 0);
  const rep = validateDeck(E.cat, E.reg, '01001', ROLAND_STARTER);
  assert.deepEqual(rep.errors, []);
  assert.deepEqual(rep.warnings, []);
  assert.equal(rep.count, 30);
});

test('a new game opens on the mulligan decision with a 5-card hand', () => {
  const { state } = newGame(1);
  assert.equal(state.pending?.kind, 'mulligan');
  assert.equal(state.investigators.s1!.hand.length, 5);
  assert.equal(state.investigators.s1!.deck.length, 25);
  assert.equal(state.investigators.s1!.loc, 'study');
});

test('same seed and same answers give the same game', () => {
  const a = autoplay(engine(), newGame(7).state);
  const b = autoplay(engine(), newGame(7).state);
  assert.deepEqual(a.state, b.state);
  assert.equal(a.steps, b.steps);
});

test('a scripted game plays to an ending without the engine throwing', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const r = autoplay(engine(), newGame(seed, 2).state);
    assert.ok(r.state.ended, `seed ${seed} should end (steps ${r.steps}, round ${r.state.round}, pending ${r.state.pending?.kind})`);
  }
});
