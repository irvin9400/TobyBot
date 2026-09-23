const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasModRole } = require('../utils/permissions');
const { banFromTickets } = require('../utils/ticketStore');
const { logAction } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-ban')
    .setDescription("Ban a user from opening tickets (doesn't remove them from the server)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) => opt.setName('user').setDescription('Who to ban from opening tickets').setRequired(true))
    .addStringOption((opt) => opt.setName('reason').setDescription('Shown to them if they try to open one').setRequired(false)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    banFromTickets(interaction.guildId, user.id, { reason, moderatorTag: interaction.user.tag });

    await logAction(interaction.client, {
      source: 'discord',
      action: 'ticket-ban',
      moderator: interaction.user.tag,
      target: user.tag,
      reason: reason || undefined,
    });

    await interaction.reply({ content: `✅ **${user.tag}** can no longer open tickets.`, flags: MessageFlags.Ephemeral });
  },
};