import React, {useCallback, useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import {singleLine} from './ui.js';

export type Notice = {text: string; level: 'info' | 'result' | 'warning' | 'error'; source?: 'validation'};
export type Progress = {
  label: string;
  completed?: number;
  total?: number;
  verified?: number;
  cancelling?: boolean;
};

export function useNotice() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    if (!notices.length || notices.some((notice) => notice.level !== 'info')) return;
    const timer = setTimeout(() => setNotices([]), 4500);
    return () => clearTimeout(timer);
  }, [notices]);
  const dismissNotice = useCallback(() => setNotices([]), []);
  const resolveValidation = useCallback(
    () => setNotices((previous) => previous.filter((notice) => notice.source !== 'validation')),
    [],
  );
  const notify = useCallback(
    (text: string, level: Notice['level'] = 'info', source?: Notice['source']) =>
      setNotices((previous) => {
        const sticky = previous.filter((notice) => notice.level !== 'info');
        if (level === 'info') return sticky.length ? previous : [{text, level}];
        if (sticky.some((notice) => notice.text === text && notice.level === level)) return previous;
        return [...sticky, {text, level, source}];
      }),
    [],
  );
  const notice: Notice | null = notices.length
    ? {
        text: notices.map((notice) => notice.text).join('\n\n'),
        level: notices.some((notice) => notice.level === 'error') ? 'error' : notices.at(-1)!.level,
      }
    : null;
  return {notice, dismissNotice, resolveValidation, notify};
}

export function progressText(progress: Progress): string {
  if (progress.label === 'Checking chats')
    return `${progress.cancelling ? 'Stopping chat checks' : 'Checking chats'}${progress.completed === undefined ? '' : ` · ${progress.completed.toLocaleString('en-US')} / ${progress.total?.toLocaleString('en-US')} checked`}`;
  if (progress.label === 'Loading' || progress.label === 'Selecting')
    return progress.cancelling ? `Stopping ${progress.label.toLowerCase()}` : `${progress.label} history`;
  const count = progress.completed?.toLocaleString('en-US');
  return `${progress.cancelling ? 'Stopping' : progress.label}${
    count === undefined
      ? ''
      : ` · ${count}${
          progress.total === undefined
            ? progress.label === 'Scanning'
              ? ' found'
              : ' loaded'
            : ` / ${progress.total.toLocaleString('en-US')} requested`
        }`
  }${progress.verified === undefined ? '' : ` · ${progress.verified.toLocaleString('en-US')} verified`}`;
}

export function ActivityHeader({
  title,
  width,
  progress,
}: {
  title: string;
  width: number;
  progress: Progress | null;
}) {
  const [frame, setFrame] = useState(0);
  const busy = Boolean(progress);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setFrame((value) => (value + 1) % 4), 120);
    return () => clearInterval(timer);
  }, [busy]);
  const operation = progress?.cancelling
    ? progress.label === 'Checking chats'
      ? 'Stopping chat checks'
      : `Stopping ${progress.label.toLowerCase()}`
    : progress?.label === 'Loading'
      ? 'Loading messages'
      : progress?.label;
  const label = progress
    ? `${operation}${
        progress.completed === undefined
          ? ''
          : ` ${progress.completed.toLocaleString('en-US')}${progress.total === undefined ? '' : `/${progress.total.toLocaleString('en-US')}`}`
      }${progress.cancelling ? '' : ' · Esc stop'}`
    : '';
  const indicator = `${['.', 'o', 'O', 'o'][frame]} ${label}`;
  const indicatorWidth = Math.min(
    Math.max(0, width - Math.min(14, Math.floor(width / 3)) - 1),
    stringWidth(indicator) + 2,
  );
  return (
    <Box width={width} height={1} flexShrink={0} overflow="hidden">
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text bold color="white" wrap="truncate-end">
          {singleLine(title)}
        </Text>
      </Box>
      {progress && (
        <Box
          width={indicatorWidth}
          height={1}
          flexShrink={0}
          marginLeft={1}
          paddingX={1}
          backgroundColor="yellowBright"
          overflow="hidden"
        >
          <Text bold color="black" wrap="truncate-end">
            {indicator}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function StatusBar({
  width,
  hasMore,
  chatsMore = false,
  selected,
  progress,
  notice,
}: {
  width: number;
  hasMore: boolean;
  chatsMore?: boolean;
  selected: number;
  progress: Progress | null;
  notice: Notice | null;
}) {
  const summary = `${selected.toLocaleString('en-US')} selected${hasMore ? ' · More may be available' : ''}${chatsMore ? ' · More chats may be available' : ''}`;
  const activity = progress ? progressText(progress) : null;
  // Progress leads during requests. Sticky notices remain in the details reader
  // until acknowledged; routine information uses spare cells and expires.
  const alert =
    notice && notice.level !== 'info'
      ? `${notice.level.toUpperCase()}: ${singleLine(notice.text)} (Esc dismiss; ! details)`
      : null;
  const lead = activity ?? alert ?? summary;
  const secondary = activity
    ? `${summary} · Request pending; Telegram may wait/retry internally. Esc stops after this request; accepted deletion is verified.`
    : alert
      ? summary
      : notice
        ? singleLine(notice.text)
        : '';
  const available = Math.max(0, width - stringWidth(lead) - 3);
  return (
    <Box width={width} height={1} flexShrink={0} overflow="hidden">
      <Text
        wrap="truncate-end"
        color={
          alert && !activity
            ? notice!.level === 'error'
              ? 'redBright'
              : notice!.level === 'result'
                ? 'cyanBright'
                : 'yellowBright'
            : 'white'
        }
      >
        {lead}
        {secondary && available > 8 ? <Text color="white">{` · ${secondary}`}</Text> : ''}
      </Text>
    </Box>
  );
}
