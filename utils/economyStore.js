// A simple virtual currency system — no real money involved anywhere, just points for fun within
// the server. Same disk-file caveat as everything else here: resets on a Railway redeploy without
// a persistent Volume (see caseStore.js for how to set one up).

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'economy.json');

const STARTING_BALANCE = 100;
const DAILY_AMOUNT = 100;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

function record(data, guildId, userId) {
  data[guildId] = data[guildId] || {};
  data[guildId][userId] = data[guildId][userId] || { balance: STARTING_BALANCE, lastDaily: 0 };
  return data[guildId][userId];
}

function getBalance(guildId, userId) {
  const data = readAll();
  return record(data, guildId, userId).balance;
}

// delta can be negative (a loss/bet) — never lets a balance go below 0
function addBalance(guildId, userId, delta) {
  const data = readAll();
  const entry = record(data, guildId, userId);
  entry.balance = Math.max(0, Math.floor(entry.balance + delta));
  writeAll(data);
  return entry.balance;
}

function getLastDaily(guildId, userId) {
  const data = readAll();
  return record(data, guildId, userId).lastDaily;
}

function claimDaily(guildId, userId) {
  const data = readAll();
  const entry = record(data, guildId, userId);
  entry.lastDaily = Date.now();
  entry.balance += DAILY_AMOUNT;
  writeAll(data);
  return entry.balance;
}

module.exports = {
  getBalance,
  addBalance,
  getLastDaily,
  claimDaily,
  STARTING_BALANCE,
  DAILY_AMOUNT,
  DAILY_COOLDOWN_MS,
};