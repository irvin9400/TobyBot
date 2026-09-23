const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, addBalance } = require('../utils/economyStore');

// Weighted so the rarer symbols pay more but come up less often
const SYMBOLS = [
  { emoji: '🍒', weight: 40 },
  { emoji: '🍋', weight: 30 },
  { emoji: '🍇', weight: 15 },
  { emoji: '💎', weight: 10 },
  { emoji: '7️⃣', weight: 5 },
];
const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

// Payout multiplier for three matching symbols
const PAYOUTS = { '🍒': 2, '🍋': 3, '🍇': 5, '💎': 10, '7️⃣': 25 };
const TWO_MATCH_MULTIPLIER = 1; // any two matching: bet back, no net loss

function spinReel() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const symbol of SYMBOLS) {
    if (roll < symbol.weight) return symbol.emoji;
    roll -= symbol.weight;
  }
  return SYMBOLS[0].emoji;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slot machine')
    .addIntegerOption((opt) => opt.setName('amount').setDescription('How many coins to bet').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const balance = getBalance(interaction.guildId, interaction.user.id);

    if (amount > balance) {
      return interaction.reply({ content: `You only have **${balance.toLocaleString()}** coins.`, flags: MessageFlags.Ephemeral });
    }

    const reels = [spinReel(), spinReel(), spinReel()];
    const allThreeMatch = reels[0] === reels[1] && reels[1] === reels[2];
    const anyTwoMatch = reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2];

    let multiplier = 0;
    let resultLine;
    if (allThreeMatch) {
      multiplier = PAYOUTS[reels[0]];
      resultLine = `🎉 **JACKPOT!** Three ${reels[0]} — you won **${(amount * multiplier).toLocaleString()}** coins!`;
    } else if (anyTwoMatch) {
      multiplier = TWO_MATCH_MULTIPLIER;
      resultLine = `Two matched — you got your **${amount.toLocaleString()}** coins back.`;
    } else {
      resultLine = `No match — you lost **${amount.toLocaleString()}** coins.`;
    }

    const netChange = amount * multiplier - amount;
    const newBalance = addBalance(interaction.guildId, interaction.user.id, netChange);

    await interaction.reply({
      content: `[ ${reels.join(' | ')} ]\n${resultLine}\nBalance: **${newBalance.toLocaleString()}**`,
    });
  },
};