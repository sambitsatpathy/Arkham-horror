// Counter-based RNG: the n-th draw depends only on (seed, n), so state stays plain JSON
// and a draft run of an effect can be discarded and replayed to the same random results.
import type { GameState } from './types.ts';

function mix(seed: number, n: number): number {
  // splitmix32-style mixing of (seed, n)
  let z = (seed + Math.imul(n + 1, 0x9e3779b9)) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Uniform integer in [0, max). */
export function randInt(s: Pick<GameState, 'seed' | 'rngN'>, max: number): number {
  const v = mix(s.seed, s.rngN++);
  return Math.floor((v / 0x100000000) * max);
}

export function shuffle<T>(s: Pick<GameState, 'seed' | 'rngN'>, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Independent stream for narration so story text can never change a game result. */
export function narrationPick(seed: number, version: number, salt: number, max: number): number {
  return Math.floor((mix(seed ^ 0x5bd1e995, version * 31 + salt) / 0x100000000) * max);
}
