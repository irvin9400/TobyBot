const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { logAction } = require('../utils/logger');
const { hasModRole } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub.setName('add')
        .setDescription('Add a role to a member')
        .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to add').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('remove')
        .setDescription('Remove a role from a member')
        .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to remove').setRequired(true))),

  async execute(interaction) {
    if (!hasModRole(interaction)) {
      return interaction.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const role = interaction.options.getRole('role');
    const sub = interaction.options.getSubcommand();

    if (!target) {
      return interaction.reply({ content: 'Could not find that member in this server.', flags: MessageFlags.Ephemeral });
    }

    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({ content: "I can't manage that role (it's above or equal to my highest role).", flags: MessageFlags.Ephemeral });
    }

    if (sub === 'add') {
      await target.roles.add(role);
      await logAction(interaction.client, {
        source: 'discord',
        action: 'role',
        moderator: interaction.user.tag,
        target: target.user.tag,
        extra: { Role: role.name, Change: 'Added' },
      });
      return interaction.reply({ content: `✅ Added **${role.name}** to **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    // remove
    await target.roles.remove(role);
    await logAction(interaction.client, {
      source: 'discord',
      action: 'role',
      moderator: interaction.user.tag,
      target: target.user.tag,
      extra: { Role: role.name, Change: 'Removed' },
    });
    return interaction.reply({ content: `✅ Removed **${role.name}** from **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
  },
};
