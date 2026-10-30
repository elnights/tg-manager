import React from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';

type Shortcut = {key: string; label: string; compactLabel?: string; priority?: number};
const GAP = '  ';
export type FooterState = {
  focus: 'chats' | 'messages'; busy: boolean; cancelling: boolean;
  confirm: boolean; canConfirm: boolean; selectPrompt: boolean; hasChat: boolean;
  canNavigate: boolean; canSelect: boolean; hasOwn: boolean; selected: number; hasMore: boolean;
  includePrivate: boolean;
};

export function footerShortcuts(state: FooterState): Shortcut[] {
  if (state.confirm) return [...(state.canConfirm ? [{key: 'Enter', label: 'Confirm'}] : []),
    {key: 'Esc', label: 'Cancel'}, {key: '?', label: 'Help'}];
  if (state.selectPrompt) return [{key: 'Y', label: 'Load & select'}, {key: 'N', label: 'Loaded only'},
    {key: 'Esc', label: 'Cancel'}, {key: '?', label: 'Help'}];
  if (state.busy) return [...(!state.cancelling ? [{key: 'Esc', label: 'Stop after request'}] : []), {key: '?', label: 'Help'}];
  const shared: Shortcut[] = [
    ...(state.canNavigate ? [{key: '↑↓', label: 'Navigate', compactLabel: 'Move', priority: 7}] : []),
    {key: 'Tab', label: 'Switch panel', compactLabel: 'Panel', priority: 8},
  ];
  const clear: Shortcut[] = state.selected ? [{key: 'c', label: 'Clear selection', compactLabel: 'Clear', priority: 2}] : [];
  const all: Shortcut[] = state.hasChat ? [{key: 'A', label: 'Delete all own', compactLabel: 'Delete all', priority: 1}] : [];
  const help: Shortcut = {key: '?', label: 'Help', priority: 0};
  if (state.focus === 'chats') return [...shared,
    {key: 'p', label: state.includePrivate ? 'Hide private' : 'Show private', compactLabel: 'Private', priority: 4},
    {key: 'v', label: 'Mine/All', compactLabel: 'View', priority: 9},
    ...clear, ...all, {key: '[ ]', label: 'Resize', priority: 10}, help];
  return [...shared,
    ...(state.canSelect ? [{key: 'Space', label: 'Select', compactLabel: 'Mark', priority: 4}] : []),
    ...(state.hasOwn || state.hasMore ? [{key: 's', label: 'Select own', compactLabel: 'Own', priority: 5}] : []),
    ...clear,
    ...(state.selected ? [{key: 'd', label: 'Delete selected', compactLabel: 'Delete', priority: 3}] : []),
    ...all,
    ...(state.hasMore && state.hasChat ? [{key: 'n', label: 'Next page', compactLabel: 'Next', priority: 6},
      {key: 'L', label: 'Load all', priority: 6}] : []),
    {key: 'v', label: 'Mine/All', compactLabel: 'View', priority: 9}, help];
}

// Shorten labels before dropping bindings. Fit by priority, then restore the
// display order so selection/deletion groups stay in a predictable position.
export function fitShortcuts(shortcuts: Shortcut[], width: number): Shortcut[] {
  const total = shortcuts.reduce((sum, item) => sum + stringWidth(`${item.key} ${item.label}`), 0) + Math.max(0, shortcuts.length - 1) * GAP.length;
  const candidates = total <= width ? shortcuts : shortcuts.map(item => ({...item, label: item.compactLabel ?? item.label}));
  const result = new Set<Shortcut>();
  let used = 0;
  for (const shortcut of [...candidates].sort((a, b) => (a.priority ?? (a.key === '?' ? 0 : 1)) - (b.priority ?? (b.key === '?' ? 0 : 1)))) {
    const cells = stringWidth(`${shortcut.key} ${shortcut.label}`) + (result.size ? GAP.length : 0);
    if (used + cells <= width) {result.add(shortcut); used += cells;}
  }
  return candidates.filter(item => result.has(item));
}

export function ShortcutRow({width, shortcuts}: {width: number; shortcuts: Shortcut[]}) {
  return <Box width={width} height={1} flexShrink={0} overflow="hidden">
    <Text wrap="truncate-end" color="white">{fitShortcuts(shortcuts, width).map((item, index) =>
      <React.Fragment key={item.key}>{index > 0 && GAP}<Text bold color="cyanBright">{item.key}</Text>{` ${item.label}`}</React.Fragment>)}</Text>
  </Box>;
}

export function Footer({width, ...state}: FooterState & {width: number}) {
  return <ShortcutRow width={width} shortcuts={footerShortcuts(state)}/>;
}
