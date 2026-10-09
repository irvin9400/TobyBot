const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const config = require('../config');
const settings = require('./guildSettings');
const { getAgeLock, setAgeLock, clearAgeLock } = require('./ageLockStore');
const { PermissionFlagsBits } = require('discord.js');

const START_BUTTON_ID = 'verify-start';
// Before the code, members confirm they meet Discord's minimum age. Nothing about their age is
// stored: clicking "I confirm" just moves them on to the code.
const AGE_CONFIRM_ID = 'verify-age-yes';
const AGE_DECLINE_ID = 'verify-age-no';
// Buttons on the staff alert: agelock-approve:<userId> and agelock-kick:<userId>
const AGE_APPROVE_PREFIX = 'agelock-approve';
const AGE_KICK_PREFIX = 'agelock-kick';

const LOCKED_MESSAGE =
  "Your verification is on hold because you said you're under 13. A staff member has been told and will review it. " +
  "If you pressed that by mistake, please wait for staff to approve you.";
const MODAL_PREFIX = 'verify-modal'; // the modal's customId, so handleSubmit knows what it's for

// Avoids characters that are easy to misread (no I, L, O, 0, 1)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_LIFETIME_MS = 5 * 60 * 1000;

const pendingCodes = new Map(); // userId -> { code, expiresAt }

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

// The panel new members click (posted once by /verify-setup)
function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('✅ Verify to get access')
    .setDescription("Click the button below, confirm you're 13 or older, then type back the short code you're shown. This confirms you're a real person, not a bot.")
    .setColor(0x57f287);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(START_BUTTON_ID).setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

// The notice posted above the panel by /setup: read the prompt, and the time limit (if one is set)
function buildNoticeMessage() {
  const hours = config.verifyKickHours;
  const lines = [
    'After you click **Verify**, confirm that you are **13 or older**, then a prompt will show you a short code.',
    '',
    'Please **read the prompt carefully** and type the code **exactly as shown**. Rushing it is the most common reason verification fails.',
  ];
  if (hours && hours > 0) {
    lines.push('', `**Failure to verify within ${hours} hours of joining may result in being kicked from the server.**`);
  }

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Read before you verify')
    .setDescription(lines.join('\n'))
    .setColor(0xffcd3c);

  return { embeds: [embed] };
}

// Step 1 (the Verify button): confirm they're 13 or older
async function startVerification(interaction) {
  const verifiedRoleId = settings.verifiedRoleId(interaction.guild);
  if (!verifiedRoleId) {
    return interaction.reply({ content: "Verification isn't set up yet — ask an admin to configure it.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.member?.roles?.cache?.has(verifiedRoleId)) {
    return interaction.reply({ content: "You're already verified. Welcome back!", flags: MessageFlags.Ephemeral });
  }
  if (getAgeLock(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: LOCKED_MESSAGE, flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setTitle('Before you verify')
    .setDescription(
      "Discord requires everyone using it to be at least **13 years old** (older in some countries).\n\n" +
        "Please confirm that you meet Discord's minimum age and that you'll follow Discord's Terms of Service and this server's rules."
    )
    .setColor(0xffcd3c);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(AGE_CONFIRM_ID).setLabel("I confirm I'm 13 or older").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(AGE_DECLINE_ID).setLabel("I'm under 13").setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

// Who counts as staff for the alert buttons: the server's mod role, or Manage Roles / Administrator
function isVerifyStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageRoles)) return true;
  return settings.modRoleIds(member.guild).some((id) => member.roles.cache.has(id));
}

function alertButtons(userId, disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${AGE_APPROVE_PREFIX}:${userId}`).setLabel('Approve (it was a mistake)').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(Boolean(disabled)),
    new ButtonBuilder().setCustomId(`${AGE_KICK_PREFIX}:${userId}`).setLabel('Kick').setEmoji('👢').setStyle(ButtonStyle.Danger).setDisabled(Boolean(disabled))
  );
}

// They said they're under 13: lock their verification and alert staff
async function declineAge(interaction) {
  const { guild, user } = interaction;
  const alreadyLocked = getAgeLock(guild.id, user.id);
  const record = alreadyLocked || { at: Date.now() };

  if (!alreadyLocked) {
    const channelId = settings.ageAlertChannelId(guild);
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (channel) {
      const modRoleId = settings.modRoleIds(guild)[0];
      const member = interaction.member;
      const embed = new EmbedBuilder()
        .setTitle('⚠️ A member said they are under 13')
        .setColor(0xe44848)
        .setDescription(
          `${user} pressed **I'm under 13** while verifying, so their verification is locked.\n\n` +
            '- If it was a **mistake**, press **Approve**: they get the verified role straight away.\n' +
            "- If they **really are under 13**, they can't use Discord under its Terms. Press **Kick**, and consider reporting the account to Discord."
        )
        .addFields(
          { name: 'Member', value: `${user.tag}\nID: ${user.id}`, inline: true },
          { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Joined', value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true }
        )
        .setTimestamp();
      try {
        const sent = await channel.send({
          content: modRoleId ? `<@&${modRoleId}>` : undefined,
          embeds: [embed],
          components: [alertButtons(user.id, false)],
          allowedMentions: { roles: modRoleId ? [modRoleId] : [] },
        });
        record.alertChannelId = channel.id;
        record.alertMessageId = sent.id;
      } catch (err) {
        console.error('[captcha] Failed to post the under-13 alert:', err);
      }
    } else {
      console.warn(`[captcha] ${user.tag} said they're under 13 in ${guild.name}, but there's no age alert or log channel to tell staff.`);
    }
    setAgeLock(guild.id, user.id, record);
  }

  const embed = new EmbedBuilder()
    .setTitle("Sorry, you can't verify")
    .setDescription(
      "Discord's Terms of Service require users to be at least 13 years old, so we can't let you into this server.\n\n" +
        "A staff member has been told. If you pressed this **by mistake**, don't worry: please wait, and a staff member will review it and let you in."
    )
    .setColor(0x99aab5);
  return interaction.update({ embeds: [embed], components: [] });
}

