const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove an active timeout from a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to remove timeout from').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({ content: 'Could not find that member in this server.', flags: MessageFlags.Ephemeral });
    }

    await target.timeout(null, reason);

    await logAction(interaction.client, {
      source: 'discord',
      action: 'untimeout',
      moderator: interaction.user.tag,
      target: target.user.tag,
      reason,
    });

    await interaction.reply({ content: `✅ Removed timeout from **${target.user.tag}**.` });
  },
};