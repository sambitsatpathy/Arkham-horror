const { getDb } = require('../db/database');
const { getSession, updateSession } = require('./gameState');
const { findCardByCode } = require('./cardLookup');
const { AttachmentBuilder } = require('discord.js');

function buildEncounterDeck(encounterSets, allCards) {
  const codes = [];
  for (const setCode of encounterSets) {
    const setCards = allCards.filter(c =>
      c.encounter_code === setCode &&
      !['scenario', 'act', 'agenda', 'location', 'investigator'].includes(c.type_code)
    );
    for (const card of setCards) {
      const qty = card.quantity || 1;
      for (let i = 0; i < qty; i++) codes.push(card.code);
    }
  }
  return codes;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawEncounterCard(session) {
  let deck = JSON.parse(session.encounter_deck);
  let discard = JSON.parse(session.encounter_discard);

  if (deck.length === 0) {
    if (discard.length === 0) return null;
    deck = shuffle(discard);
    discard = [];
  }

  const code = deck.shift();
  discard.push(code);

  updateSession(session.id, {
    encounter_deck: JSON.stringify(deck),
    encounter_discard: JSON.stringify(discard),
  });

  return code;
}

async function postEncounterCard(channel, cardCode) {
  const result = findCardByCode(cardCode);
  if (!result) {
    await channel.send(`⚠️ Encounter card \`${cardCode}\` — image not found.`);
    return null;
  }

  const { card, imagePath } = result;
  const typeLabel = card.type_code.charAt(0).toUpperCase() + card.type_code.slice(1);

  if (imagePath) {
    const attachment = new AttachmentBuilder(imagePath, { name: 'encounter.png' });
    await channel.send({
      content: `🃏 **${card.name}** *(${typeLabel})*`,
      files: [attachment],
    });
  } else {
    await channel.send(`🃏 **${card.name}** *(${typeLabel})* — ⚠️ Image not found`);
  }

  return card;
}

module.exports = { buildEncounterDeck, drawEncounterCard, postEncounterCard, shuffle };
