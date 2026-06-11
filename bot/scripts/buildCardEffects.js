const fs = require('fs');
const path = require('path');
const { cardDataRoot } = require('../config');
const { parse } = require('../engine/cardEffectParser');

const OUTPUT = path.join(__dirname, '..', 'data', 'card_effects.json');
const ARKHAMDB_URL = 'https://arkhamdb.com/api/public/cards/?encounter=1';

async function loadCards() {
  if (process.argv.includes('--from-arkhamdb')) {
    console.log(`Fetching ${ARKHAMDB_URL} ...`);
    const res = await fetch(ARKHAMDB_URL);
    if (!res.ok) throw new Error(`ArkhamDB fetch failed: HTTP ${res.status}`);
    return res.json();
  }
  const cards = [];
  const dirs = fs.readdirSync(cardDataRoot, { withFileTypes: true }).filter(e => e.isDirectory());
  for (const dir of dirs) {
    const file = path.join(cardDataRoot, dir.name, 'cards.json');
    if (!fs.existsSync(file)) continue;
    cards.push(...JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  if (cards.length === 0) {
    throw new Error(`No pack cards.json found under ${cardDataRoot} — run with --from-arkhamdb to fetch instead.`);
  }
  return cards;
}

function hasStructured(entry) {
  return Boolean(
    entry.effects.length || entry.on_success.length ||
    entry.passive.length || entry.triggers.length ||
    entry.revelation_effects.length ||
    (entry.revelation && (entry.revelation.effects.length || entry.revelation.test)) ||
    entry.keywords.length || entry.uses || entry.prey || entry.victory
  );
}

async function main() {
  const map = {};
  let total = 0;
  let parsed = 0;
  const byType = {};
  const unparsedSamples = [];

  const cards = await loadCards();
  for (const card of cards) {
    if (!card.code) continue;
    total++;
    const entry = parse(card);
    const type = entry.type || 'unknown';
    byType[type] = byType[type] || { total: 0, parsed: 0 };
    byType[type].total++;
    if (hasStructured(entry)) {
      parsed++;
      byType[type].parsed++;
    } else if (card.text && unparsedSamples.length < 20) {
      unparsedSamples.push(`${card.code} ${card.name}: ${entry.unparsed_text.slice(0, 80)}`);
    }
    map[card.code] = entry;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]));
  fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Total cards: ${total}`);
  console.log(`Parsed (any structured field): ${parsed} (${(100 * parsed / total).toFixed(1)}%)`);
  console.log(`\nCoverage by type:`);
  for (const [type, s] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${type.padEnd(16)} ${String(s.parsed).padStart(5)}/${s.total} (${(100 * s.parsed / s.total).toFixed(1)}%)`);
  }
  console.log(`\nFirst 20 cards with unparsed text:`);
  unparsedSamples.forEach(s => console.log(' ', s));
}

main().catch(err => { console.error(err); process.exit(1); });
