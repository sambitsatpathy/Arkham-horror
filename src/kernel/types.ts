// Kernel types. Everything here is plain JSON so a state can be snapshotted, cloned and replayed.

export type SeatId = string;   // "s1".."s4"
export type CardId = string;   // instance id, e.g. "c12"
export type LocId = string;    // scenario-local slug, e.g. "hallway"

export type Skill = 'willpower' | 'intellect' | 'combat' | 'agility';
export const SKILLS: Skill[] = ['willpower', 'intellect', 'combat', 'agility'];

export interface Tokens {
  damage: number; horror: number; doom: number; clues: number; resources: number;
  uses: Record<string, number>;
}

export interface Card {
  id: CardId;
  code: string;                    // catalog code (printing used by the deck)
  owner: SeatId | null;            // null for encounter cards
  exhausted: boolean;
  tokens: Tokens;
  loc: LocId | null;               // where an enemy or location-attached card is
  engaged: SeatId | null;          // enemies only
  attachedTo: LocId | null;        // attached to a location (Obscuring Fog, Barricade)
  flags: Record<string, number | string | boolean>;
}

export type SeatStatus = 'active' | 'defeated' | 'resigned';

export interface Investigator {
  seat: SeatId;
  code: string;                    // catalog code of the investigator card
  name: string;
  maxHealth: number; maxSanity: number;
  damage: number; horror: number;
  skills: Record<Skill, number>;
  resources: number; clues: number;
  loc: LocId;
  actionsLeft: number;
  extraActions: number;            // granted by cards, reset each turn
  restricted: Record<string, number>;   // extra actions that only fit a kind of ability this turn (e.g. { tome: 1 })
  deck: CardId[]; hand: CardId[]; discard: CardId[];
  inPlay: CardId[];                // assets and events that stay
  threat: CardId[];                // threat area
  status: SeatStatus;
  turnTaken: boolean;
  roundFlags: Record<string, number | string | boolean>;   // cleared at round end
  mulliganDone: boolean;
  startingDeckCodes: string[];     // for post-game deck updates
}

export interface Location {
  id: LocId;
  code: string;
  name: string;
  revealed: boolean;
  shroud: number;
  clues: number;
  connections: LocId[];
  attached: CardId[];
  inPlay: boolean;
  victory: number;
}

export type Token =
  | `${'+' | '-'}${number}` | '0'
  | 'skull' | 'cultist' | 'tablet' | 'elder_thing' | 'elder_sign' | 'autofail';

export interface TestInfo {
  seat: SeatId;
  skill: Skill;
  difficulty: number;              // after location and card modifiers
  kind: 'investigate' | 'fight' | 'evade' | 'parley' | 'treachery' | 'other';
  sourceCode: string | null;
  sourceName: string;
  locId: LocId | null;
  enemyId: CardId | null;
  label: string;                   // short key for narration, e.g. "lock", "grasping_hands"
}

export interface TestState extends TestInfo {
  bonus: number;                   // flat modifiers for this test (weapon, fast abilities)
  committed: Record<SeatId, CardId[]>;
  commitQueue: SeatId[];
  stage: 'commit' | 'reveal' | 'wouldReveal' | 'draw' | 'tokenWindow' | 'apply' | 'resolve' | 'done';
  token: Token | null;
  extraTokens: Token[];
  skillValue: number;
  total: number;
  outcome: 'success' | 'failure' | null;
  margin: number;                  // success: total-difficulty; failure: difficulty-total
  autofail: boolean;
  onSuccess: Handler | null;
  onFailure: Handler | null;
  after: Handler | null;           // runs regardless, after success/failure handler
  swapSkill: Record<string, Skill> | null;
  bonusDamage: number;             // extra damage if this is a successful attack
  extraClues: number;              // extra clues if this is a successful investigation
  luckyChecked: boolean;
  symbolDone: boolean;
  data: Record<string, unknown>;   // free scratch for scripts
}

export interface Handler { code: string; name: string; args?: Record<string, unknown>; seat: SeatId | null; }

export type Frame =
  | { k: 'game'; stage: 'mulligan' | 'rounds' | 'finish' }
  | { k: 'mulligan'; i: number }
  | { k: 'mythos'; stage: number; i: number }
  | { k: 'investigation'; stage: number }
  | { k: 'turn'; seat: SeatId; stage: number }
  | { k: 'enemyPhase'; stage: number; i: number }
  | { k: 'upkeep'; stage: number; i: number }
  | { k: 'roundEnd'; stage: number }
  | { k: 'drawEncounter'; seat: SeatId; stage: number; cardId: CardId | null; cancelled?: boolean }
  | { k: 'test'; t: TestState }
  | { k: 'effect'; h: Handler; answers: string[][]; pendingChoice: ChoiceSpec | null }
  | { k: 'window'; trigger: string; data: Record<string, any>; seats: SeatId[]; used: string[]; stage: number; finalize: Handler | null }
  | { k: 'harm'; seat: SeatId; damage: number; horror: number; source: string; sourceCardId: CardId | null; direct: boolean; stage: number; asEnemyAttack: CardId | null; dealtToAssets: CardId[]; tookDamage: number; tookHorror: number }
  | { k: 'attack'; enemyId: CardId; seat: SeatId; stage: number; cancelled: boolean; opportunity: boolean; redirectTo?: CardId }
  | { k: 'scenario'; hook: string; stage: number; args: Record<string, unknown> }
  | { k: 'resolution'; stage: number; code: string };

