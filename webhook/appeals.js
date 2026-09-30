// webhook/appeals.js   (all lowercase, so Git and Railway agree on the name)
// Ban appeals from the separate Roblox appeals game.
//
//   POST /appeal/status  { userId }                  -> ban details + appeal status
//   POST /appeal/submit  { userId, username, text }  -> posts the appeal in APPEALS_CHANNEL_ID
//
// Staff press Accept (unbans them in the main game through Roblox Open Cloud) or Deny
// (opens a box for an optional note to the player).
//
// Needs in Railway Variables:
//   APPEALS_CHANNEL_ID=1552002486686978169
//   ROBLOX_MAIN_UNIVERSE_ID=<your Free Admin game's Universe ID>
//   ROBLOX_OPEN_CLOUD_KEY  (the same key as level ranks, with "user-restrictions" read + write added)

const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const config = require('../config');
const { logAction } = require('../utils/logger');

const API = 'https://apis.roblox.com/cloud/v2';
const STORE_FILE = path.join(__dirname, '..', 'data', 'appeals.json');

const COLORS = { pending: 0xfee75c, accepted: 0x57f287, denied: 0xed4245 };

// ------------------------------------------------------------------
// Saved appeals (a small JSON file, like the bot's other stores)
// ------------------------------------------------------------------

function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAll(all) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(all, null, 2));
}

// ------------------------------------------------------------------
// Roblox Open Cloud: bans in the main game
// ------------------------------------------------------------------

function restrictionUrl(userId) {
  return `${API}/universes/${config.robloxMainUniverseId}/user-restrictions/${userId}`;
}

