import { Context } from 'telegraf';

export function createStartCommand() {
  return async (ctx: Context) => {
    await ctx.reply(
      [
        '👋 Welcome to the Riftbound Card Tracker.',
        '',
        'I look up Riftbound TCG cards, list nearby events, and DM you about every pairing and result update at a tournament you\'re watching. Use /watching to manage it.',
        '',
        'Type /help for the full command list and examples.',
      ].join('\n'),
    );
  };
}
