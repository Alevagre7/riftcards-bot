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
        '  /events — Pick a time window (1d, 3d, 5d, 1 week). Also /events 14 for any other positive N,',
        '  /events clear — Forget your saved location',
        'Detail card: tap an event to see Scoreboard, All tables, and (in private chat) Watch.',
        'Watch flow: /events → tap event → Watch → pick a participant → receive DMs on every pairing and result update.',
        '/watching — See your active watch, refresh it, change it, or stop it.',
        '/watching stop — Stop your active watch.',
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
        'Settings (per-user): location via /events set, Nexus username via /mytable set, event watches via /watching.',
      ].join('\n'),
    );
  };
}
