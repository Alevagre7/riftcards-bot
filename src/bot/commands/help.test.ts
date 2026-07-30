import { Context } from 'telegraf';
import { describe, it, expect, vi } from 'vitest';
import { createHelpCommand } from './help.js';

function makeCtx(): Context {
  return { reply: vi.fn() } as unknown as Context;
}

function getReplyText(ctx: Context): string {
  const call = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
  return call?.[0] ?? '';
}

describe('createHelpCommand', () => {
  it('renders /card with examples', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    const text = getReplyText(ctx);
    expect(text).toContain('/card');
    expect(text).toContain('Ahri');
    expect(text).toContain('ven-21');
  });

  it('renders /random', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    expect(getReplyText(ctx)).toContain('/random');
  });

  it('renders /events with subcommands and watch flow', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    const text = getReplyText(ctx);
    expect(text).toContain('/events');
    expect(text).toContain('/events 14');
    expect(text).toContain('/events set');
    expect(text).toContain('/events clear');
    expect(text).toContain('/events unwatch');
    expect(text).toContain('Watch');
  });

  it('renders /mytable with subcommands', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    const text = getReplyText(ctx);
    expect(text).toContain('/mytable');
    expect(text).toContain('/mytable <username>');
    expect(text).toContain('/mytable set');
    expect(text).toContain('/mytable clear');
  });

  it('renders /new', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    expect(getReplyText(ctx)).toContain('/new');
  });

  it('renders /admin', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    expect(getReplyText(ctx)).toContain('/admin');
  });

  it('renders inline query section', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    expect(getReplyText(ctx)).toContain('@<bot-username>');
  });

  it('renders settings summary line', async () => {
    const ctx = makeCtx();
    await createHelpCommand()(ctx);
    expect(getReplyText(ctx)).toContain('Settings');
  });
});
