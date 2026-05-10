import { Context } from 'telegraf';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { formatEventList } from '../formatters/event-formatter.js';

interface EventsCommandDeps {
  eventRepository: IEventRepository;
}

export function createEventsCommand(deps: EventsCommandDeps) {
  return async (ctx: Context) => {
    await ctx.sendChatAction('typing');

    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await deps.eventRepository.getEvents(now, weekLater);

    const message = formatEventList(events);

    await ctx.reply(message, { parse_mode: 'HTML' });
  };
}
