import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NexusTableAdapter } from './nexus-table.adapter.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';

describe('NexusTableAdapter.getTable', () => {
  let adapter: NexusTableAdapter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const mockResponsePayload = {
    event: {
      id: 'evt-001',
      name: 'Weekly Nexus Night',
      store: { id: 'str-001', name: 'Card Castle', address: '123 Main St' },
      startDate: '2026-07-29T18:00:00Z',
      format: 'Standard',
    },
    round: { number: 3, label: 'Round 3', status: 'inProgress', result: null },
    table: { number: 5, opponent: { name: 'OpponentPlayer', score: null } },
    standings: { rank: 2, points: 6, wins: 2, losses: 0, draws: 0 },
    message: '',
  };

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new NexusTableAdapter({
      baseUrl: 'https://test.api/nexus-table',
      timeoutMs: 5000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs the correct URL with action=status and username', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(mockResponsePayload), { status: 200 }),
    );

    await adapter.getTable({ username: 'TestUser' });

    const url = fetchSpy.mock.calls[0]![0] as string;
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://test.api/nexus-table');
    expect(parsed.searchParams.get('action')).toBe('status');
    expect(parsed.searchParams.get('username')).toBe('TestUser');
  });

  it('includes Bearer token when configured', async () => {
    adapter = new NexusTableAdapter({
      baseUrl: 'https://test.api/nexus-table',
      token: 'my-secret-token',
      timeoutMs: 5000,
      retryAttempts: 1,
    });

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(mockResponsePayload), { status: 200 }),
    );

    await adapter.getTable({ username: 'TestUser' });

    const options = fetchSpy.mock.calls[0]![1] as Record<string, unknown>;
    const headers = options['headers'] as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-token');
  });

  it('omits Authorization header when token is not set', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(mockResponsePayload), { status: 200 }),
    );

    await adapter.getTable({ username: 'TestUser' });

    const options = fetchSpy.mock.calls[0]![1] as Record<string, unknown>;
    const headers = options['headers'] as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('maps all fields from a full response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(mockResponsePayload), { status: 200 }),
    );

    const table = await adapter.getTable({ username: 'TestUser' });

    expect(table.username).toBe('TestUser');
    expect(table.event).not.toBeNull();
    expect(table.event!.id).toBe('evt-001');
    expect(table.event!.name).toBe('Weekly Nexus Night');
    expect(table.event!.store.name).toBe('Card Castle');
    expect(table.event!.store.address).toBe('123 Main St');
    expect(table.event!.startDate).toEqual(new Date('2026-07-29T18:00:00Z'));
    expect(table.event!.format).toBe('Standard');

    expect(table.round).not.toBeNull();
    expect(table.round!.number).toBe(3);
    expect(table.round!.label).toBe('Round 3');
    expect(table.round!.status).toBe('inProgress');
    expect(table.round!.result).toBeNull();

    expect(table.tableNumber).toBe(5);

    expect(table.opponent).not.toBeNull();
    expect(table.opponent!.name).toBe('OpponentPlayer');
    expect(table.opponent!.score).toBeNull();

    expect(table.standings).not.toBeNull();
    expect(table.standings!.rank).toBe(2);
    expect(table.standings!.points).toBe(6);
    expect(table.standings!.wins).toBe(2);
    expect(table.standings!.losses).toBe(0);
    expect(table.standings!.draws).toBe(0);

    expect(table.record).toEqual({ wins: 2, losses: 0, draws: 0 });
    expect(table.status.active).toBe(true);
    expect(table.status.inProgress).toBe(true);

    expect(table.fetchedAt).toBeDefined();
  });

  it('returns nulls and defaults when the response has no event/round/table/standings', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          event: null,
          round: null,
          table: null,
          standings: null,
          message: 'No event found',
        }),
        { status: 200 },
      ),
    );

    const table = await adapter.getTable({ username: 'NoEventUser' });

    expect(table.event).toBeNull();
    expect(table.round).toBeNull();
    expect(table.tableNumber).toBeNull();
    expect(table.opponent).toBeNull();
    expect(table.standings).toBeNull();
    expect(table.record).toEqual({ wins: 0, losses: 0, draws: 0 });
    expect(table.status.active).toBe(false);
    expect(table.status.inProgress).toBe(false);
  });

  it('throws ApiResponseError on 404', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(adapter.getTable({ username: 'Unknown' })).rejects.toThrow(
      'Nexus Table API returned status 404',
    );
  });

  it('throws ApiResponseError on 5xx', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Internal Server Error', { status: 503 }),
    );

    await expect(adapter.getTable({ username: 'Test' })).rejects.toThrow(
      'Nexus Table API returned status 503',
    );
  });

  it('throws ApiResponseError when the upstream returns invalid JSON', async () => {
    fetchSpy.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));

    await expect(adapter.getTable({ username: 'Test' })).rejects.toThrow(
      'Nexus Table API returned status 502',
    );
  });

  it('throws ApiTimeoutError on network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('AbortError'));

    await expect(adapter.getTable({ username: 'Test' })).rejects.toThrow(
      ApiTimeoutError,
    );
  });
});

describe('NexusTableAdapter with token', () => {
  let adapter: NexusTableAdapter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new NexusTableAdapter({
      baseUrl: 'https://test.api/nexus-table',
      token: 'auth-token-123',
      timeoutMs: 5000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Bearer token on every request', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ event: null, round: null, table: null, standings: null }),
        { status: 200 },
      ),
    );

    await adapter.getTable({ username: 'TestUser' });

    const options = fetchSpy.mock.calls[0]![1] as Record<string, unknown>;
    const headers = options['headers'] as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer auth-token-123');
  });
});
