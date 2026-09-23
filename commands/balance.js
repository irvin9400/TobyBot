const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance } = require('../utils/economyStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your (or someone else\'s) coin balance')
    .addUserOption((opt) => opt.setName('user').setDescription('Whose balance to check (defaults to you)').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const balance = getBalance(interaction.guildId, user.id);

    const embed = new EmbedBuilder()
      .setDescription(`🪙 **${user.tag}** has **${balance.toLocaleString()}** coins.`)
      .setColor(0xf5c400);

    await interaction.reply({ embeds: [embed] });
  },
};