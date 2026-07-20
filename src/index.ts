import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { loadConfig } from './config.js';
import { RiftapiAdapter } from './infrastructure/apis/riftapi.adapter.js';
import { RiftcodexAdapter } from './infrastructure/apis/riftcodex.adapter.js';
import { EventsAdapter } from './infrastructure/apis/events.adapter.js';
import { ICardRepository } from './core/ports/card-repository.js';
import { IUserSettingsRepository } from './core/ports/user-settings-repository.js';
import { EventLocation } from './core/ports/event-repository.js';
import { errorHandler } from './bot/middleware/error-handler.js';
import { createCardCommand } from './bot/commands/card.js';
import { createRandomCommand } from './bot/commands/random.js';
import { createEventsCommand } from './bot/commands/events.js';
import { createNewCommand } from './bot/commands/new.js';
import { createInlineQueryHandler } from './bot/inline-query.js';
import { createCardActionHandler } from './bot/actions/callbacks.js';
import { createNewActionHandler } from './bot/actions/new-callback.js';
import { createLocationPickupHandler } from './bot/handlers/location-pickup.js';
import { openDatabase } from './infrastructure/persistence/open-database.js';
import { SqliteUserSettingsRepository } from './infrastructure/persistence/sqlite-user-settings-repository.js';
import { KM_PER_MILE } from './utils/units.js';

function userId(ctx: Context): string {
  return ctx.from?.username ?? ctx.from?.id?.toString() ?? 'unknown';
}

function buildCardRepository(config: ReturnType<typeof loadConfig>): ICardRepository {
  const common = {
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
  };
  switch (config.cardSource) {
    case 'riftapi':
      // loadConfig guarantees riftapiBaseUrl is set when cardSource=riftapi.
      return new RiftapiAdapter({ baseUrl: config.riftapiBaseUrl!, ...common });
    case 'riftcodex':
      return new RiftcodexAdapter({ baseUrl: config.riftcodexBaseUrl!, ...common });
  }
}

async function main() {
  const config = loadConfig();

  const cardRepository = buildCardRepository(config);

  // The events adapter is now stateless w.r.t. location — the
  // location is per-call (per-user), passed in by the command
  // (see ADR-0006). The default location below is what /events
  // falls back to when the user has not set their own.
  const eventRepository = new EventsAdapter({
    baseUrl: config.eventsApiUrl,
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
  });
  const defaultLocation: EventLocation = {
    latitude: config.eventsLatitude,
    longitude: config.eventsLongitude,
    numMiles: config.eventsRadiusKm * KM_PER_MILE,
  };

  // Open the SQLite store and build the user-settings port. The DB
  // path is env-configurable (USER_SETTINGS_DB_PATH); the path
  // ':memory:' is reserved for tests. The file is created if it
  // does not exist; migrations are idempotent.
  const db = openDatabase(config.userSettingsDbPath);
  const userSettingsRepository: IUserSettingsRepository =
    new SqliteUserSettingsRepository(db);

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
    { command: 'events', description: 'Upcoming events near your saved location' },
    { command: 'new', description: 'Cards spoiled today (UTC)' },
  ]);

  bot.command('card', createCardCommand({ cardRepository }));
  bot.command('random', createRandomCommand({ cardRepository }));
  bot.command('events', createEventsCommand({
    eventRepository,
    userSettingsRepository,
    defaultLocation,
    daysAhead: config.eventsDaysAhead,
  }));
  bot.command('new', createNewCommand({ cardRepository }));

  bot.on('inline_query', createInlineQueryHandler({ cardRepository }));

  // Location pickup: any incoming `message.location` while a setup
  // flow is pending. Registered as a generic message handler so it
  // fires for non-text messages too.
  bot.on('message', createLocationPickupHandler({ userSettingsRepository }));

  bot.action(/^card:(.+)$/, createCardActionHandler({ cardRepository }));
  bot.action('new:show-all', createNewActionHandler({ cardRepository }));

  if (config.webhookUrl) {
    await bot.launch({
      webhook: {
        domain: config.webhookUrl,
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
