import type {
  Ability, ActAgendaStats, CardDef, CardType, ChaosSymbol, CostPart, DeckOption, DeckRequirement, Designator,
  Keyword, KeywordName, Limit, PlayerClass, ScenarioRef, Skill, Slot, SymbolEffect, Timing, Value,
} from './model.ts';

export type Raw = Record<string, any>;

const KNOWN_ICONS = new Set([
  'action', 'reaction', 'fast', 'elder_sign', 'skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail',
  'willpower', 'intellect', 'combat', 'agility', 'wild',
  'guardian', 'seeker', 'rogue', 'mystic', 'survivor',
  'per_investigator', 'bless', 'curse', 'frost',
]);

const SIMPLE_KEYWORDS: Record<string, KeywordName> = {
  fast: 'fast', hidden: 'hidden', peril: 'peril', surge: 'surge', hunter: 'hunter', retaliate: 'retaliate',
  aloof: 'aloof', massive: 'massive', alert: 'alert', permanent: 'permanent', exceptional: 'exceptional',
  myriad: 'myriad', elusive: 'elusive', customizable: 'customizable',
};

const DESIGNATORS = ['Fight', 'Evade', 'Investigate', 'Move', 'Parley', 'Resign', 'Explore', 'Engage'];

export function value(v: unknown): Value | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v === -2) return 'X';
  if (v === -3) return '*';
  if (v === -4) return '?';
  if (typeof v === 'number' && v >= 0) return v;
  throw new Error(`bad numeric value ${JSON.stringify(v)}`);
}

const strip = (s: string) => s.replace(/<\/?b>|<\/?i>/g, '').trim();

function parseTrigger(text: string): { timing: Timing; text: string } | null {
  const t = text.trim();
  if (/\bwould\b/i.test(t) && /^(when|after|if|at)\b/i.test(t)) return { timing: 'would', text: t };
  const m = /^(when|after|if|at)\b/i.exec(t);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return { timing: w === 'when' ? 'when' : w === 'after' ? 'after' : 'atIf', text: t };
}

function parseCosts(before: string): CostPart[] {
  const out: CostPart[] = [];
  for (const piece of before.split(/,\s*|\s+and\s+/i)) {
    const p = piece.trim().replace(/^During your turn\s*/i, '');
    let m: RegExpExecArray | null;
    if ((m = /^spend (\d+|X) ([a-z]+)/i.exec(p)))
      out.push({ kind: m[2].startsWith('resource') ? 'resources' : 'uses', amount: m[1] === 'X' ? 'X' : Number(m[1]), what: m[2], raw: p });
    else if ((m = /^exhaust (.+)$/i.exec(p))) out.push({ kind: 'exhaust', what: m[1], raw: p });
    else if ((m = /^discard (.+)$/i.exec(p))) out.push({ kind: 'discard', what: m[1], raw: p });
    else if ((m = /^take (\d+) (damage|horror)/i.exec(p))) out.push({ kind: m[2].toLowerCase() as 'damage' | 'horror', amount: Number(m[1]), raw: p });
    else if ((m = /^exile (.+)$/i.exec(p))) out.push({ kind: 'exile', what: m[1], raw: p });
  }
  return out;
}

function parseLimit(line: string): Limit | null {
  let m = /\(?Limit (once|twice|\d+)(?: per)? ([a-z ]+?)(?: per [a-z ]+)?\.?\)?\.?$/i.exec(line);
  const group = /group limit/i.test(line);
  if (m) {
    const n = m[1] === 'once' ? 1 : m[1] === 'twice' ? 2 : Number(m[1]);
    const s = m[2].toLowerCase();
    const scope = (['round', 'phase', 'turn', 'game', 'test', 'deck'] as const).find(x => s.includes(x)) ?? (s.includes('play') ? 'play' : 'other');
    return { scope, count: n, group, kind: 'limit', raw: m[0] };
  }
  m = /^Max (\d+)(?: committed)? per ([a-z ]+)\.?$/i.exec(line);
  if (m) {
    const s = m[2].toLowerCase();
    const scope = (['round', 'phase', 'turn', 'game', 'test'] as const).find(x => s.includes(x) || (x === 'test' && s.includes('skill test'))) ?? 'other';
    return { scope, count: Number(m[1]), kind: 'max', raw: line };
  }
  return null;
}

