// K: the API that card scripts and the engine use to read and change game state.
// Scripts never touch frames or decisions directly; they call K, and K queues follow-up frames.
import type {
  Card, CardId, ChoiceSpec, Frame, GameEvent, GameState, Handler, Investigator, LocId, Location, Option,
  SeatId, Skill, TestInfo, TestState, Token,
} from './types.ts';
import { SKILLS } from './types.ts';
import type { Catalog } from './catalog.ts';
import type { CardDef } from '../data/model.ts';
import type { Registry, Script } from './scripts/types.ts';
import { randInt, shuffle } from './rng.ts';

export class NeedChoice extends Error {
  spec: ChoiceSpec;
  constructor(spec: ChoiceSpec) { super('need choice'); this.spec = spec; }
}

export type EffectFrame = Extract<Frame, { k: 'effect' }>;
export const CORE = '_core';

export interface TestSpec {
  seat: SeatId; skill: Skill; difficulty: number; kind: TestInfo['kind'];
  sourceCode?: string | null; sourceName?: string; locId?: LocId | null; enemyId?: CardId | null; label: string;
  bonus?: number; onSuccess?: Handler | null; onFailure?: Handler | null; after?: Handler | null;
  data?: Record<string, unknown>;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
/** 'supplies' -> 'supply', 'ammo' -> 'ammo', 'charges' -> 'charge' */
export const useKey = (t: string): string => (t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.replace(/s$/, ''));

export class K {
  s: GameState;
  cat: Catalog;
  reg: Registry;
  frame: EffectFrame | null;
  seat: SeatId | null;
  out: Frame[] = [];
  private ai = 0;

  constructor(s: GameState, cat: Catalog, reg: Registry, frame: EffectFrame | null = null, seat: SeatId | null = null) {
    this.s = s; this.cat = cat; this.reg = reg; this.frame = frame; this.seat = seat;
  }

  // ---- reading
  emit(kind: string, data: Record<string, unknown> = {}): void { this.s.ev.push({ ...data, kind } as GameEvent); }
  inv(seat: SeatId): Investigator { const i = this.s.investigators[seat]; if (!i) throw new Error(`no seat ${seat}`); return i; }
  card(id: CardId): Card { const c = this.s.cards[id]; if (!c) throw new Error(`no card ${id}`); return c; }
  def(id: CardId): CardDef { return this.cat.get(this.card(id).code); }
  name(id: CardId): string { return this.def(id).title; }
  script(code: string): Script | undefined { return this.reg[code]; }
  loc(id: LocId): Location { const l = this.s.locations[id]; if (!l) throw new Error(`no location ${id}`); return l; }
  activeSeats(): SeatId[] { return this.s.seats.filter(x => this.s.investigators[x]!.status === 'active'); }
  invAt(loc: LocId): Investigator[] { return this.activeSeats().map(x => this.inv(x)).filter(i => i.loc === loc); }
  enemiesAt(loc: LocId): CardId[] { return this.s.enemies.filter(id => this.card(id).loc === loc); }
  engagedWith(seat: SeatId): CardId[] { return this.s.enemies.filter(id => this.card(id).engaged === seat); }
  hasTrait(id: CardId, trait: string): boolean { return this.def(id).traits.some(t => t.toLowerCase() === trait.toLowerCase()); }
  isElite(id: CardId): boolean { return this.hasTrait(id, 'elite'); }
  ghoulsAt(loc: LocId): number { return this.enemiesAt(loc).filter(id => this.hasTrait(id, 'ghoul')).length; }
  locByName(name: string): Location | undefined { return Object.values(this.s.locations).find(l => l.inPlay && l.name.toLowerCase() === name.toLowerCase()); }
  inPlayCards(seat: SeatId): CardId[] { const i = this.inv(seat); return [...i.inPlay, ...i.threat]; }
  controls(seat: SeatId, code: string): CardId | undefined { return this.inPlayCards(seat).find(id => this.card(id).code === code); }
  ready(id: CardId): boolean { return !this.card(id).exhausted; }
  enemyHealth(id: CardId): number {
    const e = this.def(id).enemy; if (!e) return 0;
    const h = num(e.health);
    return e.healthPerInvestigator ? h * this.s.seats.length : h;
  }
  enemyStat(id: CardId, which: 'fight' | 'evade' | 'damage' | 'horror'): number { return num(this.def(id).enemy?.[which]); }
  /** Printed text of an investigator counts unless Stubborn Detective is at their location. */
  textActive(seat: SeatId): boolean {
    const i = this.inv(seat);
    return !this.enemiesAt(i.loc).some(id => this.card(id).code === '01103' && this.card(id).flags.bearer === seat);
  }

