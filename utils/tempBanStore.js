// Tracks temporary bans (a plain Discord ban with no expiration built in, plus our own "unban this
// person at time X" reminder). index.js checks this periodically and lifts any ban whose time is up.
//
// Same disk-file caveat as caseStore.js and rulesStore.js: on Railway, this resets on redeploy
// without a persistent Volume. A temp ban that's already in effect stays banned either way — the
// only thing that resets is the bot's memory of WHEN to lift it, so it just stays banned instead of
// being freed automatically until you add a Volume (see caseStore.js for how) or unban them by hand.

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'tempbans.json');

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

function addTempBan(guildId, userId, { expiresAt, reason, moderatorTag }) {
  const data = readAll();
  data[guildId] = data[guildId] || {};
  data[guildId][userId] = { expiresAt, reason, moderatorTag };
  writeAll(data);
}

// Removes the reminder (used once it's lifted, or if someone unbans them manually first)
function removeTempBan(guildId, userId) {
  const data = readAll();
  if (data[guildId]) {
    delete data[guildId][userId];
    writeAll(data);
  }
}

// Every temp ban across every server, flattened, for the periodic sweep
function getAllTempBans() {
  const data = readAll();
  const all = [];
  for (const [guildId, users] of Object.entries(data)) {
    for (const [userId, info] of Object.entries(users)) {
      all.push({ guildId, userId, ...info });
    }
  }
  return all;
}

module.exports = { addTempBan, removeTempBan, getAllTempBans };