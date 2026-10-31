import assert from 'node:assert/strict';
import {Writable, PassThrough} from 'node:stream';
import {test} from 'node:test';
import React, {useState} from 'react';
import {Box, render, renderToString, useInput} from 'ink';
import headless from '@xterm/headless';
import unicodeGraphemes from '@xterm/addon-unicode-graphemes';
import {TerminalOutput} from '../src/terminal-output.js';
import {adjustChatPercent, panelWidths, Panels, PanelHeader, Row, useTerminalSize} from '../src/ui.js';
import {returnBigInt} from 'teleproto/Helpers.js';
import {MessageDetails} from '../src/MessageDetails.js';
import {messageRecords, messageRows} from '../src/messages.js';
import {photo} from './helpers/media.js';

const {Terminal} = headless;
const {UnicodeGraphemesAddon} = unicodeGraphemes;

function terminal(profile: '6' | '15' | '15-graphemes', columns = 80, rows = 24) {
  const emulator = new Terminal({cols: columns, rows, allowProposedApi: true, convertEol: true});
  if (profile !== '6') {
    emulator.loadAddon(new UnicodeGraphemesAddon());
    emulator.unicode.activeVersion = profile;
  }
  return emulator;
}

class Screen extends Writable {
  isTTY = true;
  columns: number;
  rows: number;
  chunks: string[] = [];
  constructor(readonly emulator: InstanceType<typeof Terminal>) {
    super();
    this.columns = emulator.cols;
    this.rows = emulator.rows;
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
    this.chunks.push(chunk.toString());
    this.emulator.write(chunk.toString(), callback);
  }
  resize(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
    this.emulator.resize(columns, rows);
    this.emit('resize');
  }
}

function write(stream: NodeJS.WritableStream, data: string) {
  return new Promise<void>((resolve, reject) =>
    stream.write(data, (error) => (error ? reject(error) : resolve())),
  );
}

function fixture(title: string, leftWidth: number, selected = true) {
  return renderToString(
    <Panels
      widths={{width: 79, leftWidth, separatorWidth: 1, rightWidth: 78 - leftWidth}}
      height={2}
      chats={
        <>
          <Row
            width={leftWidth}
            backgroundColor={selected ? 'yellowBright' : undefined}
            color="black"
            bold
          >{`> ${title}`}</Row>
          <Row width={leftWidth}>Plain chat</Row>
        </>
      }
      messages={<Row width={78 - leftWidth}>Messages</Row>}
    />,
    {columns: 80},
  );
}

test('active pane headers use white on dark blue and keep their textual focus marker', async () => {
  const emulator = terminal('6');
  try {
    emulator.write(renderToString(<PanelHeader title="CHATS" active width={30} />, {columns: 80}));
    await new Promise<void>((resolve) => emulator.write('', resolve));
    const line = emulator.buffer.active.getLine(0)!;
    assert.ok(line.translateToString().startsWith('[ACTIVE] CHATS'));
    for (const column of [0, 9, 29]) {
      const cell = line.getCell(column)!;
      if (column < 13)
        assert.ok([15, 231, 0xffffff].includes(cell.getFgColor()), 'active header text must be white');
      assert.ok(
        [4, 61, 0x1e3a8a].includes(cell.getBgColor()),
        'the whole header must have a dark blue background',
      );
    }
  } finally {
    emulator.dispose();
  }
});

test('album details bound the preview and highlight the current item across the full terminal row', async () => {
  const emulator = terminal('6', 80, 60);
  const messages = messageRecords(
    [3, 4, 5].map((id) => ({
      id,
      groupedId: returnBigInt(123),
      media: photo(id),
      message: `Synthetic item ${id}`,
    })),
    '42',
    'mine',
  );
  try {
    emulator.write(
      renderToString(
        <MessageDetails
          message={messageRows(messages)[0]!}
          client={{}}
          width={79}
          height={59}
          onClose={() => {}}
        />,
        {columns: 80},
      ),
    );
    await new Promise<void>((resolve) => emulator.write('', resolve));
    const lines = Array.from({length: 60}, (_, row) => emulator.buffer.active.getLine(row)!);
    const index = (label: string) => {
      const found = lines.findIndex((line) => line.translateToString().includes(label));
      assert.ok(found >= 0, `missing section: ${label}`);
      return found;
    };
    const preview = index('── Preview · #3');
    const end = index('── End preview · #3');
    const contents = index('── Album items');
    assert.ok(preview < end && end < contents, 'preview boundaries precede the item sections');
    assert.ok(
      contents < index('MESSAGE #3') &&
        index('MESSAGE #3') < index('MESSAGE #4') &&
        index('MESSAGE #4') < index('MESSAGE #5'),
    );
    for (const label of ['[CURRENT] Viewing item 1/3 · #3', '[CURRENT] MESSAGE #3']) {
      const line = lines[index(label)]!;
      for (const column of [0, 12, 78])
        assert.ok(
          [4, 61, 0x1e3a8a].includes(line.getCell(column)!.getBgColor()),
          'the current section fills the row with dark blue',
        );
      assert.ok([15, 231, 0xffffff].includes(line.getCell(0)!.getFgColor()), 'current-item text stays white');
      assert.equal(line.getCell(79)!.getBgColor(), -1, 'highlight stops inside the reserved terminal width');
    }
    for (const id of [4, 5])
      assert.equal(
        lines[index(`── MESSAGE #${id}`)]!.getCell(0)!.getBgColor(),
        -1,
        'other items have distinct unhighlighted headings',
      );
    assert.equal(emulator.buffer.active.baseY, 0, 'section rules do not overflow the terminal');
  } finally {
    emulator.dispose();
  }
});

