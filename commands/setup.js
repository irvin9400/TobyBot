// commands/setup.js
// /setup: sets this bot up for the server it's run in. Run it once in each server.
//
// It saves the server's own roles and channels (so nothing is shared with any other server), then
// posts the "read before you verify" notice and the Verify panel in the verification channel, and
// the warning in the honeypot channel if you picked one.
//
// Running it again updates whatever you pass and posts the messages again. Options you leave out
// keep the value they already had.

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, EmbedBuilder } = require('discord.js');
const config = require('../config');
const settings = require('../utils/guildSettings');
const { buildPanelMessage, buildNoticeMessage } = require('../utils/captcha');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

function honeypotWarning() {
  const embed = new EmbedBuilder()
    .setTitle('🚫 Do not post here')
    .setDescription(
      'This channel is a trap for spam bots.\n\n' +
        '**Anyone who sends a message here is removed from the server automatically.** ' +
        'There is nothing to see here, so please leave it alone.'
    )
    .setColor(0xe44848);
  return { embeds: [embed] };
}

// What the bot is missing in a channel it needs to post in ('' if nothing)
function missingToPost(channel, me) {
  const perms = channel.permissionsFor(me);
  const missing = [];
  if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
  if (!perms?.has(PermissionFlagsBits.SendMessages)) missing.push('Send Messages');
  if (!perms?.has(PermissionFlagsBits.EmbedLinks)) missing.push('Embed Links');
  return missing.join(', ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up verification, the mod role, the honeypot and logging for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt.setName('verify_channel').setDescription('Where the Verify button is posted').addChannelTypes(...TEXT_CHANNELS).setRequired(true))
    .addRoleOption((opt) =>
      opt.setName('verified_role').setDescription('Role given to members when they verify').setRequired(true))
    .addRoleOption((opt) =>
      opt.setName('mod_role').setDescription('Your mod/support role: can use mod commands and answer tickets').setRequired(true))
    .addChannelOption((opt) =>
      opt.setName('honeypot_channel').setDescription('Trap channel: anyone who posts in it is softbanned').addChannelTypes(...TEXT_CHANNELS).setRequired(false))
    .addChannelOption((opt) =>
      opt.setName('log_channel').setDescription('Where mod actions and honeypot catches are logged').addChannelTypes(...TEXT_CHANNELS).setRequired(false))
    .addRoleOption((opt) =>
      opt.setName('unverified_role').setDescription('Optional: role given to new members until they verify').setRequired(false))
    .addChannelOption((opt) =>
      opt.setName('age_alert_channel').setDescription('Where staff are alerted when someone says they are under 13 (default: log channel)').addChannelTypes(...TEXT_CHANNELS).setRequired(false)),

  async execute(interaction) {
    const { guild } = interaction;
    if (!guild) {
      return interaction.reply({ content: 'Run this in a server.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const verifyChannel = interaction.options.getChannel('verify_channel');
    const verifiedRole = interaction.options.getRole('verified_role');
    const modRole = interaction.options.getRole('mod_role');
    const honeypotChannel = interaction.options.getChannel('honeypot_channel');
    const logChannel = interaction.options.getChannel('log_channel');
    const unverifiedRole = interaction.options.getRole('unverified_role');
    const ageAlertChannel = interaction.options.getChannel('age_alert_channel');

    const me = guild.members.me || (await guild.members.fetchMe());
    const myTop = me.roles.highest;

    // ---- Things that would make setup pointless: stop before saving anything ----
    const problems = [];

    const roleProblem = (role, label) => {
      if (role.id === guild.id) return `${label} can't be @everyone.`;
      if (role.managed) return `${label} (${role}) is managed by Discord or another bot, so I can't give it to anyone. Pick a normal role.`;
      if (role.comparePositionTo(myTop) >= 0) {
        return `${label} (${role}) is above or level with my highest role (${myTop}). Drag my role above it in Server Settings > Roles.`;
      }
      return null;
    };

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      problems.push("I don't have the **Manage Roles** permission, so I can't give anyone the verified role.");
    }
    const verifiedProblem = roleProblem(verifiedRole, 'The verified role');
    if (verifiedProblem) problems.push(verifiedProblem);
    if (unverifiedRole) {
      const unverifiedProblem = roleProblem(unverifiedRole, 'The unverified role');
      if (unverifiedProblem) problems.push(unverifiedProblem);
      if (unverifiedRole.id === verifiedRole.id) problems.push("The verified and unverified roles can't be the same role.");
    }
    if (modRole.id === guild.id) problems.push("The mod role can't be @everyone.");

    const verifyMissing = missingToPost(verifyChannel, me);
    if (verifyMissing) problems.push(`I can't post in ${verifyChannel}. I'm missing: ${verifyMissing}.`);

    if (honeypotChannel) {
      if (honeypotChannel.id === verifyChannel.id) problems.push("The honeypot can't be the verification channel: everyone would be trapped.");
      if (logChannel && honeypotChannel.id === logChannel.id) problems.push("The honeypot can't be the log channel.");
      const honeypotMissing = missingToPost(honeypotChannel, me);
      if (honeypotMissing) problems.push(`I can't post in ${honeypotChannel}. I'm missing: ${honeypotMissing}.`);
      if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
        problems.push("The honeypot needs the **Ban Members** permission, which I don't have.");
      }
    }
    if (ageAlertChannel) {
      if (ageAlertChannel.id === verifyChannel.id) problems.push("The age alert channel should be a staff-only channel, not the verification channel.");
      const alertMissing = missingToPost(ageAlertChannel, me);
      if (alertMissing) problems.push(`I can't post in ${ageAlertChannel}. I'm missing: ${alertMissing}.`);
    }
    if (logChannel) {
      const logMissing = missingToPost(logChannel, me);
      if (logMissing) problems.push(`I can't post in ${logChannel}. I'm missing: ${logMissing}.`);
    }

    if (problems.length > 0) {
      return interaction.editReply({
        content: `**Nothing was changed.** Fix ${problems.length === 1 ? 'this' : 'these'} and run \`/setup\` again:\n` + problems.map((p) => `- ${p}`).join('\n'),
      });
    }

    // ---- Save ----
    const before = settings.getStored(guild.id);
    const saved = settings.update(guild.id, {
      verifyChannelId: verifyChannel.id,
      verifiedRoleId: verifiedRole.id,
      modRoleId: modRole.id,
      honeypotChannelId: honeypotChannel ? honeypotChannel.id : undefined, // left out = keep what was there
      logChannelId: logChannel ? logChannel.id : undefined,
      unverifiedRoleId: unverifiedRole ? unverifiedRole.id : undefined,
      ageAlertChannelId: ageAlertChannel ? ageAlertChannel.id : undefined,
      setupAt: typeof before.setupAt === 'number' ? before.setupAt : Date.now(),
      setupBy: interaction.user.id,
    });

    // ---- Post the messages ----
    const posted = [];
    const failed = [];
    try {
      await verifyChannel.send(buildNoticeMessage());
      await verifyChannel.send(buildPanelMessage());
      posted.push(`the verify notice and button in ${verifyChannel}`);
    } catch (err) {
      console.error('[setup] Failed to post the verify panel:', err);
      failed.push(`the verify panel in ${verifyChannel}`);
    }
    if (honeypotChannel) {
      try {
        await honeypotChannel.send(honeypotWarning());
        posted.push(`the warning in ${honeypotChannel}`);
      } catch (err) {
        console.error('[setup] Failed to post the honeypot warning:', err);
        failed.push(`the warning in ${honeypotChannel}`);
      }
    }

    // ---- Tell them what's set, and anything worth knowing ----
    const mention = (id, kind) => (id ? (kind === 'role' ? `<@&${id}>` : `<#${id}>`) : '*not set*');
    const lines = [
      `✅ **${guild.name} is set up.**`,
      '',
      `**Verification channel:** ${mention(saved.verifyChannelId, 'channel')}`,
      `**Verified role:** ${mention(saved.verifiedRoleId, 'role')}`,
      `**Unverified role:** ${mention(settings.unverifiedRoleId(guild), 'role')}`,
      `**Mod/support role:** ${mention(saved.modRoleId, 'role')}`,
      `**Honeypot channel:** ${mention(saved.honeypotChannelId, 'channel')}`,
      `**Log channel:** ${mention(settings.modLogChannelId(guild), 'channel')}`,
      `**Under-13 alerts:** ${mention(settings.ageAlertChannelId(guild), 'channel')}${saved.ageAlertChannelId ? '' : ' *(the log channel)*'}`,
    ];
    if (posted.length > 0) lines.push('', `Posted ${posted.join(', and ')}.`);
    if (failed.length > 0) lines.push('', `⚠️ I couldn't post ${failed.join(', or ')}. Check my permissions there and run \`/setup\` again.`);

    const notes = [];
    if (!settings.ageAlertChannelId(guild)) {
      notes.push("Nobody will be alerted when someone says they're under 13. Set `age_alert_channel` or `log_channel` to fix that.");
    }
    if (!settings.modLogChannelId(guild)) {
      notes.push('No log channel is set, so mod actions and honeypot catches in this server are not logged anywhere. Run `/setup` again with `log_channel` to fix that.');
    }
    if (saved.honeypotChannelId && modRole.comparePositionTo(myTop) >= 0) {
      notes.push(`The mod role is above my highest role. That's fine for mods, but I can only remove honeypot spammers whose roles are below ${myTop}.`);
    }
    if (config.verifyKickHours > 0) {
      notes.push(
        settings.unverifiedRoleId(guild)
          ? `Members who still have the unverified role ${config.verifyKickHours} hours after joining are kicked automatically.`
          : `Members who join from now on and don't verify within ${config.verifyKickHours} hours are kicked automatically. People who were already here are left alone.`
      );
    }
    if (notes.length > 0) lines.push('', ...notes.map((n) => `- ${n}`));

    return interaction.editReply({ content: lines.join('\n').slice(0, 1950) });
  },
};