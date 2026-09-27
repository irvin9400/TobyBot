// utils/verifyTimeout.js
// Kicks members who haven't verified within VERIFY_KICK_HOURS (default 24) of joining.
// Sends a reminder DM a few hours before the deadline.
//
// Who can be kicked:
//   - If UNVERIFIED_ROLE_ID is set: only members who still have the Unverified role
//     (new members get it when they join, so older members are never affected)
//   - Otherwise: members without the Verified role who joined after VERIFY_KICK_START
//     (a date like 2026-09-27). If that isn't set either, nobody is kicked.
// Never kicked: bots, the server owner, admins, anyone with a MOD_ROLE_IDS role,
// and anyone who has the Verified role.
//
// This doesn't need to remember anything between restarts: it uses the date each
// member joined, which Discord keeps track of.

const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { addCase } = require('./caseStore');
const { logAction } = require('./logger');

const CHECK_EVERY_MS = 10 * 60 * 1000; // Every 10 minutes
const HOUR_MS = 60 * 60 * 1000;
const reminded = new Set(); // "guildId:userId" of members already sent a reminder this run

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return (config.modRoleIds || []).some((id) => member.roles.cache.has(id));
}

function canBeKicked(member, startCutoff) {
  if (member.user.bot || member.id === member.guild.ownerId) return false;
  if (config.verifiedRoleId && member.roles.cache.has(config.verifiedRoleId)) return false;
  if (isStaff(member)) return false;
  if (config.unverifiedRoleId) return member.roles.cache.has(config.unverifiedRoleId);
  return startCutoff !== null && member.joinedTimestamp >= startCutoff;
}

async function kickUnverified(client, member, hours) {
  const reason = `Didn't verify within ${hours} hours of joining`;

  if (config.verifyKickDryRun) {
    console.log(`[verify-timeout] (dry run) Would kick ${member.user.tag}: ${reason}`);
    return;
  }
  if (!member.kickable) {
    console.warn(`[verify-timeout] Can't kick ${member.user.tag}. Is my role above theirs, and do I have Kick Members?`);
    return;
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
    action: 'kick',
    moderator: 'Automatic (not verified)',
    target: member.user.tag,
    reason,
    caseNumber: record?.case,
  });

  console.log(`[verify-timeout] Kicked ${member.user.tag}: ${reason}`);
}

async function remind(member, hoursLeft) {
  await member
    .send(`Reminder: you still need to verify in **${member.guild.name}**. If you don't verify within about ${hoursLeft} hours, you'll be removed from the server.`)
    .catch(() => {});
}

async function checkGuild(client, guild, startCutoff) {
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
        await kickUnverified(client, member, hours);
      } catch (err) {
        console.error(`[verify-timeout] Failed to kick ${member.user.tag}:`, err);
      }
      reminded.delete(key);
      await wait(1000); // Go easy on Discord's rate limits
    } else if (reminderHours > 0 && timeInServer >= limitMs - reminderHours * HOUR_MS && !reminded.has(key)) {
      reminded.add(key);
      await remind(member, reminderHours);
    }
  }
}

function startVerifyTimeout(client) {
  if (!config.verifyKickHours || config.verifyKickHours <= 0) {
    console.log('[verify-timeout] Off (VERIFY_KICK_HOURS is 0).');
    return;
  }

  const startCutoff = config.verifyKickStart ? Date.parse(config.verifyKickStart) : null;
  if (!config.unverifiedRoleId && (startCutoff === null || Number.isNaN(startCutoff))) {
    console.warn('[verify-timeout] Not starting: set UNVERIFIED_ROLE_ID, or VERIFY_KICK_START to a date like 2026-09-27.');
    return;
  }

  console.log(
    `[verify-timeout] Kicking members who don't verify within ${config.verifyKickHours}h` +
      (config.verifyKickDryRun ? ' (DRY RUN: nobody will actually be kicked)' : '')
  );

  async function checkAll() {
    for (const guild of client.guilds.cache.values()) {
      if (config.guildId && guild.id !== config.guildId) continue;
      try {
        await checkGuild(client, guild, startCutoff);
      } catch (err) {
        console.error(`[verify-timeout] Check failed for ${guild.name}:`, err);
      }
    }
  }

  checkAll();
  setInterval(checkAll, CHECK_EVERY_MS);
}

module.exports = { startVerifyTimeout };