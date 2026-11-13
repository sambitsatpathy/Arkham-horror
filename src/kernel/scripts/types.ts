import type { CardId, SeatId, Skill, Option, TestInfo, TestState, Handler } from '../types.ts';
import type { K } from '../ctx.ts';

export type Fn = (k: K, a: any) => void;

export interface CostDef { resources?: number; uses?: [string, number]; exhaust?: boolean; discard?: boolean; }

export interface AbilityDef {
  id: string;
  label: string;
  speed: 'action' | 'fast';
  actions?: number;                       // default 1 for 'action'
  designator?: 'fight' | 'evade' | 'investigate' | 'parley' | 'resign';
  cost?: CostDef;
  when?: (k: K, seat: SeatId, cardId: CardId) => boolean;
  run: string;                            // handler name in Script.handlers
  testOnly?: { skill?: Skill; kinds?: TestInfo['kind'][] };   // fast ability that only makes sense during a test commit window
  limitPerRound?: number;
  needsConfirm?: boolean;
  noProvoke?: boolean;                    // the action does not provoke attacks of opportunity
  controlledOnly?: boolean;               // default true: must be controlled by the acting seat
}

export interface ReactionDef {
  id: string;
  label: string;
  trigger: string;
  when: (k: K, seat: SeatId, cardId: CardId, data: any) => boolean;
  cost?: CostDef;
  limitPerRound?: number;
  limitPerPhase?: number;
  run: string;
}

export interface ForcedDef {
  trigger: string;
  when?: (k: K, ownerSeat: SeatId | null, cardId: CardId, data: any) => boolean;
  run: string;
}

// Called once per card for every investigator; returns the deltas that apply to `tester` (so an ally can buff others at its location).
export type ModFn = (k: K, owner: SeatId, cardId: CardId, ctx: { test?: TestInfo | TestState | null; tester: SeatId }) => Array<{ skill: Skill | 'all'; delta: number }>;

export interface Script {
  handlers: Record<string, Fn>;
  play?: string;                          // event resolution handler
  fastWindow?: { trigger: string; when: (k: K, seat: SeatId, cardId: CardId, data: any) => boolean };
  playRestriction?: (k: K, seat: SeatId, cardId: CardId) => boolean;
  abilities?: AbilityDef[];
  reactions?: ReactionDef[];
  forced?: ForcedDef[];
  mods?: ModFn[];
  restrict?: {
    cannotPlay?: (k: K, seat: SeatId, ownerCardId: CardId, playedCardId: CardId) => boolean;
    actionExtraCost?: (k: K, seat: SeatId, ownerCardId: CardId, actionType: string) => number;
  };
  revelation?: string;                    // handler run when drawn (weakness) or encountered (treachery)
  stays?: boolean;                        // events that stay in play (Barricade)
  skillCard?: { onSuccess?: (k: K, t: TestState, cardId: CardId) => void };
  elderSign?: (k: K, seat: SeatId) => number;     // investigator elder sign modifier
  elderSignAutoSucceed?: (k: K, seat: SeatId) => boolean;   // investigator: the elder sign makes the test succeed outright
  elderSignAsAutofail?: boolean;          // a card in play that makes each elder sign count as an auto-fail
  extraActions?: (k: K, seat: SeatId, cardId: CardId) => number;   // added to the three actions at the start of the owner's turn
  turnStart?: (k: K, seat: SeatId, cardId: CardId) => void;        // runs when the owner's turn begins
  slotBonus?: { slot: string; n: number; onlyTrait?: string }[];   // extra slots this card gives its owner (Tote Bag: 2 hand slots for tomes only)
  eventsToBottom?: boolean;               // events this owner plays or discards go to the bottom of the deck
  playFromDiscardTop?: boolean;           // the top event of the owner's discard may be played as if in hand
  endGameXp?: (k: K, seat: SeatId, cardId: CardId) => number;      // change to experience when the scenario ends
  shroudMod?: (k: K, locId: string, cardId: CardId) => number;   // attached cards
  textBlankedBy?: boolean;
}

export type Registry = Record<string, Script>;
export type { Handler, Option };
