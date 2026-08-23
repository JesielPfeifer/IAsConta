import { Client, GatewayIntentBits } from 'discord.js';
import { processMessage } from '../nlp/parser.js';

const TOKEN = process.env.DISCORD_TOKEN || '';

let client: Client | null = null;

const COMMANDS = ['!gastei', '!recebi', '!conta', '!saldo', '!resumo'];

export async function startDiscord(): Promise<void> {
  if (!TOKEN) {
    console.log('[discord] DISCORD_TOKEN not set, skipping');
    return;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('ready', () => {
    console.log(`[discord] Logged in as ${client?.user?.tag}`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content || message.content.trim().length === 0) return;

    const text = message.content.trim();

    if (COMMANDS.some((cmd) => text.startsWith(cmd))) {
      const cleanText = text.replace(/^!\w+\s*/, '');

      const result = await processMessage(cleanText, 'discord', {
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
        guildId: message.guildId,
      });

      if (result.message) {
        await message.reply({ content: result.message });
      }
    }
  });

  await client.login(TOKEN);
}
