const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { hasModRole } = require('../utils/permissions');
const { getCasesForUser } = require('../utils/caseStore');
const config = require('../config');

// Any of these permissions, or a role listed in MOD_ROLE_IDS, counts as "staff" for this display
const MOD_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];

function timestamp(ms) {
  const seconds = Math.floor(ms / 1000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription("Look up a member's account info, roles, and staff status")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('user').setDescription('Who to look up (defaults to you)').setRequired(false)),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setColor(member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : 0x5865f2)
      .addFields(
        { name: 'User ID', value: user.id, inline: true },
        { name: 'Bot account?', value: user.bot ? 'Yes' : 'No', inline: true },
      )
      .addFields({ name: 'Account created', value: timestamp(user.createdTimestamp) });

    if (member) {
      embed.addFields({ name: 'Joined this server', value: member.joinedTimestamp ? timestamp(member.joinedTimestamp) : 'Unknown' });

      if (member.nickname) {
        embed.addFields({ name: 'Nickname', value: member.nickname, inline: true });
      }
      if (member.premiumSinceTimestamp) {
        embed.addFields({ name: 'Boosting since', value: timestamp(member.premiumSinceTimestamp) });
      }

      const roles = member.roles.cache
        .filter((r) => r.id !== interaction.guild.id) // leave out @everyone
        .sort((a, b) => b.position - a.position);
      let roleText = roles.size > 0 ? roles.map((r) => r.toString()).join(' ') : '(none)';
      if (roleText.length > 1000) roleText = roleText.slice(0, 1000) + '...';
      embed.addFields({ name: `Roles (${roles.size})`, value: roleText });

      const isMod = MOD_PERMISSIONS.some((perm) => member.permissions.has(perm))
        || config.modRoleIds.some((id) => member.roles.cache.has(id));
      const isTicketSupport = config.ticketSupportRoleId && member.roles.cache.has(config.ticketSupportRoleId);

      const staffLines = [];
      if (isMod) staffLines.push('✅ Moderator/Admin');
      if (isTicketSupport) staffLines.push('🎫 Ticket support');
      if (staffLines.length === 0) staffLines.push('Regular member');
      embed.addFields({ name: 'Staff status', value: staffLines.join('\n') });
    } else {
      embed.addFields({ name: 'In this server?', value: "No — this is a Discord account, not a current member" });
    }

    // A quick tie-in with your moderation history — full detail still lives in /history
    const cases = getCasesForUser(interaction.guildId, user.id);
    embed.addFields({
      name: 'Moderation cases',
      value: cases.length > 0 ? `${cases.length} — use \`/history\` for details` : 'None on record',
    });

    embed.setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};