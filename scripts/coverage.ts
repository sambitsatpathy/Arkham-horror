// What is covered and what is not: narration per event kind, and card scripts per Core Set card.
//   npm run coverage
import { engine } from '../test/helpers.ts';
import { EVENT_KINDS, generic } from '../src/adapter/narration/generic.ts';
import { gatheringPack } from '../src/adapter/narration/gathering.ts';
import { SILENT } from '../src/adapter/narration/engine.ts';
import { SUPPORTED_INVESTIGATORS } from '../src/kernel/scripts/player.ts';

const authored = new Set(gatheringPack.templates.map(t => t.event)); const fallback = new Set(generic.templates.map(t => t.event));
const rows = EVENT_KINDS.map(k => ({ kind: k, status: SILENT.has(k) ? 'silent' : authored.has(k) ? 'authored' : fallback.has(k) ? 'fallback only' : 'MISSING' }));
const count = (s: string) => rows.filter(r => r.status === s).length;
console.log(`Narration (${EVENT_KINDS.length} event kinds): ${count('authored')} authored, ${count('fallback only')} fallback only, ${count('silent')} silent on purpose, ${count('MISSING')} missing`);
for (const r of rows.filter(r => r.status === 'fallback only' || r.status === 'MISSING')) console.log(`  ${r.status.padEnd(14)} ${r.kind}`);

const E = engine();
const cards = E.cat.all().filter(c => c.type !== 'investigator' && c.type !== 'agenda' && c.type !== 'act' && c.type !== 'location' && c.type !== 'story');
const scripted = (code: string) => !!E.reg[code];
const player = cards.filter(c => !c.encounterSet); const enc = cards.filter(c => c.encounterSet);
console.log(`\nPlayer cards: ${player.filter(c => scripted(c.code)).length}/${player.length} scripted`);
const byClass: Record<string, string[]> = {};
for (const c of player.filter(c => !scripted(c.code))) (byClass[c.classes[0] as string] ??= []).push(`${c.title}${c.level ? ` (${c.level})` : ''}`);
for (const [cl, names] of Object.entries(byClass)) console.log(`  ${cl}: ${names.length} unscripted: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}`);
console.log(`\nEncounter cards: ${enc.filter(c => scripted(c.code)).length}/${enc.length} scripted`);
const bySet: Record<string, string[]> = {};
for (const c of enc.filter(c => !scripted(c.code))) (bySet[c.encounterSet ?? '?'] ??= []).push(c.title);
for (const [s, names] of Object.entries(bySet)) console.log(`  ${s}: ${[...new Set(names)].join(', ')}`);
console.log(`\nInvestigators playable: ${SUPPORTED_INVESTIGATORS.map(c => E.cat.get(c).title).join(', ')} (of ${E.cat.all().filter(c => c.type === 'investigator').length} in the Core Set)`);
