import React, {useState} from 'react';
import {Box, useInput} from 'ink';
import {Row} from './ui.js';
import {legendRows, ShortcutLegend} from './Footer.js';

import {helpSections, readerBindings, readerCommand} from './commands.js';
import {wrapText} from './text.js';
export {helpSections} from './commands.js';

export function Help({width, height, onClose}: {width: number; height: number; onClose: () => void}) {
  const [offset, setOffset] = useState(0);
  const keyWidth = Math.min(22, Math.max(8, Math.floor(width * 0.35)));
  const compact = width < 60;
  const lines = helpSections.flatMap((section) => [
    {text: section.title, heading: true},
    ...section.entries.flatMap(([key, description]) => {
      const indent = compact ? Math.min(2, Math.max(0, width - 1)) : keyWidth + 1;
      const descriptions = wrapText(description!, width - indent);
      return compact
        ? [
            ...wrapText(key!, width).map((text) => ({text, heading: false})),
            ...descriptions.map((text) => ({text: ' '.repeat(indent) + text, heading: false})),
          ]
        : descriptions.map((text, index) => ({
            text: (index === 0 ? key!.padEnd(keyWidth) + ' ' : ' '.repeat(indent)) + text,
            heading: false,
          }));
    }),
    {text: '', heading: false},
  ]);
  let footerRows = legendRows(readerBindings(true), width);
  const canScroll = width >= 9 && height > 2 + footerRows.length;
  if (!canScroll) footerRows = legendRows(readerBindings(true, false), width);
  const headerHeight = Math.min(2, Math.max(0, height - footerRows.length));
  const bodyHeight = Math.max(0, height - headerHeight - footerRows.length);
  const maxOffset = Math.max(0, lines.length - bodyHeight);
  const start = Math.min(offset, maxOffset);
  useInput((input, key) => {
    const command = readerCommand(input, key, true, canScroll);
    if (command === 'close') {
      onClose();
      return;
    }
    if (!command) return;
    if (key.downArrow || input === 'j') setOffset((value) => Math.min(maxOffset, value + 1));
    if (key.upArrow || input === 'k') setOffset((value) => Math.max(0, value - 1));
    if (key.pageDown) setOffset((value) => Math.min(maxOffset, value + Math.max(1, bodyHeight)));
    if (key.pageUp) setOffset((value) => Math.max(0, value - Math.max(1, bodyHeight)));
  });
  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      {headerHeight >= 1 && (
        <Row width={width} bold color="cyanBright">
          KEYBOARD HELP · case-sensitive
        </Row>
      )}
      {headerHeight >= 2 && (
        <Row width={width} color="white">
          {canScroll
            ? `Lowercase unless shown uppercase: A and L require Shift. ${start + 1}/${lines.length}`
            : 'Enlarge the terminal to read help.'}
        </Row>
      )}
      <Box width={width} height={bodyHeight} flexShrink={0} flexDirection="column" overflow="hidden">
        {lines.slice(start, start + bodyHeight).map((line, index) => (
          <Row
            key={start + index}
            width={width}
            color={line.heading ? 'cyanBright' : 'white'}
            bold={line.heading}
          >
            {line.text}
          </Row>
        ))}
      </Box>
      <ShortcutLegend width={width} rows={footerRows} />
    </Box>
  );
}
