import React from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';

export type Shortcut = {key: string; label: string; compactLabel?: string};
export type LegendRow = {shortcuts: Shortcut[]; gap: string};
export type FooterState = {
  focus: 'chats' | 'messages'; busy: boolean; cancelling: boolean;
  confirm: boolean; canConfirm: boolean; selectPrompt: boolean; hasChat: boolean;
  canNavigate: boolean; canSelect: boolean; hasOwn: boolean; selected: number; hasMore: boolean;
  includePrivate: boolean; hasNotice?: boolean; promptVisible?: boolean; confirmationText?: string;
};

export function footerShortcuts(state: FooterState): Shortcut[] {
  const help = {key: '?', label: 'Help'};
  const interrupt = {key: 'Ctrl+C', label: 'Quit'};
  if (state.confirm) return [
    ...(state.promptVisible !== false ? [
      {key: 'DELETE', label: 'Type to confirm', compactLabel: 'Type'},
      ...(state.confirmationText ? [{key: 'Backspace', label: 'Edit'}, {key: 'Del', label: 'Edit'}] : []),
      ...(state.canConfirm ? [{key: 'Enter', label: 'Confirm'}] : []),
    ] : []),
    {key: 'Esc', label: 'Cancel'}, help, interrupt,
  ];
  if (state.selectPrompt) return [
    ...(state.promptVisible !== false ? [{key: 'Y/y', label: 'Load & select'}, {key: 'N/n', label: 'Loaded only'}] : []),
    {key: 'Esc/C/c', label: 'Cancel'}, help, interrupt,
  ];
  if (state.busy) return [
    ...(!state.cancelling || state.hasNotice ? [{key: 'Esc', label: state.cancelling ? 'Dismiss' : 'Stop after request', compactLabel: 'Stop'}] : []),
    help, interrupt,
  ];
  const messages = state.focus === 'messages';
  return [
    ...(state.canNavigate ? [{key: '↑↓/jk', label: 'Navigate', compactLabel: 'Move'}] : []),
    {key: 'Tab/←→', label: 'Switch panel', compactLabel: 'Panel'},
    {key: 'p', label: state.includePrivate ? 'Hide private' : 'Show private', compactLabel: 'Private'},
    {key: 'v', label: 'Mine/All', compactLabel: 'View'},
    ...(state.hasChat ? [{key: 'r', label: 'Reload'}] : []),
    ...(messages && state.canSelect ? [{key: 'Space', label: 'Select', compactLabel: 'Mark'}] : []),
    ...(messages && (state.hasOwn || state.hasMore) ? [{key: 's', label: 'Select own', compactLabel: 'Own'}] : []),
    ...(state.selected ? [{key: 'c', label: 'Clear selection', compactLabel: 'Clear'}] : []),
    ...(messages && state.selected ? [{key: 'd', label: 'Delete selected', compactLabel: 'Delete'}] : []),
    ...(state.hasChat ? [{key: 'A', label: 'Delete all own', compactLabel: 'Delete all'}] : []),
    ...(messages && state.hasMore && state.hasChat ? [{key: 'n', label: 'Next page', compactLabel: 'Next'}, {key: 'L', label: 'Load all'}] : []),
    {key: '[ ]', label: 'Resize'}, {key: '0', label: 'Reset width', compactLabel: 'Reset'},
    {key: 'q/Ctrl+C', label: 'Quit'},
    ...(state.hasNotice ? [{key: 'Esc', label: 'Dismiss'}] : []), help,
  ];
}

function rowWidth(shortcuts: Shortcut[], gap: string): number {
  return shortcuts.reduce((sum, item) => sum + stringWidth(item.key + (item.label ? ` ${item.label}` : '')), 0) +
    Math.max(0, shortcuts.length - 1) * gap.length;
}

// Never remove an active binding. Prefer full descriptions, then short labels,
// then keys alone. At narrow widths use as many bounded rows as the keys need.
export function legendRows(shortcuts: Shortcut[], width: number): LegendRow[] {
  if (!shortcuts.length || width <= 0) return [];
  if (rowWidth(shortcuts, '  ') <= width) return [{shortcuts, gap: '  '}];
  const compact = shortcuts.map(item => ({...item, label: item.compactLabel ?? item.label}));
  if (rowWidth(compact, ' ') <= width) return [{shortcuts: compact, gap: ' '}];
  const rows: LegendRow[] = [];
  for (const item of compact) {
    const shortcut = {...item, label: ''};
    const previous = rows.at(-1);
    if (previous && rowWidth([...previous.shortcuts, shortcut], ' ') <= width) previous.shortcuts.push(shortcut);
    else rows.push({shortcuts: [shortcut], gap: ' '});
  }
  // Reserve every key first, then spend spare cells on useful descriptions.
  const captions = ['[ ]', '0', 'A', 'c', '?'];
  for (const row of rows) for (const item of [...row.shortcuts].sort((a, b) =>
    (captions.includes(a.key) ? captions.indexOf(a.key) : captions.length) -
    (captions.includes(b.key) ? captions.indexOf(b.key) : captions.length))) {
    const label = compact.find(shortcut => shortcut.key === item.key)!.label;
    if (rowWidth(row.shortcuts, row.gap) + 1 + stringWidth(label) <= width) item.label = label;
  }
  return rows;
}

export function ShortcutLegend({width, rows}: {width: number; rows: LegendRow[]}) {
  return <Box width={width} height={rows.length} flexShrink={0} flexDirection="column" overflow="hidden">
    {rows.map((row, index) => <Box key={index} width={width} height={1} flexShrink={0} overflow="hidden">
      <Text wrap="truncate-end" color="white">{row.shortcuts.map((item, index) =>
        <React.Fragment key={item.key}>{index > 0 && row.gap}<Text bold color="cyanBright">{item.key}</Text>{item.label ? ` ${item.label}` : ''}</React.Fragment>)}</Text>
    </Box>)}
  </Box>;
}

export function Footer({width, ...state}: FooterState & {width: number}) {
  return <ShortcutLegend width={width} rows={legendRows(footerShortcuts(state), width)}/>;
}
