const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { logAction } = require('../utils/logger');
const { syncLevelRank } = require('./groupranks');
const { registerAppealRoutes } = require('./appeals');

// Explicit deny-list: these are NEVER logged, no matter what the game sends. This is the one place
// that decides that, so if Roblox ever sends "doors_set" (the entrance toggle) by mistake, or a
// future action you don't want logged, add its name here rather than relying on the Roblox side.
const EXCLUDED_ACTIONS = new Set([
  'doors_set',
]);

// Actions that create a numbered case in the Roblox admin panel go to the "mod log" channel
// (GAME_LOG_CHANNEL_ID). Everything else goes to the "action log" channel (GAME_ACTION_LOG_CHANNEL_ID,
// or GAME_LOG_CHANNEL_ID too if you haven't set a second one).
const CASE_ACTIONS = new Set(['ban', 'unban', 'kick', 'warn', 'jail', 'unjail']);

// Booking requests from Event Central (the /booking-request route). The game says which channel
// to post in, but only channels listed here are allowed, so a leaked WEBHOOK_SECRET can't be used
// to post anywhere else. To move the requests to another channel, change the ID here AND
// BOOKING_CHANNEL_ID at the top of BookingSystem in the Roblox game.
const BOOKING_CHANNEL_IDS = new Set([
  '1556097176944377886',
]);

// How each kind of booking message looks
const BOOKING_LOOKS = {
  booked: { title: 'New booking', color: 0x50c873 }, // confirmed straight away, no review needed
  request: { title: 'New booking request', color: 0xffcd3c },
  approved: { title: 'Booking approved', color: 0x50c873 },
  denied: { title: 'Booking declined', color: 0xe44848 },
};