function designatorOf(effect: string): Designator | undefined {
  const m = new RegExp(`^<b>(${DESIGNATORS.join('|')})\\.</b>`).exec(effect.trim());
  return m ? (m[1].toLowerCase() as Designator) : undefined;
}

export interface ParseCtx { type: CardType; title: string; flags: string[] }

export function parseLine(rawLine: string, ctx: ParseCtx): Ability[] {
  const line = rawLine.trim();
  if (!line) return [];
  const plain = strip(line);

  // Uses (4 ammo).   Some print the discard-when-empty rule on the same line.
  let m = /^Uses \((\d+|X)(?: per investigator)? ([a-z]+)\)\.?(?:\s+(If .+ has no [a-z]+, discard it\.?))?$/i.exec(plain);
  if (m) {
    const out: Ability[] = [{ kind: 'keyword', raw: line, keyword: { name: 'uses', amount: m[1] === 'X' ? 'X' : Number(m[1]), usesType: m[2], perInvestigator: /per investigator/i.test(plain) } }];
    if (m[3]) out.push({ kind: 'discardWhenEmpty', raw: m[3] });
    return out;
  }

  // Structured constant abilities
  if ((m = /^You get ([+-]\d+) \[(willpower|intellect|combat|agility)\](?: (while .+?|for .+?))?\.?$/.exec(plain)))
    return [{ kind: 'modifier', target: 'investigator', stat: m[2], delta: Number(m[1]), condition: m[3], raw: line }];
  if ((m = /^You get ([+-]\d+) to each of your skills\.?$/.exec(plain)))
    return [{ kind: 'modifier', target: 'investigator', stat: 'all skills', delta: Number(m[1]), raw: line }];
  if ((m = /^(?:Attached location|The Masked Hunter|Umôrdhoth|[A-Z][\w' ]+?) gets ([+-]\d+) (health|shroud|fight|evade)( per investigator)?\.?$/.exec(plain)))
    return [{ kind: 'modifier', target: /^Attached/.test(plain) ? 'attached' : 'self', stat: m[2], delta: Number(m[1]), perInvestigator: !!m[3], raw: line }];
  if ((m = /^You have (\d+) additional (hand|arcane|ally|accessory|body) slots?(?:, which can only be used to hold (.+?))?\.?$/.exec(plain)))
    return [{ kind: 'slotGrant', slot: m[2] as Slot, count: Number(m[1]), onlyFor: m[3], raw: line }];
  if ((m = /^You may take an additional action during your turn(?:, which can only be used on (.+?))?\.?$/.exec(plain)))
    return [{ kind: 'additionalAction', onlyFor: m[1], raw: line }];

  // "Hunter. Retaliate." / "Peril." / "Permanent." / "Fast."
  const kwOnly = plain.replace(/\.$/, '').split(/\.\s+/);
  if (kwOnly.length && kwOnly.every(k => SIMPLE_KEYWORDS[k.trim().toLowerCase()])) {
    return kwOnly.map(k => ({ kind: 'keyword' as const, raw: k, keyword: { name: SIMPLE_KEYWORDS[k.trim().toLowerCase()] } }));
  }
  // "Fast. Play after your turn begins."
  m = /^(Fast)\.\s+(Play .*)$/i.exec(plain);
  if (m) return [
    { kind: 'keyword', raw: 'Fast.', keyword: { name: 'fast' } },
    { kind: 'playInstruction', text: m[2], raw: m[2] },
  ];
  m = /^(Myriad|Bonded|Patrol|Swarming|Concealed|Seal)\b ?\(?([^).]*)\)?\.?$/i.exec(plain);
  if (m) return [{ kind: 'keyword', raw: line, keyword: { name: m[1].toLowerCase() as KeywordName, arg: m[2] || undefined } }];

  // Deck-only restriction
  m = /^(.+) deck only\.?$/i.exec(plain);
  if (m) return [{ kind: 'deckRestriction', investigator: m[1], raw: line }];

  // <b>Revelation</b> - ...
  m = /^<b>Revelation<\/b>\s*-\s*(.*)$/.exec(line);
  if (m) return [{ kind: 'revelation', effect: strip(m[1]), raw: line }];
  // <b>Forced</b> - When ...: effect
  m = /^<b>Forced<\/b>\s*-\s*(.*)$/.exec(line);
  if (m) {
    const [before, ...rest] = splitColon(m[1]);
    return [{ kind: 'forced', trigger: parseTrigger(before), effect: strip(rest.join(': ')), raw: line }];
  }
  m = /^<b>Prey<\/b>\s*-\s*(.*)$/.exec(line);
  if (m) return [{ kind: 'prey', instruction: strip(m[1]), only: /\bonly\b/i.test(m[1]), raw: line }];
  m = /^<b>Spawn<\/b>\s*-\s*(.*)$/.exec(line);
  if (m) return [{ kind: 'spawn', instruction: strip(m[1]), raw: line }];
  m = /^<b>Objective<\/b>\s*-\s*(.*)$/.exec(line);
  if (m) return [{ kind: 'objective', text: strip(m[1]), raw: line }];
  m = /^<b>Haunted<\/b>\s*-\s*(.*)$/.exec(line);
  if (m) return [{ kind: 'forced', trigger: { timing: 'after', text: 'Haunted' }, effect: strip(m[1]), raw: line }];

  // [elder_sign] effect: ...
  m = /^\[elder_sign\] effect:\s*(.*)$/.exec(line);
  if (m) return [{ kind: 'elderSign', effect: strip(m[1]), raw: line }];

  // Triggered: [action]+ / [reaction] / [fast]
  m = /^((?:\[action\]\s*)+)(.*)$/.exec(line);
  if (m) return [triggered('action', (m[1].match(/\[action\]/g) ?? []).length, m[2], line)];
  m = /^\[reaction\]\s*(.*)$/.exec(line);
  if (m) return [triggered('reaction', 0, m[1], line)];
  m = /^\[fast\]\s*(.*)$/.exec(line);
  if (m) return [triggered('free', 0, m[1], line)];

  // Limits / maximums on their own line
  const lim = parseLimit(plain);
  if (lim) return [{ kind: 'limit', limit: lim, raw: line }];

  // Bare designator line (events)
  const des = designatorOf(line);
  if (des) return [{ kind: 'effect', designator: des, raw: line }];

  // Skill-card test effects
  if (ctx.type === 'skill') return [{ kind: 'skillTestEffect', raw: line }];

  // Event / act / agenda free text is an effect; everything else is a constant ability
  if (ctx.type === 'event' || ctx.type === 'act' || ctx.type === 'agenda') return [{ kind: 'effect', raw: line }];
  return [{ kind: 'constant', raw: line }];
}

// Whole card text: handles quoted "gains:" blocks that span several lines.
export function parseText(text: string, ctx: ParseCtx): Ability[] {
  const lines = text.split('\n');
  const out: Ability[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const one = /^(.*\bgains?):\s*"(.*)"\s*$/.exec(l);            // single-line: ... she gains: "...."
    if (one) { out.push({ kind: 'grants', condition: one[1], abilities: parseText(one[2], ctx), raw: l }); continue; }
    if (/\bgains:\s*$/.test(l) && lines[i + 1]?.trim().startsWith('"')) {   // multi-line quoted block
      const block: string[] = []; let j = i + 1;
      for (; j < lines.length; j++) { block.push(lines[j].trim()); if (lines[j].trim().endsWith('"')) break; }
      const inner = block.join('\n').replace(/^"/, '').replace(/"$/, '');
      out.push({ kind: 'grants', condition: l.replace(/:$/, ''), abilities: parseText(inner, ctx), raw: [l, ...block].join('\n') });
      i = j; continue;
    }
    out.push(...parseLine(l, ctx));
  }
  return out;
}

function splitColon(s: string): string[] {
  const i = s.indexOf(':');
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + 1).trim()];
}

function triggered(speed: 'free' | 'reaction' | 'action', actions: number, body: string, raw: string): Ability {
  const parts = splitColon(body);
  const hasColon = parts.length === 2;
  const before = hasColon ? parts[0] : '';
  const effect = hasColon ? parts[1] : parts[0];
  const trig = speed === 'reaction' ? parseTrigger(before) : null;
  let limit: Limit | undefined;
  const lm = /\(?(Limit (?:once|twice|\d+)[^)]*)\)?\.?$/i.exec(strip(effect));
  if (lm) limit = parseLimit(lm[1]) ?? undefined;
  return {
    kind: 'triggered', speed, actions, trigger: trig, cost: parseCosts(before),
    designator: designatorOf(effect), effect: strip(effect), limit, raw,
  };
}

