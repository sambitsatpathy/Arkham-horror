// The kernel loop. State is plain JSON; step(state, answer) is pure (it clones the state it is given).
// Control flow is an explicit stack of frames, so a game can be snapshotted mid-test and resumed anywhere.
import type {
  Action, Answer, CardId, ChoiceSpec, Decision, Frame, GameState, Handler, LegalOption, Option, SeatId, StepResult, TestInfo, TestState,
} from './types.ts';
import { K, NeedChoice, CORE, type EffectFrame } from './ctx.ts';
import type { Catalog } from './catalog.ts';
import type { Registry } from './scripts/types.ts';
import type { ScenarioModule } from './scenario/types.ts';
import { fireForced } from './forced.ts';
import { canAffordCost, canPlayCard, payCost, legalActions, sameAction, abilityCandidates, abilityUsable, extraActionCost, noteExtraCostPaid, NON_PROVOKING, isFastCard, usesRestricted } from './legal.ts';
import { coreScript } from './core.ts';
import { shuffle } from './rng.ts';

export interface Engine {
  cat: Catalog; reg: Registry; scn: ScenarioModule;
  k(s: GameState): K;
}

export function createEngine(cat: Catalog, scn: ScenarioModule, registries: Registry[]): Engine {
  const reg: Registry = {};
  for (const r of registries) Object.assign(reg, r);
  Object.assign(reg, scn.registry);
  reg[CORE] = coreScript;
  const E: Engine = { cat, reg, scn, k: (s) => new K(s, cat, reg) };
  return E;
}

// ---------------------------------------------------------------------------------------------- helpers

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
const decide = (s: GameState, d: DistOmit<Decision, 'id'>): void => { s.pending = { ...d, id: `d${s.nextDecision++}` } as Decision; };
const opt = (id: string, label: string, detail?: string): Option => ({ id, label, ...(detail ? { detail } : {}) });
const top = (s: GameState): Frame | undefined => s.stack[s.stack.length - 1];
const info = (t: TestState): TestInfo => ({
  seat: t.seat, skill: t.skill, difficulty: t.difficulty, kind: t.kind, sourceCode: t.sourceCode, sourceName: t.sourceName,
  locId: t.locId, enemyId: t.enemyId, label: t.label,
});
const fail = (state: GameState, code: string, message: string): StepResult => ({ state, events: [], pending: state.pending, ended: !!state.ended, error: { code, message } });

// ---------------------------------------------------------------------------------------------- public API

/** Run a freshly set-up game up to its first decision. */
export function start(E: Engine, state: GameState): StepResult {
  const s = structuredClone(state); s.ev = [];
  run(E, s);
  s.version++;
  const events = s.ev; s.ev = [];
  return { state: s, events, pending: s.pending, ended: !!s.ended };
}

export function step(E: Engine, state: GameState, answer: Answer): StepResult {
  if (state.ended) return fail(state, 'ended', 'The story is over.');
  const p = state.pending;
  if (!p) return fail(state, 'nothing_pending', 'Nothing is waiting on anyone.');
  if (answer.decisionId && answer.decisionId !== p.id) return fail(state, 'stale', 'That moment has passed.');
  const s = structuredClone(state); s.ev = [];
  const err = applyAnswer(E, s, answer);
  if (err) return fail(state, err.code, err.message);
  run(E, s);
  s.version++;
  const events = s.ev; s.ev = [];
  for (const e of events) if (answer.how && e.seat === answer.seat && e.how === undefined && ACTION_EVENTS.has(e.kind)) e.how = answer.how;
  return { state: s, events, pending: s.pending, ended: !!s.ended };
}
const ACTION_EVENTS = new Set(['action']);

export { legalActions };

// ---------------------------------------------------------------------------------------------- answers

