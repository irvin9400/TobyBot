const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { buildPanelMessage, buildNoticeMessage } = require('../utils/captcha');
const settings = require('../utils/guildSettings');

// Posts the verification messages again: the "read before you verify" notice, then the Verify
// panel (the 13+ confirmation and the code box come up when someone clicks Verify).
// /setup posts these too. Use this one to repost them, or to put them in another channel,
// without changing any settings.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Post the verification notice and Verify button (13+ confirmation, then a code)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to post them in (defaults to this one)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false))
    .addBooleanOption((opt) =>
      opt.setName('notice').setDescription('Also post the "read before you verify" notice above it (default: yes)').setRequired(false)),

  async execute(interaction) {
    if (!settings.verifiedRoleId(interaction.guild)) {
      return interaction.reply({
        content: "This server doesn't have a verified role yet. Run `/setup` first: it sets the role and posts these messages for you.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: 'Pick a text channel.', flags: MessageFlags.Ephemeral });
    }
    const withNotice = interaction.options.getBoolean('notice') !== false;

    try {
      if (withNotice) await channel.send(buildNoticeMessage());
      await channel.send(buildPanelMessage());
    } catch (err) {
      console.error('[verify-setup] Failed to post:', err);
      return interaction.reply({
        content: `I couldn't post in ${channel}. Check I have View Channel, Send Messages and Embed Links there.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `Posted ${withNotice ? 'the notice and ' : ''}the Verify button in ${channel}. You can delete the old ones: their buttons keep working, but their wording is out of date.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};