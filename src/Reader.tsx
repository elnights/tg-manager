import React, {useState, type ReactNode} from 'react';
import {Box, useInput} from 'ink';
import {Row} from './ui.js';
import {wrapText} from './text.js';
import {readerBindings, readerCommand, type ReaderMedia} from './commands.js';
import {legendRows, ShortcutLegend} from './Footer.js';
import {ActivityHeader, type Progress} from './StatusBar.js';

export function Reader({
  title,
  text,
  width,
  height,
  onClose,
  extraLines = [],
  media,
  onMediaAction,
  progress = null,
}: {
  title: string;
  text: string;
  width: number;
  height: number;
  onClose: () => void;
  extraLines?: ReactNode[];
  media?: ReaderMedia;
  onMediaAction?: (action: 'mediaPreview' | 'mediaOpen' | 'mediaPrevious' | 'mediaNext') => void;
  progress?: Progress | null;
}) {
  const [offset, setOffset] = useState(0);
  let rows = legendRows(readerBindings(false, true, media), width);
  const canScroll = width >= 9 && height > rows.length + 1;
  const activeMedia = canScroll ? media : undefined;
  if (!canScroll) rows = legendRows(readerBindings(false, false), width);
  const body = Math.max(0, height - rows.length - 1);
  const lines = [
    ...wrapText(text, width),
    ...extraLines.flatMap((line) => (typeof line === 'string' ? wrapText(line, width) : [line])),
  ];
  const maximum = Math.max(0, lines.length - body);
  const start = Math.min(offset, maximum);
  useInput((input, key) => {
    const command = readerCommand(input, key, false, canScroll, activeMedia);
    if (command === 'close') {
      onClose();
      return;
    }
    if (!command) return;
    if (
      command === 'mediaPreview' ||
      command === 'mediaOpen' ||
      command === 'mediaPrevious' ||
      command === 'mediaNext'
    ) {
      onMediaAction?.(command);
      return;
    }
    if (key.downArrow || input === 'j') setOffset((value) => Math.min(maximum, value + 1));
    if (key.upArrow || input === 'k') setOffset((value) => Math.max(0, value - 1));
    if (key.pageDown) setOffset((value) => Math.min(maximum, value + Math.max(1, body)));
    if (key.pageUp) setOffset((value) => Math.max(0, value - Math.max(1, body)));
    if (key.home) setOffset(0);
    if (key.end) setOffset(maximum);
  });
  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      {progress ? (
        <ActivityHeader title={title} width={width} progress={progress} />
      ) : (
        <Row width={width} bold color="cyanBright">
          {title}
        </Row>
      )}
      <Box height={body} flexShrink={0} flexDirection="column" overflow="hidden">
        {!canScroll && body > 0 && <Row width={width}>Enlarge the terminal to read details.</Row>}
        {canScroll &&
          lines.slice(start, start + body).map((line, index) =>
            typeof line === 'string' ? (
              <Row width={width} key={start + index}>
                {line}
              </Row>
            ) : (
              <Box width={width} height={1} flexShrink={0} overflow="hidden" key={start + index}>
                {line}
              </Box>
            ),
          )}
      </Box>
      <ShortcutLegend width={width} rows={rows} />
    </Box>
  );
}
