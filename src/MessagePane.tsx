import React from 'react';
import {Box} from 'ink';
import {PanelHeader, Row} from './ui.js';
import {ownMessageIds, type Message} from './messages.js';

export function MessagePane({
  title,
  width,
  height,
  active,
  items,
  index,
  selected,
  status,
  context,
  empty,
  showIds,
}: {
  title: string;
  width: number;
  height: number;
  active: boolean;
  items: Message[];
  index: number;
  selected: ReadonlySet<number>;
  status: string;
  context?: string;
  empty?: string;
  showIds?: boolean;
}) {
  const rows = Math.max(0, height - (context ? 2 : 1));
  const start = Math.max(0, index - rows + 1);
  return (
    <Box width={width} height={height} flexDirection="column" flexShrink={0} overflow="hidden">
      <PanelHeader title={title} active={active} width={width} />
      {context && (
        <Row width={width} color="cyanBright">
          {context}
        </Row>
      )}
      {items.slice(start, start + rows).map((message, offset) => {
        const current = start + offset === index;
        const ids = ownMessageIds([message]);
        const checked = ids.length > 0 && ids.every((id) => selected.has(id));
        const partial = !checked && ids.some((id) => selected.has(id));
        return (
          <Row
            key={message.groupedId ? `album:${message.groupedId}` : message.id}
            width={width}
            bold={current && active}
            color={current && active ? 'black' : current ? 'yellowBright' : checked ? 'greenBright' : 'white'}
            backgroundColor={current && active ? 'yellowBright' : undefined}
          >
            {`${current ? '>' : ' '} ${message.own ? (checked ? '[x]' : partial ? '[~]' : '[ ]') : '[-]'} ${showIds ? `#${message.id} ` : ''}${message.album ? `[Album: ${message.album.length} item${message.album.length === 1 ? '' : 's'}] ` : ''}${message.context ? `[${message.context}] ` : ''}${message.author}: ${message.date} ${message.content}${message.comments === undefined ? '' : ` · ${message.comments} comments`}`}
          </Row>
        );
      })}
      {!items.length && rows > 0 && (
        <Row width={width}>
          {status === 'loading'
            ? 'Loading messages…'
            : (empty ?? (status === 'error' ? 'Loading failed; r Retry' : 'No messages'))}
        </Row>
      )}
    </Box>
  );
}