  // ---- location graph
  distance(from: LocId, to: LocId): number {
    if (from === to) return 0;
    const seen = new Set([from]); let frontier = [from]; let d = 0;
    while (frontier.length) {
      d++; const next: LocId[] = [];
      for (const l of frontier) for (const n of this.loc(l).connections) {
        if (seen.has(n) || !this.s.locations[n]?.inPlay) continue;
        if (n === to) return d;
        seen.add(n); next.push(n);
      }
      frontier = next;
    }
    return Infinity;
  }
  stepToward(from: LocId, to: LocId): LocId | null {
    if (from === to) return null;
    let best: LocId | null = null; let bd = Infinity;
    for (const n of this.loc(from).connections) {
      if (!this.s.locations[n]?.inPlay) continue;
      const d = this.distance(n, to);
      if (d < bd) { bd = d; best = n; }
    }
    return bd === Infinity ? null : best;
  }

  // ---- choices (replayed against recorded answers; see engine.runEffect)
  choose(prompt: string, options: Option[], o: { seat?: SeatId; min?: number; max?: number } = {}): string[] {
    const min = o.min ?? 1; const max = o.max ?? 1;
    const seat = o.seat ?? this.seat ?? this.s.lead;
    if (options.length === 0) return [];
    if (options.length <= min && min === max) return options.map(x => x.id);   // nothing to decide
    const recorded = this.frame?.answers[this.ai++];
    if (recorded) return recorded;
    throw new NeedChoice({ seat, prompt, options, min, max });
  }

  // ---- follow-up frames
  queue(f: Frame): void { this.out.push(f); }
  flush(): void { for (let i = this.out.length - 1; i >= 0; i--) this.s.stack.push(this.out[i]!); this.out = []; }
  queueEffect(h: Handler): void { this.queue({ k: 'effect', h, answers: [], pendingChoice: null }); }

  // ---- cards
  newCard(code: string, owner: SeatId | null): CardId {
    const id = `c${this.s.nextId++}`;
    const def = this.cat.get(code);
    const uses: Record<string, number> = {};
    for (const kw of def.keywords) if (kw.name === 'uses' && kw.usesType) uses[useKey(kw.usesType)] = typeof kw.amount === 'number' ? kw.amount : 0;
    this.s.cards[id] = {
      id, code, owner, exhausted: false, loc: null, engaged: null, attachedTo: null, flags: {},
      tokens: { damage: 0, horror: 0, doom: 0, clues: 0, resources: 0, uses },
    };
    return id;
  }

  /** Remove a card from whatever zone holds it (does not place it anywhere). */
  detach(id: CardId): void {
    const c = this.card(id);
    for (const inv of Object.values(this.s.investigators)) {
      for (const z of ['deck', 'hand', 'discard', 'inPlay', 'threat'] as const) {
        const i = inv[z].indexOf(id); if (i >= 0) inv[z].splice(i, 1);
      }
    }
    for (const z of ['enemies', 'encounterDeck', 'encounterDiscard', 'victoryDisplay'] as const) {
      const i = this.s[z].indexOf(id); if (i >= 0) this.s[z].splice(i, 1);
    }
    const i = this.s.setAside.cards.indexOf(id); if (i >= 0) this.s.setAside.cards.splice(i, 1);
    if (c.attachedTo) { const l = this.s.locations[c.attachedTo]; if (l) l.attached = l.attached.filter(x => x !== id); c.attachedTo = null; }
    c.engaged = null;
  }

  discardCard(id: CardId): void {
    const c = this.card(id);
    const wasEnemy = this.s.enemies.includes(id);
    this.detach(id);
    c.exhausted = false; c.loc = null;
    if (!wasEnemy) c.tokens.damage = c.tokens.horror = 0;
    if (c.owner && this.def(id).type === 'event' && this.inPlayCards(c.owner).some(x => this.script(this.card(x).code)?.eventsToBottom)) this.inv(c.owner).deck.push(id);
    else if (c.owner) this.inv(c.owner).discard.push(id); else this.s.encounterDiscard.push(id);
    this.emit('cardDiscarded', { cardId: id, name: this.name(id), seat: c.owner ?? undefined });
  }

