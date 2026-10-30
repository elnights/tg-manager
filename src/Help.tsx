import React, {useState} from 'react';
import {Box, useInput} from 'ink';
import stringWidth from 'string-width';
import {Row} from './ui.js';
import {ShortcutRow} from './Footer.js';

export const helpSections = [
  {title: 'Navigation', entries: [
    ['↑ / k   ↓ / j', 'Move in the focused panel'], ['Tab / ← / →', 'Switch panels'],
    ['q', 'Quit from the main view'], ['Ctrl+C', 'Quit anytime; completed requests are not undone'],
    ['? / Esc', 'Close help; ↑↓ or j/k scroll help'],
  ]},
  {title: 'Chat management', entries: [
    ['p', 'Include or hide private chats'], ['v', 'Mine / All authors; reload and clear selection'], ['r', 'Reload the active chat; clear selection'],
  ]},
  {title: 'Message selection', entries: [
    ['Space', 'Toggle own message (messages panel)'], ['s', 'Select own; offer to load remaining history'],
    ['Y / N / Esc, C', 'Selection prompt: load / loaded only / cancel'], ['c', 'Clear selection from either panel'],
  ]},
  {title: 'Loading and pagination', entries: [
    ['n', 'Next page of 100 (messages panel)'], ['L (Shift+l)', 'Load remaining view (messages panel)'],
    ['Esc', 'Stop between requests; in-flight request finishes'], ['?', 'Help during work; work continues in background'],
  ]},
  {title: 'Deletion', entries: [
    ['d', 'Confirm deletion of selected own messages'], ['A (Shift+a)', 'Scan ALL own messages, then ask to delete'],
    ['DELETE + Enter', 'Exact uppercase confirmation; no automatic deletion'], ['Esc', 'Cancel prompt or stop after in-flight batch'],
    ['Requested / verified', 'API accepted / checked absent by message ID'],
  ]},
  {title: 'Layout and settings', entries: [
    ['[ / ]', 'Narrow / widen chat panel; saved automatically'], ['0', 'Reset chat width to 32%'], ['?', 'Open keyboard help'],
  ]},
];

function wrapHelpText(text: string, width: number): string[] {
  if (width <= 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && stringWidth(`${line} ${word}`) > width) {lines.push(line); line = '';}
    if (stringWidth(word) <= width) {line += `${line ? ' ' : ''}${word}`; continue;}
    for (const {segment} of new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(word)) {
      if (stringWidth(line + segment) > width) {lines.push(line); line = '';}
      if (stringWidth(segment) <= width) line += segment;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function Help({width, height, onClose}: {width: number; height: number; onClose: () => void}) {
  const [offset, setOffset] = useState(0);
  const keyWidth = Math.min(22, Math.max(8, Math.floor(width * 0.35)));
  const compact = width < 60;
  const lines = helpSections.flatMap(section => [
    {text: section.title, heading: true},
    ...section.entries.flatMap(([key, description]) => {
      const indent = compact ? Math.min(2, Math.max(0, width - 1)) : keyWidth + 1;
      const descriptions = wrapHelpText(description!, width - indent);
      return compact ? [
        ...wrapHelpText(key!, width).map(text => ({text, heading: false})),
        ...descriptions.map(text => ({text: ' '.repeat(indent) + text, heading: false})),
      ] : descriptions.map((text, index) => ({text: (index === 0 ? key!.padEnd(keyWidth) + ' ' : ' '.repeat(indent)) + text, heading: false}));
    }),
    {text: '', heading: false},
  ]);
  const bodyHeight = Math.max(0, height - 3);
  const maxOffset = Math.max(0, lines.length - bodyHeight);
  const start = Math.min(offset, maxOffset);
  useInput((input, key) => {
    if (key.escape || input === '?') {onClose(); return;}
    if (key.downArrow || input === 'j') setOffset(value => Math.min(maxOffset, value + 1));
    if (key.upArrow || input === 'k') setOffset(value => Math.max(0, value - 1));
    if (key.pageDown) setOffset(value => Math.min(maxOffset, value + Math.max(1, bodyHeight)));
    if (key.pageUp) setOffset(value => Math.max(0, value - Math.max(1, bodyHeight)));
  });
  return <Box width={width} height={height} flexDirection="column" overflow="hidden">
    {height >= 2 && <Row width={width} bold color="cyanBright">KEYBOARD HELP · case-sensitive</Row>}
    {height >= 3 && <Row width={width} color="white">{`Lowercase unless shown uppercase: A and L require Shift. ${start + 1}/${lines.length}`}</Row>}
    <Box width={width} height={bodyHeight} flexShrink={0} flexDirection="column" overflow="hidden">
      {lines.slice(start, start + bodyHeight).map((line, index) =>
        <Row key={start + index} width={width} color={line.heading ? 'cyanBright' : 'white'} bold={line.heading}>{line.text}</Row>)}
    </Box>
    <ShortcutRow width={width} shortcuts={[{key: 'Esc', label: 'Close'}, {key: '↑↓', label: 'Scroll'}, {key: '?', label: 'Close'}]}/>
  </Box>;
}
