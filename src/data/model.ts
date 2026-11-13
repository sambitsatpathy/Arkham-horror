// Card model mirroring the "Data model" and "Ability and timing resolver" sections of the engine spec.
// Where real ArkhamDB data forced a change from the doc's first sketch, the field is marked  // DOC-FIX.

export type Skill = 'willpower' | 'intellect' | 'combat' | 'agility';
export type PlayerClass = 'guardian' | 'seeker' | 'rogue' | 'mystic' | 'survivor';
export type CardType =
  | 'investigator' | 'asset' | 'event' | 'skill' | 'enemy' | 'treachery'
  | 'location' | 'act' | 'agenda' | 'story' | 'scenarioRef' | 'key';
export type Slot = 'accessory' | 'body' | 'ally' | 'hand' | 'arcane' | 'tarot';

// Numeric sentinels in ArkhamDB: -2 = X, -3 = *, -4 = ?, null = '-' (no value).
export type Value = number | 'X' | '*' | '?' | null;

export interface PerInv { perInvestigator: number }

export type KeywordName =
  | 'fast' | 'hidden' | 'peril' | 'surge' | 'hunter' | 'retaliate' | 'aloof' | 'massive'
  | 'alert' | 'permanent' | 'exceptional' | 'myriad' | 'elusive' | 'customizable'
  | 'uses' | 'patrol' | 'swarming' | 'concealed' | 'seal' | 'bonded' | 'researched';

export interface Keyword { name: KeywordName; arg?: string; amount?: number | 'X'; usesType?: string; perInvestigator?: boolean }

export type Timing = 'would' | 'when' | 'atIf' | 'after';
export interface Trigger { timing: Timing; text: string }

export interface CostPart {
  kind: 'resources' | 'uses' | 'exhaust' | 'discard' | 'damage' | 'horror' | 'exile' | 'other';
  amount?: number | 'X'; what?: string; raw: string;
}

export interface Limit { scope: 'round' | 'phase' | 'turn' | 'game' | 'test' | 'deck' | 'play' | 'other'; count: number; group?: boolean; kind: 'limit' | 'max'; raw: string }

export type Designator = 'fight' | 'evade' | 'investigate' | 'move' | 'parley' | 'resign' | 'explore' | 'engage';

export type Ability =
  | { kind: 'constant'; raw: string }
  | { kind: 'forced'; trigger: Trigger | null; effect: string; raw: string }
  | { kind: 'revelation'; effect: string; raw: string }
  | { kind: 'triggered'; speed: 'free' | 'reaction' | 'action'; actions: number; trigger: Trigger | null;
      cost: CostPart[]; designator?: Designator; effect: string; limit?: Limit; raw: string }
  | { kind: 'keyword'; keyword: Keyword; raw: string }
  | { kind: 'spawn'; instruction: string; raw: string }
  | { kind: 'prey'; instruction: string; only: boolean; raw: string }
  | { kind: 'objective'; text: string; raw: string }
  | { kind: 'playInstruction'; text: string; raw: string }       // events: "Play when ...", "Play only during your turn"
  | { kind: 'deckRestriction'; investigator: string; raw: string }  // "Roland Banks deck only."
  | { kind: 'elderSign'; effect: string; raw: string }
  | { kind: 'effect'; designator?: Designator; raw: string }      // DOC-FIX: events/acts/skills carry bare effect text with no icon
  | { kind: 'modifier'; target: 'investigator' | 'self' | 'attached'; stat: string; delta: number; perInvestigator?: boolean; condition?: string; raw: string }
  | { kind: 'slotGrant'; slot: Slot; count: number; onlyFor?: string; raw: string }
  | { kind: 'additionalAction'; onlyFor?: string; raw: string }
  | { kind: 'discardWhenEmpty'; raw: string }
  | { kind: 'grants'; condition: string; abilities: Ability[]; raw: string }  // "While you control X, she gains: ..." (quoted abilities, may span lines)
  | { kind: 'skillTestEffect'; raw: string }                      // skill cards: "If this skill test is successful ..."
  | { kind: 'limit'; limit: Limit; raw: string };

export interface EnemyStats { fight: Value; evade: Value; damage: number; horror: number; health: Value; healthPerInvestigator: boolean } // DOC-FIX: health is Value, horror defaults to 0

export interface LocationStats {
  shroud: Value; clues: Value;
  cluesFixed: boolean;                  // DOC-FIX: per-investigator is the default, "fixed" is the flag
  connections: string[] | null;         // DOC-FIX: NOT in ArkhamDB data; null until scenario files supply them
}

export interface ActAgendaStats { stage: number; clueThreshold?: Value; doomThreshold?: Value; cluesFixed?: boolean; resolutionPoints: string[] }

export interface DeckOption {
  factions: string[]; levelMin?: number; levelMax?: number;
  limit?: number; trait?: string[]; text?: string[]; atleast?: Record<string, number>; notAny?: boolean; raw: unknown;
}
export interface DeckRequirement { kind: 'size' | 'card' | 'random'; size?: number; codes?: string[]; randomOf?: string; raw: string }

export interface InvestigatorStats {
  skills: Record<Skill, number>; health: number; sanity: number;
  deckSize: number | null; deckOptions: DeckOption[]; deckRequirements: DeckRequirement[];
  backText: string;
}

export type ChaosSymbol = 'skull' | 'cultist' | 'tablet' | 'elder_thing';
export interface SymbolEffect { symbol: ChaosSymbol; modifier: number | 'X' | null; revealAnother: boolean; text: string }
export interface ScenarioRef { easyStandard: SymbolEffect[]; hardExpert: SymbolEffect[]; unparsed: string[] }

export interface CardDef {
  code: string; setCode: string; setPosition: number; sourceCode: string;     // sourceCode = record the data really came from
  title: string; subtitle?: string; type: CardType;
  subtype?: 'weakness' | 'basicweakness';
  unique: boolean; classes: (PlayerClass | 'neutral' | 'mythos')[];
  cost?: Value;                         // undefined = card has no cost field
  level?: number;                       // from xp; absent for investigators, signature and story cards
  skillIcons: { willpower: number; intellect: number; combat: number; agility: number; wild: number };
  slots: Slot[];                        // 'Hand x2' = ['hand','hand']
  traits: string[];
  health?: number | null; sanity?: number | null;            // absent is NOT zero
  enemy?: EnemyStats; location?: LocationStats; actAgenda?: ActAgendaStats; investigator?: InvestigatorStats; scenarioRef?: ScenarioRef;
  keywords: Keyword[]; abilities: Ability[];
  victory?: number; vengeance?: number;
  encounterSet?: string; encounterPosition?: number;
  deckLimit: number; quantity: number;
  signatureOf?: string[];               // restrictions: investigator:01001
  tags?: string[];                      // ArkhamDB's own tag codes, kept verbatim (meaning not verified)
  doubleSided: boolean;
  back?: { name?: string; text?: string; abilities: Ability[]; traits?: string[] };
  textRaw: string;
  flags: string[];                      // non-fatal observations from the parser
}
