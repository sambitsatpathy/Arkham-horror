// Deck validation against the investigator's deck options, in plain-language results.
import type { Catalog } from './catalog.ts';
import type { Registry } from './scripts/types.ts';
import type { DeckOption } from '../data/model.ts';
import type { CardDef } from '../data/model.ts';

export interface DeckReport { ok: boolean; errors: string[]; warnings: string[]; count: number }

function matches(c: CardDef, o: DeckOption): boolean {
  if (!o.factions.includes(c.classes[0] as string)) return false;
  const lv = c.level ?? 0;
  if (o.levelMin !== undefined && lv < o.levelMin) return false;
  if (o.levelMax !== undefined && lv > o.levelMax) return false;
  if (o.trait && !o.trait.some(t => c.traits.map(x => x.toLowerCase()).includes(t.toLowerCase()))) return false;
  return true;
}

export function validateDeck(cat: Catalog, reg: Registry, investigatorCode: string, codes: string[]): DeckReport {
  const errors: string[] = []; const warnings: string[] = [];
  const inv = cat.get(investigatorCode);
  if (inv.type !== 'investigator' || !inv.investigator) return { ok: false, errors: ['That is not an investigator.'], warnings, count: codes.length };
  const st = inv.investigator;
  const cards: CardDef[] = [];
  for (const code of codes) {
    if (!cat.has(code)) { errors.push(`Unknown card ${code}.`); continue; }
    cards.push(cat.get(code));
  }
  if (st.deckSize !== null && cards.length !== st.deckSize) errors.push(`A deck for ${inv.title} holds exactly ${st.deckSize} cards; this one has ${cards.length}.`);
  for (const r of st.deckRequirements) {
    if (r.kind === 'card') { if (!r.codes!.some(c => codes.includes(c))) errors.push(`The deck must include ${r.codes!.map(c => cat.has(c) ? cat.get(c).title : c)[0]}.`); }
    if (r.kind === 'random' && !cards.some(c => c.subtype === 'basicweakness')) errors.push('The deck needs one random basic weakness.');
  }
  const byTitle = new Map<string, number>();
  const exclusions = st.deckOptions.filter(o => o.notAny);
  const inclusions = st.deckOptions.filter(o => !o.notAny);
  for (const c of cards) {
    byTitle.set(c.title, (byTitle.get(c.title) ?? 0) + 1);
    if (c.type === 'investigator') { errors.push(`${c.title} is an investigator, not a deck card.`); continue; }
    if (c.subtype) continue;                                       // weaknesses are always allowed
    if (c.signatureOf) { if (!c.signatureOf.includes(investigatorCode)) errors.push(`${c.title} belongs to another investigator.`); continue; }
    if (exclusions.some(o => matches(c, o))) { errors.push(`${c.title} is not allowed in this deck.`); continue; }
    if (!inclusions.some(o => matches(c, o))) errors.push(`${c.title} is outside what ${inv.title} can use.`);
  }
  for (const [title, n] of byTitle) {
    const c = cat.byName(title)!;
    if (c.deckLimit && n > c.deckLimit) errors.push(`At most ${c.deckLimit} copies of ${title}.`);
  }
  for (const c of cards) if (c.type !== 'investigator' && !reg[c.code] && c.code !== '01000') warnings.push(`${c.title} is not playable in this build yet.`);
  const unplayable = [...new Set(warnings)];
  return { ok: errors.length === 0 && unplayable.length === 0, errors, warnings: unplayable, count: cards.length };
}

/** Roland Banks' starter list used for demos and tests: signature cards, a random weakness, and 27 level-0 cards. */
export const ROLAND_STARTER: string[] = [
  '01006', '01007', '01000',
  ...['01016', '01017', '01018', '01019', '01021', '01022', '01023', '01024', '01025'].flatMap(c => [c, c]),
  '01020', '01030', '01037', '01037', '01039', '01039', '01033', '01035', '01089',
];

/** Starter lists for every Core Set investigator (signature cards, a random weakness, and level-0 cards the engine plays). */
export const STARTERS: Record<string, string[]> = {
  '01001': ROLAND_STARTER,
  '01002': ['01008',  '01009',  '01000',  '01031',  '01032',  '01035',  '01030',  '01033',  '01034',  '01036',  '01037',  '01039',  '01038',  '01086',  '01087',  '01088',  '01089',  '01091',  '01092',  '01093',  '01031',  '01032',  '01035',  '01030',  '01033',  '01034',  '01036',  '01037',  '01039',  '01038'],
  '01003': ['01010',  '01011',  '01000',  '01044',  '01045',  '01046',  '01047',  '01049',  '01050',  '01051',  '01052',  '01053',  '01048',  '01016',  '01017',  '01086',  '01087',  '01088',  '01089',  '01091',  '01044',  '01045',  '01046',  '01047',  '01049',  '01050',  '01051',  '01052',  '01053',  '01048'],
  '01004': ['01012',  '01013',  '01000',  '01059',  '01060',  '01061',  '01062',  '01063',  '01064',  '01065',  '01066',  '01067',  '01058',  '01072',  '01073',  '01086',  '01087',  '01088',  '01089',  '01091',  '01059',  '01060',  '01061',  '01062',  '01063',  '01064',  '01065',  '01066',  '01067',  '01058'],
  '01005': ['01014',  '01015',  '01000',  '01072',  '01073',  '01074',  '01075',  '01076',  '01077',  '01078',  '01079',  '01080',  '01081',  '01044',  '01046',  '01086',  '01087',  '01088',  '01089',  '01091',  '01072',  '01073',  '01074',  '01075',  '01076',  '01077',  '01078',  '01079',  '01080',  '01081'],
};
