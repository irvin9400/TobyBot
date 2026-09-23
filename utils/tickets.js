const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const config = require('../config');
const { getOpenTicketChannelId, setTicket, removeTicketByChannel } = require('./ticketStore');

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

async function openTicket(interaction) {
  const { guild, user } = interaction;

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

  // A simple text transcript, if a log channel is configured
  if (config.ticketLogChannelId) {
    try {
      const logChannel = await guild.channels.fetch(config.ticketLogChannelId);
      const messages = await channel.messages.fetch({ limit: 100 });
      const transcript = [...messages.values()]
        .reverse()
        .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
        .join('\n')
        .slice(0, 3800); // stay under Discord's field/description limits

      const embed = new EmbedBuilder()
        .setTitle(`Ticket closed: #${channel.name}`)
        .setDescription(transcript || '(no messages)')
        .setColor(0x99aab5)
        .addFields({ name: 'Closed by', value: `${interaction.user.tag}`, inline: true })
        .setTimestamp();

      await logChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error('[tickets] Failed to post transcript:', err);
    }
  }

  setTimeout(() => {
    channel.delete().catch((err) => console.error('[tickets] Failed to delete ticket channel:', err));
  }, 5000);
}

module.exports = { buildPanelMessage, openTicket, closeTicket, OPEN_BUTTON_ID, CLOSE_BUTTON_ID };