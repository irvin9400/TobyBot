const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for the kick').setRequired(false)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({ content: 'Could not find that member in this server.', flags: MessageFlags.Ephemeral });
    }
    if (!target.kickable) {
      return interaction.reply({ content: "I can't kick that member (check role hierarchy).", flags: MessageFlags.Ephemeral });
    }

    await target.kick(reason);

    await logAction(interaction.client, {
      source: 'discord',
      action: 'kick',
      moderator: interaction.user.tag,
      target: target.user.tag,
      reason,
    });

    await interaction.reply({ content: `✅ Kicked **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
  },
};
