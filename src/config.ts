import { z } from 'zod';

// Config holds every environment variable the bot reads at startup.
// All vars are validated with zod; loadConfig() throws a clear error
// on any missing-required or wrong-type value.
//
// The card source is selected by CARD_SOURCE at startup. There is no
// default: a misconfigured deployment should fail fast, not silently
// fall back to a different adapter. The other-source env vars are
// validated conditionally on the chosen CARD_SOURCE (see below).

const cardSourceSchema = z.enum(['riftapi', 'riftcodex']);

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return value;
}, z.boolean());

const configSchema = z.object({
  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

  // Adapter selection.
  cardSource: cardSourceSchema,
  riftapiBaseUrl: z.string().url().optional(),
  riftcodexBaseUrl: z.string().url().optional(),

  nodeEnv: z.enum(['development', 'production']).default('development'),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  webhookUrl: z.string().url().optional(),

  apiTimeoutMs: z.coerce.number().int().positive().default(10000),
  apiRetryAttempts: z.coerce.number().int().min(1).max(10).default(3),

  // Events adapter. Defaults to Seville (37.39, -5.99) at 50 mi /
  // 7 days. The lat/lon/radius here are the global default used
  // when a user has not configured their own location via
  // /events set. See ADR-0006.
  riftboundV2BaseUrl: z.string().url().default('https://api.riftbound.uvsgames.com/api/v2'),
  riftfoundBaseUrl: z.string().url().default('https://www.riftfound.com/api'),
  eventsLatitude: z.coerce.number().min(-90).max(90).default(37.39),
  eventsLongitude: z.coerce.number().min(-180).max(180).default(-5.99),
  eventsRadiusKm: z.coerce.number().positive().default(80), // 50 miles
  eventsDaysAhead: z.coerce.number().int().positive().default(7),

  // Nexus Table (player pairing tracker). URL defaults to the
  // Netlify-hosted function the Android app uses. Token is optional:
  // the endpoint may be public for read calls.
  nexusTableApiUrl: z.string().url().default('https://riftboundtoolkit.netlify.app/.netlify/functions/nexus-table'),
  nexusTableApiToken: z.string().optional(),

  // Admin Telegram IDs — comma-separated. Users in this list can
  // use the /admin command. Empty = no admin access.
  adminTelegramIds: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),

  // Nexus watcher (background polling). The service is constructed
  // but not started when disabled — useful for tests and kill-switch.
  // The interval tunes how often the watcher polls.
  nexusWatcherEnabled: booleanEnvSchema.default(true),
  nexusWatcherIntervalMs: z.coerce.number().int().positive().default(30000),

  // Per-user settings store (see ADR-0006). Path is a file path; in
  // tests the loader can be bypassed and the path set to ':memory:'
  // directly via SqliteUserSettingsRepository + openDatabase.
  userSettingsDbPath: z.string().default('/data/riftbot.db'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const cardSourceRaw = process.env['CARD_SOURCE'];
  if (cardSourceRaw !== 'riftapi' && cardSourceRaw !== 'riftcodex') {
    throw new Error(
      `CARD_SOURCE must be set to "riftapi" or "riftcodex" (got ${JSON.stringify(cardSourceRaw)})`,
    );
  }

  const raw = configSchema.parse({
    telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'],
    cardSource: cardSourceRaw,
    riftapiBaseUrl: process.env['RIFTAPI_BASE_URL'],
    riftcodexBaseUrl: process.env['RIFTCODEX_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
    port: process.env['PORT'],
    webhookUrl: process.env['WEBHOOK_URL'],
    apiTimeoutMs: process.env['API_TIMEOUT_MS'],
    apiRetryAttempts: process.env['API_RETRY_ATTEMPTS'],
    riftboundV2BaseUrl: process.env['RIFTBOUND_V2_BASE_URL'],
    riftfoundBaseUrl: process.env['RIFTFOUND_BASE_URL'],
    eventsLatitude: process.env['EVENTS_LATITUDE'],
    eventsLongitude: process.env['EVENTS_LONGITUDE'],
    eventsRadiusKm: process.env['EVENTS_RADIUS_KM'],
    eventsDaysAhead: process.env['EVENTS_DAYS_AHEAD'],
    nexusTableApiUrl: process.env['NEXUS_TABLE_API_URL'],
    nexusTableApiToken: process.env['NEXUS_TABLE_API_TOKEN'],
    nexusWatcherEnabled: process.env['NEXUS_WATCHER_ENABLED'],
    nexusWatcherIntervalMs: process.env['NEXUS_WATCHER_INTERVAL_MS'],
    adminTelegramIds: process.env['ADMIN_TELEGRAM_IDS'],
    userSettingsDbPath: process.env['USER_SETTINGS_DB_PATH'],
  });

  // Conditional required vars: the chosen adapter's base URL must be
  // set. This is checked after the schema parse so we can give a
  // specific error message.
  if (raw.cardSource === 'riftapi' && !raw.riftapiBaseUrl) {
    throw new Error('RIFTAPI_BASE_URL is required when CARD_SOURCE=riftapi');
  }
  if (raw.cardSource === 'riftcodex' && !raw.riftcodexBaseUrl) {
    throw new Error('RIFTCODEX_BASE_URL is required when CARD_SOURCE=riftcodex');
  }
  if (raw.nodeEnv === 'production' && !raw.webhookUrl) {
    throw new Error('WEBHOOK_URL is required when NODE_ENV=production');
  }

  return raw;
}
