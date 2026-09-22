const express = require('express');
const config = require('../config');
const { logAction } = require('../utils/logger');

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

function createWebhookServer(client) {
  const app = express();
  app.use(express.json());

  app.post('/game-log', async (req, res) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (token !== config.webhookSecret) {
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
    if (token !== config.webhookSecret) {
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

  app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
  });

  return app;
}

module.exports = { createWebhookServer, EXCLUDED_ACTIONS };