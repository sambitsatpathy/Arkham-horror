import type { K } from '../ctx.ts';
import type { Handler, LegalOption, SeatId, Token, TestState, GameState } from '../types.ts';
import type { Registry } from '../scripts/types.ts';

export interface TokenEffect {
  modifier: number;
  autofail?: boolean;
  revealAnother?: boolean;
  immediate?: Handler;           // runs right after the token is revealed (e.g. take damage)
  ifFail?: Handler;              // runs after the test if it failed
}

export interface SetupConfig {
  seats: SeatId[];
}

export interface ScenarioModule {
  id: string;
  title: string;
  agendaCodes: string[];
  actCodes: string[];
  registry: Registry;                               // scripts for scenario cards (acts, agendas, locations, scenario handlers)
  chaosBag(difficulty: GameState['difficulty']): Token[];
  /** Build locations, encounter deck, set-aside cards. Investigators already exist and have decks. */
  setup(k: K): void;
  tokenEffect(k: K, seat: SeatId, token: Token, t: TestState): TokenEffect;
  /** Hooks: checkAgenda, advanceAgenda, advanceAct, enemyDefeated, endOfRound, noInvestigators. */
  hook(k: K, name: string, args: Record<string, unknown>): void;
  canMoveInto(k: K, seat: SeatId, to: string): boolean;
  actAdvance(k: K, seat: SeatId): { ok: boolean; label: string } | null;
  extraActions(k: K, seat: SeatId): LegalOption[];  // location actions such as resign
  describeLocation?(k: K, locId: string): string;
}