// ---------- deckbuilding ----------

function parseDeckOptions(opts: any[] | null | undefined, flags: string[]): DeckOption[] {
  if (!opts) return [];
  const known = new Set(['faction', 'level', 'limit', 'trait', 'text', 'atleast', 'not', 'slot', 'uses', 'name', 'error', 'type', 'faction_select', 'tag', 'option_select']);
  return opts.map(o => {
    for (const k of Object.keys(o)) if (!known.has(k)) flags.push(`deck_options: unknown key ${k}`);
    return {
      factions: o.faction ?? [], levelMin: o.level?.min, levelMax: o.level?.max, limit: o.limit,
      trait: o.trait, text: o.text, atleast: o.atleast, notAny: o.not, raw: o,
    };
  });
}

function parseDeckRequirements(s: string | null | undefined, flags: string[]): DeckRequirement[] {
  if (!s) return [];
  return s.split(',').map(p => p.trim()).filter(Boolean).map(p => {
    const [kind, ...rest] = p.split(':');
    if (kind === 'size') return { kind: 'size' as const, size: Number(rest[0]), raw: p };
    if (kind === 'card') return { kind: 'card' as const, codes: rest, raw: p };
    if (kind === 'random') return { kind: 'random' as const, randomOf: rest.join(':'), raw: p };
    flags.push(`deck_requirements: unknown kind ${kind}`);
    return { kind: 'card' as const, codes: [], raw: p };
  });
}

