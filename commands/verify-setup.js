const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPanelMessage } = require('../utils/captcha');
const settings = require('../utils/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Post the "Verify" panel new members use to get access')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('Channel to post the panel in (defaults to this one)').setRequired(false)),

  async execute(interaction) {
    if (!settings.verifiedRoleId(interaction.guild)) {
      return interaction.reply({
        content: "This server doesn't have a verified role yet. Run `/setup` first: it sets the role and posts the panel for you.",
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