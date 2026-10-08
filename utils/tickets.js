// Support tickets.
//
// How it works for a member:
//   1. They pick what they need from the menu on the panel (posted by /ticket-setup).
//   2. A short form pops up with questions that fit what they picked.
//   3. A private channel opens for them and the support team, starting with their answers.
//
// For staff: Claim shows who's handling it, /ticket add and /ticket remove bring other people in or
// out, and Close asks for a reason. On closing, a transcript goes to the log channel and the member
// gets a DM with the outcome and a copy.
//
// To change the choices or the questions, edit CATEGORIES below. Each server uses its own
// mod/support role and log channel (from /setup).

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const settings = require('./guildSettings');
const {
  getOpenTicketChannelId,
  setTicket,
  removeTicketByChannel,
  getTicketOwner,
  nextTicketNumber,
  setTicketMeta,
  getTicketMeta,
  removeTicketMeta,
  getTicketBan,
} = require('./ticketStore');

const OPEN_BUTTON_ID = 'ticket-open'; // The button on panels posted before the menu existed
const CLOSE_BUTTON_ID = 'ticket-close';
const CLAIM_BUTTON_ID = 'ticket-claim';
const CATEGORY_SELECT_ID = 'ticket-category';
const FORM_MODAL_PREFIX = 'ticket-form'; // ticket-form:<category id>
const CLOSE_MODAL_ID = 'ticket-closeform';

const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;
const GREY = 0x99aab5;

// What a member can open a ticket about. Each one has its own short form (up to 5 questions;
// labels can be 45 characters at most). "note" is shown at the top of the ticket.
const CATEGORIES = [
  {
    id: 'help',
    label: 'General help',
    emoji: '💬',
    description: 'Questions about the server or our games',
    fields: [
      { id: 'details', label: 'What do you need help with?', long: true, required: true },
    ],
  },
  {
    id: 'report',
    label: 'Report a player',
    emoji: '🚩',
    description: 'Someone breaking the rules, in a game or here',
    fields: [
      { id: 'who', label: 'Who are you reporting? (username)', required: true },
      { id: 'where', label: 'Where did it happen?', placeholder: 'Obby, Free Admin, Event Central or Discord', required: true },
      { id: 'details', label: 'What happened?', long: true, required: true },
      { id: 'evidence', label: 'Link to evidence (optional)', placeholder: 'A screenshot or video link. You can also upload it in the ticket.', required: false },
    ],
    note: 'If you have screenshots or a video, upload them here. Reports with evidence are dealt with fastest.',
  },
  {
    id: 'moderation',
    label: 'Moderation question',
    emoji: '⚖️',
    description: 'About a warning, kick, mute or ban',
    fields: [
      { id: 'case', label: 'Case number, if you have one', required: false },
      { id: 'details', label: 'What would you like to ask?', long: true, required: true },
    ],
    note: 'Bans from our Roblox games are appealed in the Appeals game on Roblox, not in a ticket.',
  },
  {
    id: 'event',
    label: 'Event Central booking',
    emoji: '🎤',
    description: 'Help with a booking or an event',
    fields: [
      { id: 'event', label: 'Event name and date', required: false },
      { id: 'details', label: 'What do you need help with?', long: true, required: true },
    ],
    note: 'Never post your event access code here. Staff will not ask for it.',
  },
  {
    id: 'bug',
    label: 'Bug report',
    emoji: '🐛',
    description: 'Something in one of our games is broken',
    fields: [
      { id: 'game', label: 'Which game?', placeholder: 'Obby, Free Admin or Event Central', required: true },
      { id: 'details', label: 'What happened, and how do we repeat it?', long: true, required: true },
    ],
  },
  {
    id: 'other',
    label: 'Something else',
    emoji: '❔',
    description: "Anything that doesn't fit the options above",
    fields: [
      { id: 'details', label: 'How can we help?', long: true, required: true },
    ],
  },
];

