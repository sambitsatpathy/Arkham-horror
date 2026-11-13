// Card catalog: parsed card definitions keyed by code, loaded from a local clone of
// https://github.com/Kamalisk/arkhamdb-json-data (not bundled; card text is not ours to ship).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCard, type Raw } from '../data/parse.ts';
import type { CardDef } from '../data/model.ts';

export interface Catalog {
  get(code: string): CardDef;
  has(code: string): boolean;
  all(): CardDef[];
  byName(name: string): CardDef | undefined;
  loadErrors: string[];
}

const FILES = ['pack/core/core.json', 'pack/core/core_encounter.json'];

export function loadCatalog(dataDir: string): Catalog {
  const byCode = new Map<string, CardDef>();
  const errors: string[] = [];
  for (const f of FILES) {
    const p = join(dataDir, f);
    if (!existsSync(p)) throw new Error(`card data not found: ${p}. Clone arkhamdb-json-data and pass its path.`);
    for (const raw of JSON.parse(readFileSync(p, 'utf8')) as Raw[]) {
      if (!raw?.code || !raw?.name) continue;
      try { byCode.set(raw.code, parseCard(raw, null)); } catch (e: any) { errors.push(`${raw.code} ${raw.name}: ${e.message}`); }
    }
  }
  const names = new Map<string, CardDef>();
  for (const c of byCode.values()) if (!names.has(c.title)) names.set(c.title, c);
  return {
    get(code) { const c = byCode.get(code); if (!c) throw new Error(`unknown card ${code}`); return c; },
    has: (code) => byCode.has(code),
    all: () => [...byCode.values()],
    byName: (n) => names.get(n),
    loadErrors: errors,
  };
}
