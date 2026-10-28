// webhook/appeals.js   (all lowercase, so Git and Railway agree on the name)
// Ban appeals from the separate Roblox appeals game - for every game in APPEAL_GAMES
// (Free Admin, Pine Hollow, ...). Each ban is appealed separately, once per ban.
//
//   POST /appeal/status  { userId }                         -> every active ban + its appeal status
//   POST /appeal/submit  { userId, username, text, game }   -> posts the appeal in APPEALS_CHANNEL_ID
//                        (game = the game's name from APPEAL_GAMES; can be left out if they're
//                         only banned from one game)
//
// Staff press Accept (unbans them in THAT game through Roblox Open Cloud) or Deny
// (opens a box for an optional note to the player).
//
// Needs in Railway Variables:
//   APPEALS_CHANNEL_ID=1552002486686978169
//   APPEAL_GAMES=Free Admin:<Free Admin Universe ID>,Pine Hollow:<Pine Hollow Universe ID>
//     (without APPEAL_GAMES, only ROBLOX_MAIN_UNIVERSE_ID = Free Admin is checked, like before)
//   ROBLOX_OPEN_CLOUD_KEY  (the same key as level ranks, with "user-restrictions" read + write added
//                           for EVERY game in APPEAL_GAMES)

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

function games() {
  return config.appealGames || [];
}

// appeals saved before multi-game support have no universeId: they were all Free Admin
function legacyUniverseId() {
  return String(config.robloxMainUniverseId || games()[0]?.universeId || '');
}
function universeOf(appeal) {
  return String(appeal.universeId || legacyUniverseId());
}
function gameName(universeId) {
  return games().find((g) => g.universeId === String(universeId))?.name || 'Free Admin';
}

function restrictionUrl(universeId, userId) {
  return `${API}/universes/${universeId}/user-restrictions/${userId}`;
}

async function getBan(universeId, userId) {
  const res = await fetch(restrictionUrl(universeId, userId), { headers: { 'x-api-key': config.robloxOpenCloudKey } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't read the ban (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const r = data.gameJoinRestriction;
  if (!r || !r.active) return null;

  const start = r.startTime ? Date.parse(r.startTime) : Date.now();
  const seconds = r.duration ? parseInt(String(r.duration).replace('s', ''), 10) : null;
  return {
    universeId: String(universeId),
    game: gameName(universeId),
    reason: r.displayReason || 'No reason given',
    start,
    endsAt: seconds ? start + seconds * 1000 : null, // null = permanent
  };
}

// every game they're banned from right now (a game that can't be checked is skipped, but if NONE can
// be checked it throws, so the player sees "try again" instead of "you're not banned")
async function getBans(userId) {
  const results = await Promise.allSettled(games().map((g) => getBan(g.universeId, userId)));
  const failed = results.filter((r) => r.status === 'rejected');
  failed.forEach((r) => console.error('[appeals] ban check failed:', r.reason?.message));
  if (games().length > 0 && failed.length === results.length) throw new Error('No game could be checked');
  return results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
}

async function unban(universeId, userId) {
  const res = await fetch(`${restrictionUrl(universeId, userId)}?updateMask=gameJoinRestriction`, {
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
    .setTitle(`Ban Appeal: ${appeal.username} (${appeal.game || gameName(universeOf(appeal))})`)
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
      const bans = await getBans(userId);
      const all = loadAll();
      // their appeals, newest first
      const appeals = Object.values(all).filter((a) => a.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
      const appealFor = (ban) => appeals.find((a) => a.banStart === ban.start && universeOf(a) === ban.universeId);
      const short = (a) => (a ? { status: a.status, note: a.note || null, game: a.game || gameName(universeOf(a)) } : null);

      const list = bans.map((ban) => ({
        game: ban.game,
        reason: ban.reason,
        permanent: !ban.endsAt,
        endsAt: ban.endsAt ? Math.floor(ban.endsAt / 1000) : null,
        appeal: short(appealFor(ban)),
      }));
      if (list.length === 0) {
        return res.json({ banned: false, bans: [], appeal: short(appeals[0]) });
      }
      // banned/ban/appeal = the first ban (what the older appeals game reads); bans = all of them
      const first = list[0];
      return res.json({
        banned: true,
        bans: list,
        ban: { game: first.game, reason: first.reason, permanent: first.permanent, endsAt: first.endsAt },
        appeal: first.appeal,
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
    const wanted = req.body?.game ? String(req.body.game).slice(0, 60) : null;
    if (!Number.isInteger(userId) || userId <= 0 || !username) return res.status(400).json({ error: 'Invalid user' });
    if (text.length < 30) return res.status(400).json({ error: 'Please write at least 30 characters.' });

    try {
      const bans = await getBans(userId);
      if (bans.length === 0) return res.status(400).json({ error: "You're not banned, so there's nothing to appeal." });
      const ban = wanted ? bans.find((b) => b.game.toLowerCase() === wanted.toLowerCase()) : bans[0];
      if (!ban) return res.status(400).json({ error: `You're not banned from ${wanted}.` });

      const all = loadAll();
      // Free Admin keeps the old id format, so appeals sent before this update still count
      const id = ban.universeId === legacyUniverseId() ? `${userId}-${ban.start}` : `${ban.universeId}-${userId}-${ban.start}`;
      if (all[id]) return res.status(400).json({ error: `You've already appealed your ${ban.game} ban.` });

      const appeal = {
        id,
        userId,
        username,
        text,
        universeId: ban.universeId,
        game: ban.game,
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

      console.log(`[appeals] New ${ban.game} appeal from ${username} (${userId})`);
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
    await unban(universeOf(appeal), appeal.userId);
  } catch (err) {
    console.error('[appeals] unban failed:', err.message);
    return interaction.followUp({ content: `Unban failed: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  appeal.status = 'accepted';
  appeal.decidedBy = interaction.user.username;
  all[id] = appeal;
  saveAll(all);

  await interaction.editReply({ embeds: [buildEmbed(appeal)], components: [] });
  // Logged as a game unban (in the game the ban was from), in the game log with the other game cases
  await logAction(interaction.client, {
    source: 'game',
    category: 'case',
    action: 'unban',
    moderator: interaction.user.username,
    target: `[${appeal.username}](https://www.roblox.com/users/${appeal.userId}/profile)`,
    reason: 'Ban appeal accepted',
    extra: { Game: appeal.game || gameName(universeOf(appeal)), Via: 'Ban appeal (Discord)' },
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