function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

function ticketNumberText(number) {
  return number ? `#${String(number).padStart(4, '0')}` : '';
}

function categoryMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CATEGORY_SELECT_ID)
      .setPlaceholder('Choose what you need help with')
      .addOptions(CATEGORIES.map((c) => ({ label: c.label, value: c.id, description: c.description, emoji: c.emoji })))
  );
}

// The panel members use to open a ticket (posted once by /ticket-setup)
function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🎫 Need help?')
    .setDescription(
      'Choose a topic from the menu below and answer a couple of quick questions. ' +
        'A private ticket will open for you and the support team.\n\n' +
        CATEGORIES.map((c) => `${c.emoji} **${c.label}**: ${c.description}`).join('\n')
    )
    .setFooter({ text: 'One open ticket per person. Please be patient: staff are volunteers.' })
    .setColor(BLURPLE);

  return { embeds: [embed], components: [categoryMenu()] };
}

// Stops someone from rapidly opening/closing tickets to spam-create channels. Keyed per user, so
// one person spamming doesn't affect anyone else.
const TICKET_COOLDOWN_MS = 30_000;
const lastOpenedAt = new Map();

// Why this person can't open a ticket right now (a message for them), or null if they can
async function blockedReason(interaction) {
  const { guild, user } = interaction;

  const ban = getTicketBan(guild.id, user.id);
  if (ban) {
    return `You've been banned from opening tickets.${ban.reason ? ` Reason: ${ban.reason}` : ''}`;
  }

  const remaining = TICKET_COOLDOWN_MS - (Date.now() - (lastOpenedAt.get(user.id) || 0));
  if (remaining > 0) {
    return `Please wait ${Math.ceil(remaining / 1000)} more second(s) before opening another ticket.`;
  }

  if (!settings.supportRoleId(guild)) {
    return "Tickets aren't set up yet. An admin needs to run `/setup` and pick the mod/support role.";
  }

  const existingId = getOpenTicketChannelId(guild.id, user.id);
  if (existingId) {
    const existing = await guild.channels.fetch(existingId).catch(() => null);
    if (existing) return `You already have an open ticket: ${existing}`;
  }
  return null;
}

