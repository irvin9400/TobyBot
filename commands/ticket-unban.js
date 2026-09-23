const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasModRole } = require('../utils/permissions');
const { unbanFromTickets } = require('../utils/ticketStore');
const { logAction } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-unban')
    .setDescription('Let a user open tickets again')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) => opt.setName('user').setDescription('Who to unban from opening tickets').setRequired(true)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user');
    const removed = unbanFromTickets(interaction.guildId, user.id);

    if (!removed) {
      return interaction.reply({ content: `**${user.tag}** isn't banned from opening tickets.`, flags: MessageFlags.Ephemeral });
    }

    await logAction(interaction.client, {
      source: 'discord',
      action: 'ticket-unban',
      moderator: interaction.user.tag,
      target: user.tag,
    });

    await interaction.reply({ content: `✅ **${user.tag}** can open tickets again.` });
  },
};