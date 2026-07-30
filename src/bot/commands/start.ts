import { Context } from 'telegraf';

export function createStartCommand() {
  return async (ctx: Context) => {
    await ctx.reply(
      [
        '👋 Welcome to the Riftbound Card Tracker.',
        '',
        'I look up Riftbound TCG cards, list nearby events, and DMs you when a pair of tables changes at a tournament you\'re following.',
        '',
        'Type /help for the full command list and examples.',
      ].join('\n'),
    );
  };
}