function isSupport(member) {
  const supportRoleId = settings.supportRoleId(member.guild);
  if (supportRoleId && member.roles.cache.has(supportRoleId)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// ---------------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------------

// The old "Open Ticket" button (on panels posted before the menu): show the menu privately
async function openTicket(interaction) {
  const blocked = await blockedReason(interaction);
  if (blocked) {
    return interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ content: 'What do you need help with?', components: [categoryMenu()], flags: MessageFlags.Ephemeral });
}

// They picked a topic: show that topic's form
async function handleCategorySelect(interaction) {
  const category = categoryById(interaction.values?.[0]);
  if (!category) {
    return interaction.reply({ content: "That option isn't available any more. Try again.", flags: MessageFlags.Ephemeral });
  }
  const blocked = await blockedReason(interaction);
  if (blocked) {
    return interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder().setCustomId(`${FORM_MODAL_PREFIX}:${category.id}`).setTitle(category.label.slice(0, 45));
  for (const field of category.fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label.slice(0, 45))
      .setStyle(field.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required !== false)
      .setMaxLength(field.long ? 1000 : 200);
    if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return interaction.showModal(modal);
}

function ticketButtons(meta) {
  const claim = new ButtonBuilder()
    .setCustomId(CLAIM_BUTTON_ID)
    .setEmoji('🙋')
    .setLabel(meta?.claimedByTag ? `Claimed by ${meta.claimedByTag}`.slice(0, 80) : 'Claim')
    .setStyle(meta?.claimedByTag ? ButtonStyle.Success : ButtonStyle.Secondary);
  const close = new ButtonBuilder().setCustomId(CLOSE_BUTTON_ID).setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(claim, close);
}

// They sent the form: create the ticket
async function handleFormSubmit(interaction) {
  const { guild, user } = interaction;
  const category = categoryById(interaction.customId.split(':')[1]);
  if (!category) {
    return interaction.reply({ content: "That option isn't available any more. Try again.", flags: MessageFlags.Ephemeral });
  }
  const blocked = await blockedReason(interaction);
  if (blocked) {
    return interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  lastOpenedAt.set(user.id, Date.now()); // Before creating the channel, so a double-submit can't make two

  const answers = [];
  for (const field of category.fields) {
    let value = '';
    try {
      value = interaction.fields.getTextInputValue(field.id).trim();
    } catch (err) {
      value = '';
    }
    if (value) answers.push({ label: field.label, value });
  }

  const supportRoleId = settings.supportRoleId(guild);
  const me = guild.members.me || (await guild.members.fetchMe());
  const number = nextTicketNumber(guild.id);
  const view = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];

  let channel;
  try {
    channel = await guild.channels.create({
      name: `ticket-${String(number).padStart(4, '0')}-${user.username}`.toLowerCase().slice(0, 90),
      type: ChannelType.GuildText,
      parent: settings.ticketCategoryId(guild) || undefined,
      topic: `Ticket ${ticketNumberText(number)} | ${category.label} | Opened by ${user.tag} (${user.id})`.slice(0, 1000),
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [...view, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        { id: supportRoleId, allow: [...view, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        // The bot itself, so it can always post, read the transcript and delete the channel
        { id: me.id, allow: [...view, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels] },
      ],
    });
  } catch (err) {
    console.error('[tickets] Failed to create the ticket channel:', err);
    lastOpenedAt.delete(user.id);
    return interaction.editReply({ content: "I couldn't create your ticket. I may be missing the Manage Channels permission. Please let a staff member know." });
  }

  const meta = {
    number,
    category: category.id,
    categoryLabel: category.label,
    openerId: user.id,
    openerTag: user.tag,
    openedAt: Date.now(),
    answers,
    claimedById: null,
    claimedByTag: null,
  };
  setTicket(guild.id, user.id, channel.id);
  setTicketMeta(guild.id, channel.id, meta);

  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji} Ticket ${ticketNumberText(number)}: ${category.label}`)
    .setDescription(
      `Thanks for reaching out, ${user}! A member of <@&${supportRoleId}> will be with you as soon as they can.` +
        (category.note ? `\n\n**Please note:** ${category.note}` : '') +
        '\n\nAdd anything else we should know below.'
    )
    .setColor(BLURPLE)
    .setTimestamp();
  for (const answer of answers) {
    embed.addFields({ name: answer.label.slice(0, 256), value: answer.value.slice(0, 1024) });
  }

  await channel.send({
    content: `${user} <@&${supportRoleId}>`,
    embeds: [embed],
    components: [ticketButtons(meta)],
    allowedMentions: { users: [user.id], roles: [supportRoleId] },
  });
  await interaction.editReply({ content: `Your ticket is ready: ${channel}` });
}

// ---------------------------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------------------------

// Staff press Claim to show they're handling it. The person who claimed it can press again to
// let it go, so someone else can pick it up.
async function claimTicket(interaction) {
  const { guild, channel, member, user } = interaction;
  if (!isSupport(member)) {
    return interaction.reply({ content: 'Only the support team can claim tickets.', flags: MessageFlags.Ephemeral });
  }
  const meta = getTicketMeta(guild.id, channel.id);
  if (!meta) {
    return interaction.reply({ content: "I don't have this ticket's details any more, so it can't be claimed. You can still help here and close it as normal.", flags: MessageFlags.Ephemeral });
  }

  if (meta.claimedById && meta.claimedById !== user.id) {
    return interaction.reply({ content: `This ticket is already claimed by **${meta.claimedByTag}**. They can press the button to release it.`, flags: MessageFlags.Ephemeral });
  }

  const releasing = meta.claimedById === user.id;
  meta.claimedById = releasing ? null : user.id;
  meta.claimedByTag = releasing ? null : user.tag;
  setTicketMeta(guild.id, channel.id, meta);

  await interaction.update({ components: [ticketButtons(meta)] });
  const embed = new EmbedBuilder()
    .setColor(releasing ? GREY : GREEN)
    .setDescription(releasing ? `${user} is no longer handling this ticket. Another staff member will pick it up.` : `🙋 ${user} will be helping you with this ticket.`);
  await channel.send({ embeds: [embed] });
}

// ---------------------------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------------------------

function canClose(interaction) {
  const openerId = getTicketOwner(interaction.guild.id, interaction.channel.id);
  return isSupport(interaction.member) || openerId === interaction.user.id;
}

// The Close button: ask for a reason first
async function closeTicket(interaction) {
  if (!canClose(interaction)) {
    return interaction.reply({ content: 'Only the person who opened this ticket, or support staff, can close it.', flags: MessageFlags.Ephemeral });
  }
  const modal = new ModalBuilder().setCustomId(CLOSE_MODAL_ID).setTitle('Close this ticket');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason or outcome (optional)')
        .setPlaceholder('For example: Resolved, player warned. Shown to the member.')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
    )
  );
  return interaction.showModal(modal);
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

function formatDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

// The close form was sent: save a transcript, tell the member, delete the channel
async function submitClose(interaction) {
  const { guild, channel, user } = interaction;
  if (!canClose(interaction)) {
    return interaction.reply({ content: 'Only the person who opened this ticket, or support staff, can close it.', flags: MessageFlags.Ephemeral });
  }

  let reason = '';
  try {
    reason = interaction.fields.getTextInputValue('reason').trim();
  } catch (err) {
    reason = '';
  }

  const meta = getTicketMeta(guild.id, channel.id);
  const openerId = removeTicketByChannel(guild.id, channel.id) || meta?.openerId || null;
  removeTicketMeta(guild.id, channel.id);

  await interaction.reply(`🔒 This ticket is being closed by ${user}. The channel will be deleted in 5 seconds.`);

  // ---- Transcript ----
  // The header repeats what the member wrote in the form, so the request is on record even if
  // the bot can't read message text (that needs the Message Content intent, see index.js).
  let transcriptFile = null;
  let messageCount = 0;
  try {
    const allMessages = await fetchAllMessages(channel);
    messageCount = allMessages.length;
    const header = [
      `Ticket ${ticketNumberText(meta?.number)} in ${guild.name}`.trim(),
      `Topic: ${meta?.categoryLabel || 'Unknown'}`,
      `Opened by: ${meta?.openerTag || openerId || 'Unknown'}`,
      `Claimed by: ${meta?.claimedByTag || 'Nobody'}`,
      `Closed by: ${user.tag}`,
      `Reason: ${reason || 'None given'}`,
      '',
      ...(meta?.answers || []).map((a) => `${a.label}: ${a.value}`),
      '',
      '----- Messages -----',
    ];
    const lines = allMessages.reverse().map((m) => {
      const attachments = [...m.attachments.values()].map((a) => a.url).join(' ');
      const text = m.content || (attachments ? '' : '(no text)');
      return `[${m.createdAt.toISOString()}] ${m.author.tag}: ${text}${attachments ? ` ${attachments}` : ''}`;
    });
    const transcriptText = [...header, ...(lines.length ? lines : ['(no messages)'])].join('\n');
    transcriptFile = { buffer: Buffer.from(transcriptText, 'utf-8'), name: `${channel.name}-transcript.txt` };
  } catch (err) {
    console.error('[tickets] Failed to build the transcript:', err);
  }
  const attach = () => (transcriptFile ? [new AttachmentBuilder(transcriptFile.buffer, { name: transcriptFile.name })] : []);

  const summary = new EmbedBuilder()
    .setTitle(`Ticket ${ticketNumberText(meta?.number)} closed`.replace('  ', ' '))
    .setColor(GREY)
    .addFields(
      { name: 'Topic', value: meta?.categoryLabel || 'Unknown', inline: true },
      { name: 'Opened by', value: openerId ? `<@${openerId}>` : 'Unknown', inline: true },
      { name: 'Handled by', value: meta?.claimedByTag || 'Not claimed', inline: true },
      { name: 'Closed by', value: user.tag, inline: true },
      { name: 'Open for', value: meta?.openedAt ? formatDuration(Date.now() - meta.openedAt) : 'Unknown', inline: true },
      { name: 'Messages', value: String(messageCount), inline: true },
    )
    .setTimestamp();
  if (reason) summary.addFields({ name: 'Reason or outcome', value: reason.slice(0, 1024) });

  // ---- Log channel ----
  const ticketLogChannelId = settings.ticketLogChannelId(guild);
  if (ticketLogChannelId) {
    try {
      const logChannel = await guild.channels.fetch(ticketLogChannelId);
      await logChannel.send({ embeds: [summary], files: attach() });
    } catch (err) {
      console.error('[tickets] Failed to post the transcript to the log channel:', err);
    }
  }

  // ---- Tell the member (their DMs may be closed, which is fine) ----
  if (openerId) {
    try {
      const opener = await interaction.client.users.fetch(openerId);
      const dm = new EmbedBuilder()
        .setTitle(`Your ticket in ${guild.name} was closed`)
        .setColor(GREY)
        .setDescription(
          (reason ? `**Outcome:** ${reason}\n\n` : '') +
            'Thanks for getting in touch. A copy of the conversation is attached. If you need more help, you can open a new ticket any time.'
        )
        .addFields({ name: 'Topic', value: meta?.categoryLabel || 'Support', inline: true }, { name: 'Closed by', value: user.tag, inline: true })
        .setTimestamp();
      await opener.send({ embeds: [dm], files: attach() });
    } catch (err) {
      // DMs closed or they left the server: nothing to do
    }
  }

  setTimeout(() => {
    channel.delete().catch((err) => console.error('[tickets] Failed to delete ticket channel:', err));
  }, 5000);
}

// ---------------------------------------------------------------------------------------------
// /ticket add and /ticket remove (commands/ticket.js)
// ---------------------------------------------------------------------------------------------

// Returns a message for whoever ran the command
async function setTicketAccess(interaction, target, allowed) {
  const { guild, channel, member } = interaction;
  if (!getTicketOwner(guild.id, channel.id)) {
    return 'Use this inside a ticket channel.';
  }
  if (!isSupport(member)) {
    return 'Only the support team can add or remove people.';
  }
  if (target.bot) return "Bots can't be added to tickets.";

  if (allowed) {
    await channel.permissionOverwrites.edit(target.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });
    await channel.send({ content: `${target} was added to this ticket by ${interaction.user}.`, allowedMentions: { users: [target.id] } });
    return `Added ${target.tag} to this ticket.`;
  }

  if (target.id === getTicketOwner(guild.id, channel.id)) {
    return "You can't remove the person who opened the ticket. Close it instead.";
  }
  await channel.permissionOverwrites.delete(target.id).catch(() => {});
  await channel.send({ content: `${target.tag} was removed from this ticket by ${interaction.user}.` });
  return `Removed ${target.tag} from this ticket.`;
}

module.exports = {
  buildPanelMessage,
  openTicket,
  handleCategorySelect,
  handleFormSubmit,
  claimTicket,
  closeTicket,
  submitClose,
  setTicketAccess,
  OPEN_BUTTON_ID,
  CLOSE_BUTTON_ID,
  CLAIM_BUTTON_ID,
  CATEGORY_SELECT_ID,
  FORM_MODAL_PREFIX,
  CLOSE_MODAL_ID,
};