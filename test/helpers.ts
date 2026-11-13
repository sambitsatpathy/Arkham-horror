import { fileURLToPath } from 'node:url';
import { createDefaultEngine } from '../src/kernel/index.ts';
import { setupGame, type GameConfig } from '../src/kernel/setup.ts';
import { start, step, legalActions, type Engine } from '../src/kernel/engine.ts';
import { ROLAND_STARTER, STARTERS } from '../src/kernel/deck.ts';
import type { Answer, Decision, GameEvent, GameState, LegalOption, SeatId } from '../src/kernel/types.ts';

// Same default as src/main.ts: the clone bundled next to the bot.
export const DATA_DIR = process.env.ARKHAM_DATA
  ?? fileURLToPath(new URL('../arkhamdb-json-data-master/', import.meta.url));

let cached: Engine | null = null;
export function engine(): Engine { return (cached ??= createDefaultEngine(DATA_DIR)); }

export function newGame(seed: number, players = 1, difficulty: GameConfig['difficulty'] = 'standard', mix?: string[]): { E: Engine; state: GameState; events: GameEvent[] } {
  const E = engine();
  const seats = Array.from({ length: players }, (_, i) => { const code = mix?.[i % mix.length] ?? '01001'; return { seat: `s${i + 1}`, investigatorCode: code, deck: STARTERS[code] ?? ROLAND_STARTER }; });
  const s0 = setupGame(E, { seed, difficulty, seats });
  const r = start(E, s0);
  return { E, state: r.state, events: r.events };
}

export interface Policy { (E: Engine, s: GameState, d: Decision): Answer }

/** A deterministic, not-very-clever player used to drive whole games in tests. */
export const basicPolicy: Policy = (E, s, d) => {
  const k = E.k(s);
  switch (d.kind) {
    case 'spotlight': return { seat: d.seats[0]!, kind: 'stepForward', decisionId: d.id };
    case 'mulligan': return { seat: d.seat, kind: 'mulligan', cards: [], decisionId: d.id };
    case 'reveal': return { seat: d.seat, kind: 'reveal', decisionId: d.id };
    case 'commit': return { seat: d.seat, kind: 'commit', cards: d.cards.slice(0, 2).map(c => c.id), decisionId: d.id };
    case 'reaction': return { seat: d.seat, kind: 'react', optionId: d.options[0]!.id, decisionId: d.id };
    case 'choose': return { seat: d.seat, kind: 'choose', optionIds: d.options.slice(0, d.min).map(o => o.id), decisionId: d.id };
    case 'turn': {
      const inv = k.inv(d.seat);
      const legal = legalActions(E, s, d.seat);
      const pick = (g: string) => legal.find(o => o.group === g);
      const advance = pick('advance');
      if (advance) return { seat: d.seat, kind: 'action', action: advance.action, decisionId: d.id };
      const hereEnemies = k.engagedWith(d.seat);
      const fightAb = legal.find(o => o.group === 'activate' && o.action.type === 'activate' && o.action.targetId && hereEnemies.includes(o.action.targetId));
      const choice: LegalOption | undefined =
        (hereEnemies.length ? (fightAb ?? pick('fight')) : undefined)
        ?? legal.find(o => o.group === 'play' && o.actions === 0)
        ?? pick('play')
        ?? (k.loc(inv.loc).clues > 0 ? pick('investigate') : undefined)
        ?? legal.find(o => o.group === 'resign' && false)
        ?? pickMove(k, d.seat, legal)
        ?? pick('resource');
      if (!choice || d.actionsLeft === 0) return { seat: d.seat, kind: 'done', decisionId: d.id };
      return { seat: d.seat, kind: 'action', action: choice.action, decisionId: d.id };
    }
  }
};

function pickMove(k: ReturnType<Engine['k']>, seat: SeatId, legal: LegalOption[]): LegalOption | undefined {
  const moves = legal.filter(o => o.group === 'move');
  const inv = k.inv(seat);
  // prefer unrevealed rooms, then rooms with leads
  return moves.find(o => o.action.type === 'move' && !k.loc(o.action.to).revealed && o.action.to !== 'parlor')
    ?? moves.find(o => o.action.type === 'move' && k.loc(o.action.to).clues > 0)
    ?? (k.loc(inv.loc).clues === 0 ? moves[0] : undefined);
}

export function autoplay(E: Engine, state: GameState, policy: Policy = basicPolicy, maxSteps = 4000): { state: GameState; events: GameEvent[]; steps: number } {
  let s = state; const events: GameEvent[] = []; let steps = 0;
  while (!s.ended && s.pending && steps < maxSteps) {
    const a = policy(E, s, s.pending);
    const r = step(E, s, a);
    if (r.error) throw new Error(`policy answer rejected at step ${steps}: ${r.error.code} ${r.error.message} :: ${JSON.stringify(a)} :: ${JSON.stringify(s.pending)}`);
    s = r.state; events.push(...r.events); steps++;
  }
  return { state: s, events, steps };
}
