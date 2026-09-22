const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription('Manage a member\'s nickname')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addSubcommand((sub) =>
      sub.setName('set')
        .setDescription('Set a member\'s nickname')
        .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((opt) => opt.setName('nickname').setDescription('New nickname').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('reset')
        .setDescription('Reset a member\'s nickname')
        .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    if (!target) {
      return interaction.reply({ content: 'Could not find that member in this server.', flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    const oldNick = target.nickname || target.user.username;

    if (sub === 'set') {
      const newNick = interaction.options.getString('nickname');
      await target.setNickname(newNick);
      await logAction(interaction.client, {
        source: 'discord',
        action: 'nickname',
        moderator: interaction.user.tag,
        target: target.user.tag,
        extra: { From: oldNick, To: newNick },
      });
      return interaction.reply({ content: `✅ Set **${target.user.tag}**'s nickname to "${newNick}".`, flags: MessageFlags.Ephemeral });
    }

    // reset
    await target.setNickname(null);
    await logAction(interaction.client, {
      source: 'discord',
      action: 'nickname',
      moderator: interaction.user.tag,
      target: target.user.tag,
      extra: { From: oldNick, To: '(reset)' },
    });
    return interaction.reply({ content: `✅ Reset **${target.user.tag}**'s nickname.`, flags: MessageFlags.Ephemeral });
  },
};
