const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost, getCampaign, getPlayers, getSession, updateSession, updatePlayer, addCampaignLog, getDb } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endscenario')
    .setDescription('End the current scenario. Host only.')
    .addStringOption(opt =>
      opt.setName('result')
        .setDescription('victory or defeat')
        .setRequired(true)
        .addChoices({ name: 'victory', value: 'victory' }, { name: 'defeat', value: 'defeat' })),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    requireHost(interaction);

    const result = interaction.options.getString('result');
    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    const db = require('../../db/database').getDb();

    // Calculate XP
    const defeatedEnemies = db.prepare(
      'SELECT COUNT(*) as n FROM campaign_log WHERE campaign_id = ? AND scenario_code = ? AND entry LIKE ?'
    ).get(campaign.id, session.scenario_code, '%defeated%');
    const baseXp = result === 'victory' ? 2 : 0;
    const enemyXp = defeatedEnemies?.n || 0;
    const totalXp = baseXp + enemyXp;

    // Apply trauma and XP, reset per-scenario state
    for (const p of players) {
      const physTrauma = p.hp <= 0 ? 1 : 0;
      const mentTrauma = p.sanity <= 0 ? 1 : 0;
      updatePlayer(p.id, {
        xp_total: p.xp_total + totalXp,
        physical_trauma: p.physical_trauma + physTrauma,
        mental_trauma: p.mental_trauma + mentTrauma,
        is_eliminated: 0,
        hp: Math.max(1, p.max_hp - (p.physical_trauma + physTrauma)),
        sanity: Math.max(1, p.max_sanity - (p.mental_trauma + mentTrauma)),
        resources: 5,
        clues: 0,
        hand: '[]',
        discard: '[]',
      });
    }

    // Log scenario result
    addCampaignLog(campaign.id, session.scenario_code, `Scenario ended in ${result}.`);
    if (totalXp > 0) addCampaignLog(campaign.id, session.scenario_code, `Each investigator earned ${totalXp} XP.`);

    // Advance campaign scenario index
    db.prepare('UPDATE campaign SET scenario_index = scenario_index + 1 WHERE id = ?').run(campaign.id);
    updateSession(session.id, { phase: 'end' });

    const pregame = interaction.guild.channels.cache.find(c => c.name === 'pregame');
    const lines = [
      `# Scenario ${result === 'victory' ? '✅ Victory' : '❌ Defeat'}: ${session.scenario_code.replace(/_/g, ' ').replace(/\d+ /g, '')}`,
      '',
      `**XP earned:** ${totalXp} per investigator (base: ${baseXp}, enemies: ${enemyXp})`,
      '',
      '**Investigator summary:**',
      ...players.map(p => {
        const pt = p.hp <= 0 ? ' +1 Physical Trauma' : '';
        const mt = p.sanity <= 0 ? ' +1 Mental Trauma' : '';
        return `• **${p.investigator_name}**: XP ${p.xp_total + totalXp}${pt}${mt}`;
      }),
      '',
      'Use `/upgrade` to spend XP, then `/startgame` for the next scenario.',
    ];

    if (pregame) await pregame.send(lines.join('\n'));
    await interaction.reply(`✅ Scenario ended (${result}). Summary posted in #pregame.`);
  },
};
