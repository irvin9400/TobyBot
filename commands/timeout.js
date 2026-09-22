const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');
const { addCase } = require('../utils/caseStore');

// Discord's max timeout duration is 28 days.
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseDuration(input) {
  const match = /^(\d+)(m|h|d)$/i.exec(input.trim());
  if (!match) return null;
  const [, amount, unit] = match;
  return parseInt(amount, 10) * UNIT_MS[unit.toLowerCase()];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time out a member (e.g. 10m, 1h, 1d)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to time out').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('duration').setDescription('Duration, e.g. 10m, 1h, 1d').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for the timeout').setRequired(false)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.reply({ content: 'Invalid duration. Use formats like `10m`, `1h`, or `1d`.', flags: MessageFlags.Ephemeral });
    }
    if (durationMs > MAX_TIMEOUT_MS) {
      return interaction.reply({ content: 'Timeouts cannot exceed 28 days.', flags: MessageFlags.Ephemeral });
    }
    if (!target) {
      return interaction.reply({ content: 'Could not find that member in this server.', flags: MessageFlags.Ephemeral });
    }
    if (!target.moderatable) {
      return interaction.reply({ content: "I can't time out that member (check role hierarchy).", flags: MessageFlags.Ephemeral });
    }

    await target.timeout(durationMs, reason);

    const record = addCase(interaction.guildId, {
      userId: target.user.id,
      userTag: target.user.tag,
      moderatorTag: interaction.user.tag,
      action: 'timeout',
      reason,
      extra: { Duration: durationStr },
    });

    await logAction(interaction.client, {
      source: 'discord',
      action: 'timeout',
      moderator: interaction.user.tag,
      target: target.user.tag,
      reason,
      extra: { Duration: durationStr },
      caseNumber: record.case,
    });

    await interaction.reply({ content: `✅ Timed out **${target.user.tag}** for ${durationStr}. (Case #${record.case})`, flags: MessageFlags.Ephemeral });
  },
};