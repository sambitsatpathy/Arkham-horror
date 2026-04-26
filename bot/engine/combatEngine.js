const { drawToken, displayToken } = require('./chaosBag');

function resolveSkillTest(skillValue, tokenRaw, modifiers = 0) {
  const isSpecial = ['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign'].includes(tokenRaw);
  let numericMod = 0;

  if (!isSpecial) {
    numericMod = parseInt(tokenRaw, 10) || 0;
  }

  const totalModifier = numericMod + modifiers;
  const effectiveSkill = skillValue + totalModifier;

  return {
    token: tokenRaw,
    display: displayToken(tokenRaw),
    numericMod,
    totalModifier,
    effectiveSkill,
    isSpecial,
    isAutoFail: tokenRaw === 'auto_fail',
    isElderSign: tokenRaw === 'elder_sign',
  };
}

function fightTest(investigatorCombat, enemyFight, difficulty, extraMods = 0) {
  const token = drawToken(difficulty);
  const result = resolveSkillTest(investigatorCombat, token, extraMods);
  const success = !result.isAutoFail && (result.isElderSign || result.effectiveSkill >= enemyFight);
  return { ...result, success, threshold: enemyFight };
}

function evadeTest(investigatorAgility, enemyEvade, difficulty, extraMods = 0) {
  const token = drawToken(difficulty);
  const result = resolveSkillTest(investigatorAgility, token, extraMods);
  const success = !result.isAutoFail && (result.isElderSign || result.effectiveSkill >= enemyEvade);
  return { ...result, success, threshold: enemyEvade };
}

module.exports = { resolveSkillTest, fightTest, evadeTest };