// A plain "!==" comparison leaks tiny timing differences that could theoretically help someone
// guess the secret one character at a time. This compares in constant time instead. Different
// lengths never match (and can't be timed against each other), so this is safe even though
// timingSafeEqual itself requires equal-length buffers.
function secretsMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createWebhookServer(client) {
  const app = express();
  // Railway sits in front of the bot as a proxy. This tells Express to trust it, so the rate
  // limiters see each caller's real address (fixes the ERR_ERL_UNEXPECTED_X_FORWARDED_FOR error).
  app.set('trust proxy', 1);
  app.use(express.json());

  // Limits how often each IP can hit these routes, so even a leaked WEBHOOK_SECRET can't be used to
  // flood your log channels indefinitely. Roblox only ever needs to log actions as fast as your
  // moderators can click buttons in-game, so this is generous enough to never get in the way.
  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Slow down.' },
  });
  app.use('/game-log', webhookLimiter);
  app.use('/mod-call', webhookLimiter);
  app.use('/booking-request', webhookLimiter);

  // Level ranks: every Roblox server sends these when players join and level up, so it gets a
  // higher limit than the log routes.
  const rankLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Slow down.' },
  });
  app.use('/group-rank', rankLimiter);
  app.use('/appeal', webhookLimiter);

  // Ban appeals from the separate appeals game (see webhook/appeals.js)
  registerAppealRoutes(app, client, (req) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    return Boolean(token) && secretsMatch(token, config.webhookSecret);
  });

  app.post('/game-log', async (req, res) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token || !secretsMatch(token, config.webhookSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { action, moderator, target, reason, extra, case: caseNumber, duration, evidence, placeId, server } = req.body || {};

    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'Missing "action" field' });
    }

    const normalizedAction = action.toLowerCase().trim();

    if (!normalizedAction || EXCLUDED_ACTIONS.has(normalizedAction)) {
      // Explicitly excluded (e.g. the entrance toggle), or empty.
      return res.status(400).json({
        error: `Action "${action}" is not logged by this bot.`,
      });
    }

    if (!target) {
      return res.status(400).json({ error: 'Missing "target" field' });
    }

    await logAction(client, {
      source: 'game',
      category: CASE_ACTIONS.has(normalizedAction) ? 'case' : 'action',
      action: normalizedAction,
      moderator: moderator || 'In-game system',
      target,
      reason,
      extra,
      caseNumber: typeof caseNumber === 'number' ? caseNumber : undefined,
      duration: typeof duration === 'string' ? duration.slice(0, 60) : undefined,
      evidence: typeof evidence === 'string' ? evidence.slice(0, 300) : undefined,
      placeId: typeof placeId === 'number' ? placeId : undefined,
      server: typeof server === 'string' ? server.slice(0, 60) : undefined,
    });

    return res.status(200).json({ ok: true });
  });

  // A player pressed the in-game "Mod Call" button, or an admin claimed/closed one (from
  // ModCallServer.server.lua). This posts straight to modCallChannelId — it's not a moderation
  // "case" or "action" like /game-log, so it doesn't go through EXCLUDED_ACTIONS/CASE_ACTIONS at all.
  app.post('/mod-call', async (req, res) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !secretsMatch(token, config.webhookSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { event, caller, target, message, moderator, resolution, placeId, jobId } = req.body || {};
    if (!event || !['new', 'claimed', 'closed'].includes(event)) {
      return res.status(400).json({ error: 'Missing or invalid "event" field (new/claimed/closed)' });
    }
    if (!caller) {
      return res.status(400).json({ error: 'Missing "caller" field' });
    }

    if (!config.modCallChannelId) {
      console.warn('[webhook] MOD_CALL_CHANNEL_ID is not set, skipping mod call log.');
      return res.status(200).json({ ok: true }); // don't fail the game's request over a missing setting
    }

    const channel = await client.channels.fetch(config.modCallChannelId).catch(() => null);
    if (!channel) {
      console.warn(`[webhook] Could not fetch mod call channel ${config.modCallChannelId}`);
      return res.status(200).json({ ok: true });
    }

    const { buildModCallEmbed } = require('../utils/logger');
    const embed = buildModCallEmbed({
      event,
      caller: String(caller).slice(0, 100),
      target: target ? String(target).slice(0, 100) : undefined,
      message: message ? String(message).slice(0, 300) : undefined,
      moderator: moderator ? String(moderator).slice(0, 100) : undefined,
      resolution: resolution ? String(resolution).slice(0, 100) : undefined,
      placeId,
      jobId,
    });

    await channel.send({ embeds: [embed] }).catch((err) => console.error('[webhook] Failed to send mod call embed:', err));
    return res.status(200).json({ ok: true });
  });

  // A player asked to book an event at a kiosk in Event Central, or staff approved/declined that
  // request (from BookingSystem in the Roblox game). This posts an embed in the booking requests
  // channel. The channel the game names must be in BOOKING_CHANNEL_IDS at the top of this file.
  app.post('/booking-request', async (req, res) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !secretsMatch(token, config.webhookSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const b = req.body || {};
    const look = BOOKING_LOOKS[b.type];
    if (!look) {
      return res.status(400).json({ error: 'Missing or invalid "type" field (booked/request/approved/denied)' });
    }
    const channelId = String(b.channelId || '');
    if (!BOOKING_CHANNEL_IDS.has(channelId)) {
      return res.status(400).json({ error: 'That channel is not a booking requests channel' });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.warn(`[webhook] Could not fetch booking requests channel ${channelId}`);
      return res.status(200).json({ ok: true }); // don't fail the game's request over a channel problem
    }

    // A Roblox name as a link to the profile, when the game also sent the UserId
    const profile = (name, id) => {
      if (!name) return 'Unknown';
      const safeName = String(name).slice(0, 60);
      return Number.isInteger(id) && id > 0 ? `[${safeName}](https://www.roblox.com/users/${id}/profile)` : safeName;
    };

    // <t:...> timestamps show in each reader's own time zone
    const starts = Number(b.startsAt);
    const ends = Number(b.endsAt);
    const when = Number.isFinite(starts) && starts > 0
      ? `<t:${Math.floor(starts)}:F>` + (Number.isFinite(ends) && ends > 0 ? ` to <t:${Math.floor(ends)}:t>` : '')
      : 'Not set';

    const embed = new EmbedBuilder()
      .setTitle(look.title)
      .setColor(look.color)
      .addFields(
        { name: 'Event', value: String(b.event || 'Unnamed').slice(0, 200), inline: true },
        { name: 'Group', value: String(b.group || 'Unknown').slice(0, 200), inline: true },
        { name: 'Room', value: String(b.room || 'Stage').slice(0, 60), inline: true },
        { name: 'When', value: when },
        { name: 'Host', value: profile(b.host, b.hostId), inline: true },
        { name: b.type === 'booked' ? 'Booked by' : 'Requested by', value: profile(b.requestedBy, b.requestedById), inline: true },
      )
      .setTimestamp();

    if (b.type === 'booked') {
      embed.setDescription('This event is confirmed. No review is needed. Game Staff can join it at any time.');
    } else if (b.type === 'request') {
      const hours = Number.isInteger(b.reviewHours) && b.reviewHours > 0 ? b.reviewHours : 24;
      embed.setDescription(`Review this within **${hours} hours** on a staff computer in ${String(b.game || 'the game').slice(0, 60)} (Requests page).`);
    } else if (b.reviewedBy) {
      embed.addFields({ name: 'Reviewed by', value: String(b.reviewedBy).slice(0, 60), inline: true });
    }
    if (b.bookingId) {
      embed.setFooter({ text: `Booking ${String(b.bookingId).slice(0, 80)}` });
    }

    await channel.send({ embeds: [embed] }).catch((err) => console.error('[webhook] Failed to send booking request embed:', err));
    return res.status(200).json({ ok: true });
  });

  // The game reports a player's level; the bot gives them the matching level role in the community.
  // Only ever moves people between Member and the level roles (see webhook/groupranks.js).
  app.post('/group-rank', async (req, res) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !secretsMatch(token, config.webhookSecret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = Number(req.body?.userId);
    const level = Number(req.body?.level);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(level) || level < 1 || level > 1000) {
      return res.status(400).json({ error: 'Invalid "userId" or "level"' });
    }

    try {
      const result = await syncLevelRank(userId, level);
      console.log(`[group-rank] ${userId} (level ${level}): ${result}`);
      return res.status(200).json({ ok: true, result });
    } catch (err) {
      console.error(`[group-rank] Failed for ${userId} (level ${level}):`, err.message);
      return res.status(500).json({ error: 'Ranking failed' });
    }
  });

  app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
  });

  return app;
}

module.exports = { createWebhookServer, EXCLUDED_ACTIONS };