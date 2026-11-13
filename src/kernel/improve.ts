// Spending experience between scenarios: which upgrades can a deck buy, what do they cost, what can they replace.
// Same-title upgrades pay only the difference in level, as the rules say. Everything is validated through validateDeck.
import type { Catalog } from './catalog.ts';
import type { Registry } from './scripts/types.ts';
import { validateDeck } from './deck.ts';

export interface UpgradeCandidate { add: string; title: string; level: number; cost: number; removeChoices: string[]; sameTitle: boolean }

export function upgradeOptions(cat: Catalog, reg: Registry, investigatorCode: string, deck: string[], xp: number): UpgradeCandidate[] {
  const out: UpgradeCandidate[] = [];
  const inDeck = [...new Set(deck)];
  for (const c of cat.all()) {
    if ((c.level ?? 0) < 1 || c.type === 'investigator' || c.subtype || c.signatureOf || !reg[c.code]) continue;
    const same = inDeck.map(code => cat.get(code)).find(d => d.title === c.title && (d.level ?? 0) < (c.level ?? 0));
    const removals = same ? [same.code] : inDeck.filter(code => { const d = cat.get(code); return !d.subtype && !d.signatureOf && d.type !== 'investigator'; });
    const choices = removals.filter(rm => {
      const cost = same ? (c.level ?? 0) - (same.level ?? 0) : (c.level ?? 0);
      if (cost > xp) return false;
      return validateDeck(cat, reg, investigatorCode, applyUpgrade(deck, c.code, rm)).errors.length === 0;
    });
    if (!choices.length) continue;
    out.push({ add: c.code, title: c.title, level: c.level ?? 0, cost: same ? (c.level ?? 0) - (same.level ?? 0) : (c.level ?? 0), removeChoices: choices, sameTitle: !!same });
  }
  return out.sort((a, b) => a.cost - b.cost || a.title.localeCompare(b.title));
}

export function applyUpgrade(deck: string[], add: string, remove: string): string[] {
  const i = deck.indexOf(remove); if (i < 0) return deck;
  const next = [...deck]; next.splice(i, 1, add); return next;
}