// ---------- scenario reference ----------

function parseSymbolBlock(block: string): { effects: SymbolEffect[]; unparsed: string[] } {
  const effects: SymbolEffect[] = []; const unparsed: string[] = [];
  for (const l of block.split('\n').map(x => x.trim()).filter(Boolean)) {
    if (/^(Easy|Hard)\s*\/\s*(Standard|Expert)$/i.test(l)) continue;
    const m = /^\[(skull|cultist|tablet|elder_thing)\]:\s*(.*)$/.exec(l);
    if (!m) { unparsed.push(l); continue; }
    const mod = /^([+-]\d+|-X|\+X)\./.exec(m[2]);
    effects.push({
      symbol: m[1] as ChaosSymbol,
      modifier: mod ? (mod[1].endsWith('X') ? 'X' : Number(mod[1])) : null,
      revealAnother: /Reveal another token/i.test(m[2]),
      text: m[2],
    });
  }
  return { effects, unparsed };
}

// ---------- card ----------

const FACTIONS = new Set(['guardian', 'seeker', 'rogue', 'mystic', 'survivor', 'neutral', 'mythos']);

function slots(s?: string): Slot[] {
  if (!s) return [];
  const out: Slot[] = [];
  for (const part of s.split('.').map(p => p.trim()).filter(Boolean)) {
    const m = /^(Hand|Arcane|Ally|Body|Accessory|Tarot)(?: x(\d))?$/.exec(part);
    if (!m) throw new Error(`bad slot "${part}"`);
    for (let i = 0; i < Number(m[2] ?? 1); i++) out.push(m[1].toLowerCase() as Slot);
  }
  return out;
}

