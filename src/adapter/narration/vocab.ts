// Rules terms in, words a player reads out. Numbers appear only in the `math` immersion mode.
export type Immersion = 'story' | 'balanced' | 'math';

export const moments = (left: number, max = 3) => '●'.repeat(Math.max(0, left)) + '○'.repeat(Math.max(0, Math.max(max, left) - left));
export const momentsWord = (n: number) => n === 0 ? 'no moments left' : n === 1 ? 'one moment left' : n === 2 ? 'two moments left' : `${n} moments left`;

export function bar(n: number, of: number, width = 6): string {
  if (of <= 0) return '';
  const f = Math.max(0, Math.min(width, Math.round((n / of) * width)));
  return '▰'.repeat(f) + '▱'.repeat(width - f);
}

/** How someone is holding up, from the share of their body and mind already spent. */
export function holdingUp(wounds: number, maxW: number, nerves: number, maxN: number): string {
  const frac = Math.max(maxW ? wounds / maxW : 0, maxN ? nerves / maxN : 0);
  if (frac === 0) return 'steady';
  if (frac < 0.34) return 'a little rattled';
  if (frac < 0.67) return 'hurting';
  if (frac < 0.9) return 'badly shaken';
  return 'barely standing';
}
export const woundsWord = (w: number, max: number) => w === 0 ? 'unhurt' : w * 2 < max ? 'bruised' : w < max - 1 ? 'hurt' : 'close to collapse';
export const nervesWord = (h: number, max: number) => h === 0 ? 'calm' : h * 2 < max ? 'uneasy' : h < max - 1 ? 'shaken' : 'close to breaking';

export function leadsLeftWord(n: number): string {
  return n <= 0 ? 'nothing more to find' : n === 1 ? 'a little left to find' : n <= 3 ? 'some left to find' : 'much left to find';
}

export function dreadWord(doom: number, threshold: number): string {
  if (threshold <= 0) return 'the hour is uncertain';
  const f = doom / threshold;
  return f <= 0 ? 'the night is quiet' : f < 0.5 ? 'unease is building' : f < 1 ? 'the dark is pressing close' : 'the hour has come';
}

export function difficultyWord(d: number): string { return d <= 1 ? 'an easy matter' : d === 2 ? 'a modest challenge' : d === 3 ? 'a stubborn one' : d === 4 ? 'a hard one' : 'a daunting one'; }
export function oddsWord(skill: number, difficulty: number): string {
  const diff = skill - difficulty;
  return diff >= 2 ? 'good odds' : diff >= 0 ? 'even odds' : diff >= -2 ? 'long odds' : 'slim odds';
}
export function situation(label: string, kind: string, skill: number, difficulty: number, mode: Immersion): string {
  const what = kind === 'investigate' ? 'The place gives up its secrets slowly' : kind === 'fight' ? 'A fight' : kind === 'evade' ? 'Getting away' : kind === 'parley' ? 'Talking this through' : 'This';
  const words = `${what} is ${difficultyWord(difficulty)}; ${oddsWord(skill, difficulty)}.`;
  return mode === 'math' ? `${words} (${label}: your skill ${skill} against ${difficulty})` : words;
}

/** Tokens become sensations. */
export type Feel = 'doom' | 'elder' | 'symbol' | 'great' | 'good' | 'flat' | 'bad' | 'awful';
export function tokenFeel(tokens: (string | null)[], autofail: boolean): Feel {
  if (autofail) return 'doom';
  const t = tokens.filter((x): x is string => !!x);
  if (t.includes('elder_sign')) return 'elder';
  if (t.some(x => ['skull', 'cultist', 'tablet', 'elder_thing'].includes(x))) return 'symbol';
  const nums = t.map(Number).filter(n => !Number.isNaN(n));
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum >= 1 ? 'great' : sum === 0 ? 'flat' : sum >= -1 ? 'good' : sum >= -3 ? 'bad' : 'awful';
}

/** Player-supplied text is untrusted: strip mentions and markdown, cap its length. */
export function cleanHow(s: unknown): string {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/<[^>]*>/g, '').replace(/[`*_~|<>\\]/g, '').replace(/@/g, '@\u200b').trim().slice(0, 300);
}
export const escapeMd = (s: string) => s.replace(/([\\`*_~|>#\[\]()])/g, '\\$1').replace(/@/g, '@\u200b');
export const mentionsOff = { parse: [] as string[] };

export const FEEL_LINE: Record<Feel, string> = {
  doom: 'Everything goes wrong at once.', elder: 'Something steadies the hand that reaches in.', symbol: 'A cold wrongness presses in.',
  great: 'Luck holds.', flat: 'Nothing helps, nothing hinders.', good: 'A small snag.', bad: 'It is harder than it should be.', awful: 'The dark leans on the scale.',
};
