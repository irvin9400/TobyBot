// Remembers, per channel, which message is currently showing the rules — so running /rules set
// again edits that same message instead of posting a new one every time.
//
// This is a small JSON file on disk. IMPORTANT if you're on Railway: the filesystem there is wiped
// on every redeploy, so this file (and the "edit, don't repost" behavior) resets whenever you push
// an update. The rules message itself in Discord is untouched — only the bot's memory of which
// message it was resets, so the next /rules set posts a fresh one instead of editing the old one.
// If that matters to you, ask about adding a small persistent volume, or storing this in a database
// instead.

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'rules.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

function getMessageId(channelId) {
  return readAll()[channelId]?.messageId || null;
}

function setMessageId(channelId, messageId) {
  const data = readAll();
  data[channelId] = { messageId };
  writeAll(data);
}

module.exports = { getMessageId, setMessageId };