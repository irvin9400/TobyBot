const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

// A guild ID for an INSTANT deploy, given only as a one-off argument — never stored in .env, so it
// never affects how the bot actually runs (global commands still register normally on every
// startup). Use it like:
//   node deploy-commands.js --guild=1550286535944052806
// or just:
//   node deploy-commands.js 1550286535944052806
// Leave it off entirely for a normal global deploy (up to an hour to propagate everywhere, but
// required for the "Supports Commands" badge).
const guildFlag = process.argv.slice(2).find((arg) => arg.startsWith('--guild='));
const guildArg = guildFlag ? guildFlag.split('=')[1] : process.argv[2];
const instantGuildId = guildArg && /^\d+$/.test(guildArg) ? guildArg : null;

const rest = new REST().setToken(config.token);

(async () => {
  try {
    console.log(`Deploying ${commands.length} slash command(s)...`);

    if (instantGuildId) {
      // Guild commands update instantly — use this for testing without waiting on propagation.
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, instantGuildId),
        { body: commands },
      );
      console.log(`Deployed commands to guild ${instantGuildId} (instant, this server only).`);
    } else if (config.guildId) {
      // Only reached if GUILD_ID is set in .env — kept for anyone who prefers that instead.
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands },
      );
      console.log(`Deployed commands to guild ${config.guildId}.`);
    } else {
      // Global commands can take up to an hour to propagate, but reach every server the bot is in.
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands },
      );
      console.log('Deployed global commands.');
    }
  } catch (error) {
    console.error('Failed to deploy commands:', error);
  }
})();