// A first-person diary entry per investigator, drafted from the event log with authored templates. No generation.
import type { GameEvent, GameState, SeatId } from '../kernel/types.ts';
import { narrationPick } from '../kernel/rng.ts';
import { ENDING_TEXT } from './narration/gathering.ts';

type Line = (e: GameEvent, place: string) => string | null;
const pick = (seed: number, n: number, opts: string[]) => opts[narrationPick(seed, n, 3, opts.length)]!;

export function draftJournal(state: GameState, steps: { ver: number; events: GameEvent[] }[], seat: SeatId, gameSeed: number): string {
  const inv = state.investigators[seat]; if (!inv) return '';
  const placeName = (id: unknown) => (typeof id === 'string' && state.locations[id] ? state.locations[id]!.name.toLowerCase() : 'the house');
  const lines: string[] = []; let n = 0; let last = '';
  const add = (s: string | null) => { if (s && s !== last) { lines.push(s); last = s; } };
  const rules: Record<string, Line> = {
    moved: (e, _p) => e.seat === seat ? (e.firstVisit ? pick(gameSeed, n, [`I went into the ${placeName(e.to)} for the first time.`, `The ${placeName(e.to)} was next. I went in.`]) : null) : null,
    clueDiscovered: (e) => e.seat === seat ? pick(gameSeed, n, [`I found something in the ${placeName(e.loc)} that I was not meant to.`, `The ${placeName(e.loc)} gave up a lead.`]) : null,
    enemyDefeated: (e) => e.seat === seat ? `I brought down ${String(e.name)}. I do not like how steady my hands were.` : null,
    enemyAttacks: (e) => e.seat === seat && !e.opportunity ? `${String(e.name)} came for me and I took it.` : null,
    evaded: (e) => e.seat === seat ? `I got away from ${String(e.name)}, only just.` : null,
    frozenInFear: (e) => e.seat === seat ? 'There was a moment I could not move at all.' : null,
    amnesia: (e) => e.seat === seat ? 'Something went missing from my memory and has not come back.' : null,
    paranoia: (e) => e.seat === seat ? 'I stopped trusting what I had in my own pockets.' : null,
    coverUpUsed: (e) => e.seat === seat ? 'The thing I was hiding cost me.' : null,
    litaWon: (e) => e.seat === seat ? 'Someone in the dark decided I could be trusted. I will not forget it.' : null,
    investigatorDefeated: (e) => e.seat === seat ? 'This is where my account stops.' : null,
    resigned: (e) => e.seat === seat ? 'I got out. I am not proud of how fast.' : null,
  };
  for (const st of steps) for (const e of st.events) { n++; const r = rules[e.kind]; if (r) add(r(e, '')); }
  const ending = state.ended ? ENDING_TEXT[state.ended.resolution] ?? '' : '';
  const body = lines.slice(0, 14).join(' ');
  return `**${inv.name} — a night, written down afterwards**\n${body || 'There is not much to say, and I will say it later.'}${ending ? `\n\n*${ending}*` : ''}`;
}
