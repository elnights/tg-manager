import React from 'react';
import {Box} from 'ink';
import {Row} from './ui.js';
import {boundedText, wrapText} from './text.js';

export type ConfirmationTarget = {
  ids: readonly number[];
  chat: {id: string; title: string; discussionFor?: string};
  scope: 'selected' | 'entire';
  discussionScope?: string;
};

export {boundedText} from './text.js';

export function confirmationLines(
  target: ConfirmationTarget,
  account: string,
  input: string,
  width: number,
): string[] {
  return [
    `DELETE ${target.ids.length} of YOUR messages?`,
    `Account: ${account || 'identity unavailable'}`,
    `Chat: ${boundedText(target.chat.title)}`,
    `Chat ID: ${target.chat.id}`,
    `Scope: ${target.scope === 'entire' ? 'entire-history' : 'selected-message'} deletion; exact count: ${target.ids.length}`,
    ...(target.chat.discussionFor
      ? [
          target.discussionScope ??
            'Discussion group scope includes channel comments and other group messages.',
        ]
      : []),
    'WARNING: Deletion is irreversible, can affect other participants and cannot be undone.',
    `Type DELETE and Enter (Esc to cancel): ${input}_`,
    'Exact uppercase DELETE; separate Enter required. Backspace/Del edit; ? help; Ctrl+C quit.',
  ].flatMap((line) => wrapText(line, width));
}

export function Confirmation({lines, width}: {lines: string[]; width: number}) {
  return (
    <Box width={width} height={lines.length} flexShrink={0} flexDirection="column">
      {lines.map((line, index) => (
        <Row key={index} width={width} color={index === 0 ? 'redBright' : 'white'}>
          {line}
        </Row>
      ))}
    </Box>
  );
}
