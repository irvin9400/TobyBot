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
  const value = data[guildId]?.[userId];
  return typeof value === 'string' ? value : null;
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

// Who opened the ticket in this channel (null if it isn't a ticket). Doesn't change anything.
function getTicketOwner(guildId, channelId) {
  const users = readAll()[guildId] || {};
  for (const [userId, chanId] of Object.entries(users)) {
    if (chanId === channelId) return userId;
  }
  return null;
}

// Each server counts its own tickets: #0001, #0002...
function nextTicketNumber(guildId) {
  const data = readAll();
  data[guildId] = data[guildId] || {};
  const number = (data[guildId].nextNumber || 1);
  data[guildId].nextNumber = number + 1;
  writeAll(data);
  return number;
}

// Details about an open ticket, kept by channel: { number, category, openerId, openerTag, openedAt,
// answers: [{ label, value }], claimedById, claimedByTag }
function setTicketMeta(guildId, channelId, meta) {
  const data = readAll();
  data[guildId] = data[guildId] || {};
  data[guildId].meta = data[guildId].meta || {};
  data[guildId].meta[channelId] = meta;
  writeAll(data);
}

function getTicketMeta(guildId, channelId) {
  return readAll()[guildId]?.meta?.[channelId] || null;
}

function removeTicketMeta(guildId, channelId) {
  const data = readAll();
  if (data[guildId]?.meta?.[channelId]) {
    delete data[guildId].meta[channelId];
    writeAll(data);
  }
}

// Bans a user from opening tickets (separate from a real Discord server ban).
function banFromTickets(guildId, userId, { reason, moderatorTag }) {
  const data = readAll();
  data[guildId] = data[guildId] || {};
  data[guildId].bans = data[guildId].bans || {};
  data[guildId].bans[userId] = { reason: reason || null, moderatorTag, bannedAt: Date.now() };
  writeAll(data);
}

function unbanFromTickets(guildId, userId) {
  const data = readAll();
  const bans = data[guildId]?.bans;
  if (!bans || !bans[userId]) return false;
  delete bans[userId];
  writeAll(data);
  return true;
}

// Returns the ban record ({ reason, moderatorTag, bannedAt }), or null if they aren't banned
function getTicketBan(guildId, userId) {
  const data = readAll();
  return data[guildId]?.bans?.[userId] || null;
}

module.exports = {
  getOpenTicketChannelId,
  setTicket,
  removeTicketByChannel,
  getTicketOwner,
  nextTicketNumber,
  setTicketMeta,
  getTicketMeta,
  removeTicketMeta,
  banFromTickets,
  unbanFromTickets,
  getTicketBan,
};