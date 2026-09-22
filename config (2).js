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
  // In-game bans, kicks, and warns forwarded from Roblox
  gameModLogChannelId: requireEnv('GAME_MOD_LOG_CHANNEL_ID'),
  // In-game jail, unjail, unban, freeze, unfreeze forwarded from Roblox
  gameActionLogChannelId: requireEnv('GAME_ACTION_LOG_CHANNEL_ID'),

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
