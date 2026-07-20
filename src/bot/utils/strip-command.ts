// stripCommand: remove the leading `/<command>[@botname]` and any
// trailing whitespace from a Telegram text update. Shared by the
// /card, /events, and any future command that needs to parse its
// own argument string (Telegram passes the whole message including
// the `/command` prefix to the handler).
//
// Examples (when `command = 'card'`):
//   '/card Flameblade'   → 'Flameblade'
//   '/card@MyBot ahri'   → 'ahri'
//   '/card   '           → ''
//   'Flameblade'         → 'Flameblade'  (no prefix → unchanged)
//
// The bot-name suffix (`@MyBot`) is part of Telegram's text format
// when the user invokes the command with a specific bot in a group;
// we strip it so the command's own argument parser doesn't have to.

export function stripCommand(text: string, command: string): string {
  return text.replace(new RegExp(`^/${command}(@\\w+)?\\s*`, 'i'), '').trim();
}
