const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getLastDaily, claimDaily, DAILY_AMOUNT, DAILY_COOLDOWN_MS } = require('../utils/economyStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily coins'),

  async execute(interaction) {
    const lastClaim = getLastDaily(interaction.guildId, interaction.user.id);
    const remaining = DAILY_COOLDOWN_MS - (Date.now() - lastClaim);

    if (remaining > 0) {
      const hours = Math.floor(remaining / 3_600_000);
      const minutes = Math.floor((remaining % 3_600_000) / 60_000);
      return interaction.reply({
        content: `You already claimed today's coins. Try again in ${hours}h ${minutes}m.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const newBalance = claimDaily(interaction.guildId, interaction.user.id);
    await interaction.reply({ content: `🪙 You claimed **${DAILY_AMOUNT}** coins! Balance: **${newBalance.toLocaleString()}**.` });
  },
};