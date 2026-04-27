const fs = require('fs');
const path = require('path');
const { cardDataRoot } = require('../config');

const BACK_CACHE_DIR = path.join(__dirname, '../data/location_backs');

// Lazy cache of full cards.json data, keyed by card code.
// Loaded once on first access; covers all packs.
let _fullCards = null;

function loadFullCards() {
  if (_fullCards) return _fullCards;
  _fullCards = new Map();
  if (!fs.existsSync(cardDataRoot)) return _fullCards;
  const entries = fs.readdirSync(cardDataRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(cardDataRoot, entry.name, 'cards.json');
    if (!fs.existsSync(fullPath)) continue;
    try {
      const cards = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      for (const card of cards) _fullCards.set(card.code, card);
    } catch (_) {}
  }
  return _fullCards;
}

function findBackImageSrc(cardCode) {
  const card = loadFullCards().get(cardCode);
  return card?.backimagesrc ?? null;
}

async function fetchLocationBackImage(cardCode) {
  if (!fs.existsSync(BACK_CACHE_DIR)) fs.mkdirSync(BACK_CACHE_DIR, { recursive: true });

  const cachePath = path.join(BACK_CACHE_DIR, `${cardCode}b.png`);
  if (fs.existsSync(cachePath)) return cachePath;

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

  let pool = cards;
  if (opts.typeCode) pool = cards.filter(c => c.type_code === opts.typeCode);
  if (opts.packCode) pool = cards.filter(c => c.pack_code === opts.packCode);

  let found = pool.find(c => c.code === query);
  if (found) return { card: found, imagePath: findImagePath(found) };

  found = pool.find(c => normalize(c.name) === q);
  if (found) return { card: found, imagePath: findImagePath(found) };

  const partials = pool.filter(c => normalize(c.name).includes(q));
  if (partials.length > 0) {
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

// Returns starting charge count for a card, 0 if none.
function getCardCharges(cardCode) {
  const card = loadFullCards().get(cardCode);
  if (!card) return 0;
  const match = card.text?.match(/Uses \((\d+) charges?\)/i);
  return match ? parseInt(match[1], 10) : 0;
}

// Returns { intellect, combat, willpower, agility, wild } skill icon counts.
function getCardSkills(cardCode) {
  const card = loadFullCards().get(cardCode);
  if (!card) return { intellect: 0, combat: 0, willpower: 0, agility: 0, wild: 0 };
  return {
    intellect: card.skill_intellect || 0,
    combat:    card.skill_combat    || 0,
    willpower: card.skill_willpower || 0,
    agility:   card.skill_agility   || 0,
    wild:      card.skill_wild      || 0,
  };
}

function invalidateCache() {
  _allCards = null;
  _fullCards = null;
}

module.exports = { findCard, findCardByCode, findInvestigator, loadAllCards, invalidateCache, fetchLocationBackImage, getCardCharges, getCardSkills };
