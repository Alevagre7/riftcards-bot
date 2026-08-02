import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('CARD_SOURCE', 'riftapi');
    vi.stubEnv('RIFTAPI_BASE_URL', 'https://riftapi.test');
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses explicit false boolean values instead of coercing the string to true', () => {
    vi.stubEnv('NEXUS_WATCHER_ENABLED', 'false');

    expect(loadConfig().nexusWatcherEnabled).toBe(false);
  });

  it('honors the configured retry attempt count', () => {
    vi.stubEnv('API_RETRY_ATTEMPTS', '5');

    expect(loadConfig().apiRetryAttempts).toBe(5);
  });

  it('requires a webhook URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => loadConfig()).toThrow('WEBHOOK_URL is required when NODE_ENV=production');
  });

  it('rejects invalid event coordinates', () => {
    vi.stubEnv('EVENTS_LATITUDE', '91');

    expect(() => loadConfig()).toThrow();
  });
});
