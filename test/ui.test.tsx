import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {PassThrough, Writable} from 'node:stream';
import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {stripVTControlCharacters} from 'node:util';
import React, {useState} from 'react';
import {Box, render, renderToString, useInput} from 'ink';
import {adjustChatPercent, panelWidths, Panels, Row, singleLine, useTerminalSize} from '../src/ui.js';

// Test the dependencies Ink actually resolves, rather than a second application
// width implementation. Expected cell counts below are independent fixtures.
const inkRequire = createRequire(import.meta.resolve('ink'));
const {default: inkWidth} = await import(pathToFileURL(inkRequire.resolve('string-width')).href);
const {tokenize} = await import(
  new URL('./build/index.js', pathToFileURL(inkRequire.resolve('@alcalzone/ansi-tokenize/package.json'))).href
);
const glyphs = new Map([
  ['✈️', 2],
  ['🛫', 2],
  ['🚀', 2],
  ['👨‍👩‍👧‍👦', 2],
  ['🇨🇿', 2],
  ['e\u0301', 1],
  ['✈︎', 1],
  ['漢', 2],
  ['…', 1],
]);
const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

// Decode emitted SGR and expand each known grapheme into physical cells. This
// detects gaps/reset styles inside wide emoji as well as incorrect padding.
function cells(line: string) {
  const result: {glyph: string; background?: number}[] = [];
  let background: number | undefined;
  let cursor = 0;
  for (const match of line.matchAll(/\x1b\[([\d;]*)m|([^\x1b]+)/gu)) {
    assert.equal(match.index, cursor, 'unexpected ANSI sequence in frame');
    cursor += match[0].length;
    if (match[1] !== undefined) {
      for (const code of match[1].split(';').map(Number)) {
        if (code === 0 || code === 49) background = undefined;
        else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) background = code;
      }
    } else {
      for (const {segment} of segmenter.segment(match[2]!)) {
        const width = glyphs.get(segment) ?? (/^[\x20-\x7e]$/.test(segment) ? 1 : undefined);
        assert.notEqual(width, undefined, `unexpected test grapheme ${JSON.stringify(segment)}`);
        for (let i = 0; i < width!; i++) result.push({glyph: segment, background});
      }
    }
  }
  assert.equal(cursor, line.length);
  return result;
}

for (const [glyph, width] of glyphs) {
  test(`Ink measures and tokenizes ${glyph} as one ${width}-cell grapheme`, () => {
    assert.equal(inkWidth(glyph), width);
    assert.deepEqual(
      tokenize(glyph)
        .filter((token: {type: string}) => token.type === 'char')
        .map((token: {value: string}) => token.value),
      [glyph],
    );
  });

  test(`selected rows preserve ${glyph}, fill the row and truncate at grapheme boundaries`, () => {
    for (let width = 0; width <= 32; width++) {
      for (const text of [
        `> ${glyph} chat`,
        `> ${glyph.repeat(20)} end`,
        `> ${'a'.repeat(Math.max(0, width - 4))}${glyph} end`,
      ]) {
        const output = renderToString(
          <Row width={width} backgroundColor="yellowBright" color="black" bold>
            {text}
          </Row>,
          {columns: 40},
        );
        assert.equal(output.includes('\n'), false);
        const row = cells(output);
        assert.equal(
          row.length,
          width,
          `${JSON.stringify(text)} at width ${width}: ${JSON.stringify(output)}`,
        );
        assert.ok(
          row.every((cell) => cell.background === 103),
          'every cell, including emoji continuations and padding, must be highlighted',
        );
        if (inkWidth(text) <= width) assert.equal(stripVTControlCharacters(output).trimEnd(), text);
        // No ANSI styling may split a grapheme or strip its selectors/joiners.
        const plain = stripVTControlCharacters(output).trimEnd();
        assert.ok(
          text.startsWith(plain.replace(/…$/, '')),
          `truncation changed the source: ${JSON.stringify(plain)}`,
        );
      }
    }
  });
}

test('single-line normalization preserves emoji presentation and combining characters', () => {
  const title = [...glyphs.keys()].join(' ');
  assert.equal(singleLine(title), title);
  assert.equal(singleLine('one\r\n\t two\u0000\u0085three'), 'one two three');
});

