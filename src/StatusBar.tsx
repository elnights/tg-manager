import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import type {MessageView} from './messages.js';
import {singleLine} from './ui.js';

export type Notice = {text: string; level: 'info' | 'result' | 'warning' | 'error'};
export type Progress = {label: string; completed?: number; total?: number; verified?: number; cancelling?: boolean};

export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice || notice.level !== 'info') return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  return {notice, dismissNotice: () => setNotice(null),
    notify: (text: string, level: Notice['level'] = 'info') => setNotice(previous =>
      level === 'info' && previous && previous.level !== 'info' ? previous : {text, level})};
}

export function progressText(progress: Progress): string {
  const count = progress.completed?.toLocaleString('en-US');
  return `${progress.cancelling ? 'Stopping' : progress.label}${count === undefined ? '' : ` · ${count}${
    progress.total === undefined ? (progress.label === 'Scanning' ? ' found' : ' loaded') : ` / ${progress.total.toLocaleString('en-US')} requested`}`}${
    progress.verified === undefined ? '' : ` · ${progress.verified.toLocaleString('en-US')} verified`}`;
}

export function StatusBar({width, view, loaded, hasMore, selected, progress, notice}: {
  width: number; view: MessageView; loaded: number; hasMore: boolean; selected: number;
  progress: Progress | null; notice: Notice | null;
}) {
  const summary = `${view === 'mine' ? 'Mine' : 'All'} · ${loaded.toLocaleString('en-US')}${hasMore ? '+' : ''} loaded · ${selected.toLocaleString('en-US')} selected`;
  const activity = progress ? progressText(progress) : null;
  // Alerts lead the same status row until explicitly dismissed; normal notices
  // use only spare space and expire without replacing the useful counters.
  const alert = notice && notice.level !== 'info' ? `${notice.level.toUpperCase()}: ${singleLine(notice.text)} (Esc dismiss)` : null;
  const lead = alert ?? activity ?? summary;
  const secondary = alert ? [activity, summary].filter(Boolean).join(' · ') : activity ? summary : notice ? singleLine(notice.text) : '';
  const available = Math.max(0, width - stringWidth(lead) - 3);
  return <Box width={width} height={1} flexShrink={0} overflow="hidden">
    <Text wrap="truncate-end" color={alert ? notice!.level === 'error' ? 'redBright' : notice!.level === 'result' ? 'cyanBright' : 'yellowBright' : 'white'}>
      {lead}{secondary && available > 8 ? <Text color="white">{` · ${secondary}`}</Text> : ''}
    </Text>
  </Box>;
}
