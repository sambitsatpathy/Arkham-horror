const { SlashCommandBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const { requireSession, requireHost, updateSession, updatePlayer, getCampaign, getPlayers, getLocation } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');
const { revealLocation } = require('../../engine/locationManager');
const { loadScenario } = require('../../engine/scenarioLoader');
const { getDb } = require('../../db/database');

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
      const nextIndex = session.act_index + 1;
      if (nextIndex >= scenario.acts.length) {
        return interaction.editReply('No more acts to advance.');
      }

      updateSession(session.id, { act_index: nextIndex });
      const newAct = scenario.acts[nextIndex];

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
      const prevCat = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory && c.name.startsWith(prevCatName));
      if (prevCat) {
        await prevCat.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
      }
      const nextCat = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory && c.name.startsWith(nextCatName));
      if (nextCat) {
        await nextCat.permissionOverwrites.delete(interaction.guild.roles.everyone);
        await nextCat.setName(nextCat.name.replace('🔒', '🔍'));
      }

      const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
      if (doomCh) await doomCh.send(`📖 Act advanced: **${newAct.name}**`);

      // Auto-move all investigators if the act specifies a forced location
      if (newAct.move_investigators_to) {
        const campaign = getCampaign();
        const players = getPlayers(campaign.id).filter(p => !p.is_eliminated);
        const db = getDb();
        const locRow = db.prepare('SELECT * FROM locations WHERE session_id = ? AND code = ?')
          .get(session.id, newAct.move_investigators_to);

        if (locRow && locRow.status === 'hidden') {
          await revealLocation(interaction.guild, session, locRow, players);
        }

        for (const p of players) {
          updatePlayer(p.id, { location_code: newAct.move_investigators_to });
        }

        const locName = locRow?.name || newAct.move_investigators_to;
        if (doomCh) await doomCh.send(`📍 All investigators moved to **${locName}** as required by the act.`);
        return interaction.editReply(`✅ Act advanced to **${newAct.name}**. All investigators moved to **${locName}**.`);
      }

      return interaction.editReply(`✅ Act advanced to **${newAct.name}**.`);
    }

    if (type === 'agenda') {
      const nextIndex = session.agenda_index + 1;
      if (nextIndex >= scenario.agendas.length) {
        return interaction.editReply('💀 Final agenda reached — scenario defeat!');
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
      return interaction.editReply(`✅ Agenda advanced to **${newAgenda.name}**. Doom reset to 0/${newThreshold}.`);
    }
  },
};
