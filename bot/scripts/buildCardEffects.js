const fs = require('fs');
const path = require('path');
const { cardDataRoot } = require('../config');
const { parse } = require('../engine/cardEffectParser');

const OUTPUT = path.join(__dirname, '..', 'data', 'card_effects.json');

function main() {
  const map = {};
  let total = 0;
  let parsed = 0;
  const unparsedSamples = [];

  const dirs = fs.readdirSync(cardDataRoot, { withFileTypes: true })
    .filter(e => e.isDirectory());

  for (const dir of dirs) {
    const file = path.join(cardDataRoot, dir.name, 'cards.json');
    if (!fs.existsSync(file)) continue;
    const cards = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const card of cards) {
      if (!card.code) continue;
      total++;
      const entry = parse(card);
      const hasStructured =
        entry.effects.length || entry.on_success.length ||
        entry.passive.length || entry.triggers.length ||
        entry.revelation_effects.length;
      if (hasStructured) parsed++;
      else if (card.text && unparsedSamples.length < 20) {
        unparsedSamples.push(`${card.code} ${card.name}: ${entry.unparsed_text.slice(0, 80)}`);
      }
      map[card.code] = entry;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]));
  fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Total cards: ${total}`);
  console.log(`Parsed (any structured field): ${parsed} (${(100 * parsed / total).toFixed(1)}%)`);
  console.log(`\nFirst 20 cards with unparsed text:`);
  unparsedSamples.forEach(s => console.log(' ', s));
}

main();
