const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { hasModRole } = require('../utils/permissions');
const { getCasesForUser } = require('../utils/caseStore');

const ACTION_EMOJI = {
  warn: '⚠️',
  kick: '👋',
  ban: '🔨',
  timeout: '🔇',
  untimeout: '🔊',
  unban: '✅',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription("Show a member's moderation case history in this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Whose history to show').setRequired(true)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user');
    const cases = getCasesForUser(interaction.guildId, user.id);

    if (cases.length === 0) {
      return interaction.reply({ content: `**${user.tag}** has no cases on record here.`, flags: MessageFlags.Ephemeral });
    }

    // Newest first, and Discord embeds cap out around 25 fields / 6000 characters, so show the
    // most recent 20 and say how many older ones are being left out.
    const sorted = [...cases].sort((a, b) => b.timestamp - a.timestamp);
    const shown = sorted.slice(0, 20);

    const embed = new EmbedBuilder()
      .setTitle(`Case history for ${user.tag}`)
      .setColor(0x5865f2)
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ text: `${cases.length} case(s) total${cases.length > shown.length ? ` — showing the ${shown.length} most recent` : ''}` });

    for (const c of shown) {
      const emoji = ACTION_EMOJI[c.action] || '📄';
      const when = `<t:${Math.floor(c.timestamp / 1000)}:R>`;
      let value = `${when} · by ${c.moderatorTag}`;
      if (c.reason) value += `\n${c.reason}`;
      if (c.extra) {
        for (const [key, val] of Object.entries(c.extra)) {
          value += `\n${key}: ${val}`;
        }
      }
      embed.addFields({ name: `${emoji} Case #${c.case} — ${c.action.toUpperCase()}`, value });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};