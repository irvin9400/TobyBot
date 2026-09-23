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

const START_BUTTON_ID = 'verify-start';
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
    .setDescription("Click the button below. You'll be shown a short code to type back — this just confirms you're a real person, not a bot.")
    .setColor(0x57f287);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(START_BUTTON_ID).setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

async function startVerification(interaction) {
  if (!config.verifiedRoleId) {
    return interaction.reply({ content: "Verification isn't set up yet — ask an admin to configure it.", flags: MessageFlags.Ephemeral });
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

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return interaction.reply({ content: "Verified! (Couldn't update your roles automatically — ask an admin.)", flags: MessageFlags.Ephemeral });
  }

  try {
    await member.roles.add(config.verifiedRoleId);
    if (config.unverifiedRoleId && member.roles.cache.has(config.unverifiedRoleId)) {
      await member.roles.remove(config.unverifiedRoleId);
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
  if (!config.unverifiedRoleId) return;
  try {
    await member.roles.add(config.unverifiedRoleId);
  } catch (err) {
    console.error('[captcha] Failed to assign the unverified role on join:', err);
  }
}

module.exports = {
  buildPanelMessage,
  startVerification,
  submitVerification,
  applyUnverifiedRole,
  START_BUTTON_ID,
  MODAL_PREFIX,
};