import { Bot } from 'grammy';
import { processMessage } from '../nlp/parser.js';

const TOKEN = process.env.TELEGRAM_TOKEN || '';

const COMMANDS = ['/gastei', '/recebi', '/conta', '/saldo', '/resumo'];

let bot: Bot | null = null;

export async function startTelegram(): Promise<void> {
  if (!TOKEN) {
    console.log('[telegram] TELEGRAM_TOKEN not set, skipping');
    return;
  }

  bot = new Bot(TOKEN);

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();

    if (COMMANDS.some((cmd) => text.startsWith(cmd))) {
      const cleanText = text.replace(/^\/\w+\s*/, '');

      const result = await processMessage(cleanText, 'telegram', {
        userId: ctx.from?.id,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        chatId: ctx.chat.id,
        chatType: ctx.chat.type,
      });

      if (result.message) {
        await ctx.reply(result.message);
      }
    }
  });

  bot.start({
    onStart: () => {
      console.log(`[telegram] Bot started as @${bot?.botInfo?.username}`);
    },
  });
}
