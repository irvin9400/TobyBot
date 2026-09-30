require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`[config] Warning: ${name} is not set in your .env file.`);
  }
  return value;
}

module.exports = {
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,

  modLogChannelId: requireEnv('MOD_LOG_CHANNEL_ID'),
  gameLogChannelId: requireEnv('GAME_LOG_CHANNEL_ID'),
  // Optional: a separate channel for game actions that don't create a case (freeze/unfreeze).
  // Leave blank to send those to GAME_LOG_CHANNEL_ID too, in the same channel as everything else.
  gameActionLogChannelId: process.env.GAME_ACTION_LOG_CHANNEL_ID || null,
  // Where new/claimed/closed mod calls from Roblox are posted. Required for /mod-call to do anything.
  modCallChannelId: process.env.MOD_CALL_CHANNEL_ID || null,

  // Where /update posts game update announcements by default.
  // Leave blank to post in whatever channel you run /update in.
  updatesChannelId: process.env.UPDATES_CHANNEL_ID || null,

  modRoleIds: (process.env.MOD_ROLE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  // Tickets: who can see and respond to them, and (optionally) where closed transcripts go.
  ticketSupportRoleId: process.env.TICKET_SUPPORT_ROLE_ID || null,
  ticketLogChannelId: process.env.TICKET_LOG_CHANNEL_ID || null,
  // Optional: put ticket channels under this category instead of loose in the channel list.
  ticketCategoryId: process.env.TICKET_CATEGORY_ID || null,

  // CAPTCHA verification for new members.
  // verifiedRoleId is required for /verify-setup to work. unverifiedRoleId is optional — set it if
  // you want new members auto-assigned a restricted role the moment they join (and your channels
  // set up so that role can only see a #verify channel). Leave it blank if you're using verification
  // as an "unlocks extra access" model instead of a full lockdown.
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || null,
  unverifiedRoleId: process.env.UNVERIFIED_ROLE_ID || null,

  // Kick members who don't verify in time (see utils/verifyTimeout.js).
  // VERIFY_KICK_HOURS: time limit in hours (default 24). Set to 0 to turn this off.
  // VERIFY_REMINDER_HOURS: send a reminder DM this many hours before the deadline (default 6, 0 = no reminder).
  // VERIFY_KICK_DRY_RUN=true: only log who WOULD be kicked, without kicking anyone. Use this to test first!
  // VERIFY_KICK_INVITE: optional invite link included in the kick DM so people can rejoin.
  // VERIFY_KICK_START: only needed if UNVERIFIED_ROLE_ID isn't set (a date like 2026-09-27).
  verifyKickHours: process.env.VERIFY_KICK_HOURS !== undefined ? Number(process.env.VERIFY_KICK_HOURS) : 24,
  verifyReminderHours: process.env.VERIFY_REMINDER_HOURS !== undefined ? Number(process.env.VERIFY_REMINDER_HOURS) : 6,
  verifyKickDryRun: process.env.VERIFY_KICK_DRY_RUN === 'true',
  verifyKickInvite: process.env.VERIFY_KICK_INVITE || null,
  verifyKickStart: process.env.VERIFY_KICK_START || null,

  // Hosting platforms like Railway assign their own port via PORT and
  // expect the app to listen on it. WEBHOOK_PORT is used as a fallback
  // for local development.
  webhookPort: parseInt(process.env.PORT, 10) || parseInt(process.env.WEBHOOK_PORT, 10) || 3000,
  webhookSecret: requireEnv('WEBHOOK_SECRET'),

  // Level roles in your Roblox community (see webhook/groupranks.js).
  // ROBLOX_OPEN_CLOUD_KEY: an Open Cloud API key with read + write access to your community's members.
  robloxGroupId: process.env.ROBLOX_GROUP_ID || null,
  robloxOpenCloudKey: process.env.ROBLOX_OPEN_CLOUD_KEY || null,

  // Ban appeals (see webhook/appeals.js)
  appealsChannelId: process.env.APPEALS_CHANNEL_ID || null,
  robloxMainUniverseId: process.env.ROBLOX_MAIN_UNIVERSE_ID || null,

  // Posts here right after startup, and right before shutting down for a deploy/restart.
  statusChannelId: process.env.STATUS_CHANNEL_ID || null,
};