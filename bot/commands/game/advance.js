const { SlashCommandBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { requireSession, requireHost, getSession, updateSession, getCampaign, getPlayers } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');
const path = require('path');
const fs = require('fs');

function loadScenario(scenarioCode) {
  const filePath = path.join(__dirname, '../../data/scenarios/night_of_zealot', scenarioCode + '.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

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
    requireHost(interaction);

    const type = interaction.options.getString('type');
    const scenario = loadScenario(session.scenario_code);

    if (type === 'act') {
      const nextIndex = session.act_index + 1;
      if (nextIndex >= scenario.acts.length) {
        return interaction.reply({ content: 'No more acts to advance.', flags: 64 });
      }

      updateSession(session.id, { act_index: nextIndex });
      const newAct = scenario.acts[nextIndex];

      // Post new act card
      const actCh = interaction.guild.channels.cache.get(session.act_channel_id);
      if (actCh) {
        const result = findCardByCode(newAct.card_code);
        if (result?.imagePath) {
          const att = new AttachmentBuilder(result.imagePath, { name: 'act.png' });
          await actCh.send({ content: `📖 **Act ${nextIndex + 1}: ${newAct.name}**`, files: [att] });
        } else {
          await actCh.send(`📖 **Act ${nextIndex + 1}: ${newAct.name}**`);
        }
      }

      // Unlock next act category, lock previous
      const prevCatName = `🔍 ACT ${nextIndex} —`;
      const nextCatName = `🔒 ACT ${nextIndex + 1} —`;
      const prevCat = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.startsWith(prevCatName));
      if (prevCat) {
        await prevCat.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
      }
      const nextCat = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.startsWith(nextCatName));
      if (nextCat) {
        await nextCat.permissionOverwrites.delete(interaction.guild.roles.everyone);
        const newCatName = nextCat.name.replace('🔒', '🔍');
        await nextCat.setName(newCatName);
      }

      const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
      if (doomCh) await doomCh.send(`📖 Act advanced: **${newAct.name}**`);
      await interaction.reply(`✅ Act advanced to **${newAct.name}**.`);
    }

    else if (type === 'agenda') {
      const nextIndex = session.agenda_index + 1;
      if (nextIndex >= scenario.agendas.length) {
        return interaction.reply({ content: '💀 Final agenda reached — scenario defeat!',  });
      }

      const newAgenda = scenario.agendas[nextIndex];
      const newThreshold = newAgenda.doom_threshold;
      updateSession(session.id, { agenda_index: nextIndex, doom: 0, doom_threshold: newThreshold });

      const agendaCh = interaction.guild.channels.cache.get(session.agenda_channel_id);
      if (agendaCh) {
        const result = findCardByCode(newAgenda.card_code);
        if (result?.imagePath) {
          const att = new AttachmentBuilder(result.imagePath, { name: 'agenda.png' });
          await agendaCh.send({ content: `📋 **Agenda ${nextIndex + 1}: ${newAgenda.name}** — Doom: 0/${newThreshold}`, files: [att] });
        } else {
          await agendaCh.send(`📋 **Agenda ${nextIndex + 1}: ${newAgenda.name}** — Doom: 0/${newThreshold}`);
        }
      }

      const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
      if (doomCh) await doomCh.send(`⚠️ Agenda advanced: **${newAgenda.name}** — doom reset to 0/${newThreshold}`);
      await interaction.reply(`✅ Agenda advanced to **${newAgenda.name}**. Doom reset to 0/${newThreshold}.`);
    }
  },
};
