const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, addBalance } = require('../utils/economyStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Bet coins on a coin flip — double or nothing')
    .addIntegerOption((opt) => opt.setName('amount').setDescription('How many coins to bet').setRequired(true).setMinValue(1))
    .addStringOption((opt) =>
      opt.setName('call').setDescription('Heads or tails').setRequired(true).addChoices(
        { name: 'Heads', value: 'heads' },
        { name: 'Tails', value: 'tails' },
      )),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const call = interaction.options.getString('call');
    const balance = getBalance(interaction.guildId, interaction.user.id);

    if (amount > balance) {
      return interaction.reply({ content: `You only have **${balance.toLocaleString()}** coins.`, flags: MessageFlags.Ephemeral });
    }

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === call;
    const newBalance = addBalance(interaction.guildId, interaction.user.id, won ? amount : -amount);

    const coinEmoji = result === 'heads' ? '🪙 Heads' : '🪙 Tails';
    const outcome = won
      ? `**${coinEmoji}** — you won **${amount.toLocaleString()}** coins!`
      : `**${coinEmoji}** — you lost **${amount.toLocaleString()}** coins.`;

    await interaction.reply({ content: `${outcome}\nBalance: **${newBalance.toLocaleString()}**` });
  },
};