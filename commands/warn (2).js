const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Log a warning against a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for the warning').setRequired(true)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    await logAction(interaction.client, {
      source: 'discord',
      action: 'warn',
      moderator: interaction.user.tag,
      target: user.tag,
      reason,
    });

    // Best-effort DM notice; ignore if the user has DMs closed.
    await user.send(`You have been warned in **${interaction.guild.name}**. Reason: ${reason}`).catch(() => {});

    await interaction.reply({ content: `✅ Warned **${user.tag}**.`, flags: MessageFlags.Ephemeral });
  },
};
