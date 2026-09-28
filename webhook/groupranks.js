// webhook/groupranks.js   (all lowercase, so Git and Railway agree on the name)
// Gives group members a level role, like "Beginner - Lvl 1-4", based on their level in the game.
//
// SAFETY: only moves people between your default Member rank and the level ranks below.
// Anyone with any other rank (Admin, Co-Owner, Owner, or any special role) is never changed.
//
// Needs in Railway Variables:
//   ROBLOX_GROUP_ID=79158451
//   ROBLOX_OPEN_CLOUD_KEY=your API key (Creator Hub > Open Cloud > API Keys, with group read + write)

const config = require('../config');

// Your level roles. Create these in your community with EXACTLY these rank numbers.
// Each role covers levels from minLevel up to the next role's minLevel - 1.
const LEVEL_ROLES = [
  { minLevel: 1, rank: 2, name: 'Beginner - Lvl 1-4' },
  { minLevel: 5, rank: 3, name: 'Explorer - Lvl 5-9' },
  { minLevel: 10, rank: 4, name: 'Dedicated - Lvl 10-14' },
  { minLevel: 15, rank: 5, name: 'Veteran - Lvl 15-19' },
  { minLevel: 20, rank: 6, name: 'Legend - Lvl 20+' },
];

// The rank people get when they first join your community (Roblox's default is 1, "Member")
const MEMBER_RANK = 1;

const API = 'https://apis.roblox.com/cloud/v2';
const MANAGED_RANKS = new Set([MEMBER_RANK, ...LEVEL_ROLES.map((r) => r.rank)]);

function headers() {
  return { 'x-api-key': config.robloxOpenCloudKey, 'Content-Type': 'application/json' };
}

// Role IDs by rank number, cached for 10 minutes
let rolesCache = null;
let rolesFetchedAt = 0;

async function getRoles() {
  if (rolesCache && Date.now() - rolesFetchedAt < 10 * 60 * 1000) return rolesCache;
  const byRank = new Map();
  const byId = new Map();
  let pageToken = '';
  do {
    const url = `${API}/groups/${config.robloxGroupId}/roles?maxPageSize=20${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`Couldn't list group roles (${res.status}): ${await res.text()}`);
    const data = await res.json();
    for (const role of data.groupRoles || []) {
      byRank.set(role.rank, role);
      byId.set(String(role.id), role);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  rolesCache = { byRank, byId };
  rolesFetchedAt = Date.now();
  return rolesCache;
}

async function getMembership(userId) {
  const filter = encodeURIComponent(`user == 'users/${userId}'`);
  const res = await fetch(`${API}/groups/${config.robloxGroupId}/memberships?maxPageSize=1&filter=${filter}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Couldn't look up membership (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.groupMemberships || [])[0] || null;
}

function targetRankFor(level) {
  let target = null;
  for (const role of LEVEL_ROLES) {
    if (level >= role.minLevel) target = role;
  }
  return target;
}

// Returns a short result string for logging
async function syncLevelRank(userId, level) {
  if (!config.robloxOpenCloudKey || !config.robloxGroupId) return 'not set up (missing ROBLOX_OPEN_CLOUD_KEY or ROBLOX_GROUP_ID)';

  const target = targetRankFor(level);
  if (!target) return 'no level role for this level';

  const membership = await getMembership(userId);
  if (!membership) return 'not in the community';

  const roles = await getRoles();
  const currentRoleId = String(membership.role).split('/').pop();
  const currentRole = roles.byId.get(currentRoleId);
  const currentRank = currentRole ? currentRole.rank : null;

  // Never touch staff or any role that isn't Member / a level role
  if (currentRank === null || !MANAGED_RANKS.has(currentRank)) return `skipped (rank ${currentRank} isn't a level rank)`;
  if (currentRank === target.rank) return 'already correct';

  const newRole = roles.byRank.get(target.rank);
  if (!newRole) return `no role with rank ${target.rank} exists in the community (create "${target.name}")`;

  const res = await fetch(`${API}/${membership.path}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      path: membership.path,
      user: `users/${userId}`,
      role: `groups/${config.robloxGroupId}/roles/${newRole.id}`,
    }),
  });
  if (!res.ok) throw new Error(`Couldn't change rank (${res.status}): ${await res.text()}`);

  return `ranked to "${newRole.displayName}" (rank ${target.rank})`;
}

module.exports = { syncLevelRank };