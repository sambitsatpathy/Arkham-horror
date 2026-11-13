// Play many whole games headlessly with the simple scripted player and report what happened.
//   npm run simulate -- [games] [players] [difficulty]      (MIX=all rotates through all five investigators)
import { engine, newGame, autoplay } from '../test/helpers.ts';
import type { GameState } from '../src/kernel/types.ts';

const games = Number(process.argv[2] ?? 100); const players = Number(process.argv[3] ?? 2); const difficulty = (process.argv[4] ?? 'standard') as GameState['difficulty'];
const ALL = ['01001', '01002', '01003', '01004', '01005'];
const mixFor = (seed: number) => (process.env.MIX === 'all' ? Array.from({ length: players }, (_, i) => ALL[(seed + i) % 5]!) : undefined);
const E = engine(); const endings: Record<string, number> = {}; const kinds: Record<string, number> = {}; let steps = 0; let rounds = 0; let worst = 0;
const t0 = Date.now();
for (let seed = 1; seed <= games; seed++) {
  const r = autoplay(E, newGame(seed, players, difficulty, mixFor(seed)).state);
  const res = r.state.ended?.resolution ?? 'NOT ENDED'; endings[res] = (endings[res] ?? 0) + 1;
  steps += r.steps; rounds += r.state.round; worst = Math.max(worst, r.steps);
  for (const e of r.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
}
console.log(`${games} games, ${players} player(s), ${difficulty}, ${Date.now() - t0} ms`);
console.log('endings:', endings);
console.log(`average ${(steps / games).toFixed(0)} answers and ${(rounds / games).toFixed(1)} rounds per game; longest ${worst} answers`);
console.log('events seen:', Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
if (endings['NOT ENDED']) process.exitCode = 1;
