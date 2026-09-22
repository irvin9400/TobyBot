const { EmbedBuilder } = require('discord.js');
const config = require('../config');

// Colors per action, purely cosmetic (an action not listed here just uses the default gray —
// it doesn't need to be added here for it to be logged).
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

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

function buildEmbed({ action, moderator, target, reason, extra, source, caseNumber, duration, evidence, placeId, server }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS[action] || COLORS.default)
    .setTitle(formatTitle(action, source))
    .addFields(
      { name: 'Target', value: target || 'Unknown', inline: true },
      { name: 'Moderator', value: moderator || 'Unknown', inline: true },
    )
    .setTimestamp();

  if (caseNumber) embed.addFields({ name: 'Case', value: `#${caseNumber}`, inline: true });
  if (duration) embed.addFields({ name: 'Duration', value: duration, inline: true });
  if (reason) embed.addFields({ name: 'Reason', value: reason });

  if (evidence) {
    embed.addFields({ name: 'Evidence', value: evidence });
    // If it's a direct image link, show it inline too. A non-image link (a Medal/YouTube clip,
    // a Google Drive link, etc.) just stays a plain clickable field above.
    if (IMAGE_EXTENSIONS.test(evidence)) {
      embed.setImage(evidence);
    }
  }

  if (placeId || server) {
    const parts = [];
    if (placeId) parts.push(`Place ${placeId}`);
    if (server) parts.push(`Server ${server.slice(0, 8)}`);
    embed.setFooter({ text: parts.join(' | ') });
  }

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
 * category (only used when source is 'game'): 'case' (creates a numbered case in the Roblox
 *   admin panel: ban, unban, kick, warn, jail, unjail) or 'action' (doesn't: freeze, unfreeze).
 *   'case' goes to GAME_LOG_CHANNEL_ID, 'action' goes to GAME_ACTION_LOG_CHANNEL_ID if you set
 *   one, otherwise it falls back to GAME_LOG_CHANNEL_ID too.
 */
async function logAction(client, { source, category, action, moderator, target, reason, extra, caseNumber, duration, evidence, placeId, server }) {
  let channelId;
  if (source === 'game') {
    channelId = category === 'action'
      ? (config.gameActionLogChannelId || config.gameLogChannelId)
      : config.gameLogChannelId;
  } else {
    channelId = config.modLogChannelId;
  }
  if (!channelId) {
    console.warn(`[logger] No log channel configured for source "${source}" (category "${category}"), skipping log.`);
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.warn(`[logger] Could not fetch log channel ${channelId}.`);
    return;
  }

  const embed = buildEmbed({ action, moderator, target, reason, extra, source, caseNumber, duration, evidence, placeId, server });
  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error('[logger] Failed to send log embed:', err);
  });
}

const MOD_CALL_TITLES = {
	new: '🚨 New Mod Call',
	claimed: '👋 Mod Call Claimed',
	closed: '✅ Mod Call Closed',
};
const MOD_CALL_COLORS = {
	new: 0xff5a5a,
	claimed: 0xffa03c,
	closed: 0x4bdc5a,
};

// A mod call event from Roblox (ModCallServer.server.lua), via the /mod-call webhook route.
// This is separate from buildEmbed/logAction above: mod calls aren't a moderation "case" or
// "action" on a player, they're a live help request, so they get their own simpler embed.
function buildModCallEmbed({ event, caller, target, message, moderator, resolution, placeId, jobId }) {
	const embed = new EmbedBuilder()
		.setColor(MOD_CALL_COLORS[event] || 0x5865f2)
		.setTitle(MOD_CALL_TITLES[event] || 'Mod Call')
		.addFields({ name: 'Caller', value: caller, inline: true });

	if (target) embed.addFields({ name: 'Reporting', value: target, inline: true });
	if (moderator) embed.addFields({ name: event === 'claimed' ? 'Claimed by' : 'Closed by', value: moderator, inline: true });
	if (message) embed.addFields({ name: 'Message', value: message });
	if (resolution) embed.addFields({ name: 'Resolution', value: resolution, inline: true });

	if (placeId || jobId) {
		const parts = [];
		if (placeId) parts.push(`Place ${placeId}`);
		if (jobId) parts.push(`Server ${String(jobId).slice(0, 8)}`);
		embed.setFooter({ text: parts.join(' | ') });
	}

	embed.setTimestamp();
	return embed;
}

module.exports = { logAction, buildModCallEmbed };