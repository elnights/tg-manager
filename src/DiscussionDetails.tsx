import React, {useEffect, useRef, useState, type ComponentProps} from 'react';
import {Box, Text, useInput} from 'ink';
import {MessageDetails} from './MessageDetails.js';
import {Reader} from './Reader.js';
import {useDiscussion, type DiscussionFilter} from './useDiscussion.js';
import {detailDiscussionBindings, detailDiscussionCommand} from './commands.js';
import {appendPage} from './operations.js';
import {describeError} from './errors.js';
import type {BrowseCache} from './browseCache.js';
import type {TelegramApi} from './telegram.js';

type Props = ComponentProps<typeof MessageDetails> & {
  client: TelegramApi;
  selfId: string;
  cache: BrowseCache;
  filter: DiscussionFilter;
};
export function DiscussionDetails({filter, ...props}: Props) {
  return props.chat?.isBroadcast ? <PostDetails {...props} filter={filter} /> : <MessageDetails {...props} />;
}
function PostDetails({filter, ...props}: Props) {
  const {client, chat, selfId, message, width, height, cache, onClose} = props;
  const discussion = useDiscussion(client, chat, selfId, message, {cache, scope: 'post', filter});
  const [right, setRight] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const transfer = useRef<{cancelled: boolean} | null>(null);
  useEffect(() => {
    setLoading(false);
    setFailure('');
    return () => {
      if (transfer.current) transfer.current.cancelled = true;
      transfer.current = null;
    };
  }, [discussion.key]);
  const available = discussion.status !== 'none';
  const comments = available && right;
  const split = available && width >= 72;
  const leftWidth = split ? Math.floor((width - 1) / 2) : width;
  const rightWidth = split ? width - leftWidth - 1 : width;
  const more = async () => {
    if (transfer.current || !discussion.target) return;
    const task = {cancelled: false};
    transfer.current = task;
    setLoading(true);
    setFailure('');
    try {
      const items = await discussion.fetch(discussion.history.cursor, task);
      if (!task.cancelled) discussion.publish(appendPage(discussion.history, items));
    } catch (error) {
      if (!task.cancelled) setFailure(describeError(error));
    } finally {
      if (transfer.current === task) {
        transfer.current = null;
        setLoading(false);
      }
    }
  };
  useInput((input, key) => {
    if (!available) return;
    const command = detailDiscussionCommand(input, key, comments, discussion.history.more, loading);
    if (command === 'focus') setRight((value) => !value);
    if (command === 'view') discussion.toggleView();
    if (command === 'reload') discussion.reload();
    if (command === 'next') void more();
  });
  const stateText =
    discussion.status === 'waiting'
      ? 'Waiting for navigation…'
      : discussion.status === 'loading'
        ? 'Loading comments…'
        : discussion.status === 'error'
          ? `Comments unavailable: ${discussion.error}. Press r to retry.`
          : (discussion.error ?? (discussion.view === 'mine' ? 'No comments from you.' : 'No comments.'));
  const text = `${discussion.view === 'mine' ? 'Mine' : 'All'} [v] · ${discussion.history.items.length} loaded\n\n${
    discussion.history.items.length
      ? discussion.history.items
          .map((item) => `${item.author} · ${item.date}\n#${item.id} ${item.content}`)
          .join('\n\n')
      : stateText
  }${failure ? `\n\nLoading failed: ${failure}` : ''}`;
  return (
    <Box width={width} height={height} overflow="hidden">
      <Box width={leftWidth} flexDirection="column" display={split || !comments ? 'flex' : 'none'}>
        <MessageDetails
          {...props}
          width={leftWidth}
          active={!comments}
          focused={available ? !comments : undefined}
          shortcuts={available ? detailDiscussionBindings(false, false, false) : []}
        />
      </Box>
      {split && (
        <Box width={1} flexDirection="column">
          {Array.from({length: height}, (_, i) => (
            <Text key={i} color="gray">
              │
            </Text>
          ))}
        </Box>
      )}
      {available && (
        <Box width={rightWidth} flexDirection="column" display={split || comments ? 'flex' : 'none'}>
          <Reader
            key={discussion.key}
            title="COMMENTS · Read only"
            focused={comments}
            cache={cache}
            scrollKey={cache.key('comment-scroll', discussion.key)}
            text={text}
            width={rightWidth}
            height={height}
            onClose={onClose}
            active={comments}
            shortcuts={detailDiscussionBindings(true, discussion.history.more, loading)}
            progress={loading || discussion.status === 'loading' ? {label: 'Loading comments'} : null}
          />
        </Box>
      )}
    </Box>
  );
}
