import {Writable, type WritableOptions} from 'node:stream';
import ansiRegex from 'ansi-regex';
import stringWidth from 'string-width';

type TerminalStream = NodeJS.WritableStream & {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
};

const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const controls = new RegExp(`${ansiRegex().source}|[\r\n]`, 'g');
const columnAt = (column: number) => `\x1b[${column + 1}G`;

/**
 * Ink lays out cells correctly, then serializes each row as one string. A
 * terminal with different emoji widths otherwise shifts everything after an
 * emoji, including a separator in a separate Yoga box. Keep terminal output
 * aligned with those cell positions without changing any Unicode characters.
 * This uses the same string-width version as Ink, not another width heuristic.
 */
export class TerminalOutput extends Writable {
  private column = 0;
  private background = '\x1b[49m';
  private readonly onResize = () => this.emit('resize');

  constructor(private readonly terminal: TerminalStream, options?: WritableOptions) {
    super(options);
    terminal.on('resize', this.onResize);
  }

  get isTTY() {return this.terminal.isTTY ?? false;}
  get columns() {return this.terminal.columns;}
  get rows() {return this.terminal.rows;}

  private text(value: string): string {
    if (/^[\x20-\x7e]*$/u.test(value)) {
      this.column += stringWidth(value);
      return value;
    }
    let result = '';
    for (const {segment} of segmenter.segment(value)) {
      const width = stringWidth(segment);
      if (width > 1) {
        // Paint the cells before drawing the complete grapheme. If a terminal
        // advances only one cell for a colorful emoji, its other cell still has
        // the active background. CHA then anchors the following text to Ink's
        // intended column rather than the terminal's reported character width.
        result += columnAt(this.column) + ' '.repeat(width) + columnAt(this.column) + segment;
        this.column += width;
        const end = columnAt(this.column);
        // Other width tables allocate an extra cell for VS16. Overwriting that
        // continuation can erase the preceding cell using the NEW style (e.g.
        // an unhighlighted divider). Clear it now, while the glyph's background
        // is still active, then leave the next cell clean for its actual owner.
        result += end + ' ' + end;
        if (this.background !== '\x1b[49m') result += '\x1b[49m ' + this.background + end;
      } else {
        result += segment;
        this.column += width;
      }
    }
    return result;
  }

  private control(value: string) {
    if (value === '\r' || value === '\n') {
      // Ink uses newline as a terminal line break (TTY ONLCR).
      this.column = 0;
      return;
    }
    const match = /^\x1b\[([\d;]*)([A-Za-z`])$/u.exec(value);
    if (!match) return;
    const parameters = match[1]!.split(';').map(Number);
    const count = parameters[0] || 1;
    switch (match[2]) {
      case 'm':
        for (let index = 0; index < parameters.length; index++) {
          const code = parameters[index];
          if (code === 0 || code === 49) this.background = '\x1b[49m';
          else if ((code! >= 40 && code! <= 47) || (code! >= 100 && code! <= 107)) this.background = `\x1b[${code}m`;
          else if (code === 38 || code === 48) {
            const length = parameters[index + 1] === 2 ? 5 : 3;
            if (code === 48) this.background = `\x1b[${parameters.slice(index, index + length).join(';')}m`;
            index += length - 1;
          }
        }
        break;
      case 'G': case '`': this.column = count - 1; break;
      case 'H': case 'f': this.column = (parameters[1] || 1) - 1; break;
      case 'C': case 'a': this.column += count; break;
      case 'D': this.column = Math.max(0, this.column - count); break;
      case 'E': case 'F': this.column = 0; break;
    }
  }

  private positionGraphemes(value: string): string {
    let result = '';
    let start = 0;
    for (const match of value.matchAll(controls)) {
      result += this.text(value.slice(start, match.index));
      result += match[0];
      this.control(match[0]);
      start = match.index + match[0].length;
    }
    return result + this.text(value.slice(start));
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const value = chunk.toString('utf8');
    // Preserve ordinary text output when stdout is redirected.
    this.terminal.write(this.isTTY ? this.positionGraphemes(value) : value, callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.terminal.off('resize', this.onResize);
    callback(error);
  }
}
