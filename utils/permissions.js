const config = require('../config');

/**
 * Discord's own slash-command permission requirements (set per-command via
 * setDefaultMemberPermissions) already gate who sees/uses each command.
 * This is an optional extra check: if MOD_ROLE_IDS is set in .env, the
 * member must also hold one of those roles. If it's left blank, this
 * check passes everyone through and Discord's native permissions decide.
 */
function hasModRole(interaction) {
  if (config.modRoleIds.length === 0) return true;
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;
  return config.modRoleIds.some((roleId) => memberRoles.has(roleId));
}

module.exports = { hasModRole };
