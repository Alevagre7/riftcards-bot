import { Context } from 'telegraf';

export function createHelpCommand() {
  return async (ctx: Context) => {
    await ctx.reply(
      [
        'Riftbound Card Tracker — Commands',
        '',
        '📇 Card lookup',
        '/card <name or ID> — Look up a card by name or ID.',
        'Examples:',
        '  /card Ahri',
        '  /card ven-21',
        '',
        '/random — Get a random card.',
        '',
        '🎲 Events',
        '/events — Upcoming events in the next 7 days (your saved location).',
        'Subcommands:',
        '  /events 14 — Next 14 days',
        '  /events set [<lat>, <lon>] — Save your location: pin, Share button, or inline coords (e.g. /events set 42.5, -83.8),',
        '  /events clear — Forget your saved location',
        '  /events unwatch — Stop watching the current event',
        'Detail card: tap an event to see Scoreboard, All tables, and (in private chat) Watch.',
        'Watch flow: /events → tap event → Watch → pick a participant → receive DMs on pairing changes and submitted scores.',
        '',
        '🃏 Nexus pairing',
        '/mytable — See your current Nexus pairing.',
        'Subcommands:',
        '  /mytable <username> — One-off lookup',
        '  /mytable set [username] — Save your Nexus username',
        '  /mytable clear — Forget your saved Nexus username',
        '',
        '✨ Spoilers',
        '/new — Cards spoiled today (UTC).',
        '',
        '🔧 Admin (restricted)',
        '/admin — List and stop active event watches. Requires admin access.',
        '',
        '💬 Inline query',
        'In any chat, type @<bot-username> <card name> to share a card preview inline.',
        '',
        'Settings (per-user): location via /events set, Nexus username via /mytable set, event watches via /events Watch.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  };
}
