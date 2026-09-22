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
    activities: [{ name: 'Watching for rulebreakers!', type: ActivityType.Watching }],
  });

  // Start the webhook server once the bot is ready so it can fetch channels.
  createWebhookServer(client);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    // A text box submitted from a command (currently just /rules set). Routed to whichever
    // command file's customId prefix matches, so more commands can add their own modals later.
    if (interaction.isModalSubmit()) {
      const [prefix] = interaction.customId.split(':');
      const owner = [...client.commands.values()].find(
        (cmd) => cmd.handleModalSubmit && interaction.customId.startsWith(`${prefix}:`) && cmd.data.name === 'rules'
      );
      if (owner) await owner.handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error(`Error handling interaction (${interaction.type}):`, error);
    const errorReply = { content: 'Something went wrong running that.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply).catch(() => {});
    } else {
      await interaction.reply(errorReply).catch(() => {});
    }
  }
});

client.login(config.token);