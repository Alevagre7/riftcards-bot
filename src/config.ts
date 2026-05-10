import { z } from 'zod';

const configSchema = z.object({
  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  rapidApiKey: z.string().optional(),
  riftcodexProxyUrl: z.string().url().optional(),

  nodeEnv: z.enum(['development', 'production']).default('development'),
  port: z.coerce.number().default(8080),
  webhookUrl: z.string().url().optional(),

  cacheTtlCardHours: z.coerce.number().default(168),
  cacheTtlSearchHours: z.coerce.number().default(24),
  cacheTtlSetHours: z.coerce.number().default(168),

  apiTimeoutMs: z.coerce.number().default(10000),
  apiRetryAttempts: z.coerce.number().default(3),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const raw = configSchema.parse({
    telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'],
    rapidApiKey: process.env['RAPIDAPI_KEY'],
    riftcodexProxyUrl: process.env['RIFTCODEX_PROXY_URL'],
    nodeEnv: process.env['NODE_ENV'],
    port: process.env['PORT'],
    webhookUrl: process.env['WEBHOOK_URL'],
    cacheTtlCardHours: process.env['CACHE_TTL_CARD_HOURS'],
    cacheTtlSearchHours: process.env['CACHE_TTL_SEARCH_HOURS'],
    cacheTtlSetHours: process.env['CACHE_TTL_SET_HOURS'],
    apiTimeoutMs: process.env['API_TIMEOUT_MS'],
    apiRetryAttempts: process.env['API_RETRY_ATTEMPTS'],
  });

  if (raw.nodeEnv === 'production' && !raw.webhookUrl) {
    throw new Error('WEBHOOK_URL is required when NODE_ENV=production');
  }

  return raw;
}
