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

  modRoleIds: (process.env.MOD_ROLE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  // Hosting platforms like Railway assign their own port via PORT and
  // expect the app to listen on it. WEBHOOK_PORT is used as a fallback
  // for local development.
  webhookPort: parseInt(process.env.PORT, 10) || parseInt(process.env.WEBHOOK_PORT, 10) || 3000,
  webhookSecret: requireEnv('WEBHOOK_SECRET'),
};