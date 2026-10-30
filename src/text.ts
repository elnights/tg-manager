import stringWidth from 'string-width';

// Wrap by terminal cells, preserving grapheme clusters. Never hide control text.
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [''];
  const lines: string[] = [];
  for (const paragraph of text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && stringWidth(`${line} ${word}`) > width) {
        lines.push(line);
        line = '';
      }
      if (stringWidth(word) <= width) {
        line += `${line ? ' ' : ''}${word}`;
        continue;
      }
      for (const {segment} of new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(word)) {
        if (stringWidth(line + segment) > width) {
          lines.push(line);
          line = '';
        }
        if (stringWidth(segment) <= width) line += segment;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function singleLine(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f\s]+/gu, ' ');
}
export function boundedText(text: string, limit = 80): string {
  const parts = [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(singleLine(text))];
  return (
    parts
      .slice(0, limit)
      .map((part) => part.segment)
      .join('') + (parts.length > limit ? '…' : '')
  );
}
