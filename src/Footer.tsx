import React from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';

import {footerShortcuts, type Shortcut, type FooterState} from './commands.js';
export {footerShortcuts} from './commands.js';
export type {Shortcut, FooterState} from './commands.js';
export type LegendRow = {shortcuts: Shortcut[]; gap: string};

function rowWidth(shortcuts: Shortcut[], gap: string): number {
  return (
    shortcuts.reduce((sum, item) => sum + stringWidth(item.key + (item.label ? ` ${item.label}` : '')), 0) +
    Math.max(0, shortcuts.length - 1) * gap.length
  );
}

// Never remove an active binding. Prefer full descriptions, then short labels,
// then keys alone. At narrow widths use as many bounded rows as the keys need.
export function legendRows(shortcuts: Shortcut[], width: number): LegendRow[] {
  if (!shortcuts.length || width <= 0) return [];
  if (rowWidth(shortcuts, '  ') <= width) return [{shortcuts, gap: '  '}];
  const compact = shortcuts.map((item) => ({...item, label: item.compactLabel ?? item.label}));
  if (rowWidth(compact, ' ') <= width) return [{shortcuts: compact, gap: ' '}];
  const rows: LegendRow[] = [];
  for (const item of compact) {
    const shortcut = {...item, label: ''};
    const previous = rows.at(-1);
    if (previous && rowWidth([...previous.shortcuts, shortcut], ' ') <= width)
      previous.shortcuts.push(shortcut);
    else rows.push({shortcuts: [shortcut], gap: ' '});
  }
  // Reserve every key first, then spend spare cells on useful descriptions.
  const captions = ['[ ]', '0', 'A', 's', 'c', '?'];
  for (const row of rows)
    for (const item of [...row.shortcuts].sort(
      (a, b) =>
        (captions.includes(a.key) ? captions.indexOf(a.key) : captions.length) -
        (captions.includes(b.key) ? captions.indexOf(b.key) : captions.length),
    )) {
      const label = compact.find((shortcut) => shortcut.key === item.key)!.label;
      if (rowWidth(row.shortcuts, row.gap) + 1 + stringWidth(label) <= width) item.label = label;
    }
  return rows;
}

export function ShortcutLegend({width, rows}: {width: number; rows: LegendRow[]}) {
  return (
    <Box width={width} height={rows.length} flexShrink={0} flexDirection="column" overflow="hidden">
      {rows.map((row, index) => (
        <Box key={index} width={width} height={1} flexShrink={0} overflow="hidden">
          <Text wrap="truncate-end" color="white">
            {row.shortcuts.map((item, index) => (
              <React.Fragment key={item.key}>
                {index > 0 && row.gap}
                <Text bold color="cyanBright">
                  {item.key}
                </Text>
                {item.label ? ` ${item.label}` : ''}
              </React.Fragment>
            ))}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function Footer({width, ...state}: FooterState & {width: number}) {
  return <ShortcutLegend width={width} rows={legendRows(footerShortcuts(state), width)} />;
}
