const fs = require('fs');
const path = require('path');

let _effects = null;

function loadEffects() {
  if (_effects) return _effects;
  const file = process.env.CARD_EFFECTS_PATH || path.join(__dirname, '..', 'data', 'card_effects.json');
  if (!fs.existsSync(file)) {
    _effects = {};
    return _effects;
  }
  try {
    _effects = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    _effects = {};
  }
  return _effects;
}

function getEntry(code) {
  return loadEffects()[code] || null;
}

function passiveCardCodes(player) {
  const assets = JSON.parse(player.assets || '[]');
  const threat = JSON.parse(player.threat_area || '[]');
  const assetCodes = assets.map(a => typeof a === 'string' ? a : a?.code).filter(Boolean);
  const threatCodes = threat.map(t => typeof t === 'string' ? t : t?.code).filter(Boolean);
  return [...assetCodes, ...threatCodes];
}

function passiveApplies(passive, ctx) {
  if (!passive.condition) return true;
  if (passive.condition === 'while_investigating') return !!ctx.investigating;
  if (passive.condition === 'while_engaged_only_enemy') return !!ctx.engaged_only_enemy;
  if (passive.condition === 'while_no_clues') return !!ctx.no_clues;
  if (passive.condition === 'while_5_or_more_cards_in_hand') return !!ctx.five_plus_cards;
  return false;
}

function getEffectiveStat(player, stat, ctx, investigator) {
  const base = (investigator?.skills?.[stat]) ?? 0;
  let total = base;
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const p of (entry.passive || [])) {
      if (!passiveApplies(p, ctx || {})) continue;
      if (p.type === 'stat_bonus' && (p.stat === stat || p.stat === 'all')) total += p.value;
      if (p.type === 'stat_penalty' && (p.stat === stat || p.stat === 'all')) total -= p.value;
    }
  }
  return total;
}

function getEffectiveActions(player) {
  let total = 3;
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const p of (entry.passive || [])) {
      if (p.type === 'extra_actions') total += p.value;
    }
  }
  return total;
}

function getEffectiveHandSize(player) {
  let total = 8;
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const p of (entry.passive || [])) {
      if (p.type === 'hand_size_bonus') total += p.value;
    }
  }
  return total;
}

function resolveOnSuccess(committedCodes) {
  const out = [];
  for (const code of committedCodes) {
    const entry = getEntry(code);
    if (!entry) continue;
    out.push(...(entry.on_success || []));
  }
  return out;
}

function resolveOnPlay(code) {
  const entry = getEntry(code);
  if (!entry) return { effects: [], needs_targets: [], fast: false, conditions: [], unparsed: '' };
  const needsTargets = [];
  (entry.effects || []).forEach((eff, i) => {
    if (typeof eff.target === 'string' && eff.target.startsWith('chosen_')) {
      needsTargets.push({ effect_index: i, target: eff.target });
    }
  });
  return {
    effects: entry.effects || [],
    needs_targets: needsTargets,
    fast: !!entry.fast,
    conditions: entry.conditions || [],
    unparsed: entry.unparsed_text || '',
  };
}

function fireTriggers(player, eventName) {
  const out = [];
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const trig of (entry.triggers || [])) {
      if (trig.event === eventName) {
        out.push({ source: code, source_name: entry.name, effects: trig.effects || [] });
      }
    }
  }
  return out;
}

function _resetForTests() { _effects = null; }

module.exports = {
  getEntry,
  getEffectiveStat,
  getEffectiveActions,
  getEffectiveHandSize,
  resolveOnSuccess,
  resolveOnPlay,
  fireTriggers,
  _resetForTests,
};
