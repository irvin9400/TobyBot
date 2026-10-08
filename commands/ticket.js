// commands/ticket.js
// /ticket add and /ticket remove: bring someone into a ticket, or take them out again.
// Run it inside the ticket channel. Support team only.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { setTicketAccess } = require('../utils/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage who can see the ticket you are in')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Let another member see and talk in this ticket')
        .addUserOption((opt) => opt.setName('user').setDescription('Who to add').setRequired(true)))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Take a member out of this ticket')
        .addUserOption((opt) => opt.setName('user').setDescription('Who to remove').setRequired(true))),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Run this in a server.', flags: MessageFlags.Ephemeral });
    }
    const target = interaction.options.getUser('user');
    const adding = interaction.options.getSubcommand() === 'add';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await setTicketAccess(interaction, target, adding);
    return interaction.editReply({ content: message });
  },
};