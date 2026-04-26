const fs = require('fs');
const path = require('path');
const { cardDataRoot } = require('../config');

const BACK_CACHE_DIR = path.join(__dirname, '../data/location_backs');

function findBackImageSrc(cardCode) {
  // Look up backimagesrc from the full cards.json in each pack folder
  if (!fs.existsSync(cardDataRoot)) return null;
  const entries = fs.readdirSync(cardDataRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(cardDataRoot, entry.name, 'cards.json');
    if (!fs.existsSync(fullPath)) continue;
    try {
      const cards = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const card = cards.find(c => c.code === cardCode);
      if (card?.backimagesrc) return card.backimagesrc; // e.g. "/bundles/cards/01111b.png"
    } catch (_) {}
  }
  return null;
}

async function fetchLocationBackImage(cardCode) {
  if (!fs.existsSync(BACK_CACHE_DIR)) fs.mkdirSync(BACK_CACHE_DIR, { recursive: true });

  const cachePath = path.join(BACK_CACHE_DIR, `${cardCode}b.png`);
  if (fs.existsSync(cachePath)) return cachePath;

  // Get the backimagesrc path from cards.json, fall back to guessed URL
  const backSrc = findBackImageSrc(cardCode);
  const url = backSrc
    ? `https://arkhamdb.com${backSrc}`
    : `https://arkhamdb.com/bundles/cards/${cardCode}b.png`;

  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    fs.writeFileSync(cachePath, Buffer.from(buf));
    return cachePath;
  } catch (_) {
    return null;
  }
}

let _allCards = null;

function loadAllCards() {
  if (_allCards) return _allCards;
  _allCards = [];

  const entries = fs.readdirSync(cardDataRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(cardDataRoot, entry.name, 'cards_index.json');
    if (!fs.existsSync(indexPath)) continue;
    try {
      const cards = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      for (const card of cards) {
        card._packDir = path.join(cardDataRoot, entry.name);
      }
      _allCards.push(...cards);
    } catch (_) {}
  }
  return _allCards;
}

function findImagePath(card) {
  const dir = card._packDir;
  if (!dir || !fs.existsSync(dir)) return null;

  const pos = card.position;
  if (!pos) return null;

  const files = fs.readdirSync(dir);

  // Try zero-padded variants: 1, 01, 001, 0001
  const padded = [
    String(pos),
    String(pos).padStart(2, '0'),
    String(pos).padStart(3, '0'),
    String(pos).padStart(4, '0'),
  ];

  for (const prefix of padded) {
    const match = files.find(f => f.startsWith(prefix + '_') && /\.(png|jpg|jpeg)$/i.test(f));
    if (match) return path.join(dir, match);
  }

  // fallback: match by code number
  const codeNum = String(parseInt(card.code, 10));
  const match2 = files.find(f => f.startsWith(codeNum + '_') && /\.(png|jpg|jpeg)$/i.test(f));
  if (match2) return path.join(dir, match2);

  return null;
}

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCard(query, opts = {}) {
  const cards = loadAllCards();
  const q = normalize(query);

  // Filter by type if requested
  let pool = cards;
  if (opts.typeCode) pool = cards.filter(c => c.type_code === opts.typeCode);
  if (opts.packCode) pool = cards.filter(c => c.pack_code === opts.packCode);

  // Exact code match
  let found = pool.find(c => c.code === query);
  if (found) return { card: found, imagePath: findImagePath(found) };

  // Exact name match
  found = pool.find(c => normalize(c.name) === q);
  if (found) return { card: found, imagePath: findImagePath(found) };

  // Partial name match
  const partials = pool.filter(c => normalize(c.name).includes(q));
  if (partials.length > 0) {
    // prefer shorter name (closer match)
    partials.sort((a, b) => a.name.length - b.name.length);
    return { card: partials[0], imagePath: findImagePath(partials[0]) };
  }

  return null;
}

function findCardByCode(code) {
  const cards = loadAllCards();
  const card = cards.find(c => c.code === code);
  if (!card) return null;
  return { card, imagePath: findImagePath(card) };
}

function findInvestigator(query) {
  return findCard(query, { typeCode: 'investigator' });
}

// Returns the starting charge count for a card, or 0 if it has none.
// Reads the full cards.json (which has "text") to parse "Uses (N charges)."
function getCardCharges(cardCode) {
  if (!fs.existsSync(cardDataRoot)) return 0;
  const entries = fs.readdirSync(cardDataRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(cardDataRoot, entry.name, 'cards.json');
    if (!fs.existsSync(fullPath)) continue;
    try {
      const cards = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const card = cards.find(c => c.code === cardCode);
      if (!card) continue;
      const match = card.text?.match(/Uses \((\d+) charges?\)/i);
      if (match) return parseInt(match[1], 10);
      return 0;
    } catch (_) {}
  }
  return 0;
}

function invalidateCache() {
  _allCards = null;
}

module.exports = { findCard, findCardByCode, findInvestigator, loadAllCards, invalidateCache, fetchLocationBackImage, getCardCharges };