async function getBan(userId) {
  const res = await fetch(restrictionUrl(userId), { headers: { 'x-api-key': config.robloxOpenCloudKey } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't read the ban (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const r = data.gameJoinRestriction;
  if (!r || !r.active) return null;

  const start = r.startTime ? Date.parse(r.startTime) : Date.now();
  const seconds = r.duration ? parseInt(String(r.duration).replace('s', ''), 10) : null;
  return {
    reason: r.displayReason || 'No reason given',
    start,
    endsAt: seconds ? start + seconds * 1000 : null, // null = permanent
  };
}

async function unban(userId) {
  const res = await fetch(`${restrictionUrl(userId)}?updateMask=gameJoinRestriction`, {
    method: 'PATCH',
    headers: { 'x-api-key': config.robloxOpenCloudKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameJoinRestriction: { active: false } }),
  });
  if (!res.ok) throw new Error(`Couldn't unban (${res.status}): ${await res.text()}`);
}

function lengthText(ban) {
  if (!ban.endsAt) return 'Permanent';
  const days = Math.max(0, Math.ceil((ban.endsAt - Date.now()) / 86400000));
  return `Ends <t:${Math.floor(ban.endsAt / 1000)}:R> (${days} day${days === 1 ? '' : 's'} left)`;
}

// ------------------------------------------------------------------
// Discord post
// ------------------------------------------------------------------

function buildEmbed(appeal) {
  const status = appeal.status;
  const embed = new EmbedBuilder()
    .setColor(COLORS[status])
    .setTitle(`Ban Appeal: ${appeal.username}`)
    .setURL(`https://www.roblox.com/users/${appeal.userId}/profile`)
    .addFields(
      { name: 'Ban reason', value: appeal.banReason.slice(0, 1000) },
      { name: 'Length', value: appeal.banLength, inline: true },
      { name: 'Banned', value: `<t:${Math.floor(appeal.banStart / 1000)}:D>`, inline: true },
      { name: 'Their appeal', value: appeal.text.slice(0, 1024) }
    )
    .setTimestamp(appeal.createdAt);

  if (status === 'pending') {
    embed.setFooter({ text: 'Waiting for a decision' });
  } else {
    embed.setFooter({ text: `${status === 'accepted' ? 'Accepted' : 'Denied'} by ${appeal.decidedBy}` });
    if (appeal.note) embed.addFields({ name: 'Note to the player', value: appeal.note.slice(0, 1024) });
  }
  return embed;
}

function buildButtons(appeal) {
  if (appeal.status !== 'pending') return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appeal:accept:${appeal.id}`).setLabel('Accept (unban)').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`appeal:deny:${appeal.id}`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger)
    ),
  ];
}

function canReview(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return (config.modRoleIds || []).some((id) => member.roles?.cache?.has(id));
}

// ------------------------------------------------------------------
// Routes for the appeals game
// ------------------------------------------------------------------

function registerAppealRoutes(app, client, checkAuth) {
  app.post('/appeal/status', async (req, res) => {
    if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const userId = Number(req.body?.userId);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid userId' });

    try {
      const ban = await getBan(userId);
      const all = loadAll();
      // Their most recent appeal
      const appeals = Object.values(all).filter((a) => a.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
      const latest = appeals[0];

      if (!ban) {
        return res.json({ banned: false, appeal: latest ? { status: latest.status, note: latest.note || null } : null });
      }
      const forThisBan = appeals.find((a) => a.banStart === ban.start);
      return res.json({
        banned: true,
        ban: { reason: ban.reason, permanent: !ban.endsAt, endsAt: ban.endsAt ? Math.floor(ban.endsAt / 1000) : null },
        appeal: forThisBan ? { status: forThisBan.status, note: forThisBan.note || null } : null,
      });
    } catch (err) {
      console.error('[appeals] status failed:', err.message);
      return res.status(500).json({ error: 'Could not check the ban right now' });
    }
  });

  app.post('/appeal/submit', async (req, res) => {
    if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const userId = Number(req.body?.userId);
    const username = String(req.body?.username || '').slice(0, 40);
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!Number.isInteger(userId) || userId <= 0 || !username) return res.status(400).json({ error: 'Invalid user' });
    if (text.length < 30) return res.status(400).json({ error: 'Please write at least 30 characters.' });

    try {
      const ban = await getBan(userId);
      if (!ban) return res.status(400).json({ error: "You're not banned, so there's nothing to appeal." });

      const all = loadAll();
      const id = `${userId}-${ban.start}`;
      if (all[id]) return res.status(400).json({ error: "You've already appealed this ban." });

      const appeal = {
        id,
        userId,
        username,
        text,
        banStart: ban.start,
        banReason: ban.reason,
        banLength: lengthText(ban),
        status: 'pending',
        createdAt: Date.now(),
      };

      const channel = await client.channels.fetch(config.appealsChannelId);
      const message = await channel.send({ embeds: [buildEmbed(appeal)], components: buildButtons(appeal) });
      appeal.messageId = message.id;
      all[id] = appeal;
      saveAll(all);

      console.log(`[appeals] New appeal from ${username} (${userId})`);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[appeals] submit failed:', err.message);
      return res.status(500).json({ error: 'Could not send your appeal right now. Try again later.' });
    }
  });
}

// ------------------------------------------------------------------
// Discord buttons and the deny box
// ------------------------------------------------------------------

async function handleAppealButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!canReview(interaction.member)) {
    return interaction.reply({ content: "You don't have permission to review appeals.", flags: MessageFlags.Ephemeral });
  }
  const all = loadAll();
  const appeal = all[id];
  if (!appeal) return interaction.reply({ content: "I couldn't find that appeal.", flags: MessageFlags.Ephemeral });
  if (appeal.status !== 'pending') {
    return interaction.reply({ content: `This appeal was already ${appeal.status}.`, flags: MessageFlags.Ephemeral });
  }

  if (action === 'deny') {
    const modal = new ModalBuilder().setCustomId(`appealdeny:${id}`).setTitle(`Deny ${appeal.username}'s appeal`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('note')
          .setLabel('Note to the player (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(false)
      )
    );
    return interaction.showModal(modal);
  }

  // Accept: unban them in the main game
  await interaction.deferUpdate();
  try {
    await unban(appeal.userId);
  } catch (err) {
    console.error('[appeals] unban failed:', err.message);
    return interaction.followUp({ content: `Unban failed: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  appeal.status = 'accepted';
  appeal.decidedBy = interaction.user.username;
  all[id] = appeal;
  saveAll(all);

  await interaction.editReply({ embeds: [buildEmbed(appeal)], components: [] });
  await logAction(interaction.client, {
    source: 'discord',
    action: 'unban',
    moderator: interaction.user.tag,
    target: appeal.username,
    reason: 'Ban appeal accepted',
  }).catch(() => {});
}

async function handleAppealModal(interaction) {
  const id = interaction.customId.slice('appealdeny:'.length);
  if (!canReview(interaction.member)) {
    return interaction.reply({ content: "You don't have permission to review appeals.", flags: MessageFlags.Ephemeral });
  }
  const all = loadAll();
  const appeal = all[id];
  if (!appeal || appeal.status !== 'pending') {
    return interaction.reply({ content: 'This appeal was already decided.', flags: MessageFlags.Ephemeral });
  }
  appeal.status = 'denied';
  appeal.note = (interaction.fields.getTextInputValue('note') || '').trim() || null;
  appeal.decidedBy = interaction.user.username;
  all[id] = appeal;
  saveAll(all);

  // Update the original post
  try {
    const channel = await interaction.client.channels.fetch(config.appealsChannelId);
    const message = await channel.messages.fetch(appeal.messageId);
    await message.edit({ embeds: [buildEmbed(appeal)], components: [] });
  } catch (err) {
    console.error('[appeals] could not update the post:', err.message);
  }
  return interaction.reply({ content: `Denied ${appeal.username}'s appeal.`, flags: MessageFlags.Ephemeral });
}

module.exports = { registerAppealRoutes, handleAppealButton, handleAppealModal };