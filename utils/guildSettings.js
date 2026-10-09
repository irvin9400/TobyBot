// Per-server settings, saved by /setup: which role is "verified", which role is the mod/support
// team, where the honeypot is, where logs go, and so on. This is what lets the bot run in more
// than one server at once.
//
// Anything a server hasn't set falls back to the matching value in your environment variables
// (VERIFIED_ROLE_ID, MOD_ROLE_IDS, MOD_LOG_CHANNEL_ID...), but ONLY if that role or channel actually
// belongs to the server in question. So your original server keeps working exactly as before
// without running /setup, and its roles and channels are never used for a different server.
//
// Saved in data/guilds.json, next to cases.json. IMPORTANT if you're on Railway: its filesystem is
// wiped on every redeploy unless you add a Volume mounted at /app/data (see utils/caseStore.js for
// the steps). Without one, every server has to run /setup again after each update you push.

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config');

const FILE_PATH = path.join(__dirname, '..', 'data', 'guilds.json');

let cache = null;

function readAll() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  } catch (err) {
    cache = {};
  }
  return cache;
}

function writeAll(data) {
  cache = data;
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

// What /setup saved for this server ({} if it has never been run there)
function getStored(guildId) {
  return readAll()[guildId] || {};
}

// Merges new values into a server's saved settings. A value of undefined is left as it was.
function update(guildId, patch) {
  const data = readAll();
  const current = data[guildId] || {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) current[key] = value;
  }
  data[guildId] = current;
  writeAll(data);
  return current;
}

// Only returns the ID if that role / channel really is in this server
function roleIn(guild, id) {
  return id && guild?.roles?.cache?.has(id) ? id : null;
}
function channelIn(guild, id) {
  return id && guild?.channels?.cache?.has(id) ? id : null;
}

function verifiedRoleId(guild) {
  return roleIn(guild, getStored(guild.id).verifiedRoleId) || roleIn(guild, config.verifiedRoleId);
}

function unverifiedRoleId(guild) {
  return roleIn(guild, getStored(guild.id).unverifiedRoleId) || roleIn(guild, config.unverifiedRoleId);
}

// Roles allowed to use moderation commands in this server. Empty = no extra check (Discord's own
// per-command permissions decide), the same as leaving MOD_ROLE_IDS blank.
function modRoleIds(guild) {
  const stored = roleIn(guild, getStored(guild.id).modRoleId);
  if (stored) return [stored];
  return (config.modRoleIds || []).filter((id) => roleIn(guild, id));
}

// The role that can see and answer tickets: the server's mod/support role from /setup
function supportRoleId(guild) {
  return roleIn(guild, getStored(guild.id).modRoleId) || roleIn(guild, config.ticketSupportRoleId);
}

function modLogChannelId(guild) {
  return channelIn(guild, getStored(guild.id).logChannelId) || channelIn(guild, config.modLogChannelId);
}

function ticketLogChannelId(guild) {
  return channelIn(guild, config.ticketLogChannelId) || channelIn(guild, getStored(guild.id).logChannelId);
}

function ticketCategoryId(guild) {
  return channelIn(guild, config.ticketCategoryId);
}

// Where "I'm under 13" alerts go: the channel picked in /setup, or the log channel if none was
function ageAlertChannelId(guild) {
  return channelIn(guild, getStored(guild.id).ageAlertChannelId) || modLogChannelId(guild);
}

function honeypotChannelId(guildId) {
  return getStored(guildId).honeypotChannelId || null;
}

// When /setup was first run here (a timestamp), or null. Used as the "only kick people who joined
// after this" line for servers that don't use an unverified role.
function setupAt(guildId) {
  const value = getStored(guildId).setupAt;
  return typeof value === 'number' ? value : null;
}

// Remembers which server the command or button being handled came from, so logAction can send the
// log to THAT server's log channel without every command having to pass it along.
// (index.js wraps each interaction in guildContext.run.)
const guildContext = new AsyncLocalStorage();
function currentGuildId() {
  return guildContext.getStore()?.guildId || null;
}

module.exports = {
  getStored,
  update,
  verifiedRoleId,
  unverifiedRoleId,
  modRoleIds,
  supportRoleId,
  modLogChannelId,
  ticketLogChannelId,
  ticketCategoryId,
  honeypotChannelId,
  ageAlertChannelId,
  setupAt,
  guildContext,
  currentGuildId,
};