  putInPlay(seat: SeatId, id: CardId): void { this.detach(id); this.inv(seat).inPlay.push(id); }
  putInThreat(seat: SeatId, id: CardId): void { this.detach(id); this.inv(seat).threat.push(id); }
  attachToLocation(locId: LocId, id: CardId): void {
    this.detach(id); this.loc(locId).attached.push(id); this.card(id).attachedTo = locId;
  }

  gainResources(seat: SeatId, n: number): void { this.inv(seat).resources += n; this.emit('resources', { seat, delta: n }); }
  spendResources(seat: SeatId, n: number): void { this.inv(seat).resources -= n; if (n) this.emit('resources', { seat, delta: -n }); }

  draw(seat: SeatId, n: number, why = 'draw'): CardId[] {
    const inv = this.inv(seat); const drawn: CardId[] = [];
    for (let i = 0; i < n; i++) {
      if (inv.deck.length === 0) {
        if (inv.discard.length === 0) break;
        inv.deck = shuffle(this.s, inv.discard.splice(0));
        this.emit('deckReshuffled', { seat });
        this.harm(seat, 0, 1, { source: 'empty deck', direct: true });
      }
      const id = inv.deck.shift()!;
      inv.hand.push(id); drawn.push(id);
      this.emit('drew', { seat, cardId: id, why });
      this.onDrawn(seat, id);
    }
    return drawn;
  }

  drawSpecific(seat: SeatId, id: CardId, why = 'search'): void {
    const inv = this.inv(seat); this.detach(id); inv.hand.push(id);
    this.emit('drew', { seat, cardId: id, why }); this.onDrawn(seat, id);
  }

  onDrawn(seat: SeatId, id: CardId): void {
    const d = this.def(id);
    const sc = this.script(this.card(id).code);
    if (!d.subtype && !sc?.revelation) return;                // only weaknesses and cards with a revelation act when drawn
    if (d.type === 'enemy') {
      const inv = this.inv(seat);
      this.detach(id); this.card(id).flags.bearer = seat;
      this.card(id).loc = inv.loc; this.s.enemies.push(id); this.card(id).engaged = seat;
      this.emit('enemySpawned', { cardId: id, name: d.title, loc: inv.loc, engagedSeat: seat, fromDeck: true });
    } else if (sc?.revelation) {
      this.queueEffect({ code: this.card(id).code, name: sc.revelation, args: { cardId: id }, seat });
    }
  }

  discardFromHand(seat: SeatId, id: CardId): void { if (this.inv(seat).hand.includes(id)) this.discardCard(id); }

  heal(seat: SeatId, damage: number, horror: number): { damage: number; horror: number } {
    const i = this.inv(seat);
    const d = Math.min(damage, i.damage); const h = Math.min(horror, i.horror);
    i.damage -= d; i.horror -= h;
    if (d || h) this.emit('healed', { seat, damage: d, horror: h });
    return { damage: d, horror: h };
  }

  harm(seat: SeatId, damage: number, horror: number, o: { source: string; sourceCardId?: CardId | null; direct?: boolean; enemy?: CardId | null } ): void {
    if (damage <= 0 && horror <= 0) return;
    this.queue({
      k: 'harm', seat, damage, horror, source: o.source, sourceCardId: o.sourceCardId ?? null, direct: !!o.direct,
      stage: 0, asEnemyAttack: o.enemy ?? null, dealtToAssets: [], tookDamage: 0, tookHorror: 0,
    });
  }

  discoverClues(seat: SeatId, locId: LocId, n: number, source = 'investigate'): void {
    if (n <= 0) return;
    this.queue({
      k: 'window', trigger: 'wouldDiscover', data: { seat, locId, n, source }, seats: [seat], used: [], stage: 0,
      finalize: { code: CORE, name: 'discover', seat },
    });
  }

  /** Doom on the agenda plus doom sitting on cards in play: that is what the agenda's threshold counts. */
  totalDoom(): number {
    let n = this.s.agenda.doom;
    for (const c of Object.values(this.s.cards)) {
      if (!c.tokens.doom || c.id.startsWith('inv:')) continue;
      const own = c.owner ? this.inPlayCards(c.owner).includes(c.id) : false;
      if (own || this.s.enemies.includes(c.id) || this.s.locAssets.includes(c.id) || c.attachedTo) n += c.tokens.doom;
    }
    return n;
  }
  clearCardDoom(): void { for (const c of Object.values(this.s.cards)) c.tokens.doom = 0; }
  /** Mind Wipe: until the end of the phase an enemy's text box is blank (keywords and forced effects stop; traits stay). */
  isBlanked(id: CardId): boolean { return this.card(id).flags.blank === `${this.s.round}:${this.s.phase}`; }
  hasKeyword(id: CardId, name: string): boolean { return !this.isBlanked(id) && this.def(id).keywords.some(x => x.name === name); }

