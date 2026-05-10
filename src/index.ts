import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { loadConfig } from './config.js';
import { MemoryCacheService } from './infrastructure/cache/memory-cache.service.js';
import { RiftcodexAdapter } from './infrastructure/apis/riftcodex.adapter.js';
import { EventsAdapter } from './infrastructure/apis/events.adapter.js';
import { errorHandler } from './bot/middleware/error-handler.js';
import { createCardCommand } from './bot/commands/card.js';
import { createRandomCommand } from './bot/commands/random.js';
import { createEventsCommand } from './bot/commands/events.js';
import { createInlineQueryHandler } from './bot/inline-query.js';
import { createCardActionHandler } from './bot/actions/callbacks.js';

function userId(ctx: Context): string {
  return ctx.from?.username ?? ctx.from?.id?.toString() ?? 'unknown';
}

async function main() {
  const config = loadConfig();

  const cache = new MemoryCacheService();

  const cardRepository = new RiftcodexAdapter({
    baseUrl: 'https://api.riftcodex.com',
    cache,
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
    cacheTtlSeconds: {
      card: config.cacheTtlCardHours * 3600,
      search: config.cacheTtlSearchHours * 3600,
      set: config.cacheTtlSetHours * 3600,
    },
  });

  const eventRepository = new EventsAdapter({
    baseUrl: 'https://api.cloudflare.riftbound.uvsgames.com',
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
    latitude: 37.389092399999996,
    longitude: -5.9844589,
    numMiles: 25,
  });

  const bot = new Telegraf(config.telegramBotToken);

  bot.use((ctx, next) => {
    const ts = new Date().toISOString();
    const user = userId(ctx);

    if (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') {
      console.log(`[${ts}] user=${user} text="${ctx.message.text.slice(0, 120)}"`);
    } else if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
      console.log(`[${ts}] user=${user} callback=${ctx.callbackQuery.data}`);
    } else if (ctx.inlineQuery) {
      console.log(`[${ts}] user=${user} inline="${ctx.inlineQuery.query.slice(0, 120)}"`);
    }

    return next();
  });

  bot.use(errorHandler());

  bot.telegram.setMyCommands([
    { command: 'card', description: 'Look up a card by name or ID' },
    { command: 'random', description: 'Get a random card' },
    { command: 'events', description: 'Upcoming events near Seville' },
  ]);

  bot.command('card', createCardCommand({ cardRepository }));
  bot.command('random', createRandomCommand({ cardRepository }));
  bot.command('events', createEventsCommand({ eventRepository }));

  bot.on('inline_query', createInlineQueryHandler({ cardRepository }));

  bot.action(/^card:(.+)$/, createCardActionHandler({ cardRepository }));

  if (config.nodeEnv === 'production') {
    await bot.launch({
      webhook: {
        domain: config.webhookUrl!,
        port: config.port,
      },
    });
    console.log(`Bot running in webhook mode on port ${config.port}`);
  } else {
    await bot.launch();
    console.log('Bot running in polling mode');
  }
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
