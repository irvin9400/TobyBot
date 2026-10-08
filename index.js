const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, MessageFlags, ActivityType, PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const { openTicket, closeTicket, OPEN_BUTTON_ID, CLOSE_BUTTON_ID } = require('./utils/tickets');
const { handleChoice: handleRpsChoice } = require('./utils/rps');
const { startVerification, submitVerification, applyUnverifiedRole, START_BUTTON_ID: VERIFY_BUTTON_ID, MODAL_PREFIX: VERIFY_MODAL_PREFIX } = require('./utils/captcha');
const { createWebhookServer } = require('./webhook/server');
const { getAllTempBans, removeTempBan } = require('./utils/tempBanStore');
const { addCase } = require('./utils/caseStore');
const { handleAppealButton, handleAppealModal } = require('./webhook/appeals');
const { logAction } = require('./utils/logger');
const settings = require('./utils/guildSettings');

// ---------------------------------------------------------------------------------------------
// Verification timeout: kicks members who don't verify within VERIFY_KICK_HOURS (default 24)
// of joining, with a reminder DM a few hours before. Settings are in config.js.
// (Kept inside index.js so there's no separate file to upload.)
// ---------------------------------------------------------------------------------------------

const CHECK_EVERY_MS = 10 * 60 * 1000; // Every 10 minutes
const HOUR_MS = 60 * 60 * 1000;
const reminded = new Set(); // "guildId:userId" of members already sent a reminder this run

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every server has its own roles (set with /setup; your original server can keep using the
// environment variables). See utils/guildSettings.js.
function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return settings.modRoleIds(member.guild).some((id) => member.roles.cache.has(id));
}

function canBeKicked(member, startCutoff) {
  if (member.user.bot || member.id === member.guild.ownerId) return false;
  const verifiedRoleId = settings.verifiedRoleId(member.guild);
  if (!verifiedRoleId) return false; // Verification isn't set up in this server: never kick anyone
  if (member.roles.cache.has(verifiedRoleId)) return false;
  if (isStaff(member)) return false;
  const unverifiedRoleId = settings.unverifiedRoleId(member.guild);
  if (unverifiedRoleId) return member.roles.cache.has(unverifiedRoleId);
  return startCutoff !== null && member.joinedTimestamp >= startCutoff;
}

// Returns 'kicked', 'preview' (would have kicked), or 'failed'
async function kickUnverified(client, member, hours, preview) {
  const reason = `Didn't verify within ${hours} hours of joining`;

  if (preview || config.verifyKickDryRun) {
    console.log(`[verify-timeout] (dry run) Would kick ${member.user.tag}: ${reason}`);
    return 'preview';
  }
  if (!member.kickable) {
    console.warn(`[verify-timeout] Can't kick ${member.user.tag}. Is my role above theirs, and do I have Kick Members?`);
    return 'failed';
  }

  // Let them know why, and how to come back (DMs can fail if they're closed, that's fine)
  const rejoin = config.verifyKickInvite ? ` You're welcome to rejoin and verify anytime: ${config.verifyKickInvite}` : '';
  await member
    .send(`You were removed from **${member.guild.name}** because you didn't verify within ${hours} hours of joining.${rejoin}`)
    .catch(() => {});

  await member.kick(reason);

  const record = addCase(member.guild.id, {
    userId: member.id,
    userTag: member.user.tag,
    moderatorTag: 'Automatic (not verified)',
    action: 'kick',
    reason,
  });

  await logAction(client, {
    source: 'discord',
    guildId: member.guild.id,
    action: 'kick',
    moderator: 'Automatic (not verified)',
    target: member.user.tag,
    reason,
    caseNumber: record?.case,
  });

  console.log(`[verify-timeout] Kicked ${member.user.tag}: ${reason}`);
  return 'kicked';
}

async function remind(member, hoursLeft) {
  await member
    .send(`Reminder: you still need to verify in **${member.guild.name}**. If you don't verify within about ${hoursLeft} hours, you'll be removed from the server.`)
    .catch(() => {});
}

