// commands/update.js
// /update: opens a form, then posts a game update announcement.
// Each section is its own embed so it gets its own color:
//   Added = green, Changed / Fixed = yellow, Removed = red
//
// Options:
//   channel (optional): where to post it. Defaults to UPDATES_CHANNEL_ID, or the current channel
//   ping    (optional): a role to ping with the update

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const config = require('../config');

const MODAL_PREFIX = 'update';

const COLORS = {
  header: 0x5865f2, // Discord blurple
  added: 0x57f287, // Green
  changed: 0xfee75c, // Yellow
  removed: 0xed4245, // Red
};

// Only people with a mod role (from MOD_ROLE_IDS) or admins can post updates
function canPost(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.modRoleIds && config.modRoleIds.length > 0) {
    return member.roles.cache.some((role) => config.modRoleIds.includes(role.id));
  }
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// One item per line in the form -> a bullet list. Leading "-", "*" or "•" is fine too.
function toBulletList(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `• ${line.replace(/^[-*•]\s*/, '')}`)
    .join('\n');
}

function paragraph(id, label, placeholder) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(placeholder)
    .setMaxLength(1500)
    .setRequired(false);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('update')
    .setDescription('Post a game update announcement')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Where to post it (defaults to the updates channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addRoleOption((option) =>
      option.setName('ping').setDescription('A role to ping with the update (optional)')
    ),

  async execute(interaction) {
    if (!canPost(interaction.member)) {
      return interaction.reply({ content: "You don't have permission to post updates.", flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('ping');
    const channelId = channel?.id || config.updatesChannelId || interaction.channelId;

    // The channel and role ride along in the form's ID so we know them when it's submitted
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}:${channelId}:${role?.id || ''}`)
      .setTitle('Post an update');

    const title = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. Update 1.4: The Lake & Tower')
      .setMaxLength(200)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(paragraph('added', 'Added (one per line)', 'New tower you can climb\nWeekly arena leaderboard')),
      new ActionRowBuilder().addComponents(paragraph('changed', 'Changed / Fixed (one per line)', 'Fixed flying on mobile\nMod Call form fits phone screens')),
      new ActionRowBuilder().addComponents(paragraph('removed', 'Removed (one per line)', 'Old gray baseplate')),
      new ActionRowBuilder().addComponents(paragraph('notes', 'Notes (optional, shown at the top)', 'Thanks for playing! More coming soon.'))
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    if (!canPost(interaction.member)) {
      return interaction.reply({ content: "You don't have permission to post updates.", flags: MessageFlags.Ephemeral });
    }

    const [, channelId, roleId] = interaction.customId.split(':');
    const value = (id) => (interaction.fields.getTextInputValue(id) || '').trim();

    const title = value('title');
    const added = value('added');
    const changed = value('changed');
    const removed = value('removed');
    const notes = value('notes');

    if (!added && !changed && !removed) {
      return interaction.reply({
        content: 'Fill in at least one of **Added**, **Changed / Fixed**, or **Removed**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const header = new EmbedBuilder()
      .setColor(COLORS.header)
      .setTitle(`📢 ${title}`)
      .setFooter({ text: `Posted by ${interaction.user.username}` })
      .setTimestamp();
    if (notes) header.setDescription(notes);

    const embeds = [header];
    if (added) {
      embeds.push(new EmbedBuilder().setColor(COLORS.added).setTitle('✅ Added').setDescription(toBulletList(added)));
    }
    if (changed) {
      embeds.push(new EmbedBuilder().setColor(COLORS.changed).setTitle('🛠️ Changed / Fixed').setDescription(toBulletList(changed)));
    }
    if (removed) {
      embeds.push(new EmbedBuilder().setColor(COLORS.removed).setTitle('❌ Removed').setDescription(toBulletList(removed)));
    }

    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({ content: "I couldn't find that channel.", flags: MessageFlags.Ephemeral });
    }

    try {
      await channel.send({
        content: roleId ? `<@&${roleId}>` : undefined,
        embeds,
        // Only ever pings the role you picked, never @everyone or anything typed in the form
        allowedMentions: { parse: [], roles: roleId ? [roleId] : [] },
      });
    } catch (err) {
      console.error('[update] Failed to post update:', err);
      return interaction.reply({
        content: "I couldn't post there. Make sure I can **View Channel**, **Send Messages**, and **Embed Links** in that channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({ content: `Update posted in <#${channelId}>!`, flags: MessageFlags.Ephemeral });
  },
};