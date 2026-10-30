import React, {type ComponentProps, type ReactNode} from 'react';
import {Box, Text, useWindowSize} from 'ink';

export const DEFAULT_CHAT_PERCENT = 32;

export function adjustChatPercent(previous: number, input: '[' | ']' | '0'): number {
  return input === '0'
    ? DEFAULT_CHAT_PERCENT
    : Math.max(20, Math.min(70, previous + (input === ']' ? 2 : -2)));
}

// Keep presentation selectors, joiners and combining marks intact. Only flatten
// whitespace/control characters that cannot belong to a single display row.
import {singleLine} from './text.js';
export {singleLine} from './text.js';

type RowProps = Pick<ComponentProps<typeof Text>, 'color' | 'backgroundColor' | 'bold'> & {
  width: number;
  children: string;
};

export function Row({width, children, color, backgroundColor, bold}: RowProps) {
  if (width <= 0) return null;
  // Yoga owns the row's cells, including the space after the text. Ink inherits
  // the Box background into Text, so both cells of wide glyphs stay painted.
  // Use Ink's own measurement/truncation throughout, with no manual padding.
  return (
    <Box width={width} height={1} flexShrink={0} overflow="hidden" backgroundColor={backgroundColor}>
      <Text wrap="truncate-end" color={color} bold={bold}>
        {singleLine(children)}
      </Text>
    </Box>
  );
}

export function panelWidths(columns: number, chatPercent: number) {
  // Leave one physical column free to avoid terminal auto-wrap on the last cell.
  const width = Math.max(0, Math.floor(columns) - 1);
  const separatorWidth = Math.min(1, width);
  const contentWidth = width - separatorWidth;
  // On small terminals reduce the minima instead of overflowing the viewport.
  const minLeft = Math.min(12, Math.floor(contentWidth / 2));
  const minRight = Math.min(20, contentWidth - minLeft);
  const leftWidth = Math.max(
    minLeft,
    Math.min(contentWidth - minRight, Math.floor((contentWidth * chatPercent) / 100)),
  );
  return {width, leftWidth, rightWidth: contentWidth - leftWidth, separatorWidth};
}

type PanelsProps = {
  widths: ReturnType<typeof panelWidths>;
  height: number;
  chats: ReactNode;
  messages: ReactNode;
};

export function Panels({widths, height, chats, messages}: PanelsProps) {
  const {width, leftWidth, rightWidth, separatorWidth} = widths;
  return (
    <Box width={width} height={height} flexShrink={0} overflow="hidden">
      <Box width={leftWidth} flexShrink={0} flexDirection="column" overflow="hidden">
        {chats}
      </Box>
      {separatorWidth > 0 && (
        <Box width={separatorWidth} flexShrink={0} flexDirection="column">
          {Array.from({length: height}, (_, i) => (
            <Text key={i} color="gray">
              |
            </Text>
          ))}
        </Box>
      )}
      <Box width={rightWidth} flexShrink={0} flexDirection="column" overflow="hidden">
        {messages}
      </Box>
    </Box>
  );
}

export const useTerminalSize = useWindowSize;