async function checkGuild(client, guild, startCutoff, options = {}, summary = { kicked: [], preview: [], failed: [] }) {
  const hours = config.verifyKickHours;
  const limitMs = hours * HOUR_MS;
  const reminderHours = config.verifyReminderHours;
  const now = Date.now();

  const members = await guild.members.fetch();
  for (const member of members.values()) {
    if (!member.joinedTimestamp || !canBeKicked(member, startCutoff)) continue;

    const timeInServer = now - member.joinedTimestamp;
    const key = `${guild.id}:${member.id}`;

    if (timeInServer >= limitMs) {
      try {
        const result = await kickUnverified(client, member, hours, options.preview);
        summary[result]?.push(member.user.tag);
      } catch (err) {
        summary.failed.push(member.user.tag);
        console.error(`[verify-timeout] Failed to kick ${member.user.tag}:`, err);
      }
      reminded.delete(key);
      await wait(1000); // Go easy on Discord's rate limits
    } else if (!options.preview && reminderHours > 0 && timeInServer >= limitMs - reminderHours * HOUR_MS && !reminded.has(key)) {
      reminded.add(key);
      await remind(member, reminderHours);
    }
  }
  return summary;
}

function startVerifyTimeout(client) {
  if (!config.verifyKickHours || config.verifyKickHours <= 0) {
    console.log('[verify-timeout] Off (VERIFY_KICK_HOURS is 0).');
    return;
  }

  // For servers without an unverified role, only people who joined after a cutoff can be kicked:
  // the moment /setup was first run there, or VERIFY_KICK_START for a server that uses the
  // environment variables instead.
  const parsedStart = config.verifyKickStart ? Date.parse(config.verifyKickStart) : NaN;
  const envCutoff = Number.isNaN(parsedStart) ? null : parsedStart;

  console.log(
    `[verify-timeout] Kicking members who don't verify within ${config.verifyKickHours}h` +
      (config.verifyKickDryRun ? ' (DRY RUN: nobody will actually be kicked)' : '')
  );

  async function checkAll(options = {}) {
    const summary = { kicked: [], preview: [], failed: [] };
    for (const guild of client.guilds.cache.values()) {
      if (config.guildId && guild.id !== config.guildId) continue;
      try {
        // A server whose verified role comes from the environment variables keeps using VERIFY_KICK_START
        const usesEnv = envCutoff !== null && Boolean(config.verifiedRoleId) && guild.roles.cache.has(config.verifiedRoleId);
        const startCutoff = usesEnv ? envCutoff : settings.setupAt(guild.id);
        await checkGuild(client, guild, startCutoff, options, summary);
      } catch (err) {
        console.error(`[verify-timeout] Check failed for ${guild.name}:`, err);
      }
    }
    return summary;
  }

  // Run the check on demand (e.g. from /eval):
  //   await client.runVerifyCheck()                    -> kicks anyone past the deadline now
  //   await client.runVerifyCheck({ preview: true })   -> only lists who WOULD be kicked
  client.runVerifyCheck = checkAll;

  checkAll();
  setInterval(checkAll, CHECK_EVERY_MS);
}

// ---------------------------------------------------------------------------------------------

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages, // Needed to notice someone posting in a honeypot channel
];
// Optional: lets honeypot logs show WHAT the spammer posted. Only set MESSAGE_CONTENT_INTENT=true
// after turning on "Message Content Intent" for the bot in the Discord Developer Portal (Bot page).
// With the variable set but the switch off, the bot can't log in at all.
if (process.env.MESSAGE_CONTENT_INTENT === 'true') {
  intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({ intents });

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
    activities: [{ name: 'Watching for tickets', type: ActivityType.Watching }],
  });

  // Let everyone watching the status channel know the bot is back, after a deploy or a restart
  if (config.statusChannelId) {
    client.channels.fetch(config.statusChannelId)
      .then((channel) => channel.send('✅ **Back online.**'))
      .catch((err) => console.error('[status] Failed to send the online message:', err));
  }

  // Start the webhook server once the bot is ready so it can fetch channels.
  createWebhookServer(client);

  // Kick members who don't verify within 24 hours of joining (the code is at the top of this file)
  startVerifyTimeout(client);

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
            guildId,
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

// Everything a command or button does runs "inside" its server, so logs go to that server's own
// log channel (see guildContext in utils/guildSettings.js).
client.on('interactionCreate', (interaction) =>
  settings.guildContext.run({ guildId: interaction.guildId }, () => handleInteraction(interaction))
);

