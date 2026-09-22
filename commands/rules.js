const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');
const { getMessageId, setMessageId } = require('../utils/rulesStore');

const RULES_COLOR = 0x5865f2;
const MODAL_PREFIX = 'rules-modal'; // customId is "rules-modal:<channelId>", so the submit handler
                                     // in index.js knows which channel this edit is for

function buildRulesEmbed(text, author) {
  return new EmbedBuilder()
    .setTitle('📜 Server Rules')
    .setDescription(text)
    .setColor(RULES_COLOR)
    .setFooter({ text: `Last updated by ${author}` })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Show or edit this server\'s rules')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Post or update the rules in a channel (opens a text box to type them in)')
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Channel to post the rules in').setRequired(true)))
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Show the rules for a channel right here')
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Which channel\'s rules to show (defaults to this one)').setRequired(false)))
    // Only members who can manage the server see /rules set at all; /rules show is open to everyone.
    // Discord only lets a command have ONE default permission for the whole command (not per
    // subcommand), so this is enforced again inside execute() for "set" specifically.
    .setDefaultMemberPermissions(null),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "You need the Manage Server permission to edit the rules.", flags: MessageFlags.Ephemeral });
      }

      const channel = interaction.options.getChannel('channel');
      if (!channel?.isTextBased()) {
        return interaction.reply({ content: 'Pick a text channel.', flags: MessageFlags.Ephemeral });
      }

      // Pre-fill the text box with whatever's already posted there, so editing existing rules
      // means changing a few words rather than retyping everything.
      let existingText = '';
      const existingId = getMessageId(channel.id);
      if (existingId) {
        const existing = await channel.messages.fetch(existingId).catch(() => null);
        existingText = existing?.embeds?.[0]?.description || '';
      }

      const modal = new ModalBuilder()
        .setCustomId(`${MODAL_PREFIX}:${channel.id}`)
        .setTitle(`Rules for #${channel.name}`.slice(0, 45));

      const input = new TextInputBuilder()
        .setCustomId('text')
        .setLabel('Rules (Markdown supported)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(existingText)
        .setMaxLength(4000)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (sub === 'show') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const messageId = getMessageId(channel.id);

      if (!messageId) {
        return interaction.reply({ content: `No rules have been set for ${channel}. An admin can add them with \`/rules set\`.`, flags: MessageFlags.Ephemeral });
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        return interaction.reply({ content: `The rules message for ${channel} seems to have been deleted. An admin can post it again with \`/rules set\`.`, flags: MessageFlags.Ephemeral });
      }

      return interaction.reply({ content: `📜 [Jump to the rules in ${channel}](${message.url})`, embeds: [message.embeds[0]], flags: MessageFlags.Ephemeral });
    }
  },

  // Called from index.js when the /rules set text box is submitted
  async handleModalSubmit(interaction) {
    const channelId = interaction.customId.split(':')[1];
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      return interaction.reply({ content: "Couldn't find that channel anymore.", flags: MessageFlags.Ephemeral });
    }

    const text = interaction.fields.getTextInputValue('text');
    const embed = buildRulesEmbed(text, interaction.user.tag);

    const existingId = getMessageId(channel.id);
    const existing = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;

    if (existing) {
      await existing.edit({ embeds: [embed] });
      await interaction.reply({ content: `Updated the rules in ${channel}.`, flags: MessageFlags.Ephemeral });
    } else {
      const sent = await channel.send({ embeds: [embed] });
      setMessageId(channel.id, sent.id);
      await interaction.reply({ content: `Posted the rules in ${channel}.`, flags: MessageFlags.Ephemeral });
    }
  },
};