test('reproduces the old test blind spot: Ink output alone does not fix the physical divider column', async () => {
  for (const [profile, expected] of [
    ['6', 23],
    ['15', 25],
  ] as const) {
    const emulator = terminal(profile);
    const screen = new Screen(emulator);
    try {
      const raw = fixture('Sample✈️', 24);
      assert.ok(raw.includes('Sample✈️'));
      await write(screen, raw);
      const line = emulator.buffer.active.getLine(0)!;
      const divider = Array.from({length: 80}, (_, column) => line.getCell(column)!.getChars()).indexOf('|');
      assert.equal(divider, expected, 'physical terminal advance can differ in either direction');
    } finally {
      screen.destroy();
      emulator.dispose();
    }
  }
});

for (const profile of ['6', '15', '15-graphemes'] as const) {
  test(`Sample✈️ stays aligned and fully highlighted in xterm ${profile}`, async () => {
    const emulator = terminal(profile);
    const screen = new Screen(emulator);
    const output = new TerminalOutput(screen);
    try {
      for (const width of [10, 11, 12, 24, 40]) {
        for (const selected of [false, true]) {
          await write(output, '\x1b[H\x1b[2J' + fixture('Sample✈️', width, selected));
          const row = emulator.buffer.active.getLine(0)!;
          assert.equal(
            row.getCell(width)!.getChars(),
            '|',
            'separator must be at its actual terminal column',
          );
          assert.equal(emulator.buffer.active.getLine(1)!.getCell(width)!.getChars(), '|');
          assert.ok(
            screen.chunks.at(-1)!.includes('✈️'),
            'emit the complete airplane and its selector without an intervening escape',
          );
          assert.equal(row.getCell(8)!.getChars(), profile === '15' ? '✈' : '✈️');
          for (let column = 0; column < width; column++) {
            assert.equal(
              row.getCell(column)!.getBgColor(),
              selected ? 11 : -1,
              `background at cell ${column}`,
            );
          }
          assert.equal(row.getCell(width)!.getBgColor(), -1);
          assert.equal(row.getCell(width + 1)!.getChars(), 'M');
          assert.equal(emulator.buffer.active.baseY, 0, 'no accidental terminal wrapping');
        }
      }
    } finally {
      output.destroy();
      screen.destroy();
      emulator.dispose();
    }
  });
}

test('all required emoji stay aligned in a terminal with grapheme support', async () => {
  const emulator = terminal('15-graphemes');
  const screen = new Screen(emulator);
  const output = new TerminalOutput(screen);
  try {
    for (const title of ['Sample✈️', 'Пример✈️', '🛫', '🚀', '👨‍👩‍👧‍👦', '🇨🇿', 'e\u0301', '✈️'.repeat(50)]) {
      for (const width of [4, 5, 10, 24, 40]) {
        await write(output, '\x1b[H\x1b[2J' + fixture(title, width));
        const row = emulator.buffer.active.getLine(0)!;
        assert.equal(row.getCell(width)!.getChars(), '|');
        for (let column = 0; column < width; column++) assert.equal(row.getCell(column)!.getBgColor(), 11);
      }
    }
  } finally {
    output.destroy();
    screen.destroy();
    emulator.dispose();
  }
});

test('redirected output remains unchanged', async () => {
  const chunks: string[] = [];
  const target = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const output = new TerminalOutput(target);
  const value = '\x1b[103mSample✈️\x1b[49m\n';
  try {
    await write(output, value);
    assert.equal(chunks.join(''), value);
  } finally {
    output.destroy();
    target.destroy();
  }
});

test('terminal output tracks cursor movements and redraws without shifting emoji rows', async () => {
  const emulator = terminal('6');
  const screen = new Screen(emulator);
  const output = new TerminalOutput(screen);
  try {
    for (const prefix of ['\x1b[H', '\x1b[1G', '\r', '\x1b[4G\x1b[3D', '\x1b[1;1H']) {
      await write(output, '\x1b[H\x1b[2J');
      await write(output, prefix + fixture('Sample✈️', 24));
      assert.equal(emulator.buffer.active.getLine(0)!.getCell(24)!.getChars(), '|');
    }
  } finally {
    output.destroy();
    screen.destroy();
    emulator.dispose();
  }
});

