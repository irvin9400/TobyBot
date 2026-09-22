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

const rest = new REST().setToken(config.token);

(async () => {
  try {
    console.log(`Deploying ${commands.length} slash command(s)...`);

    if (config.guildId) {
      // Guild commands update instantly — best for development.
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands },
      );
      console.log(`Deployed commands to guild ${config.guildId}.`);
    } else {
      // Global commands can take up to an hour to propagate.
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
