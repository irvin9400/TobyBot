const settings = require('./guildSettings');

/**
 * Discord's own slash-command permission requirements (set per-command via
 * setDefaultMemberPermissions) already gate who sees/uses each command.
 * This is an optional extra check: if this server has a mod role (set with /setup, or
 * MOD_ROLE_IDS in .env for your original server), the member must also hold it.
 * If the server has none, this check passes everyone through and Discord's native
 * permissions decide.
 */
function hasModRole(interaction) {
  if (!interaction.guild) return false;
  const modRoleIds = settings.modRoleIds(interaction.guild);
  if (modRoleIds.length === 0) return true;
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;
  return modRoleIds.some((roleId) => memberRoles.has(roleId));
}

module.exports = { hasModRole };