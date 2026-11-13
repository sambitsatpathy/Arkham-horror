// Turn "a deck link, an id, or pasted JSON" into { investigator, codes }. The network call is injectable so tests never touch the web.
// The ArkhamDB endpoint shape (/api/public/decklist/{id}, /api/public/deck/{id}, fields investigator_code and slots) is from memory and not verified here.
export interface ParsedDeck { investigator: string; codes: string[]; name?: string }
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function expandSlots(slots: Record<string, number>): string[] {
  return Object.entries(slots).flatMap(([code, n]) => Array.from({ length: Math.max(0, Math.floor(Number(n))) }, () => code));
}

export function parseDeckJson(raw: unknown): ParsedDeck | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const inv = o.investigator_code ?? o.investigator; const slots = o.slots;
  if (typeof inv !== 'string' || !slots || typeof slots !== 'object') return null;
  return { investigator: inv, codes: expandSlots(slots as Record<string, number>), ...(typeof o.name === 'string' ? { name: o.name } : {}) };
}

export async function loadDeck(source: string, fetcher: Fetcher): Promise<{ deck?: ParsedDeck; error?: string }> {
  const s = source.trim();
  if (s.startsWith('{')) {
    try { const d = parseDeckJson(JSON.parse(s)); return d ? { deck: d } : { error: 'That JSON does not look like a deck (it needs an investigator and its cards).' }; }
    catch { return { error: 'That looks like JSON but it will not parse.' }; }
  }
  const m = s.match(/(?:decklist|deck)\/view\/(\d+)/) ?? s.match(/^(\d{1,9})$/);
  if (!m) return { error: 'Paste an ArkhamDB deck link, a deck id, or the deck as JSON.' };
  const id = m[1]!;
  for (const url of [`https://arkhamdb.com/api/public/decklist/${id}`, `https://arkhamdb.com/api/public/deck/${id}`]) {
    try {
      const r = await fetcher(url); if (!r.ok) continue;
      const d = parseDeckJson(await r.json()); if (d) return { deck: d };
    } catch { /* try the next one */ }
  }
  return { error: 'I could not fetch that deck. If it is private, publish it or paste the JSON instead.' };
}