  placeDoom(n: number): void {
    this.s.agenda.doom += n; this.emit('doomPlaced', { count: n, total: this.totalDoom(), threshold: this.doomThreshold() });
    this.queue({ k: 'scenario', hook: 'checkAgenda', stage: 0, args: {} });
  }

  startTest(spec: TestSpec): void {
    const t: TestState = {
      seat: spec.seat, skill: spec.skill, difficulty: Math.max(0, spec.difficulty), kind: spec.kind,
      sourceCode: spec.sourceCode ?? null, sourceName: spec.sourceName ?? '', locId: spec.locId ?? null,
      enemyId: spec.enemyId ?? null, label: spec.label,
      bonus: spec.bonus ?? 0, committed: {}, commitQueue: [], stage: 'commit', token: null, extraTokens: [],
      skillValue: 0, total: 0, outcome: null, margin: 0, autofail: false,
      onSuccess: spec.onSuccess ?? null, onFailure: spec.onFailure ?? null, after: spec.after ?? null,
      swapSkill: null, bonusDamage: 0, extraClues: 0, luckyChecked: false, symbolDone: false, data: spec.data ?? {},
    };
    this.queue({ k: 'test', t });
  }

  /** Damage to an enemy; handles defeat, victory display and reaction windows. */
  damageEnemy(enemyId: CardId, n: number, bySeat: SeatId | null, source = ''): void {
    if (n <= 0) return;
    const c = this.card(enemyId);
    c.tokens.damage += n;
    this.emit('enemyDamaged', { cardId: enemyId, name: this.name(enemyId), amount: n, seat: bySeat ?? undefined, source, total: c.tokens.damage, health: this.enemyHealth(enemyId) });
    if (c.tokens.damage >= this.enemyHealth(enemyId)) this.defeatEnemy(enemyId, bySeat);
  }

  defeatEnemy(enemyId: CardId, bySeat: SeatId | null): void {
    const c = this.card(enemyId); const d = this.def(enemyId); const loc = c.loc;
    this.emit('enemyDefeated', { cardId: enemyId, name: d.title, seat: bySeat ?? undefined, loc });
    const wasWeak = !!d.subtype;
    this.detach(enemyId); c.tokens.damage = 0; c.loc = null;
    if (wasWeak && c.owner) this.inv(c.owner).discard.push(enemyId);
    else if (d.victory && d.victory > 0) this.s.victoryDisplay.push(enemyId);
    else this.s.encounterDiscard.push(enemyId);
    this.queue({ k: 'scenario', hook: 'enemyDefeated', stage: 0, args: { code: c.code } });
    if (bySeat) this.queue({ k: 'window', trigger: 'afterEnemyDefeated', data: { seat: bySeat, enemyId, loc }, seats: [bySeat], used: [], stage: 0, finalize: null });
  }

  revealLocation(id: LocId): void {
    const l = this.loc(id); if (l.revealed) return;
    l.revealed = true;
    const d = this.cat.get(l.code);
    const per = d.location && !d.location.cluesFixed ? this.s.seats.length : 1;
    l.clues = num(d.location?.clues) * per;
    l.shroud = num(d.location?.shroud);
    this.emit('locationRevealed', { loc: id, name: l.name, clues: l.clues });
  }

  /** Spawn an enemy at a location (or engaged with a seat) and check engagement. */
  spawnEnemy(cardId: CardId, where: { loc: LocId } | { engage: SeatId }): void {
    const c = this.card(cardId); this.detach(cardId);
    const loc = 'loc' in where ? where.loc : this.inv(where.engage).loc;
    c.loc = loc; this.s.enemies.push(cardId); c.exhausted = false;
    if ('engage' in where) c.engaged = where.engage;
    this.emit('enemySpawned', { cardId, name: this.name(cardId), loc, engagedSeat: 'engage' in where ? where.engage : undefined });
    this.engageCheck();
    const here = this.invAt(loc).map(i => i.seat);
    if (here.length) this.queue({ k: 'window', trigger: 'afterEnemySpawn', data: { enemyId: cardId, loc }, seats: here, used: [], stage: 0, finalize: null });
  }

