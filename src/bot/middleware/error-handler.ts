import { Context } from 'telegraf';
import { DomainError } from '../../core/errors/base-error.js';

export function errorHandler() {
  return async (ctx: Context, next: () => Promise<void>) => {
    try {
      await next();
    } catch (error) {
      const user = ctx.from?.username ?? ctx.from?.id ?? 'unknown';
      const updateType = ctx.updateType;
      console.error(`[ERROR] [${new Date().toISOString()}] user=${user} type=${updateType}`, error);

      if (error instanceof DomainError && error.isUserFacing) {
        await ctx.reply(`\u26A0\uFE0F ${error.message}`).catch(() => {});
      } else {
        await ctx.reply('\u26A0\uFE0F Something went wrong. Please try again later.').catch(() => {});
      }
    }
  };
}
