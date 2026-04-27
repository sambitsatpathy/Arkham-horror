const { findCardByCode, loadAllCards } = require('./cardLookup');

async function fetchDeckFromArkhamDB(deckId) {
  const { default: fetch } = await import('node-fetch');
  const url = `https://arkhamdb.com/api/public/deck/${deckId}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ArkhamDB returned ${res.status}`);
  return res.json();
}

function extractDeckId(input) {
  // Accept raw ID or full URL
  const match = input.match(/(\d+)/);
  return match ? match[1] : null;
}

function flattenSlots(slots) {
  const codes = [];
  for (const [code, qty] of Object.entries(slots)) {
    for (let i = 0; i < qty; i++) codes.push(code);
  }
  return codes;
}

async function importDeck(input, investigatorCode) {
  const deckId = extractDeckId(input);
  if (!deckId) throw new Error('Could not parse deck ID from input.');

  const data = await fetchDeckFromArkhamDB(deckId);

  if (data.investigator_code !== investigatorCode) {
    throw new Error(
      `Deck belongs to investigator ${data.investigator_code}, but you chose ${investigatorCode}.`
    );
  }

  const codes = flattenSlots(data.slots || {});

  // Warn about unknown cards (non-fatal)
  const unknown = [];
  for (const code of [...new Set(codes)]) {
    if (!findCardByCode(code)) unknown.push(code);
  }

  return {
    deckId: String(data.id),
    deckName: data.name,
    investigatorCode: data.investigator_code,
    codes,
    unknown,
    raw: data,
  };
}

function buildStarterDeck(investigatorCode, starterDecks) {
  const entry = starterDecks[investigatorCode];
  if (!entry) throw new Error(`No starter deck found for investigator ${investigatorCode}.`);

  const codes = flattenSlots(entry.deck);
  const sigs = entry.signature_cards || [];
  const weakness = entry.weakness
    ? [entry.weakness]
    : (entry.weakness_cards || []);
  const displayName = entry.name || entry.investigator || investigatorCode;

  return {
    deckName: `${displayName} Starter Deck`,
    codes: [...codes, ...sigs, ...weakness],
  };
}

module.exports = { importDeck, buildStarterDeck, extractDeckId };
