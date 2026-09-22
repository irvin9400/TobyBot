const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, MessageFlags, ActivityType } = require('discord.js');
const config = require('./config');
const { createWebhookServer } = require('./webhook/server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // The bot's status: the colored dot (online/idle/dnd/invisible) and the text under its name.
  // ActivityType.Watching / Playing / Listening / Competing change the verb shown before the text
  // (e.g. "Watching the school", "Playing Roblox"). See discord.js's ActivityType enum for the options.
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'the school', type: ActivityType.Watching }],
  });

  // Start the webhook server once the bot is ready so it can fetch channels.
  createWebhookServer(client);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing /${interaction.commandName}:`, error);
    const errorReply = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply);
    } else {
      await interaction.reply(errorReply);
    }
  }
});

client.login(config.token);