export interface ChoiceSpec {
  seat: SeatId;
  prompt: string;                  // narration/UI key, e.g. "agenda1b", "medical_texts.target"
  options: Option[];
  min: number; max: number;
}

export interface Option { id: string; label: string; detail?: string; cost?: string }

export type Decision =
  | { id: string; kind: 'spotlight'; seats: SeatId[] }
  | { id: string; kind: 'turn'; seat: SeatId; actionsLeft: number }
  | { id: string; kind: 'commit'; seat: SeatId; test: TestInfo; skillValue: number; cards: Option[]; abilities: Option[] }
  | { id: string; kind: 'reveal'; seat: SeatId; test: TestInfo }
  | { id: string; kind: 'reaction'; seat: SeatId; trigger: string; prompt: string; options: Option[] }
  | { id: string; kind: 'choose'; seat: SeatId; prompt: string; options: Option[]; min: number; max: number }
  | { id: string; kind: 'mulligan'; seat: SeatId; cards: Option[] };

export type Action =
  | { type: 'investigate' } | { type: 'move'; to: LocId } | { type: 'draw' } | { type: 'resource' }
  | { type: 'play'; cardId: CardId } | { type: 'activate'; cardId: CardId; abilityId: string; targetId?: string }
  | { type: 'engage'; enemyId: CardId } | { type: 'fight'; enemyId: CardId } | { type: 'evade'; enemyId: CardId }
  | { type: 'parley'; targetId: string } | { type: 'resign' } | { type: 'advance' };

export type Answer = { seat: SeatId; decisionId?: string; how?: string } & (
  | { kind: 'stepForward' }
  | { kind: 'action'; action: Action }
  | { kind: 'done' }
  | { kind: 'commit'; cards: CardId[] }
  | { kind: 'useAbility'; cardId: CardId; abilityId: string }
  | { kind: 'reveal' }
  | { kind: 'react'; optionId: string | null }
  | { kind: 'choose'; optionIds: string[] }
  | { kind: 'mulligan'; cards: CardId[] }
  | { kind: 'timeout' }
);

export interface GameEvent {
  kind: string;
  seat?: SeatId;
  how?: string;
  [k: string]: unknown;
}

export interface GameState {
  version: number;
  seed: number;
  rngN: number;
  nextId: number;
  nextDecision: number;
  round: number;
  phase: 'setup' | 'mythos' | 'investigation' | 'enemy' | 'upkeep' | 'ended';
  difficulty: 'easy' | 'standard' | 'hard' | 'expert';
  scenario: string;
  seats: SeatId[];                  // seating order
  lead: SeatId;
  spotlight: SeatId | null;
  investigators: Record<SeatId, Investigator>;
  cards: Record<CardId, Card>;
  locations: Record<LocId, Location>;
  setAside: { locations: LocId[]; cards: CardId[] };
  enemies: CardId[];               // enemies in play
  locAssets: CardId[];             // uncontrolled non-enemy cards sitting at a location (Lita before she is won over)
  encounterDeck: CardId[];
  encounterDiscard: CardId[];
  victoryDisplay: CardId[];
  chaosBag: Token[];
  agenda: { stage: number; doom: number; deckStage: number };
  act: { stage: number; clues: number };
  scenarioFlags: Record<string, number | string | boolean>;
  campaignLog: string[];
  stack: Frame[];
  pending: Decision | null;
  ended: null | { resolution: string; xp: Record<SeatId, number>; trauma: Record<SeatId, { physical: number; mental: number }> };
  testResultsThisRound: number;
  ev: GameEvent[];                  // events emitted during the current step (cleared each step)
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
  pending: Decision | null;
  ended: boolean;
  error?: { code: string; message: string };
}

export interface LegalOption {
  action: Action;
  label: string;                   // plain words: "Investigate", "Fight Ghoul Minion"
  cost: string;                    // "1 moment", "free", "1 moment, 2 means"
  group: string;                   // "investigate" | "move" | ... used by adapter autocomplete
  needsConfirm?: boolean;
  targetLabel?: string;
  actions: number;                 // moments it spends (0 = free)
  provokes: boolean;               // provokes attacks of opportunity
  sourceCardId?: CardId;
  designator?: string;             // fight | evade | investigate | parley | resign for card abilities
}
