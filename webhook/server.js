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

  app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
  });

  return app;
}

module.exports = { createWebhookServer, EXCLUDED_ACTIONS };