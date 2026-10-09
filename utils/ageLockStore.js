// Members who pressed "I'm under 13" while verifying. They can't verify again until a staff
// member approves them (in case it was a mis-click) with the button on the alert or /verify-approve.
//
// Only the user ID, when it happened and the alert message are kept; nothing else about them.
// Saved in data/agelocks.json, next to cases.json (keep the Railway volume, see caseStore.js).

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'agelocks.json');

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

// The lock record ({ at, alertChannelId, alertMessageId }), or null if they aren't locked
function getAgeLock(guildId, userId) {
  return readAll()[guildId]?.[userId] || null;
}

function setAgeLock(guildId, userId, record) {
  const data = readAll();
  data[guildId] = data[guildId] || {};
  data[guildId][userId] = record;
  writeAll(data);
}

// Returns the removed record, or null if there wasn't one
function clearAgeLock(guildId, userId) {
  const data = readAll();
  const record = data[guildId]?.[userId];
  if (!record) return null;
  delete data[guildId][userId];
  writeAll(data);
  return record;
}

module.exports = { getAgeLock, setAgeLock, clearAgeLock };