function applyAnswer(E: Engine, s: GameState, a: Answer): { code: string; message: string } | null {
  const p = s.pending!; const f = top(s)!;
  const k = E.k(s);
  const timeout = a.kind === 'timeout';
  switch (p.kind) {
    case 'spotlight': {
      if (a.kind !== 'stepForward' || !p.seats.includes(a.seat)) return { code: 'not_yours', message: 'Someone else has the floor.' };
      if (f.k !== 'investigation') return { code: 'state', message: 'Out of step.' };
      s.pending = null; s.spotlight = a.seat;
      s.stack.push({ k: 'turn', seat: a.seat, stage: 0 });
      return null;
    }
    case 'turn': {
      if (a.seat !== p.seat) return { code: 'not_yours', message: 'It is not your turn.' };
      if (f.k !== 'turn') return { code: 'state', message: 'Out of step.' };
      if (a.kind === 'done') { s.pending = null; f.stage = 2; k.emit('turnEnded', { seat: a.seat }); return null; }
      if (a.kind !== 'action') return { code: 'bad_answer', message: 'Choose something to do, or finish.' };
      const legal = legalActions(E, s, a.seat);
      const match = legal.find(o => sameAction(o.action, a.action));
      if (!match) return { code: 'illegal', message: 'That is not possible right now.' };
      s.pending = null;
      performAction(E, s, a.seat, match, a.how);
      return null;
    }
    case 'commit': {
      if (f.k !== 'test') return { code: 'state', message: 'Out of step.' };
      const t = f.t;
      if (a.seat !== p.seat) return { code: 'not_yours', message: 'That prompt is not yours.' };
      if (a.kind === 'timeout') { s.pending = null; t.commitQueue.shift(); return null; }
      if (a.kind === 'useAbility') {
        const found = commitAbilities(k, t, a.seat).find(x => x.cardId === a.cardId && x.ability.id === a.abilityId);
        if (!found) return { code: 'illegal', message: 'That cannot help right now.' };
        s.pending = null;
        payCost(k, a.seat, found.cardId, found.ability.cost);
        if (found.ability.limitPerRound) { const fl = `lim:${found.cardId}:${found.ability.id}`; k.inv(a.seat).roundFlags[fl] = Number(k.inv(a.seat).roundFlags[fl] ?? 0) + 1; }
        k.emit('abilityUsed', { seat: a.seat, name: k.name(found.cardId), label: found.ability.label });
        k.queueEffect({ code: k.card(found.cardId).code, name: found.ability.run, args: { cardId: found.cardId }, seat: a.seat });
        k.flush();
        return null;
      }
      if (a.kind !== 'commit') return { code: 'bad_answer', message: 'Choose cards to lend, or go without.' };
      const eligible = new Set(eligibleCommit(k, t, a.seat));
      const titles = new Map<string, number>();
      for (const ids of Object.values(t.committed)) for (const id of ids) titles.set(k.name(id), (titles.get(k.name(id)) ?? 0) + 1);
      for (const id of a.cards) {
        if (!eligible.has(id)) return { code: 'illegal', message: 'That card cannot be lent to this.' };
        if (/max 1 committed/i.test(k.def(id).textRaw)) {
          const n = (titles.get(k.name(id)) ?? 0) + 1; titles.set(k.name(id), n);
          if (n > 1) return { code: 'illegal', message: 'Only one of those can help here.' };
        }
      }
      if (new Set(a.cards).size !== a.cards.length) return { code: 'illegal', message: 'Duplicate cards.' };
      s.pending = null;
      for (const id of a.cards) k.detach(id);
      t.committed[a.seat] = a.cards;
      t.commitQueue.shift();
      if (a.cards.length) k.emit('committed', { seat: a.seat, names: a.cards.map(id => k.name(id)), count: a.cards.length });
      return null;
    }
    case 'reveal': {
      if (f.k !== 'test') return { code: 'state', message: 'Out of step.' };
      if (a.seat !== p.seat) return { code: 'not_yours', message: 'That is not yours to do.' };
      if (a.kind !== 'reveal') return { code: 'bad_answer', message: 'Reach into the bag.' };
      s.pending = null;
      f.t.stage = 'wouldReveal';
      return null;
    }
    case 'reaction': {
      if (f.k !== 'window') return { code: 'state', message: 'Out of step.' };
      if (a.seat !== p.seat) return { code: 'not_yours', message: 'That prompt is not yours.' };
      if (a.kind !== 'react' && a.kind !== 'timeout') return { code: 'bad_answer', message: 'Use it, or let it pass.' };
      const choice = a.kind === 'react' ? a.optionId : null;
      s.pending = null;
      if (choice === null) { f.stage++; return null; }
      const ok = p.options.find(o => o.id === choice);
      if (!ok) return { code: 'illegal', message: 'That is not an option.' };
      applyReaction(E, s, f, a.seat, choice);
      return null;
    }
    case 'choose': {
      if (a.seat !== p.seat) return { code: 'not_yours', message: 'That prompt is not yours.' };
      if (a.kind === 'timeout') return { code: 'required', message: 'This needs an answer.' };
      if (a.kind !== 'choose') return { code: 'bad_answer', message: 'Make a choice.' };
      const ids = a.optionIds;
      if (new Set(ids).size !== ids.length || ids.length < p.min || ids.length > p.max || !ids.every(i => p.options.some(o => o.id === i)))
        return { code: 'illegal', message: 'That is not a valid choice.' };
      s.pending = null;
      if (f.k === 'effect') { f.answers.push(ids); f.pendingChoice = null; return null; }
      if (f.k === 'harm') { applyHarmChoice(E, s, f, ids[0]!); return null; }
      if (f.k === 'upkeep') { for (const id of ids) k.discardFromHand(p.seat, id); k.emit('handTrimmed', { seat: p.seat, count: ids.length }); f.i++; return null; }
      return { code: 'state', message: 'Out of step.' };
    }
    case 'mulligan': {
      if (f.k !== 'mulligan') return { code: 'state', message: 'Out of step.' };
      if (a.seat !== p.seat) return { code: 'not_yours', message: 'That prompt is not yours.' };
      const cards = a.kind === 'timeout' ? [] : a.kind === 'mulligan' ? a.cards : null;
      if (!cards) return { code: 'bad_answer', message: 'Choose cards to put back, or keep your hand.' };
      const inv = k.inv(p.seat);
      if (!cards.every(c => inv.hand.includes(c)) || new Set(cards).size !== cards.length) return { code: 'illegal', message: 'Those are not in your hand.' };
      s.pending = null;
      for (const c of cards) inv.hand.splice(inv.hand.indexOf(c), 1);
      k.draw(p.seat, cards.length, 'mulligan');
      inv.deck.push(...cards); shuffle(s, inv.deck);
      inv.mulliganDone = true;
      k.emit('mulliganed', { seat: p.seat, count: cards.length });
      f.i++;
      k.flush();
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------- the main loop

function run(E: Engine, s: GameState): void {
  let guard = 0;
  while (!s.pending && !s.ended) {
    if (++guard > 20000) throw new Error('engine loop did not settle');
    const f = top(s);
    if (!f) { E.k(s).endGame('unresolved'); break; }
    RUNNERS[f.k](E, s, f as never);
  }
}

type Runner<T extends Frame['k']> = (E: Engine, s: GameState, f: Extract<Frame, { k: T }>) => void;
const RUNNERS: { [T in Frame['k']]: Runner<T> } = {
  game: runGame, mulligan: runMulligan, mythos: runMythos, investigation: runInvestigation, turn: runTurn,
  enemyPhase: runEnemyPhase, upkeep: runUpkeep, roundEnd: runRoundEnd, drawEncounter: runDrawEncounter,
  test: runTest, effect: runEffect, window: runWindow, harm: runHarm, attack: runAttack, scenario: runScenario,
  resolution: (_E, s) => { s.stack.pop(); },
};

function runGame(E: Engine, s: GameState, f: Extract<Frame, { k: 'game' }>): void {
  const k = E.k(s);
  if (f.stage === 'mulligan') { f.stage = 'rounds'; s.stack.push({ k: 'mulligan', i: 0 }); return; }
  s.round++;
  k.emit('roundStarted', { round: s.round });
  s.stack.push({ k: 'roundEnd', stage: 0 }, { k: 'upkeep', stage: 0, i: 0 }, { k: 'enemyPhase', stage: 0, i: 0 }, { k: 'investigation', stage: 0 });
  if (s.round > 1) s.stack.push({ k: 'mythos', stage: 0, i: 0 });
}

function runMulligan(E: Engine, s: GameState, f: Extract<Frame, { k: 'mulligan' }>): void {
  const k = E.k(s);
  while (f.i < s.seats.length && (k.inv(s.seats[f.i]!).status !== 'active' || k.inv(s.seats[f.i]!).mulliganDone)) f.i++;
  if (f.i >= s.seats.length) { s.stack.pop(); return; }
  const seat = s.seats[f.i]!;
  decide(s, { kind: 'mulligan', seat, cards: k.inv(seat).hand.map(id => opt(id, k.name(id))) });
}

function runMythos(E: Engine, s: GameState, f: Extract<Frame, { k: 'mythos' }>): void {
  const k = E.k(s);
  if (f.stage === 0) {
    s.phase = 'mythos'; k.emit('phaseStarted', { phase: 'mythos', round: s.round });
    k.queue({ k: 'window', trigger: 'afterPhaseBegins', data: { phase: 'mythos' }, seats: k.activeSeats(), used: [], stage: 0, finalize: null });
    f.stage = 1; k.placeDoom(1); k.flush(); return;
  }
  while (f.i < s.seats.length && k.inv(s.seats[f.i]!).status !== 'active') f.i++;
  if (f.i >= s.seats.length) { s.stack.pop(); return; }
  s.stack.push({ k: 'drawEncounter', seat: s.seats[f.i]!, stage: 0, cardId: null });
  f.i++;
}

function runDrawEncounter(E: Engine, s: GameState, f: Extract<Frame, { k: 'drawEncounter' }>): void {
  const k = E.k(s);
  if (f.stage === 0) {
    if (k.inv(f.seat).status !== 'active') { s.stack.pop(); return; }
    if (s.encounterDeck.length === 0) {
      if (s.encounterDiscard.length === 0) { s.stack.pop(); return; }
      s.encounterDeck = shuffle(s, s.encounterDiscard.splice(0)); k.emit('encounterReshuffled', {});
    }
    const id = s.encounterDeck.shift()!;
    f.cardId = id; const d = k.def(id);
    k.emit('encounterDrawn', { seat: f.seat, cardId: id, name: d.title, type: d.type });
    const sc = k.script(k.card(id).code);
    if (d.type === 'enemy') {
      const spawn = d.abilities.find(a => a.kind === 'spawn');
      if (spawn && spawn.kind === 'spawn') {
        const name = spawn.instruction.replace(/\.$/, '').trim();
        const loc = k.locByName(name);
        if (!loc) { k.emit('enemyFizzled', { cardId: id, name: d.title }); k.discardCard(id); s.stack.pop(); return; }
        k.spawnEnemy(id, { loc: loc.id });
      } else k.spawnEnemy(id, { engage: f.seat });
      s.stack.pop(); k.flush(); return;
    }
    if (d.type === 'treachery' && sc?.revelation) {
      f.stage = 5;
      k.queue({ k: 'window', trigger: 'treacheryDrawn', data: { seat: f.seat, cardId: id }, seats: [f.seat], used: [], stage: 0, finalize: null }); k.flush(); return;
    }
    k.emit('unscripted', { code: k.card(id).code, name: d.title });
    k.discardCard(id); s.stack.pop(); return;
  }
  if (f.stage === 5) {
    const cid = f.cardId!; const csc = k.script(k.card(cid).code); f.stage = 1;
    if (f.cancelled) { k.emit('revelationCancelled', { seat: f.seat, name: k.name(cid) }); return; }
    k.queueEffect({ code: k.card(cid).code, name: csc!.revelation!, args: { cardId: cid }, seat: f.seat }); k.flush(); return;
  }
  const id = f.cardId!;
  const c = s.cards[id]!;
  const placed = Object.values(s.investigators).some(i => i.threat.includes(id) || i.inPlay.includes(id)) || !!c.attachedTo;
  if (!placed && !s.encounterDiscard.includes(id) && !s.enemies.includes(id)) k.discardCard(id);
  s.stack.pop();
}

function runInvestigation(E: Engine, s: GameState, f: Extract<Frame, { k: 'investigation' }>): void {
  const k = E.k(s);
  if (f.stage === 0) {
    s.phase = 'investigation'; s.spotlight = null; f.stage = 1;
    for (const seat of s.seats) k.inv(seat).turnTaken = false;
    k.emit('phaseStarted', { phase: 'investigation', round: s.round });
    k.queue({ k: 'window', trigger: 'afterPhaseBegins', data: { phase: 'investigation' }, seats: k.activeSeats(), used: [], stage: 0, finalize: null });
    return;
  }
  const waiting = k.activeSeats().filter(x => !k.inv(x).turnTaken);
  if (!waiting.length) { s.spotlight = null; s.stack.pop(); return; }
  if (waiting.length === 1) { s.spotlight = waiting[0]!; s.stack.push({ k: 'turn', seat: waiting[0]!, stage: 0 }); return; }
  s.spotlight = null;
  decide(s, { kind: 'spotlight', seats: waiting });
}

function runTurn(E: Engine, s: GameState, f: Extract<Frame, { k: 'turn' }>): void {
  const k = E.k(s); const inv = k.inv(f.seat);
  if (inv.status !== 'active') { inv.turnTaken = true; s.spotlight = null; s.stack.pop(); return; }
  if (f.stage === 0) {
    let bonus = inv.extraActions; inv.restricted = {};
    for (const id of [...k.inPlayCards(f.seat), 'inv:' + f.seat]) {
      if (id.startsWith('inv:') && !k.textActive(f.seat)) continue;
      const sc = k.script(k.card(id).code); bonus += sc?.extraActions?.(k, f.seat, id) ?? 0; sc?.turnStart?.(k, f.seat, id);
    }
    inv.actionsLeft = 3 + bonus; f.stage = 1;
    k.emit('turnStarted', { seat: f.seat, actions: inv.actionsLeft });
    return;
  }
  if (f.stage === 1) {
    if (inv.actionsLeft <= 0 && legalActions(E, s, f.seat).length === 0) { f.stage = 2; return; }
    decide(s, { kind: 'turn', seat: f.seat, actionsLeft: inv.actionsLeft });
    return;
  }
  if (f.stage === 2) {
    f.stage = 3; fireForced(k, 'endOfTurn', { seat: f.seat });
    for (const id of k.inv(f.seat).hand) for (const fo of k.script(k.card(id).code)?.forced ?? []) if (fo.trigger === 'endOfTurnInHand') k.queueEffect({ code: k.card(id).code, name: fo.run, args: { cardId: id }, seat: f.seat });
    k.flush(); return;
  }
  inv.turnTaken = true; inv.actionsLeft = 0; inv.restricted = {}; delete inv.roundFlags.noTokens; s.spotlight = null; s.stack.pop();
}

// ---------------------------------------------------------------------------------------------- actions

function performAction(E: Engine, s: GameState, seat: SeatId, o: LegalOption, how?: string): void {
  const k = E.k(s); const inv = k.inv(seat); const a = o.action;
  k.emit('action', { seat, type: a.type, label: o.label, target: o.targetLabel, sourceCardId: o.sourceCardId, loc: inv.loc, ...(how ? { how } : {}) });
  if (a.type === 'activate' && o.actions > 0 && usesRestricted(k, seat, a.cardId, o.actions)) inv.restricted.tome = (inv.restricted.tome ?? 0) - o.actions;   // the tome-only action is spent first: it is good for nothing else
  else inv.actionsLeft -= o.actions;
  if (o.actions > 0 && (a.type === 'move' || a.type === 'fight' || a.type === 'evade')) noteExtraCostPaid(k, seat, a.type);
  let body: Handler = { code: CORE, name: 'act', args: { action: a }, seat };
  if (a.type === 'play') {
    const pc = canPlayCard(k, seat, a.cardId, 'turn');
    k.spendResources(seat, pc.cost);
    k.detach(a.cardId);
    const sc = k.script(k.card(a.cardId).code)!; const d = k.def(a.cardId);
    k.emit('played', { seat, cardId: a.cardId, name: d.title, type: d.type });
    if (d.type === 'event') {
      if (!sc.stays) k.discardCard(a.cardId);
      body = { code: k.card(a.cardId).code, name: sc.play!, args: { cardId: a.cardId }, seat };
    } else body = { code: CORE, name: 'enterPlay', args: { cardId: a.cardId }, seat };
  } else if (a.type === 'activate') {
    const cand = abilityCandidates(k, seat).find(c => c.cardId === a.cardId && c.ability.id === a.abilityId)!;
    payCost(k, seat, a.cardId, cand.ability.cost);
    if (cand.ability.limitPerRound) { const fl = `lim:${a.cardId}:${cand.ability.id}`; inv.roundFlags[fl] = Number(inv.roundFlags[fl] ?? 0) + 1; }
    body = { code: k.card(a.cardId).code, name: cand.ability.run, args: { cardId: a.cardId, targetId: a.targetId }, seat };
  }
  k.queue({ k: 'effect', h: body, answers: [], pendingChoice: null });
  // attacks of opportunity resolve before the action does
  if (o.provokes && o.actions > 0) {
    for (const e of k.engagedWith(seat)) if (!k.card(e).exhausted) k.queue({ k: 'attack', enemyId: e, seat, stage: 0, cancelled: false, opportunity: true });
  }
  // queue() collects in order; flush pushes reversed so the first queued runs first. The body must run LAST, so move it to the end.
  const bodyFrame = k.out.shift()!; k.out.push(bodyFrame);
  if (a.type === 'play') {
    const pd = k.def(a.cardId);
    k.queue({ k: 'window', trigger: 'afterPlay', data: { seat, cardId: a.cardId, name: pd.title, cardType: pd.type, traits: pd.traits.map(x => x.toLowerCase()) }, seats: [seat], used: [], stage: 0, finalize: null });
  }
  k.flush();
}

// ---------------------------------------------------------------------------------------------- effects

function runEffect(E: Engine, s: GameState, f: EffectFrame): void {
  const sc = E.reg[f.h.code]; const fn = sc?.handlers[f.h.name];
  if (!fn) { s.ev.push({ kind: 'unscripted', code: f.h.code, name: f.h.name }); s.stack.pop(); return; }
  const draft = structuredClone(s);
  const df = draft.stack[draft.stack.length - 1] as EffectFrame;
  const k = new K(draft, E.cat, E.reg, df, f.h.seat);
  try { fn(k, { ...(f.h.args ?? {}), seat: f.h.seat }); }
  catch (e) {
    if (e instanceof NeedChoice) {
      f.pendingChoice = e.spec;
      decide(s, { kind: 'choose', seat: e.spec.seat, prompt: e.spec.prompt, options: e.spec.options, min: e.spec.min, max: e.spec.max });
      return;
    }
    throw e;
  }
  draft.stack.pop();
  k.flush();
  Object.assign(s, draft);
}

function runScenario(E: Engine, s: GameState, f: Extract<Frame, { k: 'scenario' }>): void {
  s.stack.pop();
  const k = E.k(s);
  E.scn.hook(k, f.hook, f.args);
  k.flush();
}

// ---------------------------------------------------------------------------------------------- skill tests

function eligibleCommit(k: K, t: TestState, seat: SeatId): CardId[] {
  const inv = k.inv(seat);
  const taken = new Set<string>();
  for (const ids of Object.values(t.committed)) for (const id of ids) taken.add(k.name(id));
  return inv.hand.filter(id => {
    const d = k.def(id); const ic = d.skillIcons;
    if (ic[t.skill] + ic.wild <= 0) return false;
    if (/commit only to a skill test you are performing/i.test(d.textRaw) && seat !== t.seat) return false;
    return !(/max 1 committed/i.test(d.textRaw) && taken.has(d.title));   // "Max 1 committed per skill test" counts every investigator's commits
  });
}

function commitAbilities(k: K, t: TestState, seat: SeatId) {
  const out: { cardId: CardId; ability: import('./scripts/types.ts').AbilityDef }[] = [];
  for (const id of k.inPlayCards(seat)) {
    for (const a of k.script(k.card(id).code)?.abilities ?? []) {
      if (!a.testOnly) continue;
      if (a.testOnly.skill && a.testOnly.skill !== t.skill) continue;
      if (a.testOnly.kinds && !a.testOnly.kinds.includes(t.kind)) continue;
      if (!canAffordCost(k, seat, id, a.cost) || (a.when && !a.when(k, seat, id))) continue;
      out.push({ cardId: id, ability: a });
    }
  }
  return out;
}

function runTest(E: Engine, s: GameState, f: Extract<Frame, { k: 'test' }>): void {
  const k = E.k(s); const t = f.t;
  if (k.inv(t.seat).status !== 'active') { s.stack.pop(); return; }
  if (t.stage === 'commit') {
    if (!t.data.started) {
      t.data.started = true;
      const at = k.inv(t.seat).loc;
      t.commitQueue = [t.seat, ...k.invAt(at).map(i => i.seat).filter(x => x !== t.seat)];
      t.skillValue = k.skillValue(t);
      { const { kind: testKind, ...rest } = info(t); k.emit('testStarted', { ...rest, testKind, skillValue: t.skillValue }); }
    }
    while (t.commitQueue.length) {
      const seat = t.commitQueue[0]!;
      const cards = eligibleCommit(k, t, seat); const abil = commitAbilities(k, t, seat);
      if (!cards.length && !abil.length) { t.commitQueue.shift(); continue; }
      decide(s, {
        kind: 'commit', seat, test: info(t), skillValue: k.skillValue(t),
        cards: cards.map(id => opt(id, k.name(id), icons(k, id, t))),
        abilities: abil.map(x => opt(`${x.cardId}:${x.ability.id}`, x.ability.label, k.name(x.cardId))),
      });
      return;
    }
    t.stage = 'reveal';
  }
  if (t.stage === 'reveal') {
    if (k.inv(t.seat).roundFlags.noTokens) {                       // the bag stays closed this turn
      t.data.tokMod = 0; t.data.autofail = false; t.data.ifFail = [] as never; t.token = null; t.extraTokens = []; t.stage = 'resolve';
      k.emit('noTokens', { seat: t.seat, label: t.label });
    } else { decide(s, { kind: 'reveal', seat: t.seat, test: info(t) }); return; }
  }
  const window = (trigger: string, data: Record<string, unknown>) => { k.queue({ k: 'window', trigger, data, seats: [t.seat], used: [], stage: 0, finalize: null }); k.flush(); };
  if (t.stage === 'wouldReveal') {
    if (!t.data.wrDone) { t.data.wrDone = true; window('wouldRevealToken', { seat: t.seat }); return; }
    t.stage = 'draw';
  }
  if (t.stage === 'draw') { drawFirstToken(E, s, t); t.stage = 'tokenWindow'; }
  if (t.stage === 'tokenWindow') {
    if (!t.data.twDone) { t.data.twDone = true; window('tokenRevealed', { seat: t.seat, token: t.data.pre }); return; }
    if (t.data.redraw) { t.data.redraw = false; t.data.twDone = false; t.data.statue = false; drawFirstToken(E, s, t); return; }
    t.stage = 'apply';
  }
  if (t.stage === 'apply') { applyTokens(E, s, t); return; }       // anything the token queued resolves before the test does
  if (t.stage === 'resolve') resolveTest(E, s, f);
}

const icons = (k: K, id: CardId, t: TestState): string => { const ic = k.def(id).skillIcons; return String(ic[t.skill] + ic.wild); };

/** Draw the first token (two when the Statue is spent and the better one is kept). Nothing is applied yet: cards may react to it. */
function drawFirstToken(E: Engine, s: GameState, t: TestState): void {
  const k = E.k(s); const pool = [...s.chaosBag];
  const n = t.data.statue ? 2 : 1; const drawn: string[] = [];
  for (let i = 0; i < n && pool.length; i++) drawn.push(pool.splice(k.rand(pool.length), 1)[0]!);
  const value = (tok: string): number => {
    if (/^[+-]?\d+$/.test(tok)) return Number(tok);
    if (tok === 'autofail') return -100;
    if (tok === 'elder_sign') return (k.script(k.inv(t.seat).code)?.elderSign?.(k, t.seat) ?? 0);
    const fx = E.scn.tokenEffect(k, t.seat, tok as never, t); return fx.autofail ? -100 : fx.modifier;
  };
  drawn.sort((a, b) => value(b) - value(a));
  t.data.pre = drawn[0]!;
  if (drawn.length > 1) k.emit('twoTokens', { seat: t.seat });
}

function applyTokens(E: Engine, s: GameState, t: TestState): void {
  const k = E.k(s); const inv = k.inv(t.seat);
  const pool = [...s.chaosBag]; const first = String(t.data.pre);
  pool.splice(pool.indexOf(first as never), 1);
  const revealed: string[] = [];
  let mod = 0; let autofail = false;
  const ifFail: Handler[] = [];
  for (let guardN = 0; guardN < 4; guardN++) {
    const tok = guardN === 0 ? first : pool.splice(k.rand(pool.length), 1)[0]!;
    revealed.push(tok);
    let more = false;
    if (/^[+-]?\d+$/.test(tok)) mod += Number(tok);
    else if (tok === 'autofail') autofail = true;
    else if (tok === 'elder_sign') {
      if (k.inPlayCards(t.seat).some(id => k.script(k.card(id).code)?.elderSignAsAutofail)) autofail = true;
      else if (k.textActive(t.seat) && k.script(inv.code)?.elderSignAutoSucceed?.(k, t.seat)) { t.data.autoSucceed = true; t.data.elder = true; }
      else { t.data.elder = true; mod += k.textActive(t.seat) ? (k.script(inv.code)?.elderSign?.(k, t.seat) ?? 0) : 0; }
    } else {
      const fx = E.scn.tokenEffect(k, t.seat, tok as never, t);
      mod += fx.modifier; autofail ||= !!fx.autofail; more = !!fx.revealAnother;
      if (fx.immediate) k.queueEffect(fx.immediate);
      if (fx.ifFail) ifFail.push(fx.ifFail);
    }
    if (!more || !pool.length) break;
  }
  t.token = revealed[0] as never; t.extraTokens = revealed.slice(1) as never;
  t.data.tokMod = mod; t.data.autofail = autofail; t.data.ifFail = ifFail as unknown as never;
  t.stage = 'resolve';
  k.emit('tokenRevealed', { seat: t.seat, tokens: revealed, modifier: mod, autofail, label: t.label });
  k.flush();
}

function resolveTest(E: Engine, s: GameState, f: Extract<Frame, { k: 'test' }>): void {
  const k = E.k(s); const t = f.t;
  const autofail = !!t.data.autofail;
  t.skillValue = k.skillValue(t);
  t.total = autofail ? 0 : Math.max(0, t.skillValue + Number(t.data.tokMod ?? 0));
  if (t.data.autoSucceed && !autofail) t.total = Math.max(t.total, t.difficulty);
  const ok = !autofail && t.total >= t.difficulty;
  if (!ok && !t.luckyChecked) {
    t.luckyChecked = true;
    k.queue({ k: 'window', trigger: 'wouldFailTest', data: { seat: t.seat }, seats: [t.seat], used: [], stage: 0, finalize: null });
    k.flush(); return;
  }
  t.outcome = ok ? 'success' : 'failure';
  t.margin = ok ? t.total - t.difficulty : t.difficulty - t.total;
  k.emit('testResolved', {
    seat: t.seat, outcome: t.outcome, margin: t.margin, total: t.total, difficulty: t.difficulty, skillValue: t.skillValue,
    tokenMod: t.data.tokMod, tokens: [t.token, ...t.extraTokens].filter(Boolean), label: t.label, testKind: t.kind, skill: t.skill, locId: t.locId, enemyId: t.enemyId,
    sourceName: t.sourceName, autofail,
  });
  if (ok) for (const ids of Object.values(t.committed)) for (const id of ids) k.script(k.card(id).code)?.skillCard?.onSuccess?.(k, t, id);
  for (const ids of Object.values(t.committed)) for (const id of ids) {
    const c = k.card(id);
    if (c.flags.returnToHand && c.owner) { delete c.flags.returnToHand; k.inv(c.owner).hand.push(id); }
    else if (c.owner) k.inv(c.owner).discard.push(id);
  }
  if (ok && t.data.elder && k.textActive(t.seat)) k.queueEffect({ code: k.inv(t.seat).code, name: 'elderSuccess', args: {}, seat: t.seat });
  s.testResultsThisRound++;
  s.stack.pop();
  const args = { margin: t.margin, tokens: [t.token, ...t.extraTokens].filter(Boolean), enemyId: t.enemyId, locId: t.locId, data: t.data, bonusDamage: t.bonusDamage, extraClues: t.extraClues, tseat: t.seat };
  const h = ok ? t.onSuccess : t.onFailure;
  if (h) k.queueEffect({ ...h, args: { ...(h.args ?? {}), ...args } });
  if (!ok) for (const x of (t.data.ifFail as unknown as Handler[]) ?? []) k.queueEffect({ ...x, args: { ...(x.args ?? {}), ...args } });
  if (t.after) k.queueEffect({ ...t.after, args: { ...(t.after.args ?? {}), ...args, outcome: t.outcome } });
  if (!ok) k.queue({ k: 'window', trigger: 'afterFailTest', data: { seat: t.seat, margin: t.margin, testKind: t.kind, locId: t.locId }, seats: [t.seat], used: [], stage: 0, finalize: null });
  k.flush();
}

// ---------------------------------------------------------------------------------------------- reaction windows

interface ReactionOpt { id: string; label: string; detail?: string }

function findReactions(k: K, seat: SeatId, trigger: string, data: Record<string, unknown>, used: string[]): ReactionOpt[] {
  const inv = k.inv(seat); const out: ReactionOpt[] = [];
  const owned: CardId[] = [...k.inPlayCards(seat), 'inv:' + seat];
  for (const id of owned) {
    if (id === 'inv:' + seat && !k.textActive(seat)) continue;
    const sc = k.script(k.card(id).code);
    for (const r of sc?.reactions ?? []) {
      if (r.trigger !== trigger) continue;
      const oid = `r|${id}|${r.id}`;
      if (used.includes(oid)) continue;
      if (r.limitPerRound && Number(inv.roundFlags[`lim:${id}:${r.id}`] ?? 0) >= r.limitPerRound) continue;
      if (r.limitPerPhase && Number(inv.roundFlags[`lim:${id}:${r.id}:${k.s.phase}`] ?? 0) >= r.limitPerPhase) continue;
      if (!canAffordCost(k, seat, id, r.cost) || !r.when(k, seat, id, data)) continue;
      out.push({ id: oid, label: r.label, detail: k.name(id) });
    }
  }
  for (const id of inv.hand) {
    const sc = k.script(k.card(id).code);
    if (!sc?.fastWindow || sc.fastWindow.trigger !== trigger) continue;
    const oid = `e|${id}`;
    if (used.includes(oid)) continue;
    const pc = canPlayCard(k, seat, id, 'window');
    if (!pc.ok || !sc.fastWindow.when(k, seat, id, data)) continue;
    out.push({ id: oid, label: `Play ${k.name(id)}`, detail: pc.cost ? `${pc.cost} means` : 'no cost' });
  }
  return out;
}

function runWindow(E: Engine, s: GameState, f: Extract<Frame, { k: 'window' }>): void {
  const k = E.k(s);
  while (f.stage < f.seats.length) {
    const seat = f.seats[f.stage]!;
    if (k.inv(seat).status !== 'active') { f.stage++; continue; }
    const opts = findReactions(k, seat, f.trigger, f.data, f.used);
    if (!opts.length) { f.stage++; continue; }
    decide(s, { kind: 'reaction', seat, trigger: f.trigger, prompt: f.trigger, options: opts.map(o => opt(o.id, o.label, o.detail)) });
    return;
  }
  s.stack.pop();
  if (f.finalize) { k.queueEffect({ ...f.finalize, args: { ...(f.finalize.args ?? {}), data: f.data } }); k.flush(); }
}

function applyReaction(E: Engine, s: GameState, f: Extract<Frame, { k: 'window' }>, seat: SeatId, optionId: string): void {
  const k = E.k(s); const inv = k.inv(seat);
  const [kind, id, rid] = optionId.split('|') as [string, CardId, string];
  f.used.push(optionId);
  if (kind === 'r') {
    const code = k.card(id).code; const r = k.script(code)!.reactions!.find(x => x.id === rid)!;
    payCost(k, seat, id, r.cost);
    if (r.limitPerRound) inv.roundFlags[`lim:${id}:${r.id}`] = Number(inv.roundFlags[`lim:${id}:${r.id}`] ?? 0) + 1;
    if (r.limitPerPhase) inv.roundFlags[`lim:${id}:${r.id}:${k.s.phase}`] = Number(inv.roundFlags[`lim:${id}:${r.id}:${k.s.phase}`] ?? 0) + 1;
    k.emit('reactionUsed', { seat, name: k.name(id), label: r.label, trigger: f.trigger });
    k.queueEffect({ code, name: r.run, args: { cardId: id, data: f.data }, seat });
  } else {
    const code = k.card(id).code; const sc = k.script(code)!;
    const pc = canPlayCard(k, seat, id, 'window');
    k.spendResources(seat, pc.cost); k.detach(id);
    k.emit('played', { seat, cardId: id, name: k.name(id), type: 'event', trigger: f.trigger });
    if (!sc.stays) k.discardCard(id);
    k.queueEffect({ code, name: sc.play!, args: { cardId: id, data: f.data }, seat });
  }
  k.flush();
}

// ---------------------------------------------------------------------------------------------- harm and attacks

function soakTargets(k: K, seat: SeatId, kind: 'damage' | 'horror'): CardId[] {
  return k.inv(seat).inPlay.filter(id => {
    const d = k.def(id); const c = k.card(id);
    if (d.type !== 'asset') return false;
    return kind === 'damage' ? typeof d.health === 'number' && c.tokens.damage < d.health : typeof d.sanity === 'number' && c.tokens.horror < d.sanity;
  });
}

function runHarm(E: Engine, s: GameState, f: Extract<Frame, { k: 'harm' }>): void {
  const k = E.k(s); const inv = k.inv(f.seat);
  if (inv.status !== 'active') { s.stack.pop(); return; }
  while (f.damage > 0 || f.horror > 0) {
    const kind: 'damage' | 'horror' = f.damage > 0 ? 'damage' : 'horror';
    const soak = f.direct ? [] : soakTargets(k, f.seat, kind);
    if (!soak.length) {
      const n = kind === 'damage' ? f.damage : f.horror;
      if (kind === 'damage') { inv.damage += n; f.tookDamage += n; f.damage = 0; } else { inv.horror += n; f.tookHorror += n; f.horror = 0; }
      k.emit(kind === 'damage' ? 'damageTaken' : 'horrorTaken', { seat: f.seat, amount: n, source: f.source, direct: f.direct, target: 'self' });
      continue;
    }
    decide(s, {
      kind: 'choose', seat: f.seat, prompt: `harm.${kind}`, min: 1, max: 1,
      options: [opt('self', 'yourself'), ...soak.map(id => opt(id, k.name(id)))],
    });
    return;
  }
  // everything assigned: check for defeat, then forced after-harm effects
  s.stack.pop();
  if (inv.damage >= inv.maxHealth || inv.horror >= inv.maxSanity) { defeatInvestigator(k, f.seat); k.flush(); return; }
  if (f.tookHorror > 0) fireForced(k, 'afterTakeHorror', { seat: f.seat });
  if (f.tookHorror > 0) k.queue({ k: 'window', trigger: 'afterHorrorPlaced', data: { seat: f.seat, amount: f.tookHorror }, seats: [f.seat], used: [], stage: 0, finalize: null });
  if (f.tookDamage > 0) fireForced(k, 'afterTakeDamage', { seat: f.seat });
  k.flush();
}

function applyHarmChoice(E: Engine, s: GameState, f: Extract<Frame, { k: 'harm' }>, choice: string): void {
  const k = E.k(s); const inv = k.inv(f.seat);
  const kind: 'damage' | 'horror' = f.damage > 0 ? 'damage' : 'horror';
  if (kind === 'damage') f.damage--; else f.horror--;
  if (choice === 'self') {
    if (kind === 'damage') { inv.damage++; f.tookDamage++; } else { inv.horror++; f.tookHorror++; }
    k.emit(kind === 'damage' ? 'damageTaken' : 'horrorTaken', { seat: f.seat, amount: 1, source: f.source, target: 'self' });
    return;
  }
  const c = k.card(choice); const d = k.def(choice);
  if (kind === 'damage') c.tokens.damage++; else c.tokens.horror++;
  k.emit(kind === 'damage' ? 'damageTaken' : 'horrorTaken', { seat: f.seat, amount: 1, source: f.source, target: 'ally', name: d.title });
  if (kind === 'damage' && f.asEnemyAttack) k.queue({ k: 'window', trigger: 'assetDamagedByEnemy', data: { seat: f.seat, cardId: choice, enemyId: f.asEnemyAttack }, seats: [f.seat], used: [], stage: 0, finalize: null });
  const dead = kind === 'damage' ? c.tokens.damage >= (d.health as number) : c.tokens.horror >= (d.sanity as number);
  if (dead) { k.emit('allyDefeated', { seat: f.seat, name: d.title }); k.discardCard(choice); }
  k.flush();
}

export function defeatInvestigator(k: K, seat: SeatId): void {
  const inv = k.inv(seat); const s = k.s;
  const physical = inv.damage >= inv.maxHealth;
  inv.status = 'defeated';
  s.scenarioFlags[`trauma:${seat}:${physical ? 'physical' : 'mental'}`] = Number(s.scenarioFlags[`trauma:${seat}:${physical ? 'physical' : 'mental'}`] ?? 0) + 1;
  k.emit('investigatorDefeated', { seat, name: inv.name, cause: physical ? 'wounds' : 'nerves' });
  k.loc(inv.loc).clues += inv.clues; inv.clues = 0;
  for (const id of [...inv.hand, ...inv.inPlay, ...inv.threat]) k.discardCard(id);
  for (const e of k.engagedWith(seat)) k.card(e).engaged = null;
  if (s.lead === seat) { const next = k.activeSeats()[0]; if (next) s.lead = next; }
  checkAllOut(k);
}

export function checkAllOut(k: K): void {
  if (k.activeSeats().length === 0) k.queue({ k: 'scenario', hook: 'noInvestigators', stage: 0, args: {} });
}

function runAttack(E: Engine, s: GameState, f: Extract<Frame, { k: 'attack' }>): void {
  const k = E.k(s);
  const e = s.cards[f.enemyId];
  if (!e || !s.enemies.includes(f.enemyId) || k.inv(f.seat).status !== 'active' || e.engaged !== f.seat) { s.stack.pop(); return; }
  if (f.stage === 0 && k.inv(f.seat).roundFlags.onTheLam && !k.isElite(f.enemyId)) { k.emit('attackCancelled', { seat: f.seat, name: k.name(f.enemyId) }); s.stack.pop(); return; }
  if (f.stage === 0) {
    f.stage = 1;
    k.emit('enemyAttacks', { seat: f.seat, cardId: f.enemyId, name: k.name(f.enemyId), opportunity: f.opportunity });
    const at = k.inv(f.seat).loc;
    k.queue({ k: 'window', trigger: 'enemyAttacks', data: { seat: f.seat, enemyId: f.enemyId }, seats: k.invAt(at).map(i => i.seat), used: [], stage: 0, finalize: null });
    k.flush(); return;
  }
  if (f.stage === 1) {
    f.stage = 2;
    if (f.cancelled) { k.emit('attackCancelled', { seat: f.seat, name: k.name(f.enemyId) }); return; }
    if (!f.opportunity) e.exhausted = true;
    if (f.redirectTo && s.enemies.includes(f.redirectTo)) {                       // Aquinnah: the blow lands on another enemy instead
      k.damageEnemy(f.redirectTo, k.enemyStat(f.enemyId, 'damage'), f.seat, k.name(f.enemyId));
      k.harm(f.seat, 0, k.enemyStat(f.enemyId, 'horror'), { source: k.name(f.enemyId), sourceCardId: f.enemyId, enemy: f.enemyId });
    } else k.harm(f.seat, k.enemyStat(f.enemyId, 'damage'), k.enemyStat(f.enemyId, 'horror'), { source: k.name(f.enemyId), sourceCardId: f.enemyId, enemy: f.enemyId });
    k.flush(); return;
  }
  if (f.stage === 2) {
    f.stage = 3;
    if (!f.cancelled) { fireForced(k, 'afterAttack', { seat: f.seat, enemyId: f.enemyId }); k.flush(); }
    return;
  }
  s.stack.pop();
}

// ---------------------------------------------------------------------------------------------- enemy phase, upkeep, round end

function runEnemyPhase(E: Engine, s: GameState, f: Extract<Frame, { k: 'enemyPhase' }>): void {
  const k = E.k(s);
  if (f.stage === 0) { s.phase = 'enemy'; k.emit('phaseStarted', { phase: 'enemy', round: s.round }); f.stage = 1; k.queue({ k: 'window', trigger: 'afterPhaseBegins', data: { phase: 'enemy' }, seats: k.activeSeats(), used: [], stage: 0, finalize: null }); k.flush(); return; }
  if (f.stage === 1) {
    f.stage = 2;
    for (const id of [...s.enemies]) {
      const c = k.card(id);
      if (c.engaged || c.exhausted || !c.loc || !k.hasKeyword(id, 'hunter')) continue;
      let best: { loc: string; d: number } | null = null;
      for (const inv of k.activeSeats().map(x => k.inv(x))) {
        if (k.preyScore(id, inv.seat) === null) continue;
        const d = k.distance(c.loc, inv.loc);
        if (d > 0 && d < Infinity && (!best || d < best.d)) { const step1 = k.stepToward(c.loc, inv.loc); if (step1) best = { loc: step1, d }; }
      }
      if (best) {
        if (k.loc(best.loc).attached.some(x => k.card(x).code === '01038') && !k.isElite(id)) continue;   // Barricade
        const from = c.loc; c.loc = best.loc;
        k.emit('enemyMoved', { cardId: id, name: k.name(id), from, to: best.loc });
      }
    }
    k.engageCheck();
    return;
  }
  if (f.stage === 2) {
    const seats = s.seats;
    while (f.i < seats.length && k.inv(seats[f.i]!).status !== 'active') f.i++;
    if (f.i >= seats.length) { f.stage = 3; return; }
    const seat = seats[f.i]!; f.i++;
    for (const e of k.engagedWith(seat).filter(id => !k.card(id).exhausted).reverse())
      s.stack.push({ k: 'attack', enemyId: e, seat, stage: 0, cancelled: false, opportunity: false });
    return;
  }
  if (f.stage === 3) { f.stage = 4; fireForced(k, 'endOfEnemyPhase', {}); k.flush(); return; }
  s.stack.pop();
}

function runUpkeep(E: Engine, s: GameState, f: Extract<Frame, { k: 'upkeep' }>): void {
  const k = E.k(s);
  if (f.stage === 0) {
    s.phase = 'upkeep'; k.emit('phaseStarted', { phase: 'upkeep', round: s.round });
    k.queue({ k: 'window', trigger: 'afterPhaseBegins', data: { phase: 'upkeep' }, seats: k.activeSeats(), used: [], stage: 0, finalize: null });
    for (const seat of k.activeSeats()) {
      const inv = k.inv(seat);
      for (const id of inv.inPlay) k.card(id).exhausted = false;
    }
    for (const id of s.enemies) k.card(id).exhausted = false;
    k.engageCheck();
    for (const seat of k.activeSeats()) { k.draw(seat, 1, 'upkeep'); k.gainResources(seat, 1); }
    f.stage = 1; k.flush(); return;
  }
  while (f.i < s.seats.length) {
    const seat = s.seats[f.i]!; const inv = k.inv(seat);
    if (inv.status === 'active' && inv.hand.length > 8) {
      const n = inv.hand.length - 8;
      decide(s, { kind: 'choose', seat, prompt: 'handsize', min: n, max: n, options: inv.hand.map(id => opt(id, k.name(id))) });
      return;
    }
    f.i++;
  }
  s.stack.pop();
}

function runRoundEnd(E: Engine, s: GameState, f: Extract<Frame, { k: 'roundEnd' }>): void {
  const k = E.k(s);
  if (f.stage === 0) { f.stage = 1; fireForced(k, 'endOfRound', {}); k.flush(); return; }
  if (f.stage === 1) { f.stage = 2; k.queue({ k: 'scenario', hook: 'endOfRound', stage: 0, args: {} }); k.flush(); return; }
  for (const inv of Object.values(s.investigators)) inv.roundFlags = {};
  s.testResultsThisRound = 0;
  s.stack.pop();
}

export { extraActionCost, isFastCard, abilityUsable, NON_PROVOKING };
export type { Action };
