const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');

const MOVES = { rock: '🪨 Rock', paper: '📄 Paper', scissors: '✂️ Scissors' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' }; // key beats value

const GAME_TIMEOUT_MS = 2 * 60 * 1000; // a game nobody finishes expires after 2 minutes

// In-memory only — a short-lived game being lost on a bot restart is a fine tradeoff, unlike the
// moderation data elsewhere in this bot that actually needs to survive one.
const games = new Map(); // gameId -> { challengerId, opponentId (null = vs the bot), choices, message, timeout }

function buildButtons(gameId, disabled) {
  const row = new ActionRowBuilder().addComponents(
    Object.entries(MOVES).map(([key, label]) =>
      new ButtonBuilder()
        .setCustomId(`rps:${gameId}:${key}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled === true)
    )
  );
  return [row];
}

function decideWinner(challengerMove, opponentMove) {
  if (challengerMove === opponentMove) return 'tie';
  return BEATS[challengerMove] === opponentMove ? 'challenger' : 'opponent';
}

function createGame({ gameId, challengerId, opponentId, message }) {
  const game = {
    challengerId,
    opponentId, // null means "vs the bot"
    choices: {},
    message,
  };

  game.timeout = setTimeout(() => {
    if (games.has(gameId)) {
      games.delete(gameId);
      message.edit({ content: '⌛ This game expired — nobody finished picking in time.', embeds: [], components: [] }).catch(() => {});
    }
  }, GAME_TIMEOUT_MS);

  games.set(gameId, game);
}

function resultEmbed(challengerId, challengerMove, opponentLabel, opponentMove, result) {
  let resultText;
  if (result === 'tie') {
    resultText = "It's a tie!";
  } else if (result === 'challenger') {
    resultText = `<@${challengerId}> wins! 🎉`;
  } else {
    resultText = `${opponentLabel} wins! 🎉`;
  }

  return new EmbedBuilder()
    .setTitle('🪨📄✂️ Rock Paper Scissors — Result')
    .setDescription(
      `<@${challengerId}> chose **${MOVES[challengerMove]}**\n${opponentLabel} chose **${MOVES[opponentMove]}**\n\n${resultText}`
    )
    .setColor(0x5865f2);
}

async function handleChoice(interaction) {
  const [, gameId, choice] = interaction.customId.split(':');
  const game = games.get(gameId);

  if (!game) {
    return interaction.reply({ content: 'This game has ended.', flags: MessageFlags.Ephemeral });
  }

  const userId = interaction.user.id;
  const isVsBot = game.opponentId === null;

  if (isVsBot) {
    if (userId !== game.challengerId) {
      return interaction.reply({ content: "This isn't your game — run /rps yourself to start one.", flags: MessageFlags.Ephemeral });
    }

    const botMove = Object.keys(MOVES)[Math.floor(Math.random() * 3)];
    const result = decideWinner(choice, botMove);

    clearTimeout(game.timeout);
    games.delete(gameId);

    return interaction.update({
      embeds: [resultEmbed(userId, choice, 'The bot', botMove, result)],
      components: buildButtons(gameId, true),
    });
  }

  // Playing against another person
  if (userId !== game.challengerId && userId !== game.opponentId) {
    return interaction.reply({ content: "This isn't your game.", flags: MessageFlags.Ephemeral });
  }
  if (game.choices[userId]) {
    return interaction.reply({ content: `You already picked ${MOVES[game.choices[userId]]}.`, flags: MessageFlags.Ephemeral });
  }

  game.choices[userId] = choice;
  await interaction.reply({ content: `You chose ${MOVES[choice]}. Waiting for your opponent to pick...`, flags: MessageFlags.Ephemeral });

  const challengerMove = game.choices[game.challengerId];
  const opponentMove = game.choices[game.opponentId];

  if (challengerMove && opponentMove) {
    clearTimeout(game.timeout);
    games.delete(gameId);

    const result = decideWinner(challengerMove, opponentMove);
    await game.message.edit({
      embeds: [resultEmbed(game.challengerId, challengerMove, `<@${game.opponentId}>`, opponentMove, result)],
      components: buildButtons(gameId, true),
    });
  }
}

module.exports = { buildButtons, createGame, handleChoice };