import React from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';

type Shortcut = {key: string; label: string};
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
  const help = {key: '?', label: 'Help'};
  const navigate = {key: '↑↓', label: 'Navigate'};
  const switchPanel = {key: 'Tab', label: 'Switch'};
  if (state.focus === 'chats') return [help, ...(state.canNavigate ? [navigate] : []), switchPanel,
    {key: 'p', label: state.includePrivate ? 'Hide private' : 'Private'}, {key: '[ ]', label: 'Resize'}];
  return [help, ...(state.canNavigate ? [navigate] : []),
    ...(state.canSelect ? [{key: 'Space', label: 'Select'}] : []),
    ...(state.selected ? [{key: 'd', label: 'Delete'}] : []),
    ...(state.hasOwn || state.hasMore ? [{key: 's', label: 'Select own'}] : []), switchPanel,
    ...(state.hasMore && state.hasChat ? [{key: 'n', label: 'Next'}] : [])];
}

// Fit whole shortcuts by priority. Help remains discoverable at narrow widths.
export function fitShortcuts(shortcuts: Shortcut[], width: number): Shortcut[] {
  const result: Shortcut[] = [];
  let used = 0;
  for (const shortcut of [...shortcuts.filter(item => item.key === '?'), ...shortcuts.filter(item => item.key !== '?')]) {
    const cells = stringWidth(`${shortcut.key} ${shortcut.label}`) + (result.length ? 3 : 0);
    if (used + cells <= width) {result.push(shortcut); used += cells;}
  }
  // Put help at the familiar right edge when there is room for other actions.
  return [...result.filter(item => item.key !== '?'), ...result.filter(item => item.key === '?')];
}

export function ShortcutRow({width, shortcuts}: {width: number; shortcuts: Shortcut[]}) {
  return <Box width={width} height={1} flexShrink={0} overflow="hidden">
    <Text wrap="truncate-end" color="white">{fitShortcuts(shortcuts, width).map((item, index) =>
      <React.Fragment key={item.key}>{index > 0 && ' · '}<Text bold color="cyanBright">{item.key}</Text>{` ${item.label}`}</React.Fragment>)}</Text>
  </Box>;
}

export function Footer({width, ...state}: FooterState & {width: number}) {
  return <ShortcutRow width={width} shortcuts={footerShortcuts(state)}/>;
}