  preyScore(enemyId: CardId, seat: SeatId): number | null {
    const prey = this.def(enemyId).abilities.find(a => a.kind === 'prey');
    const inst = prey && prey.kind === 'prey' ? prey.instruction.toLowerCase() : '';
    const inv = this.inv(seat);
    if (inst.includes('bearer')) return this.card(enemyId).flags.bearer === seat ? 100 : null;
    if (inst.includes('highest') && inst.includes('combat')) return inv.skills.combat;
    if (inst.includes('highest') && inst.includes('agility')) return inv.skills.agility;
    if (inst.includes('highest') && inst.includes('willpower')) return inv.skills.willpower;
    if (inst.includes('highest') && inst.includes('intellect')) return inv.skills.intellect;
    if (inst.includes('lowest') && inst.includes('remaining health')) return -(inv.maxHealth - inv.damage);
    if (inst.includes('lowest') && inst.includes('remaining sanity')) return -(inv.maxSanity - inv.horror);
    return 0;
  }

  /** Unengaged, ready, non-aloof enemies at a location with investigators engage one (by prey, then seat order). */
  engageCheck(): void {
    for (const id of this.s.enemies) {
      const c = this.card(id);
      if (c.engaged || c.exhausted || !c.loc) continue;
      if (this.hasKeyword(id, 'aloof')) continue;
      const cands = this.invAt(c.loc).filter(i => this.preyScore(id, i.seat) !== null);
      if (!cands.length) continue;
      let best = cands[0]!; let bs = this.preyScore(id, best.seat)!;
      for (const i of cands.slice(1)) { const sc = this.preyScore(id, i.seat)!; if (sc > bs) { best = i; bs = sc; } }
      c.engaged = best.seat;
      this.emit('enemyEngaged', { cardId: id, name: this.name(id), seat: best.seat });
    }
  }

  // ---- skill modifiers
  modsFor(tester: SeatId, test: TestInfo | TestState | null): Record<Skill, number> {
    const out: Record<Skill, number> = { willpower: 0, intellect: 0, combat: 0, agility: 0 };
    for (const owner of this.activeSeats()) {
      for (const cardId of this.inPlayCards(owner)) {
        const sc = this.script(this.card(cardId).code);
        for (const m of sc?.mods ?? []) for (const d of m(this, owner, cardId, { test, tester })) {
          if (d.skill === 'all') for (const sk of SKILLS) out[sk] += d.delta; else out[d.skill] += d.delta;
        }
      }
    }
    return out;
  }

  /** The skill figure split into what the investigator brings, what others lend, and flat bonuses. */
  skillParts(t: TestState): { base: number; lent: number; bonus: number } {
    const inv = this.inv(t.seat);
    const used: Skill = t.swapSkill?.[t.skill] ?? t.skill;
    const mods = this.modsFor(t.seat, t);
    let base = inv.skills[used] + mods[used];
    if (inv.roundFlags.mindOverMatter && (used === 'combat' || used === 'agility')) base = Math.max(base, inv.skills.intellect + mods.intellect);
    let lent = 0;
    for (const [seat, ids] of Object.entries(t.committed)) {
      if (this.inv(seat).status !== 'active') continue;
      for (const id of ids) { const ic = this.def(id).skillIcons; lent += ic[t.skill] + ic.wild; }
    }
    return { base, lent, bonus: t.bonus };
  }
  skillValue(t: TestState): number { const p = this.skillParts(t); return Math.max(0, p.base + p.lent + p.bonus); }

  /** The doom the current agenda turns on, or 0 when there is none to show. */
  doomThreshold(): number {
    const code = String(this.s.scenarioFlags.agendaCode ?? ''); if (!code || !this.cat.has(code)) return 0;
    const v = this.cat.get(code).actAgenda?.doomThreshold;
    return typeof v === 'number' ? v : Number((v as { value?: number } | undefined)?.value ?? 0);
  }

