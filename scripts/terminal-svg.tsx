import {Writable} from 'node:stream';
import headless from '@xterm/headless';
import unicodeGraphemes from '@xterm/addon-unicode-graphemes';
import type {IBufferCell} from '@xterm/headless';
import {TerminalOutput} from '../src/terminal-output.js';

const palette = [
  '#0f172a',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#1e3a8a',
  '#a78bfa',
  '#22d3ee',
  '#d1d5db',
  '#64748b',
  '#fb7185',
  '#86efac',
  '#fde047',
  '#93c5fd',
  '#d8b4fe',
  '#67e8f9',
  '#f8fafc',
];
const background = '#0f172a';
const foreground = '#d6deeb';
const cellWidth = 9;
const lineHeight = 20;
const padding = 16;
const top = 54;
const escapeXML = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function color(value: number, rgb: boolean, fallback: string) {
  if (value < 0) return fallback;
  if (rgb) return `#${value.toString(16).padStart(6, '0')}`;
  if (value < 16) return palette[value]!;
  if (value >= 232) {
    const gray = (8 + (value - 232) * 10).toString(16).padStart(2, '0');
    return `#${gray.repeat(3)}`;
  }
  const levels = [0, 95, 135, 175, 215, 255];
  const n = value - 16;
  return `#${[Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6]
    .map((index) => levels[index]!.toString(16).padStart(2, '0'))
    .join('')}`;
}

function colors(cell: IBufferCell) {
  const fg = cell.isFgDefault() ? foreground : color(cell.getFgColor(), cell.isFgRGB(), foreground);
  const bg = cell.isBgDefault() ? background : color(cell.getBgColor(), cell.isBgRGB(), background);
  return cell.isInverse() ? {fg: bg, bg: fg} : {fg, bg};
}

// Render actual terminal cells, preserving ANSI styles and the app's emoji repair.
export async function terminalSVG(frame: string, columns: number, rows: number): Promise<string> {
  const emulator = new headless.Terminal({cols: columns, rows, allowProposedApi: true, convertEol: true});
  emulator.loadAddon(new unicodeGraphemes.UnicodeGraphemesAddon());
  emulator.unicode.activeVersion = '15-graphemes';
  const screen = Object.assign(
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        emulator.write(chunk.toString(), callback);
      },
    }),
    {isTTY: true, columns, rows},
  );
  const output = new TerminalOutput(screen);
  try {
    await new Promise<void>((resolve, reject) =>
      output.write('\x1b[H\x1b[2J' + frame.trimEnd(), (error) => (error ? reject(error) : resolve())),
    );
    const shapes: string[] = [];
    const text: string[] = [];
    for (let row = 0; row < rows; row++) {
      const line = emulator.buffer.active.getLine(row)!;
      let column = 0;
      while (column < columns) {
        const start = column;
        const bg = colors(line.getCell(column)!).bg;
        column++;
        while (column < columns && colors(line.getCell(column)!).bg === bg) column++;
        if (bg !== background)
          shapes.push(
            `<rect x="${padding + start * cellWidth}" y="${top + row * lineHeight}" width="${(column - start) * cellWidth}" height="${lineHeight}" fill="${bg}"/>`,
          );
      }
      column = 0;
      while (column < columns) {
        const start = column;
        const cell = line.getCell(column)!;
        if (cell.getWidth() === 0) {
          column++;
          continue;
        }
        const {fg} = colors(cell);
        const bold = cell.isBold();
        const dim = cell.isDim();
        let chars = cell.getChars() || ' ';
        const wide = cell.getWidth() > 1;
        column += cell.getWidth();
        if (!wide)
          while (column < columns) {
            const next = line.getCell(column)!;
            if (
              next.getWidth() !== 1 ||
              colors(next).fg !== fg ||
              next.isBold() !== bold ||
              next.isDim() !== dim
            )
              break;
            chars += next.getChars() || ' ';
            column++;
          }
        const leading = chars.length - chars.trimStart().length;
        const trailing = chars.length - chars.trimEnd().length;
        if (chars.trim())
          text.push(
            `<text x="${padding + (start + leading) * cellWidth}" y="${top + row * lineHeight + 15}" fill="${fg}"${bold ? ' font-weight="700"' : ''}${dim ? ' opacity="0.65"' : ''}${wide ? '' : ` textLength="${(column - start - leading - trailing) * cellWidth}" lengthAdjust="spacingAndGlyphs"`}>${escapeXML(chars.trim())}</text>`,
          );
      }
    }
    const width = columns * cellWidth + padding * 2;
    const height = top + rows * lineHeight + padding;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
<title id="title">TG Manager — everyday Telegram conversations</title>
<desc id="description">Actual terminal UI at ${columns} columns by ${rows} rows, rendered offline with fictional chats and messages.</desc>
<defs><clipPath id="window"><rect width="${width}" height="${height}" rx="12"/></clipPath></defs>
<g clip-path="url(#window)">
<rect width="${width}" height="${height}" fill="${background}"/>
<rect width="${width}" height="38" fill="#1e293b"/>
<circle cx="20" cy="19" r="5" fill="#fb7185"/>
<circle cx="38" cy="19" r="5" fill="#fbbf24"/>
<circle cx="56" cy="19" r="5" fill="#4ade80"/>
<text x="${width / 2}" y="24" fill="#cbd5e1" text-anchor="middle" font-family="monospace" font-size="12">tg-manager</text>
${shapes.join('\n')}
<g font-family="'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'" font-size="14" xml:space="preserve" style="white-space:pre">
${text.join('\n')}
</g></g></svg>\n`;
  } finally {
    output.destroy();
    screen.destroy();
    emulator.dispose();
  }
}