async function handleInteraction(interaction) {
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
      if (interaction.customId.startsWith(`${VERIFY_MODAL_PREFIX}:`)) {
        await submitVerification(interaction);
        return;
      }

      // Denying a ban appeal (webhook/appeals.js)
      if (interaction.customId.startsWith('appealdeny:')) {
        await handleAppealModal(interaction);
        return;
      }

      // The /update form (commands/update.js)
      if (interaction.customId.startsWith('update:')) {
        const updateCommand = client.commands.get('update');
        if (updateCommand?.handleModalSubmit) {
          await updateCommand.handleModalSubmit(interaction);
        }
        return;
      }

      const [prefix] = interaction.customId.split(':');
      const owner = [...client.commands.values()].find(
        (cmd) => cmd.handleModalSubmit && interaction.customId.startsWith(`${prefix}:`) && cmd.data.name === 'rules'
      );
      if (owner) await owner.handleModalSubmit(interaction);
      return;
    }

    // The "Open Ticket" / "Close Ticket" buttons, and the Rock Paper Scissors move buttons
    if (interaction.isButton()) {
      if (interaction.customId === OPEN_BUTTON_ID) {
        await openTicket(interaction);
      } else if (interaction.customId === CLOSE_BUTTON_ID) {
        await closeTicket(interaction);
      } else if (interaction.customId.startsWith('rps:')) {
        await handleRpsChoice(interaction);
      } else if (interaction.customId === VERIFY_BUTTON_ID) {
        await startVerification(interaction);
      } else if (interaction.customId.startsWith('appeal:')) {
        await handleAppealButton(interaction);
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
}

// ---------------------------------------------------------------------------------------------
// Honeypot: a channel nobody should post in (picked with /setup). Spam bots and hacked accounts
// post in every channel they can, so anyone who posts there is softbanned: banned and unbanned
// straight away. That removes them and deletes their last hour of messages in every channel, but
// a real person who was hacked can rejoin later. Staff and bots are ignored.
// ---------------------------------------------------------------------------------------------

const HONEYPOT_DELETE_SECONDS = 60 * 60;

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild || message.author.bot || message.system) return;
    const honeypotId = settings.honeypotChannelId(message.guild.id);
    if (!honeypotId || message.channelId !== honeypotId) return;

    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (member && (isStaff(member) || member.permissions.has(PermissionFlagsBits.ManageMessages))) return;

    const reason = 'Honeypot: posted in the trap channel';
    // Empty unless MESSAGE_CONTENT_INTENT is on (see the intents above)
    const posted = message.content ? message.content.slice(0, 500) : null;
    let failure = null;

    try {
      await message.guild.members.ban(message.author.id, { deleteMessageSeconds: HONEYPOT_DELETE_SECONDS, reason });
      await message.guild.members.unban(message.author.id, 'Honeypot softban');
    } catch (err) {
      failure = err?.message || String(err);
      console.error(`[honeypot] Couldn't softban ${message.author.tag} in ${message.guild.name}:`, err);
    }

    const record = failure
      ? null
      : addCase(message.guild.id, {
          userId: message.author.id,
          userTag: message.author.tag,
          moderatorTag: 'Automatic (honeypot)',
          action: 'softban',
          reason,
        });

    await logAction(client, {
      source: 'discord',
      guildId: message.guild.id,
      action: 'softban',
      moderator: 'Automatic (honeypot)',
      target: `${message.author.tag} (${message.author.id})`,
      reason: failure ? `FAILED to softban: ${failure}. Check my role is above theirs and I have Ban Members.` : reason,
      caseNumber: record?.case,
      extra: posted ? { 'What they posted': posted } : undefined,
    });
  } catch (err) {
    console.error('[honeypot] Handler failed:', err);
  }
});

// Railway (and most hosts) send SIGTERM to ask a process to stop cleanly before killing it outright
// — for a deploy, that's the moment just before the new version replaces this one. Posting here,
// then exiting, is what makes the "going down" message actually happen before the bot disconnects.
let shuttingDown = false;

async function announceShutdown(signal) {
  if (shuttingDown) return; // don't double-post if a second signal arrives while we're already exiting
  shuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);

  if (config.statusChannelId) {
    try {
      const channel = await client.channels.fetch(config.statusChannelId);
      await channel.send('🔧 **Going down for an update.** Back shortly.');
    } catch (err) {
      console.error('[status] Failed to send the going-down message:', err);
    }
  }

  client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => announceShutdown('SIGTERM'));
process.on('SIGINT', () => announceShutdown('SIGINT'));

client.on('guildMemberAdd', (member) => {
  applyUnverifiedRole(member).catch((err) => console.error('[captcha] guildMemberAdd handler failed:', err));
});

client.login(config.token);