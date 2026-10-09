// commands/verify-approve.js
// /verify-approve: lets in a member who pressed "I'm under 13" by mistake (same as the Approve
// button on the staff alert). Use it if the alert was deleted, or from any channel.

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { approveAgeLock } = require('../utils/captcha');
const { getAgeLock } = require('../utils/ageLockStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-approve')
    .setDescription('Let in a member who said they were under 13 by mistake')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((opt) => opt.setName('user').setDescription('The member to approve').setRequired(true)),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Run this in a server.', flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('user');
    if (!getAgeLock(interaction.guild.id, user.id)) {
      return interaction.reply({ content: `${user.tag} isn't locked, so there's nothing to approve. They can verify normally.`, flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await approveAgeLock(interaction.guild, user.id, interaction.user);
    return interaction.editReply({ content: message });
  },
};