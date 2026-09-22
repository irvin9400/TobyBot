// Persistent moderation case history: every warn, kick, ban, and timeout gets a permanent, numbered
// case per server, so you can look up anyone's record later with /history.
//
// This is a JSON file on disk (data/cases.json), the simplest thing that needs no extra setup or
// native dependencies. IMPORTANT if you're on Railway: its filesystem is wiped on every redeploy,
// so without a persistent Volume, your case history resets every time you push an update. To fix
// that: in Railway, open your service > Settings > Volumes > Add Volume, and set its mount path to
// /app/data (or wherever this repo lands inside the container — check your Deploy Logs for the
// working directory if unsure). That gives this file (and rules.json) a real home that survives
// redeploys. Without a Volume, this still works fine day-to-day — it just starts over on redeploy.

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'cases.json');

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

function guildBucket(data, guildId) {
  if (!data[guildId]) {
    data[guildId] = { nextCase: 1, cases: [] };
  }
  return data[guildId];
}

// Adds a case and returns it (with its assigned case number).
function addCase(guildId, { userId, userTag, moderatorTag, action, reason, extra }) {
  const data = readAll();
  const bucket = guildBucket(data, guildId);

  const entry = {
    case: bucket.nextCase,
    userId,
    userTag,
    moderatorTag,
    action,
    reason: reason || null,
    extra: extra || null,
    timestamp: Date.now(),
  };

  bucket.cases.push(entry);
  bucket.nextCase += 1;
  writeAll(data);

  return entry;
}

// Every case for one user in a server, oldest first.
function getCasesForUser(guildId, userId) {
  const data = readAll();
  const bucket = data[guildId];
  if (!bucket) return [];
  return bucket.cases.filter((c) => c.userId === userId);
}

// Removes one case by number. Returns the removed case, or null if there wasn't one.
function removeCase(guildId, caseNumber) {
  const data = readAll();
  const bucket = data[guildId];
  if (!bucket) return null;

  const index = bucket.cases.findIndex((c) => c.case === caseNumber);
  if (index === -1) return null;

  const [removed] = bucket.cases.splice(index, 1);
  writeAll(data);
  return removed;
}

module.exports = { addCase, getCasesForUser, removeCase };