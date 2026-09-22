const express = require('express');
const config = require('../config');
const { logAction } = require('../utils/logger');

// Explicit allow-list of in-game actions this bot will log. Anything not on
// this list is rejected — including things like "Lock Entrance" /
// "Unlock Entrance", which are intentionally left off.
const ALLOWED_ACTIONS = new Set([
  'ban',
  'unban',
  'kick',
  'warn',
  'jail',
  'unjail',
  'freeze',
  'unfreeze',
]);

function createWebhookServer(client) {
  const app = express();
  app.use(express.json());

  app.post('/game-log', async (req, res) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (token !== config.webhookSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { action, moderator, target, reason, extra } = req.body || {};

    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'Missing "action" field' });
    }

    const normalizedAction = action.toLowerCase().trim();

    if (!ALLOWED_ACTIONS.has(normalizedAction)) {
      // Silently-but-explicitly reject anything not on the allow-list
      // (e.g. "Lock Entrance", "Unlock Entrance", or anything else you
      // don't want mirrored into Discord).
      return res.status(400).json({
        error: `Action "${action}" is not logged by this bot.`,
        allowed: Array.from(ALLOWED_ACTIONS),
      });
    }

    if (!target) {
      return res.status(400).json({ error: 'Missing "target" field' });
    }

    await logAction(client, {
      source: 'game',
      action: normalizedAction,
      moderator: moderator || 'In-game system',
      target,
      reason,
      extra,
    });

    return res.status(200).json({ ok: true });
  });

  app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
  });

  return app;
}

module.exports = { createWebhookServer, ALLOWED_ACTIONS };
