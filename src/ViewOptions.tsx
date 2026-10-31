import type {MessageView} from './messages.js';
import {commands} from './commands.js';
import {wrapText} from './text.js';
import React from 'react';
import {Box, useInput} from 'ink';
import {Row} from './ui.js';
import {chatTypes, chatTypeLabels, defaultChatTypes, type ChatType} from './telegram.js';
import {filterCommand, filterBindings} from './commands.js';
import {legendRows, ShortcutLegend} from './Footer.js';

// Reserve the hints' space while busy so disabling shortcuts cannot move lists.
export function viewOptionLines(
  width: number,
  options: {
    view: MessageView;
    includePrivate: boolean;
    types?: ReadonlySet<ChatType>;
    ownOnly?: boolean;
    ownCheck?: 'checking' | 'stopping';
    chats: number;
    messages: number;
    reservedMessages?: number;
    shortcuts?: boolean;
  },
): string[] {
  const types =
    options.types ??
    new Set([...defaultChatTypes, ...(options.includePrivate ? (['private', 'bot'] as const) : [])]);
  const ownChats = options.ownCheck
    ? width < 30
      ? '...'
      : options.ownCheck
    : options.ownOnly
      ? 'on'
      : 'off';
  const chats = options.chats.toLocaleString('en-US');
  const messages = options.messages.toLocaleString('en-US');
  const build = (showHints: boolean, reserve = false) => {
    const view = reserve || options.view === 'mine' ? 'Mine' : 'All';
    const messageCount = reserve
      ? Math.max(100, options.reservedMessages ?? options.messages).toLocaleString('en-US')
      : messages;
    const hint = (id: string) =>
      showHints ? ` [${commands.find((command) => command.id === id)!.key}]` : '';
    const filters = `${view}${hint('view')} · Types: ${
      chatTypes
        .filter((type) => types.has(type))
        .map((type) => chatTypeLabels[type].symbol)
        .join(' ') || 'none'
    }${hint('types')}`;
    const own = `With my messages${width < 30 ? ' ' : ': '}${reserve ? (width < 30 ? '...' : 'checking') : ownChats}${hint('ownChats')}`;
    const counts = `Loaded: ${chats} chats / ${messageCount} msgs`;
    if (width >= 90) return [filters + ' · ' + own + ' · ' + counts];
    if (width >= 70) return [filters + ' · ' + own, counts];
    if (width >= 30) return [filters, own, counts];
    return [
      `${view}${hint('view')} · ${messageCount} msgs`,
      `Types: ${
        chatTypes
          .filter((type) => types.has(type))
          .map((type) => chatTypeLabels[type].symbol)
          .join(' ') || 'none'
      }${hint('types')}`,
      own,
      `${chats} chats loaded`,
    ];
  };
  const reserved = build(true, true);
  return build(options.shortcuts !== false).flatMap((part, index) => {
    const lines = wrapText(part, width);
    while (lines.length < wrapText(reserved[index]!, width).length) lines.push('');
    return lines;
  });
}

export function TypeFilter({
  value,
  onChange,
  width,
  height,
  paused,
  onApply,
  onCancel,
  onHelp,
}: {
  value: {types: ReadonlySet<ChatType>; index: number};
  onChange(value: {types: ReadonlySet<ChatType>; index: number}): void;
  width: number;
  height: number;
  paused: boolean;
  onApply(types: ReadonlySet<ChatType>): void;
  onCancel(): void;
  onHelp(): void;
}) {
  const {types: draft, index} = value;
  const fullRows = legendRows(filterBindings, width);
  const body = [
    'VIEW OPTIONS / CHAT TYPES',
    ...chatTypes.map(
      (type, item) =>
        `${item === index ? '>' : ' '} [${draft.has(type) ? 'x' : ' '}] [${chatTypeLabels[type].symbol}] ${chatTypeLabels[type].label}`,
    ),
    'Choose any combination. Changes apply with Enter.',
    ...(draft.size ? [] : ['All chat types are hidden.']),
  ].flatMap((line) => wrapText(line, width));
  const fits = width >= 24 && height >= body.length + fullRows.length;
  const rows = fits
    ? fullRows
    : legendRows(
        filterBindings.filter((binding) => ['close', 'help', 'interrupt'].includes(binding.id)),
        width,
      );
  useInput((input, key) => {
    if (paused) return;
    const command = filterCommand(input, key);
    if (command === 'help') onHelp();
    if (command === 'close') onCancel();
    if (!fits) return;
    if (command === 'up') onChange({...value, index: Math.max(0, index - 1)});
    if (command === 'down') onChange({...value, index: Math.min(chatTypes.length - 1, index + 1)});
    if (command === 'toggle') {
      const next = new Set(draft);
      const type = chatTypes[index]!;
      if (next.has(type)) next.delete(type);
      else next.add(type);
      onChange({...value, types: next});
    }
    if (command === 'apply') onApply(draft);
  });
  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      {(fits ? body : ['Enlarge the terminal to edit chat types.'])
        .slice(0, Math.max(0, height - rows.length))
        .map((line, item) => (
          <Row width={width} key={item}>
            {line}
          </Row>
        ))}
      <Box flexGrow={1} />
      <ShortcutLegend width={width} rows={rows} />
    </Box>
  );
}
