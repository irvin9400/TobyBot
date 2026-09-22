// Turns "10m", "12h", "7d", "2w" into milliseconds, and formats milliseconds back into a short
// string like "7d" for confirmations and logs.
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function parseDuration(input) {
  const match = /^(\d+)(m|h|d|w)$/i.exec(String(input).trim());
  if (!match) return null;
  const [, amount, unit] = match;
  return parseInt(amount, 10) * UNIT_MS[unit.toLowerCase()];
}

function formatDuration(ms) {
  const days = Math.floor(ms / UNIT_MS.d);
  const hours = Math.floor((ms % UNIT_MS.d) / UNIT_MS.h);
  const minutes = Math.floor((ms % UNIT_MS.h) / UNIT_MS.m);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && !days) parts.push(`${minutes}m`); // skip minutes once it's day-scale, keeps it short
  return parts.length ? parts.join(' ') : '<1m';
}

module.exports = { parseDuration, formatDuration };