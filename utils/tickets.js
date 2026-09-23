const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const config = require('../config');
const { getOpenTicketChannelId, setTicket, removeTicketByChannel, getTicketBan } = require('./ticketStore');

const OPEN_BUTTON_ID = 'ticket-open';
const CLOSE_BUTTON_ID = 'ticket-close';

// The panel players click to open a ticket (posted once by /ticket-setup)
function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🎫 Need help?')
    .setDescription('Click the button below to open a private ticket with the support team.')
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(OPEN_BUTTON_ID).setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

// Fetches every message in a channel, oldest first isn't guaranteed here (Discord returns newest
// first per page) — paginate backwards with `before` until there's nothing left, capped so an
// unusually long-lived ticket channel can't make this loop forever.
const MAX_TRANSCRIPT_MESSAGES = 2000;

async function fetchAllMessages(channel) {
  const all = [];
  let beforeId = undefined;

  while (all.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, before: beforeId });
    if (batch.size === 0) break;

    all.push(...batch.values());
    beforeId = batch.last().id;

    if (batch.size < 100) break; // that was the last page
  }

  return all;
}

// Stops someone from rapidly opening/closing tickets to spam-create channels. Keyed per user, so
// one person spamming doesn't affect anyone else.
const TICKET_COOLDOWN_MS = 30_000;
const lastOpenedAt = new Map();

async function openTicket(interaction) {
  const { guild, user } = interaction;

  const ban = getTicketBan(guild.id, user.id);
  if (ban) {
    const reasonText = ban.reason ? ` Reason: ${ban.reason}` : '';
    return interaction.reply({
      content: `You've been banned from opening tickets.${reasonText}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const lastOpen = lastOpenedAt.get(user.id) || 0;
  const remaining = TICKET_COOLDOWN_MS - (Date.now() - lastOpen);
  if (remaining > 0) {
    return interaction.reply({
      content: `Please wait ${Math.ceil(remaining / 1000)} more second(s) before opening another ticket.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!config.ticketSupportRoleId) {
    return interaction.reply({ content: "Tickets aren't set up yet — TICKET_SUPPORT_ROLE_ID is missing.", flags: MessageFlags.Ephemeral });
  }

  const existingId = getOpenTicketChannelId(guild.id, user.id);
  if (existingId) {
    const existing = await guild.channels.fetch(existingId).catch(() => null);
    if (existing) {
      return interaction.reply({ content: `You already have an open ticket: ${existing}`, flags: MessageFlags.Ephemeral });
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = await guild.channels.create({
    name: `ticket-${user.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: config.ticketSupportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  setTicket(guild.id, user.id, channel.id);
  lastOpenedAt.set(user.id, Date.now());

  const embed = new EmbedBuilder()
    .setTitle('🎫 Ticket opened')
    .setDescription(`Thanks for reaching out, ${user}! <@&${config.ticketSupportRoleId}> will be with you shortly.\n\nDescribe what you need help with below.`)
    .setColor(0x5865f2)
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `${user} <@&${config.ticketSupportRoleId}>`, embeds: [embed], components: [closeRow] });
  await interaction.editReply({ content: `Your ticket is ready: ${channel}` });
}

async function closeTicket(interaction) {
  const { guild, channel, member } = interaction;

  const isSupport = config.ticketSupportRoleId && member.roles.cache.has(config.ticketSupportRoleId);
  const openerId = removeTicketByChannel(guild.id, channel.id);
  const isOpener = openerId === interaction.user.id;

  if (!isSupport && !isOpener) {
    // Put the record back — this person isn't allowed to close it
    if (openerId) setTicket(guild.id, openerId, channel.id);
    return interaction.reply({ content: "Only the person who opened this ticket, or support staff, can close it.", flags: MessageFlags.Ephemeral });
  }

  await interaction.reply(`This ticket is being closed by ${interaction.user}. Closing in 5 seconds...`);

  // A full text transcript, posted as a downloadable file if a log channel is configured
  if (config.ticketLogChannelId) {
    try {
      const logChannel = await guild.channels.fetch(config.ticketLogChannelId);
      const allMessages = await fetchAllMessages(channel);

      const lines = allMessages
        .reverse()
        .map((m) => {
          const attachments = [...m.attachments.values()].map((a) => a.url).join(' ');
          const text = m.content || (attachments ? '' : '(no text)');
          return `[${m.createdAt.toISOString()}] ${m.author.tag}: ${text}${attachments ? ` ${attachments}` : ''}`;
        });
      const transcriptText = lines.join('\n') || '(no messages)';

      const file = new AttachmentBuilder(Buffer.from(transcriptText, 'utf-8'), {
        name: `${channel.name}-transcript.txt`,
      });

      const embed = new EmbedBuilder()
        .setTitle(`Ticket closed: #${channel.name}`)
        .setColor(0x99aab5)
        .addFields(
          { name: 'Closed by', value: `${interaction.user.tag}`, inline: true },
          { name: 'Messages', value: String(allMessages.length), inline: true },
        )
        .setTimestamp();

      await logChannel.send({ embeds: [embed], files: [file] });
    } catch (err) {
      console.error('[tickets] Failed to post transcript:', err);
    }
  }

  setTimeout(() => {
    channel.delete().catch((err) => console.error('[tickets] Failed to delete ticket channel:', err));
  }, 5000);
}

module.exports = { buildPanelMessage, openTicket, closeTicket, OPEN_BUTTON_ID, CLOSE_BUTTON_ID };