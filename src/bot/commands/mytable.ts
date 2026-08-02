import { Context, Markup } from 'telegraf';
import { NexusTable } from '../../core/entities/nexus-table.js';
import { INexusTableRepository } from '../../core/ports/nexus-table-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { ApiResponseError } from '../../core/errors/index.js';
import { formatNexusTable } from '../formatters/nexus-table-formatter.js';
import { setupFlow } from '../state/setup-flow.js';
import { stripCommand } from '../utils/strip-command.js';
import { NEXUS_USERNAME_RE } from '../utils/nexus-username.js';

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface MytableCommandDeps {
  nexusTableRepository: INexusTableRepository;
  userSettingsRepository: IUserSettingsRepository;
}

// ---------------------------------------------------------------------------
// Subcommand parser
// ---------------------------------------------------------------------------

type MytableAction = 'show' | 'set' | 'clear' | 'usage';

function parseAction(rawArgs: string): MytableAction {
  const arg = rawArgs.trim().toLowerCase();
  if (arg === '' || arg === 'show' || arg.startsWith('show ')) return 'show';
  if (arg === 'set' || arg.startsWith('set ')) return 'set';
  if (arg === 'clear' || arg.startsWith('clear ')) return 'clear';
  return 'usage';
}

// Pulls the inline username from a `set <username>` invocation.
// Returns an empty string if the user only typed `/mytable set`.
function parseSetArg(rawArgs: string): string {
  const arg = rawArgs.trim();
  const lower = arg.toLowerCase();
  if (lower !== 'set' && !lower.startsWith('set ')) return '';
  return arg.slice(3).trim();
}

// ---------------------------------------------------------------------------
// renderMytable — exported so callbacks can re-use
// ---------------------------------------------------------------------------

export async function renderMytable(
  ctx: Context,
  deps: MytableCommandDeps,
  username: string,
): Promise<NexusTable | undefined> {
  try {
    const table = await deps.nexusTableRepository.getTable({ username });
    const body = formatNexusTable(table);
    await ctx.reply(body, { parse_mode: 'HTML' });
    return table;
  } catch (error) {
    if (error instanceof ApiResponseError && error.message.includes('404')) {
      await ctx.reply(
        `Nexus username "${username}" not found. Check your username or set it with /mytable set.`,
      );
      return;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// createMytableCommand
// ---------------------------------------------------------------------------

export function createMytableCommand(deps: MytableCommandDeps) {
  return async (ctx: Context) => {
    const text =
      ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string'
        ? ctx.message.text
        : '';
    const rawArgs = stripCommand(text, 'mytable');
    const action = parseAction(rawArgs);
    const userId = ctx.from?.id;

    if (action === 'usage') {
      await ctx.reply(
        'Usage:\n' +
          '/mytable \u2014 see your current Nexus pairing\n' +
          '/mytable &lt;username&gt; \u2014 lookup a specific user (one-off)\n' +
          '/mytable set [username] \u2014 save your Nexus username (inline or on next message)\n' +
          '/mytable clear \u2014 forget your saved Nexus username',
      );
      return;
    }

    if (action === 'set') {
      if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
        return;
      }
      const inlineUsername = parseSetArg(rawArgs);
      if (inlineUsername.length > 0) {
        if (!NEXUS_USERNAME_RE.test(inlineUsername)) {
          await ctx.reply(
            'Invalid Nexus username. Use letters, numbers, _, -, ., and internal spaces (1-64 characters).',
          );
          return;
        }
        await deps.userSettingsRepository.setNexusUsername(userId, inlineUsername);
        await ctx.reply(
          `Nexus username saved as "${inlineUsername}". Use /mytable to see your pairing.`,
          Markup.removeKeyboard(),
        );
        return;
      }
      setupFlow.start(userId, 'mytable-set-username');
      await ctx.reply(
        'Send me your Nexus username (or /cancel to abort).',
        Markup.removeKeyboard(),
      );
      return;
    }

    if (action === 'clear') {
      if (userId != null) {
        await deps.userSettingsRepository.clearNexusUsername(userId);
        setupFlow.cancel(userId);
        await ctx.reply('Your Nexus username has been forgotten.', Markup.removeKeyboard());
      } else {
        await ctx.reply('Could not identify your account. Please try again.');
      }
      return;
    }

    // --- action === 'show' ---

    // Check if there's a per-call override after stripping 'show'
    let args = rawArgs.trim();
    if (args.toLowerCase().startsWith('show')) {
      args = args.slice(4).trim();
    }

    if (args.length > 0) {
      // Per-call username override — do not persist
      await renderMytable(ctx, deps, args);
      return;
    }

    // No override — check saved username
    if (userId == null) {
      await ctx.reply('Could not identify your account. Please try again.');
      return;
    }

    const savedUsername = await deps.userSettingsRepository.getNexusUsername(userId);
    if (!savedUsername) {
      await ctx.reply(
        'You haven\u2019t set a Nexus username yet. Use /mytable set to save one, ' +
          'or /mytable &lt;username&gt; for a one-off lookup.',
      );
      return;
    }

    await renderMytable(ctx, deps, savedUsername);
  };
}
