const { getPlayerById, updatePlayer, getLocation, updateLocation, getSession, updateSession } = require('./gameState');
const { drawCards } = require('./deck');
const { drawEncounterCard, postEncounterCard } = require('./encounterEngine');

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
    case 'discover_clues': {
      if (effect.target === 'self_location') {
        const loc = getLocation(session.id, fresh.location_code);
        if (loc) {
          const newClues = Math.max(0, loc.clues - effect.count);
          updateLocation(loc.id, { clues: newClues });
          return `🔎 Discovered ${effect.count} clue(s) at ${loc.name} (${newClues} remaining).`;
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
      updateSession(session.id, { doom: session.doom + effect.count });
      return `💀 +${effect.count} doom.`;
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
      return `🧠 Deal ${effect.count} horror — manual.`;
    }
    case 'deal_damage': {
      if (effect.target === 'self') {
        const newHp = Math.max(0, fresh.hp - effect.count);
        updatePlayer(player.id, { hp: newHp });
        return `🩸 Took ${effect.count}${effect.direct ? ' direct' : ''} damage.`;
      }
      return `🩸 Deal ${effect.count} damage — manual (target: ${effect.target}).`;
    }
    default:
      return `⚙️ Effect \`${effect.type}\` — resolve manually.`;
  }
}

module.exports = { execEffect };
