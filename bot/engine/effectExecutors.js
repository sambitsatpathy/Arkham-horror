const { getPlayerById, updatePlayer, getLocation, updateLocation, getSession, updateSession, getCampaign, getPlayers, addToThreatArea } = require('./gameState');
const { drawCards, discardCard } = require('./deck');
const { drawEncounterCard, postEncounterCard } = require('./encounterEngine');
const { updateLocationStatus } = require('./locationManager');

// Resolves an effect's count, scaling by active investigator count when the
// parser tagged it per_investigator.
function effectCount(effect) {
  const base = effect.count ?? 1;
  if (!effect.per_investigator) return base;
  const campaign = getCampaign();
  const n = campaign ? getPlayers(campaign.id).filter(p => !p.is_eliminated).length : 1;
  return base * Math.max(1, n);
}

// Applies fn to every active investigator at the reference player's location.
// Returns the affected investigator names for the summary line.
function applyToInvestigatorsAtLocation(refPlayer, fn) {
  const campaign = getCampaign();
  if (!campaign) { fn(refPlayer); return refPlayer.investigator_name; }
  const targets = getPlayers(campaign.id)
    .filter(p => !p.is_eliminated && p.location_code === refPlayer.location_code);
  for (const p of targets) fn(p);
  return targets.map(p => `**${p.investigator_name}**`).join(', ') || refPlayer.investigator_name;
}

async function execEffect(effect, ctx) {
  const { player, session, guild } = ctx;
  const fresh = getPlayerById(player.id);
  switch (effect.type) {
    case 'draw_cards': {
      drawCards(fresh, effect.count);
      return `🎴 Drew ${effect.count} card(s).`;
    }
    case 'gain_resources': {
      updatePlayer(player.id, { resources: fresh.resources + effect.count });
      return `💰 Gained ${effect.count} resource(s).`;
    }
    case 'lose_resources': {
      const lost = Math.min(fresh.resources, effect.count);
      updatePlayer(player.id, { resources: fresh.resources - lost });
      return `💸 Lost ${lost} resource(s) (${fresh.resources - lost} remaining).`;
    }
    case 'discard_all_resources': {
      updatePlayer(player.id, { resources: 0 });
      return `💸 All resources discarded.`;
    }
    case 'add_to_threat_area': {
      if (!ctx.cardCode) return `🔻 Add to threat area — manual (no card context).`;
      addToThreatArea(player.id, ctx.cardCode);
      return `🔻 Card added to your threat area.`;
    }
    case 'discard_cards': {
      if (!effect.random) return `🃏 Choose and discard ${effect.count} card(s) from your hand — manual.`;
      const discarded = [];
      for (let i = 0; i < effect.count; i++) {
        const p = getPlayerById(player.id);
        const hand = JSON.parse(p.hand || '[]');
        if (hand.length === 0) break;
        const code = hand[Math.floor(Math.random() * hand.length)];
        discardCard(p, code);
        discarded.push(code);
      }
      if (discarded.length === 0) return `🃏 No cards in hand to discard.`;
      const { findCardByCode } = require('./cardLookup');
      const names = discarded.map(c => findCardByCode(c)?.card.name || c).join(', ');
      return `🃏 Discarded ${discarded.length} random card(s): ${names}.`;
    }
    case 'discover_clues': {
      if (effect.target === 'self_location') {
        const loc = getLocation(session.id, fresh.location_code);
        if (loc) {
          const cluesGained = Math.min(effect.count, loc.clues);
          const newLocClues = loc.clues - cluesGained;
          updateLocation(loc.id, { clues: newLocClues });
          updatePlayer(player.id, { clues: fresh.clues + cluesGained });
          const refreshed = getLocation(session.id, fresh.location_code);
          try { await updateLocationStatus(guild, session, refreshed); } catch (e) { console.warn('updateLocationStatus failed:', e.message); }
          return `🔎 Discovered ${cluesGained} clue(s) at ${loc.name} (${newLocClues} remaining).`;
        }
      }
      return `🔎 Discover ${effect.count} clue(s) — manual.`;
    }
    case 'draw_encounter_card': {
      const session2 = getSession();
      const code = drawEncounterCard(session2);
      if (!code) return `📜 Encounter deck empty.`;
      const ch = guild.channels.cache.get(session2.encounter_channel_id);
      if (ch) await postEncounterCard(ch, code);
      return `📜 Drew encounter card \`${code}\`.`;
    }
    case 'add_doom': {
      const n = effectCount(effect);
      const freshSession = getSession();
      updateSession(session.id, { doom: freshSession.doom + n });
      return `💀 +${n} doom${effect.per_investigator ? ' (scaled per investigator)' : ''}.`;
    }
    case 'heal_horror': {
      const newSan = Math.min(fresh.max_sanity, fresh.sanity + effect.count);
      updatePlayer(player.id, { sanity: newSan });
      return `💚 Healed ${effect.count} horror.`;
    }
    case 'heal_damage': {
      const newHp = Math.min(fresh.max_hp, fresh.hp + effect.count);
      updatePlayer(player.id, { hp: newHp });
      return `❤️ Healed ${effect.count} damage.`;
    }
    case 'deal_horror': {
      if (effect.target === 'self') {
        const newSan = Math.max(0, fresh.sanity - effect.count);
        updatePlayer(player.id, { sanity: newSan });
        return `🧠 Took ${effect.count}${effect.direct ? ' direct' : ''} horror.`;
      }
      if (effect.target === 'all_investigators_at_location') {
        const names = applyToInvestigatorsAtLocation(fresh, p => {
          updatePlayer(p.id, { sanity: Math.max(0, p.sanity - effect.count) });
        });
        return `🧠 ${effect.count} horror to each investigator here: ${names}.`;
      }
      return `🧠 Deal ${effect.count} horror — manual.`;
    }
    case 'deal_damage': {
      if (effect.target === 'self') {
        const newHp = Math.max(0, fresh.hp - effect.count);
        updatePlayer(player.id, { hp: newHp });
        return `🩸 Took ${effect.count}${effect.direct ? ' direct' : ''} damage.`;
      }
      if (effect.target === 'all_investigators_at_location') {
        const names = applyToInvestigatorsAtLocation(fresh, p => {
          updatePlayer(p.id, { hp: Math.max(0, p.hp - effect.count) });
        });
        return `🩸 ${effect.count} damage to each investigator here: ${names}.`;
      }
      return `🩸 Deal ${effect.count} damage — manual (target: ${effect.target}).`;
    }
    default:
      return `⚙️ Effect \`${effect.type}\` — resolve manually.`;
  }
}

module.exports = { execEffect, effectCount };
