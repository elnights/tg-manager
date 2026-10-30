import type {MessageView} from './messages.js';
import {commands} from './commands.js';
import {wrapText} from './text.js';

// Reserve the hints' space while busy so disabling shortcuts cannot move lists.
export function viewOptionLines(
  width: number,
  options: {
    view: MessageView;
    includePrivate: boolean;
    ownOnly?: boolean;
    chats: number;
    messages: number;
    shortcuts?: boolean;
  },
): string[] {
  const view = options.view === 'mine' ? 'Mine' : 'All';
  const privateChats = options.includePrivate ? 'on' : 'off';
  const ownChats = options.ownOnly ? 'on' : 'off';
  const chats = options.chats.toLocaleString('en-US');
  const messages = options.messages.toLocaleString('en-US');
  const build = (showHints: boolean) => {
    const hint = (id: string) =>
      showHints ? ` [${commands.find((command) => command.id === id)!.key}]` : '';
    const filters = `${view}${hint('view')} · Private: ${privateChats}${hint('private')}`;
    const own = `With my messages${width < 30 ? ' ' : ': '}${ownChats}${hint('ownChats')}`;
    const counts = `Loaded: ${chats} chats / ${messages} msgs`;
    if (width >= 90) return [filters + ' · ' + own + ' · ' + counts];
    if (width >= 70) return [filters + ' · ' + own, counts];
    if (width >= 30) return [filters, own, counts];
    return [
      `${view}${hint('view')} · ${messages} msgs`,
      `Private: ${privateChats}${hint('private')}`,
      own,
      `${chats} chats loaded`,
    ];
  };
  const reserved = build(true);
  return build(options.shortcuts !== false).flatMap((part, index) => {
    const lines = wrapText(part, width);
    while (lines.length < wrapText(reserved[index]!, width).length) lines.push('');
    return lines;
  });
}
