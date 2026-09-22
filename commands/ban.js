const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');
const { addCase } = require('../utils/caseStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for the ban').setRequired(false))
    .addIntegerOption((opt) =>
      opt.setName('delete_days')
        .setDescription('Days of message history to delete (0-7)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') || 0;

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) {
      return interaction.reply({ content: "I can't ban that member (check role hierarchy).", flags: MessageFlags.Ephemeral });
    }

    await interaction.guild.bans.create(user.id, {
      reason,
      deleteMessageSeconds: deleteDays * 86400,
    });

    const record = addCase(interaction.guildId, {
      userId: user.id,
      userTag: user.tag,
      moderatorTag: interaction.user.tag,
      action: 'ban',
      reason,
    });

    await logAction(interaction.client, {
      source: 'discord',
      action: 'ban',
      moderator: interaction.user.tag,
      target: user.tag,
      reason,
      caseNumber: record.case,
    });

    await interaction.reply({ content: `✅ Banned **${user.tag}**. (Case #${record.case})`, flags: MessageFlags.Ephemeral });
  },
};