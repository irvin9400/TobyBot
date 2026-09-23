const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, MessageFlags, ActivityType } = require('discord.js');
const config = require('./config');
const { openTicket, closeTicket, OPEN_BUTTON_ID, CLOSE_BUTTON_ID } = require('./utils/tickets');
const { createWebhookServer } = require('./webhook/server');
const { getAllTempBans, removeTempBan } = require('./utils/tempBanStore');
const { addCase } = require('./utils/caseStore');
const { logAction } = require('./utils/logger');

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

  // Temp bans: every minute, lift any ban from /ban whose time is up. Checking on an interval
  // (rather than one setTimeout per ban) means this still works correctly even if the bot restarts
  // in between — nothing depends on a timer surviving a restart, just this file on disk.
  const TEMP_BAN_CHECK_INTERVAL_MS = 60_000;

  async function checkTempBans() {
    const now = Date.now();
    for (const { guildId, userId, expiresAt, reason } of getAllTempBans()) {
      if (expiresAt > now) continue;

      try {
        const guild = await client.guilds.fetch(guildId);
        const stillBanned = await guild.bans.fetch(userId).catch(() => null);

        if (stillBanned) {
          await guild.bans.remove(userId, 'Temporary ban expired');

          const record = addCase(guildId, {
            userId,
            userTag: stillBanned.user.tag,
            moderatorTag: 'Automatic (temp ban expired)',
            action: 'unban',
            reason: `Temporary ban expired (was: ${reason})`,
          });

          await logAction(client, {
            source: 'discord',
            action: 'unban',
            moderator: 'Automatic (temp ban expired)',
            target: stillBanned.user.tag,
            reason: `Temporary ban expired (was: ${reason})`,
            caseNumber: record.case,
          });
        }
      } catch (err) {
        console.error(`Temp ban check failed for user ${userId} in guild ${guildId}:`, err);
      } finally {
        // Whether it worked, failed, or they were already unbanned by hand — stop tracking it, so a
        // persistent failure (e.g. the bot lost access to the guild) doesn't retry forever.
        removeTempBan(guildId, userId);
      }
    }
  }

  checkTempBans();
  setInterval(checkTempBans, TEMP_BAN_CHECK_INTERVAL_MS);
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
      return;
    }

    // The "Open Ticket" / "Close Ticket" buttons
    if (interaction.isButton()) {
      if (interaction.customId === OPEN_BUTTON_ID) {
        await openTicket(interaction);
      } else if (interaction.customId === CLOSE_BUTTON_ID) {
        await closeTicket(interaction);
      }
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