export function parseCard(src: Raw, listing: Raw | null): CardDef {
  const flags: string[] = [];
  const type = (src.type_code === 'scenario' ? 'scenarioRef' : src.type_code) as CardType;
  const ctx: ParseCtx = { type, title: src.name, flags };
  if (!FACTIONS.has(src.faction_code)) flags.push(`unknown faction ${src.faction_code}`);
  const classes = [src.faction_code, src.faction2_code, src.faction3_code].filter(Boolean);

  // Scenario reference cards hold per-symbol token text, parsed separately below, not abilities.
  const abilities: Ability[] = type === 'scenarioRef' ? [] : parseText(src.text ?? '', ctx);
  for (const i of ((src.text ?? '') + ' ' + (src.back_text ?? '')).match(/\[[a-z_]+\]/g) ?? [])
    if (!KNOWN_ICONS.has(i.slice(1, -1))) flags.push(`unknown icon token ${i}`);

  const keywords: Keyword[] = abilities.filter(a => a.kind === 'keyword').map(a => (a as any).keyword);
  const card: CardDef = {
    code: listing?.code ?? src.code, setCode: listing?.pack_code ?? src.pack_code, setPosition: listing?.position ?? src.position,
    sourceCode: src.code, title: src.name, subtitle: src.subname, type,
    subtype: src.subtype_code, unique: !!src.is_unique, classes,
    cost: value(src.cost), level: src.xp,
    skillIcons: { willpower: src.skill_willpower ?? 0, intellect: src.skill_intellect ?? 0, combat: src.skill_combat ?? 0, agility: src.skill_agility ?? 0, wild: src.skill_wild ?? 0 },
    slots: slots(src.slot),
    traits: (src.traits ?? '').split('.').map((t: string) => t.trim()).filter(Boolean),
    keywords, abilities,
    victory: src.victory, vengeance: src.vengeance,
    encounterSet: src.encounter_code, encounterPosition: src.encounter_position,
    deckLimit: src.deck_limit ?? 0, quantity: listing?.quantity ?? src.quantity,
    signatureOf: src.restrictions ? String(src.restrictions).split(',').map((x: string) => x.replace(/^investigator:/, '')) : undefined,
    tags: src.tags ? String(src.tags).split('.').filter(Boolean) : undefined,
    doubleSided: !!src.double_sided, textRaw: src.text ?? '', flags,
  };
  if ('health' in src) card.health = src.health;
  if ('sanity' in src) card.sanity = src.sanity;

  switch (type) {
    case 'investigator':
      card.investigator = {
        skills: { willpower: src.skill_willpower, intellect: src.skill_intellect, combat: src.skill_combat, agility: src.skill_agility } as Record<Skill, number>,
        health: src.health, sanity: src.sanity,
        deckOptions: parseDeckOptions(src.deck_options, flags),
        deckRequirements: parseDeckRequirements(src.deck_requirements, flags),
        deckSize: null, backText: src.back_text ?? '',
      };
      card.investigator.deckSize = card.investigator.deckRequirements.find(r => r.kind === 'size')?.size ?? null;
      break;
    case 'enemy':
      card.enemy = {
        fight: value(src.enemy_fight) ?? null, evade: value(src.enemy_evade) ?? null,
        damage: src.enemy_damage ?? 0, horror: src.enemy_horror ?? 0,
        health: value(src.health) ?? null, healthPerInvestigator: !!src.health_per_investigator,
      };
      break;
    case 'location':
      card.location = { shroud: value(src.shroud) ?? null, clues: value(src.clues) ?? null, cluesFixed: !!src.clues_fixed, connections: null };
      break;
    case 'act': case 'agenda': {
      const res = [...(src.back_text ?? '').matchAll(/\(→R(\d+)\)/g)].map(x => 'R' + x[1]);
      card.actAgenda = { stage: src.stage, clueThreshold: type === 'act' ? value(src.clues) : undefined, doomThreshold: type === 'agenda' ? value(src.doom) : undefined, cluesFixed: !!src.clues_fixed, resolutionPoints: res };
      card.back = { name: src.back_name, text: src.back_text, abilities: (src.back_text ?? '').split('\n').flatMap((l: string) => parseLine(l, { ...ctx, type: 'event' })) };
      break;
    }
    case 'scenarioRef': {
      const easy = parseSymbolBlock(src.text ?? ''); const hard = parseSymbolBlock(src.back_text ?? '');
      card.scenarioRef = { easyStandard: easy.effects, hardExpert: hard.effects, unparsed: [...easy.unparsed, ...hard.unparsed] } as ScenarioRef;
      break;
    }
    default:
      if (src.back_text) card.back = { name: src.back_name, text: src.back_text, abilities: [] };
  }
  return card;
}

export { KNOWN_ICONS, FACTIONS };
