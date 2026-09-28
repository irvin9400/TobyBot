// commands/eval.js
// /eval: runs JavaScript on the bot. OWNER ONLY.
//
// Safety:
//   - Only works for the Discord user ID in OWNER_ID. Nobody else, not even admins.
//   - Completely off unless EVAL_ENABLED=true is set in Railway Variables.
//   - Replies are only visible to you, and secrets (bot token, API keys, webhook secret)
//     are blanked out of the output.
//   - Every use is logged in Railway.
//
// Handy commands:
//   await client.runVerifyCheck({ preview: true })   -> list who would be kicked for not verifying
//   await client.runVerifyCheck()                    -> kick them now

const util = require('node:util');
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Hides anything that looks like a secret before showing output
function redact(text) {
  const secrets = [config.token, config.webhookSecret, config.robloxOpenCloudKey];
  for (const [name, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|KEY|PASSWORD/i.test(name) && value && value.length >= 8) {
      secrets.push(value);
    }
  }
  let output = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      output = output.split(secret).join('[redacted]');
    }
  }
  return output;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eval')
    .setDescription('Run code on the bot (owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName('code').setDescription('JavaScript to run. Use "await" freely.').setRequired(true)
    ),

  async execute(interaction) {
    if (process.env.EVAL_ENABLED !== 'true') {
      return interaction.reply({ content: '/eval is turned off.', flags: MessageFlags.Ephemeral });
    }
    if (!process.env.OWNER_ID || interaction.user.id !== process.env.OWNER_ID) {
      console.warn(`[eval] Blocked attempt by ${interaction.user.tag} (${interaction.user.id})`);
      return interaction.reply({ content: "You can't use this command.", flags: MessageFlags.Ephemeral });
    }

    const code = interaction.options.getString('code');
    console.log(`[eval] ${interaction.user.tag} ran: ${code}`);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let output;
    const started = Date.now();
    try {
      // Lets you write "await ..." directly, and "return x" to show a value.
      // Plain expressions work too: "client.guilds.cache.size"
      const body = /\breturn\b|;|\n/.test(code) ? code : `return (${code});`;
      const fn = new AsyncFunction('client', 'interaction', 'config', 'require', body);
      const result = await fn(interaction.client, interaction, config, require);
      output = typeof result === 'string' ? result : util.inspect(result, { depth: 2 });
    } catch (err) {
      output = `Error: ${err?.stack || err}`;
    }

    output = redact(String(output));
    if (output.length > 1850) output = output.slice(0, 1850) + '\n... (cut off)';

    return interaction.editReply({
      content: `\`\`\`js\n${output}\n\`\`\`\n-# Took ${Date.now() - started} ms`,
    });
  },
};