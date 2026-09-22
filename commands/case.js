const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasModRole } = require('../utils/permissions');
const { removeCase } = require('../utils/caseStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Manage moderation cases')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Permanently delete one case by number (does not undo a ban/timeout itself)')
        .addIntegerOption((opt) =>
          opt.setName('number').setDescription('The case number, from /history').setRequired(true))),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const number = interaction.options.getInteger('number');
    const removed = removeCase(interaction.guildId, number);

    if (!removed) {
      return interaction.reply({ content: `There's no case #${number} in this server's history.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.reply({
      content: `Removed case #${number} (**${removed.action.toUpperCase()}** on ${removed.userTag}). This only deletes the record — it doesn't lift a ban or timeout by itself.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};