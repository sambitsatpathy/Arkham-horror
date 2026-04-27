const { getDb } = require('../db/database');
const { updatePlayer } = require('./gameState');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCards(player, count = 1) {
  let deck = JSON.parse(player.deck);
  let hand = JSON.parse(player.hand);
  let discard = JSON.parse(player.discard);
  const drawn = [];

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      deck = shuffle(discard);
      discard = [];
    }
    drawn.push(deck.shift());
  }

  hand.push(...drawn);
  updatePlayer(player.id, {
    deck: JSON.stringify(deck),
    hand: JSON.stringify(hand),
    discard: JSON.stringify(discard),
  });

  return drawn;
}

function playCard(player, cardCode) {
  let hand = JSON.parse(player.hand);
  const idx = hand.indexOf(cardCode);
  if (idx === -1) return false;
  hand.splice(idx, 1);
  updatePlayer(player.id, { hand: JSON.stringify(hand) });
  return true;
}

function discardCard(player, cardCode) {
  let hand = JSON.parse(player.hand);
  let discard = JSON.parse(player.discard);
  const idx = hand.indexOf(cardCode);
  if (idx === -1) return false;
  hand.splice(idx, 1);
  discard.push(cardCode);
  updatePlayer(player.id, { hand: JSON.stringify(hand), discard: JSON.stringify(discard) });
  return true;
}

function initDeck(player, deckCodes) {
  const shuffled = shuffle(deckCodes);
  updatePlayer(player.id, {
    deck: JSON.stringify(shuffled),
    hand: JSON.stringify([]),
    discard: JSON.stringify([]),
  });
}

function reshuffleDeck(player) {
  const deck = JSON.parse(player.deck);
  const discard = JSON.parse(player.discard);
  const full = shuffle([...deck, ...discard]);
  updatePlayer(player.id, {
    deck: JSON.stringify(full),
    discard: JSON.stringify([]),
  });
}

// Move card from hand to in-play assets area with optional starting charges
function playAsset(player, cardCode, cardName, charges = 0) {
  let hand = JSON.parse(player.hand);
  const idx = hand.indexOf(cardCode);
  if (idx === -1) return false;
  hand.splice(idx, 1);

  const assets = JSON.parse(player.assets || '[]');
  assets.push({ code: cardCode, name: cardName, charges, exhausted: false });

  updatePlayer(player.id, { hand: JSON.stringify(hand), assets: JSON.stringify(assets) });
  return true;
}

// Spend one charge from an in-play asset. Returns new charge count, or -1 if not found / already empty.
function useCharge(player, assetCode) {
  const assets = JSON.parse(player.assets || '[]');
  const asset = assets.find(a => a.code === assetCode);
  if (!asset || asset.charges <= 0) return -1;
  asset.charges -= 1;

  let discard = JSON.parse(player.discard);
  if (asset.charges === 0) {
    // Remove from play, send to discard
    const filtered = assets.filter(a => a.code !== assetCode);
    discard.push(assetCode);
    updatePlayer(player.id, { assets: JSON.stringify(filtered), discard: JSON.stringify(discard) });
  } else {
    updatePlayer(player.id, { assets: JSON.stringify(assets) });
  }
  return asset.charges;
}

// Discard an asset from play directly
function discardAsset(player, assetCode) {
  const assets = JSON.parse(player.assets || '[]');
  const filtered = assets.filter(a => a.code !== assetCode);
  if (filtered.length === assets.length) return false;
  let discard = JSON.parse(player.discard);
  discard.push(assetCode);
  updatePlayer(player.id, { assets: JSON.stringify(filtered), discard: JSON.stringify(discard) });
  return true;
}

// Commit one card from hand to a test — moves to discard
function commitCard(player, cardCode) {
  let hand = JSON.parse(player.hand);
  const idx = hand.indexOf(cardCode);
  if (idx === -1) return false;
  hand.splice(idx, 1);
  let discard = JSON.parse(player.discard);
  discard.push(cardCode);
  updatePlayer(player.id, { hand: JSON.stringify(hand), discard: JSON.stringify(discard) });
  return true;
}

// Commit multiple cards from hand to a test in a single DB write.
// Returns array of codes that were actually in hand (silently skips missing ones).
function commitCards(player, cardCodes) {
  let hand = JSON.parse(player.hand);
  let discard = JSON.parse(player.discard);
  const committed = [];
  for (const code of cardCodes) {
    const idx = hand.indexOf(code);
    if (idx === -1) continue;
    hand.splice(idx, 1);
    discard.push(code);
    committed.push(code);
  }
  if (committed.length > 0) {
    updatePlayer(player.id, { hand: JSON.stringify(hand), discard: JSON.stringify(discard) });
  }
  return committed;
}

module.exports = { drawCards, playCard, discardCard, playAsset, useCharge, discardAsset, commitCard, commitCards, initDeck, reshuffleDeck, shuffle };