// Gives a member the verified role (and takes the unverified role away). Returns an error message or null.
async function grantVerified(member) {
  const verifiedRoleId = settings.verifiedRoleId(member.guild);
  const unverifiedRoleId = settings.unverifiedRoleId(member.guild);
  if (!verifiedRoleId) return "This server doesn't have a verified role. Run `/setup` first.";
  try {
    await member.roles.add(verifiedRoleId);
    if (unverifiedRoleId && member.roles.cache.has(unverifiedRoleId)) await member.roles.remove(unverifiedRoleId);
    return null;
  } catch (err) {
    console.error('[captcha] Failed to give the verified role:', err);
    return "I couldn't give them the verified role. Check my role is above it and I have Manage Roles.";
  }
}

// Marks the staff alert as dealt with (buttons greyed out, with who did what)
async function closeAlert(guild, record, text, color) {
  if (!record?.alertChannelId || !record?.alertMessageId) return;
  try {
    const channel = await guild.channels.fetch(record.alertChannelId);
    const message = await channel.messages.fetch(record.alertMessageId);
    const embed = EmbedBuilder.from(message.embeds[0]).setColor(color).addFields({ name: 'Outcome', value: text });
    const userId = message.components[0]?.components[0]?.customId?.split(':')[1];
    await message.edit({ embeds: [embed], components: userId ? [alertButtons(userId, true)] : [] });
  } catch (err) {
    // The alert was deleted, or the bot can't see it any more: nothing to update
  }
}

// Staff approve someone who pressed "I'm under 13" by mistake. Used by the alert button and
// /verify-approve. Returns a message for the staff member.
async function approveAgeLock(guild, userId, staffUser) {
  const record = clearAgeLock(guild.id, userId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    if (record) await closeAlert(guild, record, `Unlocked by ${staffUser} (they had left the server, so no role was given).`, 0x99aab5);
    return record
      ? "They're no longer in the server. Their lock is cleared, so they can verify normally if they come back."
      : "That member isn't in the server and wasn't locked.";
  }
  const problem = await grantVerified(member);
  if (problem) {
    if (record) setAgeLock(guild.id, userId, record); // Put the lock back so nothing is half done
    return problem;
  }
  await closeAlert(guild, record, `✅ Approved by ${staffUser}`, 0x57f287);
  member
    .send(`Good news: a staff member reviewed your verification in **${guild.name}** and let you in. Welcome!`)
    .catch(() => {});
  return `Approved ${member.user.tag}: they now have the verified role.`;
}

