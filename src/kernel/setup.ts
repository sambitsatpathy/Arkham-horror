// Building a game: investigators, decks, opening hands, the scenario, and the first frame.
import type { Card, CardId, GameState, Investigator, SeatId } from './types.ts';
import { K } from './ctx.ts';
import type { Engine } from './engine.ts';
import { shuffle, randInt } from './rng.ts';

export interface SeatConfig { seat: SeatId; investigatorCode: string; deck: string[]; userId?: string }
export interface GameConfig { seed: number; difficulty: GameState['difficulty']; seats: SeatConfig[] }

/** Basic weaknesses the engine can play, used when a deck holds the random-weakness placeholder (01000). */
export const PLAYABLE_BASIC_WEAKNESSES = ['01096', '01097', '01098', '01099', '01100', '01101', '01102', '01103'];

export function emptyState(cfg: GameConfig): GameState {
  return {
    version: 0, seed: cfg.seed, rngN: 0, nextId: 1, nextDecision: 1, round: 0, phase: 'setup', difficulty: cfg.difficulty,
    scenario: 'gathering', seats: cfg.seats.map(x => x.seat), lead: cfg.seats[0]!.seat, spotlight: null,
    investigators: {}, cards: {}, locations: {}, setAside: { locations: [], cards: [] }, locAssets: [], enemies: [],
    encounterDeck: [], encounterDiscard: [], victoryDisplay: [], chaosBag: [],
    agenda: { stage: 1, doom: 0, deckStage: 1 }, act: { stage: 1, clues: 0 }, scenarioFlags: {}, campaignLog: [],
    stack: [], pending: null, ended: null, testResultsThisRound: 0, ev: [],
  };
}

export function setupGame(E: Engine, cfg: GameConfig): GameState {
  const s = emptyState(cfg);
  const k = new K(s, E.cat, E.reg);
  for (const sc of cfg.seats) {
    const def = E.cat.get(sc.investigatorCode);
    const st = def.investigator!;
    const inv: Investigator = {
      seat: sc.seat, code: sc.investigatorCode, name: def.title, maxHealth: st.health, maxSanity: st.sanity,
      damage: 0, horror: 0, skills: { ...st.skills }, resources: 5, clues: 0, loc: '', actionsLeft: 0, extraActions: 0, restricted: {},
      deck: [], hand: [], discard: [], inPlay: [], threat: [], status: 'active', turnTaken: false, roundFlags: {},
      mulliganDone: false, startingDeckCodes: [...sc.deck],
    };
    s.investigators[sc.seat] = inv;
    // the investigator card itself, so its abilities can use the same machinery as any card
    const card: Card = { id: 'inv:' + sc.seat, code: sc.investigatorCode, owner: sc.seat, exhausted: false, loc: null, engaged: null, attachedTo: null, flags: {}, tokens: { damage: 0, horror: 0, doom: 0, clues: 0, resources: 0, uses: {} } };
    s.cards[card.id] = card;
    const ids: CardId[] = sc.deck.map(code => {
      const real = code === '01000' ? PLAYABLE_BASIC_WEAKNESSES[randInt(s, PLAYABLE_BASIC_WEAKNESSES.length)]! : code;
      return k.newCard(real, sc.seat);
    });
    inv.deck = shuffle(s, ids);
    // opening hand: weaknesses are set aside and replaced, then shuffled back in
    const aside: CardId[] = [];
    while (inv.hand.length < 5 && inv.deck.length) {
      const id = inv.deck.shift()!;
      if (E.cat.get(s.cards[id]!.code).subtype || E.reg[s.cards[id]!.code]?.revelation) aside.push(id); else inv.hand.push(id);
    }
    inv.deck.push(...aside); shuffle(s, inv.deck);
  }
  E.scn.setup(k);
  s.stack = [{ k: 'game', stage: 'mulligan' }];
  return s;
}
