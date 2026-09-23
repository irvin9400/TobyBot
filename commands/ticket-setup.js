const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPanelMessage } = require('../utils/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Post the "Open Ticket" panel in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('Channel to post the panel in (defaults to this one)').setRequired(false)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: 'Pick a text channel.', flags: MessageFlags.Ephemeral });
    }

    await channel.send(buildPanelMessage());
    await interaction.reply({ content: `Posted the ticket panel in ${channel}.`, flags: MessageFlags.Ephemeral });
  },
};