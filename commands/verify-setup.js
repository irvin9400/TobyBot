const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPanelMessage } = require('../utils/captcha');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Post the "Verify" panel new members use to get access')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('Channel to post the panel in (defaults to this one)').setRequired(false)),

  async execute(interaction) {
    if (!config.verifiedRoleId) {
      return interaction.reply({
        content: 'Set VERIFIED_ROLE_ID (and optionally UNVERIFIED_ROLE_ID) in your environment variables first.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: 'Pick a text channel.', flags: MessageFlags.Ephemeral });
    }

    await channel.send(buildPanelMessage());
    await interaction.reply({ content: `Posted the verify panel in ${channel}.`, flags: MessageFlags.Ephemeral });
  },
};