function frame(columns: number, percent: number, selected: number, messagesFocused = false) {
  const widths = panelWidths(columns, percent);
  const titles = [...glyphs.keys()].map((glyph) => `> ${glyph} chat ${glyph.repeat(12)}`);
  const output = renderToString(
    <Panels
      widths={widths}
      height={titles.length + 1}
      chats={
        <>
          <Row width={widths.leftWidth} backgroundColor="blueBright">
            CHATS
          </Row>
          {titles.map((title, i) => (
            <Row
              key={title}
              width={widths.leftWidth}
              backgroundColor={i === selected && !messagesFocused ? 'yellowBright' : undefined}
            >
              {title}
            </Row>
          ))}
        </>
      }
      messages={
        <>
          <Row width={widths.rightWidth} backgroundColor="blueBright">
            MESSAGES
          </Row>
          {titles.map((title, i) => (
            <Row
              key={title}
              width={widths.rightWidth}
              backgroundColor={i === selected && messagesFocused ? 'yellowBright' : undefined}
            >
              {title}
            </Row>
          ))}
        </>
      }
    />,
    {columns: Math.max(1, columns)},
  );
  return {output, widths};
}

test('divider and full-row selection survive every column width, focus and panel percentage', () => {
  for (const columns of [1, 2, 3, 8, 20, 32, 40, 80, 100, 160]) {
    for (const percent of [20, 32, 50, 70]) {
      for (const messagesFocused of [false, true]) {
        const {output, widths} = frame(columns, percent, 1, messagesFocused);
        const lines = output.split('\n');
        assert.equal(lines.length, glyphs.size + 1);
        for (const [i, line] of lines.entries()) {
          const row = cells(line);
          assert.ok(row.length <= widths.width, `overflow at ${columns} columns`);
          if (widths.separatorWidth) {
            assert.equal(row[widths.leftWidth]?.glyph, '|');
            assert.equal(
              row[widths.leftWidth]?.background,
              undefined,
              'highlight must stop before separator',
            );
          }
          const left = row.slice(0, widths.leftWidth);
          const right = row.slice(widths.leftWidth + widths.separatorWidth);
          if (i === 2) {
            assert.equal(left.length, widths.leftWidth);
            if (messagesFocused) assert.equal(right.length, widths.rightWidth);
            assert.ok(left.every((cell) => cell.background === (messagesFocused ? undefined : 103)));
            assert.ok(right.every((cell) => cell.background === (messagesFocused ? 103 : undefined)));
          } else if (i > 0)
            assert.ok(
              row.every((cell) => cell.background !== 103),
              'stale row selection',
            );
        }
      }
    }
  }
});

test('panel adjustment keys retain clamping and reset behavior', () => {
  assert.equal(adjustChatPercent(32, '['), 30);
  assert.equal(adjustChatPercent(32, ']'), 34);
  assert.equal(adjustChatPercent(20, '['), 20);
  assert.equal(adjustChatPercent(70, ']'), 70);
  assert.equal(adjustChatPercent(70, '0'), 32);
  assert.ok(panelWidths(100, 30).leftWidth < panelWidths(100, 34).leftWidth);
});

test('layout minima never force panels outside the terminal', () => {
  for (let columns = 0; columns <= 200; columns++) {
    for (let percent = 20; percent <= 70; percent += 2) {
      const {width, leftWidth, rightWidth, separatorWidth} = panelWidths(columns, percent);
      assert.equal(leftWidth + rightWidth + separatorWidth, width);
      assert.ok(width < columns || columns === 0);
      assert.ok(leftWidth >= 0 && rightWidth >= 0);
    }
  }
});

