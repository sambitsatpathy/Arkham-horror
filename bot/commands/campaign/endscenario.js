const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost, getCampaign, getPlayers, getSession, updateSession, updatePlayer, addCampaignLog } = require('../../engine/gameState');
const { loadScenario } = require('../../engine/scenarioLoader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endscenario')
    .setDescription('End the current scenario. Host only.')
    .addStringOption(opt =>
      opt.setName('result')
        .setDescription('victory or defeat')
        .setRequired(true)
        .addChoices({ name: 'victory', value: 'victory' }, { name: 'defeat', value: 'defeat' }))
    .addStringOption(opt =>
      opt.setName('resolution')
        .setDescription('Resolution to read aloud (from scenario text)')
        .setRequired(false)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const session = getSession();
    if (!session) return interaction.respond([]);

    const scenario = loadScenario(session);
    if (!scenario?.resolutions) return interaction.respond([]);

    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.entries(scenario.resolutions)
      .filter(([, r]) => !focused || r.label.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(([key, r]) => ({ name: r.label, value: key }));

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();

    const result = interaction.options.getString('result');
    const resolutionKey = interaction.options.getString('resolution');
    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    const db = require('../../db/database').getDb();

    const scenario = loadScenario(session);

    const pregame = interaction.guild.channels.cache.find(c => c.name === 'pregame');

    // Post resolution narration first if provided
    if (resolutionKey && scenario?.resolutions?.[resolutionKey]) {
      const res = scenario.resolutions[resolutionKey];
      const resLines = [
        `## 📖 ${res.label}`,
        '',
        ...res.text.map(p => `*${p}*`),
      ];
      if (pregame) await pregame.send(resLines.join('\n'));
    }

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

    const lines = [
      `# Scenario ${result === 'victory' ? '✅ Victory' : '❌ Defeat'}: ${scenario?.name || session.scenario_code.replace(/_/g, ' ')}`,
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
    await interaction.editReply(`✅ Scenario ended (${result}). Summary posted in #pregame.`);
  },
};
