import 'dotenv/config';
import { Telegraf, Context } from 'telegraf';
import { loadConfig } from './config.js';
import { RiftapiAdapter } from './infrastructure/apis/riftapi.adapter.js';
import { RiftcodexAdapter } from './infrastructure/apis/riftcodex.adapter.js';
import { EventsAdapter } from './infrastructure/apis/events.adapter.js';
import { RiftfoundAdapter } from './infrastructure/apis/riftfound.adapter.js';
import { FallbackEventsAdapter } from './infrastructure/apis/fallback-events.adapter.js';
import { NexusTableAdapter } from './infrastructure/apis/nexus-table.adapter.js';
import { LocatorHtmlAdapter } from './infrastructure/apis/locator.adapter.js';
import { INexusTableRepository } from './core/ports/nexus-table-repository.js';
import { ICardRepository } from './core/ports/card-repository.js';
import { IUserSettingsRepository } from './core/ports/user-settings-repository.js';
import { EventLocation, IEventRepository } from './core/ports/event-repository.js';
import { ILocatorRepository } from './core/ports/locator-repository.js';
import { IEventWatchRepository } from './core/ports/event-watch-repository.js';
import { errorHandler } from './bot/middleware/error-handler.js';
import { createStartCommand } from './bot/commands/start.js';
import { createHelpCommand } from './bot/commands/help.js';
import { createCardCommand } from './bot/commands/card.js';
import { createRandomCommand } from './bot/commands/random.js';
import { createEventsCommand } from './bot/commands/events.js';
import { createMytableCommand } from './bot/commands/mytable.js';
import { createNewCommand } from './bot/commands/new.js';
import { createAdminCommand } from './bot/commands/admin.js';
import { createEventWatcher } from './bot/services/event-watcher.js';
import { createInlineQueryHandler } from './bot/inline-query.js';
import { createCardActionHandler } from './bot/actions/callbacks.js';
import { createNewActionHandler } from './bot/actions/new-callback.js';
import { createEventActionHandler } from './bot/actions/event-callback.js';
import {
  createLocationPickupHandler,
  createNexusUsernamePickupHandler,
} from './bot/handlers/location-pickup.js';
import { openDatabase } from './infrastructure/persistence/open-database.js';
import { SqliteUserSettingsRepository } from './infrastructure/persistence/sqlite-user-settings-repository.js';
import { SqliteEventWatchRepository } from './infrastructure/persistence/sqlite-event-watch-repository.js';
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
      return new RiftapiAdapter({ baseUrl: config.riftapiBaseUrl!, ...common });
    case 'riftcodex':
      return new RiftcodexAdapter({ baseUrl: config.riftcodexBaseUrl!, ...common });
  }
}

async function main() {
  const config = loadConfig();

  const cardRepository = buildCardRepository(config);

  // Events repository: riftfound as primary, old EventsAdapter as fallback
  const riftfoundAdapter = new RiftfoundAdapter({
    baseUrl: config.riftfoundApiUrl,
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
  });
  const oldAdapter = new EventsAdapter({
    baseUrl: config.eventsApiUrl,
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
  });
  const eventRepository: IEventRepository = new FallbackEventsAdapter(
    riftfoundAdapter,
    oldAdapter,
  );
  const defaultLocation: EventLocation = {
    latitude: config.eventsLatitude,
    longitude: config.eventsLongitude,
    numMiles: config.eventsRadiusKm * KM_PER_MILE,
  };

  // Open the SQLite store
  const db = openDatabase(config.userSettingsDbPath);
  const userSettingsRepository: IUserSettingsRepository =
    new SqliteUserSettingsRepository(db);

  // Event watch repository
  const eventWatchRepository: IEventWatchRepository =
    new SqliteEventWatchRepository(db);

  // Nexus Table (mytable show/set/clear — no watch)
  const nexusTableRepository: INexusTableRepository = new NexusTableAdapter({
    baseUrl: config.nexusTableApiUrl,
    ...(config.nexusTableApiToken ? { token: config.nexusTableApiToken } : {}),
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
  });

  // Locator repository (HTML parser for roster/pairings)
  const locatorRepository: ILocatorRepository = new LocatorHtmlAdapter({
    baseUrl: 'https://locator.riftbound.uvsgames.com',
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
  });

  // Build the event watcher service (background polling)
  const notify = async (telegramId: number, body: string): Promise<void> => {
    await bot.telegram.sendMessage(telegramId, body, { parse_mode: 'HTML' });
  };
  const eventWatcher = createEventWatcher({
    watchRepository: eventWatchRepository,
    locatorRepository,
    notify,
    intervalMs: config.nexusWatcherIntervalMs,
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
    { command: 'start', description: 'Welcome and quick intro' },
    { command: 'help', description: 'Full command list and examples' },
    { command: 'card', description: 'Look up a card by name or ID' },
    { command: 'random', description: 'Get a random card' },
    { command: 'events', description: 'Upcoming events near your saved location' },
    { command: 'mytable', description: 'See your current Nexus pairing' },
    { command: 'new', description: 'Cards spoiled today (UTC)' },
    { command: 'admin', description: 'Manage active event watches' },
  ]);

  bot.command('start', createStartCommand());
  bot.command('help', createHelpCommand());
  bot.command('card', createCardCommand({ cardRepository }));
  bot.command('random', createRandomCommand({ cardRepository }));
  bot.command(
    'events',
    createEventsCommand({
      eventRepository,
      userSettingsRepository,
      defaultLocation,
      daysAhead: config.eventsDaysAhead,
      locatorRepository,
      watchRepository: eventWatchRepository,
    }),
  );
  bot.command(
    'mytable',
    createMytableCommand({
      nexusTableRepository,
      userSettingsRepository,
    }),
  );
  bot.command('new', createNewCommand({ cardRepository }));
  bot.command(
    'admin',
    createAdminCommand({
      watchRepository: eventWatchRepository,
      adminTelegramIds: config.adminTelegramIds,
    }),
  );

  bot.on('inline_query', createInlineQueryHandler({ cardRepository }));

  bot.on('message', createLocationPickupHandler({ userSettingsRepository }));
  bot.on(
    'text',
    createNexusUsernamePickupHandler({ userSettingsRepository }),
  );

  bot.action(/^card:(.+)$/, createCardActionHandler({ cardRepository }));
  bot.action('new:show-all', createNewActionHandler({ cardRepository }));
  bot.action(
    /^(event:.+|admin:stop:\d+)$/,
    createEventActionHandler({
      eventRepository,
      locatorRepository,
      watchRepository: eventWatchRepository,
      userSettingsRepository,
      defaultLocation,
      daysAhead: config.eventsDaysAhead,
      adminTelegramIds: config.adminTelegramIds,
    }),
  );

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

  if (config.nexusWatcherEnabled) {
    eventWatcher.start();
  }
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
