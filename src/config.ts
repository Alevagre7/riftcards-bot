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

const configSchema = z.object({
  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

  // Adapter selection.
  cardSource: cardSourceSchema,
  riftapiBaseUrl: z.string().url().optional(),
  riftcodexBaseUrl: z.string().url().optional(),

  nodeEnv: z.enum(['development', 'production']).default('development'),
  port: z.coerce.number().default(8080),
  webhookUrl: z.string().url().optional(),

  apiTimeoutMs: z.coerce.number().default(10000),
  apiRetryAttempts: z.coerce.number().default(3),

  // Events adapter. Defaults to Seville (37.39, -5.99) at 50 mi /
  // 7 days; the EVENTS_API_URL defaults to the upstream directly
  // (the Cloudflare Worker proxy is gone).
  eventsApiUrl: z.string().url().default('https://api.cloudflare.riftbound.uvsgames.com'),
  eventsLatitude: z.coerce.number().default(37.39),
  eventsLongitude: z.coerce.number().default(-5.99),
  eventsRadiusKm: z.coerce.number().default(80), // 50 miles
  eventsDaysAhead: z.coerce.number().default(7),
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
    eventsApiUrl: process.env['EVENTS_API_URL'],
    eventsLatitude: process.env['EVENTS_LATITUDE'],
    eventsLongitude: process.env['EVENTS_LONGITUDE'],
    eventsRadiusKm: process.env['EVENTS_RADIUS_KM'],
    eventsDaysAhead: process.env['EVENTS_DAYS_AHEAD'],
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