test('an airplane at the right panel edge keeps its background without wrapping or painting outside the row', async () => {
  for (const profile of ['6', '15', '15-graphemes'] as const) {
    const emulator = terminal(profile, 30, 4);
    const screen = new Screen(emulator);
    const output = new TerminalOutput(screen);
    try {
      const raw = renderToString(
        <Panels
          widths={{width: 29, leftWidth: 12, rightWidth: 16, separatorWidth: 1}}
          height={1}
          chats={<Row width={12}>Chat</Row>}
          messages={
            <Row width={16} backgroundColor="yellowBright">
              12345678901234✈️
            </Row>
          }
        />,
        {columns: 30},
      );
      await write(output, raw);
      const row = emulator.buffer.active.getLine(0)!;
      assert.equal(row.getCell(12)!.getChars(), '|');
      for (let column = 13; column < 29; column++) assert.equal(row.getCell(column)!.getBgColor(), 11);
      assert.equal(row.getCell(29)!.getBgColor(), -1, 'reserved terminal column stays unhighlighted');
      assert.equal(emulator.buffer.active.cursorY, 0, 'wide glyph does not wrap into another row');
      assert.ok(screen.chunks.join('').includes('✈️'));
    } finally {
      output.destroy();
      screen.destroy();
      emulator.dispose();
    }
  }
});

test('live resize and selection redraw correctly in the actual terminal buffer', async () => {
  class Input extends PassThrough {
    isTTY = true;
    setRawMode() {
      return this;
    }
    ref() {
      return this;
    }
    unref() {
      return this;
    }
  }
  const emulator = terminal('15');
  const screen = new Screen(emulator);
  const output = new TerminalOutput(screen);
  const stdin = new Input();
  function App() {
    const {columns, rows} = useTerminalSize();
    const [percent, setPercent] = useState(32);
    const [selected, setSelected] = useState(0);
    const widths = panelWidths(columns, percent);
    useInput((input, key) => {
      if (input === '[' || input === ']' || input === '0')
        setPercent((previous) => adjustChatPercent(previous, input));
      if (key.downArrow) setSelected((previous) => 1 - previous);
    });
    return (
      <Box height={rows - 1} width={widths.width} flexDirection="column">
        <Row width={widths.width}>{`SIZE ${columns}x${rows}/${percent}/${selected}`}</Row>
        <Panels
          widths={widths}
          height={rows - 2}
          chats={['Sample✈️', 'Sample🛫'].map((title, index) => (
            <Row
              key={title}
              width={widths.leftWidth}
              backgroundColor={index === selected ? 'yellowBright' : undefined}
            >{`> ${title}`}</Row>
          ))}
          messages={<Row width={widths.rightWidth}>Messages ✈️</Row>}
        />
      </Box>
    );
  }
  const instance = render(<App />, {
    stdout: output,
    stdin,
    stderr: new PassThrough(),
    interactive: true,
    alternateScreen: true,
    maxFps: 0,
    patchConsole: false,
    kittyKeyboard: {mode: 'disabled'},
  });
  async function check(percent: number, selected: number) {
    // Ink's commit and the terminal parser are separate queues; flush both.
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setImmediate(resolve));
      await instance.waitUntilRenderFlush();
      await write(output, '');
      if (
        emulator.buffer.active
          .getLine(0)!
          .translateToString(true)
          .startsWith(`SIZE ${screen.columns}x${screen.rows}/${percent}/${selected}`)
      )
        break;
    }
    assert.ok(
      emulator.buffer.active
        .getLine(0)!
        .translateToString(true)
        .startsWith(`SIZE ${screen.columns}x${screen.rows}/${percent}/${selected}`),
    );
    const {leftWidth} = panelWidths(screen.columns, percent);
    for (let rowIndex = 1; rowIndex < screen.rows - 1; rowIndex++) {
      const row = emulator.buffer.active.getLine(rowIndex)!;
      assert.equal(row.getCell(leftWidth)!.getChars(), '|');
      for (let column = 0; column < leftWidth; column++) {
        assert.equal(
          row.getCell(column)!.getBgColor(),
          rowIndex === selected + 1 ? 11 : -1,
          'no stale selection in terminal buffer',
        );
      }
    }
    assert.equal(emulator.buffer.active.baseY, 0);
  }
  try {
    await check(32, 0);
    stdin.write(']');
    await check(34, 0);
    stdin.write('\x1b[B');
    await check(34, 1);
    for (const [columns, rows] of [
      [60, 12],
      [40, 8],
      [110, 28],
      [80, 16],
    ]) {
      screen.resize(columns!, rows!);
      await check(34, 1);
    }
    stdin.write('[');
    await check(32, 1);
    stdin.write(']');
    await check(34, 1);
    stdin.write('0');
    await check(32, 1);
  } finally {
    instance.unmount();
    await instance.waitUntilExit();
    instance.cleanup();
    output.destroy();
    screen.destroy();
    stdin.destroy();
    emulator.dispose();
  }
  assert.equal(screen.listenerCount('resize'), 0);
});