  // ---- the three basic tests (used by the core actions and by weapon/tool abilities)
  shroudOf(locId: LocId, delta = 0): number {
    const l = this.loc(locId); let v = l.shroud + delta;
    for (const id of l.attached) v += this.script(this.card(id).code)?.shroudMod?.(this, locId, id) ?? 0;
    return Math.max(0, v);
  }
  startInvestigate(seat: SeatId, o: { shroudDelta?: number; sourceCode?: string; sourceName?: string; bonus?: number; swapCluesFor?: Handler } = {}): void {
    const locId = this.inv(seat).loc;
    this.startTest({
      seat, skill: 'intellect', difficulty: this.shroudOf(locId, o.shroudDelta ?? 0), kind: 'investigate',
      sourceCode: o.sourceCode ?? null, sourceName: o.sourceName ?? 'investigation', locId, label: 'investigate', bonus: o.bonus ?? 0,
      onSuccess: o.swapCluesFor ?? { code: CORE, name: 'investigateSuccess', seat },
      data: {},
    });
  }
  startFight(seat: SeatId, enemyId: CardId, o: { bonus?: number; damageBonus?: number; sourceCode?: string; sourceName?: string; skill?: Skill; after?: Handler; data?: Record<string, unknown> } = {}): void {
    this.startTest({
      seat, skill: o.skill ?? 'combat', difficulty: this.enemyStat(enemyId, 'fight'), kind: 'fight',
      sourceCode: o.sourceCode ?? null, sourceName: o.sourceName ?? this.name(enemyId), locId: this.inv(seat).loc, enemyId, label: 'fight',
      bonus: o.bonus ?? 0, onSuccess: { code: CORE, name: 'fightSuccess', seat }, onFailure: { code: CORE, name: 'fightFail', seat },
      ...(o.after ? { after: o.after } : {}),
      data: { damageBonus: o.damageBonus ?? 0, ...(o.data ?? {}) },
    });
  }
  startEvade(seat: SeatId, enemyId: CardId, o: { bonus?: number; sourceCode?: string; sourceName?: string; skill?: Skill; onSuccessExtra?: Handler; data?: Record<string, unknown> } = {}): void {
    this.startTest({
      seat, skill: o.skill ?? 'agility', difficulty: this.enemyStat(enemyId, 'evade'), kind: 'evade',
      sourceCode: o.sourceCode ?? null, sourceName: o.sourceName ?? this.name(enemyId), locId: this.inv(seat).loc, enemyId, label: 'evade',
      bonus: o.bonus ?? 0, onSuccess: { code: CORE, name: 'evadeSuccess', seat }, data: { ...(o.data ?? {}) },
      ...(o.onSuccessExtra ? { after: o.onSuccessExtra } : {}),
    });
  }

  windowFrame(trigger: string): Extract<Frame, { k: 'window' }> | undefined {
    for (let i = this.s.stack.length - 1; i >= 0; i--) { const f = this.s.stack[i]!; if (f.k === 'window' && f.trigger === trigger) return f; }
    return undefined;
  }
  findFrame<T extends Frame['k']>(kind: T): Extract<Frame, { k: T }> | undefined {
    for (let i = this.s.stack.length - 1; i >= 0; i--) { const f = this.s.stack[i]!; if (f.k === kind) return f as Extract<Frame, { k: T }>; }
    return undefined;
  }

  /** End the scenario: tally experience from the victory display and cleared locations, record trauma, stop all frames. */
  endGame(resolution: string, bonusXp = 0): void {
    let vp = 0;
    for (const id of this.s.victoryDisplay) vp += this.def(id).victory ?? 0;
    for (const l of Object.values(this.s.locations)) if (l.inPlay && l.revealed && l.clues === 0) vp += l.victory;
    const xp: Record<SeatId, number> = {}; const trauma: Record<SeatId, { physical: number; mental: number }> = {};
    for (const seat of this.s.seats) {
      let adj = 0;
      for (const id of this.inPlayCards(seat)) adj += this.script(this.card(id).code)?.endGameXp?.(this, seat, id) ?? 0;
      xp[seat] = Math.max(0, vp + bonusXp + adj);
      trauma[seat] = { physical: Number(this.s.scenarioFlags[`trauma:${seat}:physical`] ?? 0), mental: Number(this.s.scenarioFlags[`trauma:${seat}:mental`] ?? 0) };
      const cu = this.controls(seat, '01007');
      if (cu && this.card(cu).tokens.clues > 0) trauma[seat]!.mental += 1;
    }
    this.s.ended = { resolution, xp, trauma };
    this.s.phase = 'ended'; this.s.stack = []; this.s.pending = null; this.out = [];
    this.emit('gameEnded', { resolution, xp });
  }

  shuffleDeck(seat: SeatId): void { shuffle(this.s, this.inv(seat).deck); }
  rand(max: number): number { return randInt(this.s, max); }
  token(): Token { return this.s.chaosBag[randInt(this.s, this.s.chaosBag.length)]!; }
}

export type { Frame };
