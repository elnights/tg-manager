import React, {useState} from 'react';
import {Box, render, useApp, useInput} from 'ink';
import {adjustChatPercent, DEFAULT_CHAT_PERCENT, panelWidths, Panels, Row, useTerminalSize} from './ui.js';
import {TerminalOutput} from './terminal-output.js';

// Offline reproduction: no Telegram client, credentials, sessions or settings.
const titles = [
  'Sample✈️',
  '✈️ Flights',
  '🛫 Departures',
  '🚀 Launches',
  '👨‍👩‍👧‍👦 Family',
  '🇨🇿 Czechia',
  'Cafe\u0301 / combining',
  '✈️🛫🚀👨‍👩‍👧‍👦🇨🇿e\u0301'.repeat(6),
];

function EmojiDemo() {
  const {exit} = useApp();
  const size = useTerminalSize();
  const [percent, setPercent] = useState(DEFAULT_CHAT_PERCENT);
  const [index, setIndex] = useState(0);
  const [messagesFocused, setMessagesFocused] = useState(false);
  const widths = panelWidths(size.columns, percent);
  useInput((input, key) => {
    if (input === 'q') exit();
    if (input === '[' || input === ']' || input === '0')
      setPercent((previous) => adjustChatPercent(previous, input));
    if (key.downArrow || input === 'j') setIndex((previous) => (previous + 1) % titles.length);
    if (key.upArrow || input === 'k') setIndex((previous) => (previous + titles.length - 1) % titles.length);
    if (key.tab) setMessagesFocused((previous) => !previous);
  });
  const height = Math.max(1, size.rows - 1);
  const listHeight = Math.max(0, height - 3);
  const start = Math.max(0, index - listHeight + 1);
  const visible = titles.slice(start, start + listHeight);
  return (
    <Box width={widths.width} height={height} flexDirection="column" overflow="hidden">
      <Row
        width={widths.width}
      >{`Up/Down move | Tab focus | [ ] chat width | 0 reset chat width (${DEFAULT_CHAT_PERCENT}%) | q quit`}</Row>
      {height >= 3 && (
        <Panels
          widths={widths}
          height={height - 2}
          chats={
            <>
              <Row width={widths.leftWidth} backgroundColor="blueBright" color="black">
                CHATS
              </Row>
              {visible.map((title) => (
                <Row
                  key={title}
                  width={widths.leftWidth}
                  backgroundColor={title === titles[index] && !messagesFocused ? 'yellowBright' : undefined}
                  color={title === titles[index] && !messagesFocused ? 'black' : 'white'}
                  bold={title === titles[index]}
                >
                  {`${title === titles[index] ? '>' : ' '} ${title}`}
                </Row>
              ))}
            </>
          }
          messages={
            <>
              <Row width={widths.rightWidth} backgroundColor="blueBright" color="black">
                MESSAGES
              </Row>
              <Row
                width={widths.rightWidth}
                backgroundColor={messagesFocused ? 'yellowBright' : undefined}
                color={messagesFocused ? 'black' : 'white'}
              >{`> [x] ${titles[index]}`}</Row>
            </>
          }
        />
      )}
      {height >= 2 && (
        <Row width={widths.width}>{`${size.columns} columns / ${size.rows} rows / chats ${percent}%`}</Row>
      )}
    </Box>
  );
}

const stdout = new TerminalOutput(process.stdout);
try {
  const instance = render(<EmojiDemo />, {stdout, alternateScreen: true});
  await instance.waitUntilExit();
  instance.unmount();
} finally {
  stdout.destroy();
}
