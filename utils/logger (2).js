const { EmbedBuilder } = require('discord.js');
const config = require('../config');

// Colors per action, purely cosmetic.
const COLORS = {
  kick: 0xf5a623,
  ban: 0xe0245e,
  unban: 0x2ecc71,
  timeout: 0xf5a623,
  untimeout: 0x2ecc71,
  nickname: 0x5865f2,
  role: 0x5865f2,
  warn: 0xf1c40f,
  jail: 0xe0245e,
  unjail: 0x2ecc71,
  freeze: 0x3498db,
  unfreeze: 0x2ecc71,
  default: 0x99aab5,
};

function buildEmbed({ action, moderator, target, reason, extra, source }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS[action] || COLORS.default)
    .setTitle(formatTitle(action, source))
    .addFields(
      { name: 'Target', value: target || 'Unknown', inline: true },
      { name: 'Moderator', value: moderator || 'Unknown', inline: true },
    )
    .setTimestamp();

  if (reason) embed.addFields({ name: 'Reason', value: reason });
  if (extra) {
    for (const [name, value] of Object.entries(extra)) {
      embed.addFields({ name, value: String(value), inline: true });
    }
  }

  return embed;
}

function formatTitle(action, source) {
  const label = action.charAt(0).toUpperCase() + action.slice(1);
  return source === 'game' ? `🎮 In-Game: ${label}` : `🛡️ Discord: ${label}`;
}

/**
 * Posts a moderation log embed.
 * source: 'discord' (bot commands) or 'game' (Roblox webhook events)
 */
/**
 * Posts a moderation log embed.
 * source: 'discord' (bot commands) or 'game' (Roblox webhook events)
 * channelId: optional explicit target channel; overrides the source-based default.
 *   Discord-side commands omit this and always land in modLogChannelId.
 *   Game events pass this explicitly, since they route to one of two channels
 *   depending on the action (see webhook/server.js).
 */
async function logAction(client, { source, action, moderator, target, reason, extra, channelId: channelIdOverride }) {
  const channelId = channelIdOverride || config.modLogChannelId;
  if (!channelId) {
    console.warn(`[logger] No log channel configured for source "${source}", skipping log.`);
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.warn(`[logger] Could not fetch log channel ${channelId}.`);
    return;
  }

  const embed = buildEmbed({ action, moderator, target, reason, extra, source });
  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error('[logger] Failed to send log embed:', err);
  });
}

module.exports = { logAction };
