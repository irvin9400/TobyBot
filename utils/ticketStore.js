// Tracks which channel is whose open ticket, so someone can't open a second one while they already
// have one, and so the "Close Ticket" button knows which channel it's closing.
//
// Same disk-file caveat as caseStore.js and rulesStore.js: on Railway, this resets on redeploy
// without a persistent Volume. That doesn't delete anyone's actual ticket channel — it just means
// the bot could let someone open a second ticket right after a redeploy, since it forgot about
// their first one. Low-stakes, but worth knowing.

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'tickets.json');

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

function getOpenTicketChannelId(guildId, userId) {
  const data = readAll();
  return data[guildId]?.[userId] || null;
}

function setTicket(guildId, userId, channelId) {
  const data = readAll();
  data[guildId] = data[guildId] || {};
  data[guildId][userId] = channelId;
  writeAll(data);
}

// Removes the record for whichever user owns this channel (used when the channel is closed)
function removeTicketByChannel(guildId, channelId) {
  const data = readAll();
  const users = data[guildId] || {};
  for (const [userId, chanId] of Object.entries(users)) {
    if (chanId === channelId) {
      delete users[userId];
      writeAll(data);
      return userId;
    }
  }
  return null;
}

module.exports = { getOpenTicketChannelId, setTicket, removeTicketByChannel };