test('live Ink input and resize repaint the divider and clear previous selections', async () => {
  class Output extends Writable {
    columns = 100;
    rows = 24;
    isTTY = true;
    chunks: string[] = [];
    override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
      this.chunks.push(chunk.toString());
      callback();
    }
  }
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
  const stdout = new Output();
  const stdin = new Input();
  const titles = ['✈️', '🛫', '👨‍👩‍👧‍👦'];
  function Harness() {
    const size = useTerminalSize();
    const [percent, setPercent] = useState(32);
    const [selected, setSelected] = useState(0);
    const [right, setRight] = useState(false);
    useInput((input, key) => {
      if (input === '[' || input === ']' || input === '0')
        setPercent((previous) => adjustChatPercent(previous, input));
      if (key.downArrow) setSelected((previous) => (previous + 1) % titles.length);
      if (key.tab) setRight((previous) => !previous);
    });
    const widths = panelWidths(size.columns, percent);
    return (
      <Box width={widths.width} height={size.rows - 1} flexDirection="column">
        <Row
          width={widths.width}
        >{`SIZE ${size.columns}x${size.rows}/${percent}/${selected}/${Number(right)}`}</Row>
        <Panels
          widths={widths}
          height={size.rows - 2}
          chats={titles.map((title, i) => (
            <Row
              key={title}
              width={widths.leftWidth}
              backgroundColor={i === selected && !right ? 'yellowBright' : undefined}
            >{`> ${title} chat`}</Row>
          ))}
          messages={titles.map((title, i) => (
            <Row
              key={title}
              width={widths.rightWidth}
              backgroundColor={i === selected && right ? 'yellowBright' : undefined}
            >{`> [x] ${title} message`}</Row>
          ))}
        />
      </Box>
    );
  }
  const instance = render(<Harness />, {
    stdout,
    stdin,
    stderr: new PassThrough(),
    interactive: true,
    patchConsole: false,
    exitOnCtrlC: false,
    maxFps: 0,
    kittyKeyboard: {mode: 'disabled'},
  });
  async function check(percent: number, selected: number, right: boolean, erased = true) {
    const marker = `SIZE ${stdout.columns}x${stdout.rows}/${percent}/${selected}/${Number(right)}`;
    let chunk = '';
    for (let attempts = 0; attempts < 100; attempts++) {
      chunk = stdout.chunks.filter((value) => value.includes('|')).at(-1) ?? '';
      if (stripVTControlCharacters(chunk).startsWith(marker)) break;
      await setTimeout(10);
    }
    assert.ok(stripVTControlCharacters(chunk).startsWith(marker), `missing frame ${marker}`);
    if (erased) assert.ok(stdout.chunks.join('').includes('\x1b[2K'), 'Ink must erase the preceding frame');
    const frame = chunk.replace(/^(?:\x1b\[[\d;?]*[A-HJKhl])+/u, '').replace(/\n$/, '');
    const lines = frame.split('\n');
    assert.equal(lines.length, stdout.rows - 1, 'frame leaves room for the trailing newline');
    const widths = panelWidths(stdout.columns, percent);
    for (const [i, line] of lines.entries()) {
      const row = cells(line);
      assert.ok(row.length <= widths.width, 'frame must fit after resize');
      if (i === 0) continue;
      assert.equal(row[widths.leftWidth]?.glyph, '|');
      const highlighted = row.flatMap((cell, column) => (cell.background === 103 ? [column] : []));
      const start = right ? widths.leftWidth + 1 : 0;
      const count = right ? widths.rightWidth : widths.leftWidth;
      assert.deepEqual(
        highlighted,
        i === selected + 1 ? Array.from({length: count}, (_, index) => start + index) : [],
        'no stale or partial selection',
      );
    }
    stdout.chunks = [];
  }
  try {
    await check(32, 0, false, false);
    stdin.write(']');
    await check(34, 0, false);
    stdin.write('[');
    await check(32, 0, false);
    stdin.write('\x1b[B');
    await check(32, 1, false);
    stdin.write('\t');
    await check(32, 1, true);
    for (const [columns, rows] of [
      [60, 12],
      [40, 8],
      [110, 28],
      [80, 16],
    ]) {
      stdout.columns = columns!;
      stdout.rows = rows!;
      stdout.emit('resize');
      await check(32, 1, true);
    }
    stdin.write(']');
    await check(34, 1, true);
    stdin.write('0');
    await check(32, 1, true);
  } finally {
    instance.unmount();
    instance.cleanup();
    stdin.destroy();
    stdout.destroy();
  }
  assert.equal(stdout.listenerCount('resize'), 0, 'resize listeners must be removed on unmount');
});
