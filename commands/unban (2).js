const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by their ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((opt) =>
      opt.setName('user_id').setDescription('Discord user ID to unban').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for the unban').setRequired(false)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      return interaction.reply({ content: 'That user is not currently banned.', flags: MessageFlags.Ephemeral });
    }

    await interaction.guild.bans.remove(userId, reason);

    await logAction(interaction.client, {
      source: 'discord',
      action: 'unban',
      moderator: interaction.user.tag,
      target: ban.user.tag,
      reason,
    });

    await interaction.reply({ content: `✅ Unbanned **${ban.user.tag}**.`, flags: MessageFlags.Ephemeral });
  },
};
