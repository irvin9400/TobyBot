const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { buildButtons, createGame } = require('../utils/rps');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play Rock Paper Scissors — against a friend, or the bot')
    .addUserOption((opt) =>
      opt.setName('opponent').setDescription('Challenge someone (leave blank to play against the bot)').setRequired(false)),

  async execute(interaction) {
    const opponent = interaction.options.getUser('opponent');

    if (opponent) {
      if (opponent.id === interaction.user.id) {
        return interaction.reply({ content: "You can't challenge yourself.", flags: MessageFlags.Ephemeral });
      }
      if (opponent.bot) {
        return interaction.reply({ content: "You can't challenge a bot — run /rps with no opponent to play against me directly.", flags: MessageFlags.Ephemeral });
      }
    }

    const gameId = interaction.id; // every interaction has a unique ID, perfect as a game ID too

    const embed = new EmbedBuilder()
      .setTitle('🪨📄✂️ Rock Paper Scissors')
      .setDescription(
        opponent
          ? `${interaction.user} challenged ${opponent} to Rock Paper Scissors! Both of you pick a move below — it stays secret until you've both picked.`
          : `${interaction.user} is playing against the bot. Pick your move!`
      )
      .setColor(0x5865f2);

    await interaction.reply({ embeds: [embed], components: buildButtons(gameId) });
    const message = await interaction.fetchReply();

    createGame({
      gameId,
      challengerId: interaction.user.id,
      opponentId: opponent ? opponent.id : null,
      message,
    });
  },
};