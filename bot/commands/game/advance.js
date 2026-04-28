const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost } = require('../../engine/gameState');
const { advanceAgenda, advanceAct } = require('../../engine/advanceEngine');
const { loadScenario } = require('../../engine/scenarioLoader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('advance')
    .setDescription('Advance the act or agenda. Host only.')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('What to advance')
        .setRequired(true)
        .addChoices({ name: 'act', value: 'act' }, { name: 'agenda', value: 'agenda' })),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();

    const scenario = loadScenario(session);
    if (!scenario) {
      return interaction.editReply('❌ Scenario data not found. Check that the scenario file exists.');
    }

    const type = interaction.options.getString('type');

    if (type === 'act') {
      const result = await advanceAct(interaction.guild, session, scenario);
      if (result === 'no_more') return interaction.editReply('No more acts to advance.');
      const newAct = scenario.acts[session.act_index + 1];
      return interaction.editReply(`✅ Act advanced to **${newAct.name}**.`);
    }

    if (type === 'agenda') {
      const result = await advanceAgenda(interaction.guild, session, scenario);
      if (result === 'defeat') return interaction.editReply('💀 Final agenda reached — scenario defeat!');
      const newAgenda = scenario.agendas[session.agenda_index + 1];
      return interaction.editReply(`✅ Agenda advanced to **${newAgenda.name}**. Doom reset to 0/${newAgenda.doom_threshold}.`);
    }
  },
};