// The two buttons on the staff alert
async function handleAgeAlertButton(interaction) {
  const [prefix, userId] = interaction.customId.split(':');
  if (!isVerifyStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use these buttons.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (prefix === AGE_APPROVE_PREFIX) {
    const message = await approveAgeLock(interaction.guild, userId, interaction.user);
    return interaction.editReply({ content: message });
  }

  // Kick
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return interaction.editReply({ content: "They're no longer in the server." });
  }
  if (!member.kickable) {
    return interaction.editReply({ content: "I can't kick them. Check my role is above theirs and I have Kick Members." });
  }
  await member
    .send(`You were removed from **${interaction.guild.name}** because Discord requires users to be at least 13 years old.`)
    .catch(() => {});
  await member.kick('Said they are under 13 while verifying');
  await closeAlert(interaction.guild, getAgeLock(interaction.guild.id, userId), `👢 Kicked by ${interaction.user}`, 0x99aab5);
  // The lock stays, so if they rejoin they still can't verify without staff approval
  return interaction.editReply({ content: `Kicked ${member.user.tag}. If they rejoin, they still can't verify without staff approval.` });
}

// Step 2 ("I confirm" button): the same type-the-code box as before
async function confirmAge(interaction) {
  if (!settings.verifiedRoleId(interaction.guild)) {
    return interaction.reply({ content: "Verification isn't set up yet — ask an admin to configure it.", flags: MessageFlags.Ephemeral });
  }
  if (getAgeLock(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: LOCKED_MESSAGE, flags: MessageFlags.Ephemeral });
  }

  const code = generateCode();
  pendingCodes.set(interaction.user.id, { code, expiresAt: Date.now() + CODE_LIFETIME_MS });

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:${interaction.user.id}`)
    .setTitle(`Type this code: ${code}`);

  const input = new TextInputBuilder()
    .setCustomId('code')
    .setLabel('Confirmation code')
    .setStyle(TextInputStyle.Short)
    .setMinLength(CODE_LENGTH)
    .setMaxLength(CODE_LENGTH)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function submitVerification(interaction) {
  const pending = pendingCodes.get(interaction.user.id);
  const typed = interaction.fields.getTextInputValue('code').trim().toUpperCase();

  if (!pending || Date.now() > pending.expiresAt) {
    pendingCodes.delete(interaction.user.id);
    return interaction.reply({ content: "That code expired. Click **Verify** again to get a new one.", flags: MessageFlags.Ephemeral });
  }

  if (typed !== pending.code) {
    return interaction.reply({ content: "That didn't match. Click **Verify** again to try with a fresh code.", flags: MessageFlags.Ephemeral });
  }

  pendingCodes.delete(interaction.user.id);

  if (getAgeLock(interaction.guild.id, interaction.user.id)) {
    return interaction.reply({ content: LOCKED_MESSAGE, flags: MessageFlags.Ephemeral });
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return interaction.reply({ content: "Verified! (Couldn't update your roles automatically — ask an admin.)", flags: MessageFlags.Ephemeral });
  }

  // Each server has its own roles (set with /setup)
  const verifiedRoleId = settings.verifiedRoleId(interaction.guild);
  const unverifiedRoleId = settings.unverifiedRoleId(interaction.guild);
  if (!verifiedRoleId) {
    return interaction.reply({
      content: "Your code was correct, but this server's verified role is missing. Ask an admin to run `/setup` again.",
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await member.roles.add(verifiedRoleId);
    if (unverifiedRoleId && member.roles.cache.has(unverifiedRoleId)) {
      await member.roles.remove(unverifiedRoleId);
    }
    await interaction.reply({ content: "✅ You're verified! Welcome in.", flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('[captcha] Failed to update roles after verification:', err);
    await interaction.reply({
      content: "Your code was correct, but I couldn't update your roles — I probably need a higher position in the role list, or the Manage Roles permission. Ask an admin to check.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

// Called when someone joins, if you've set an unverified role to auto-assign
async function applyUnverifiedRole(member) {
  const unverifiedRoleId = settings.unverifiedRoleId(member.guild);
  if (!unverifiedRoleId) return;
  try {
    await member.roles.add(unverifiedRoleId);
  } catch (err) {
    console.error('[captcha] Failed to assign the unverified role on join:', err);
  }
}

module.exports = {
  handleAgeAlertButton,
  approveAgeLock,
  AGE_APPROVE_PREFIX,
  AGE_KICK_PREFIX,
  confirmAge,
  declineAge,
  AGE_CONFIRM_ID,
  AGE_DECLINE_ID,
  buildPanelMessage,
  buildNoticeMessage,
  startVerification,
  submitVerification,
  applyUnverifiedRole,
  START_BUTTON_ID,
  MODAL_PREFIX,
};