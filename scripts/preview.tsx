import React from 'react';
import {writeFileSync} from 'node:fs';
import {render} from 'ink';
import {App} from '../src/App.js';
import {TerminalOutput} from '../src/terminal-output.js';
import type {TelegramApi} from '../src/telegram.js';
import {testTerminal} from '../test/helpers/terminal.js';

// Public, synthetic fixtures only: no authentication, disk settings or sessions.
function syntheticClient(): TelegramApi {
  const records = Array.from({length: 202}, (_, index) => ({
    id: 300 - index,
    message:
      index === 0
        ? 'Example message — inspect with Enter before marking.'
        : `Synthetic planning message ${index}`,
    senderId: index % 3 === 0 ? 99 : 42,
  }));
  const deleted = new Set<number>();
  return {
    async getMe() {
      return {id: 42, firstName: 'Synthetic account'};
    },
    async *iterDialogs() {
      for (let index = 0; index < 205; index++)
        yield {
          id: `-${1000 + index}`,
          title: index === 0 ? 'Weekend project' : `Synthetic group ${index}`,
          entity: `synthetic-${index}`,
          isGroup: true,
        };
    },
    async getMessages(_entity, options) {
      return records
        .filter(
          (message) =>
            !deleted.has(message.id) &&
            (options.ids
              ? options.ids.includes(message.id)
              : (!options.offsetId || message.id < options.offsetId) &&
                (!options.fromUser || message.senderId === 42)),
        )
        .slice(0, options.ids ? undefined : options.limit);
    },
    async *iterMessages() {
      for (const record of records) if (record.senderId === 42 && !deleted.has(record.id)) yield record;
    },
    async deleteMessages(_entity, ids) {
      ids.forEach((id) => deleted.add(id));
    },
  };
}
const settings = {read: () => 32, write: (_value: number) => {}};
const escapeXML = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
if (process.argv.includes('--capture')) {
  for (const [columns, rows, name] of [
    [100, 24, 'synthetic-terminal'],
    [40, 18, 'synthetic-narrow'],
  ] as const) {
    const ui = testTerminal(<App client={syntheticClient()} settings={settings} />, {columns, rows});
    try {
      await ui.waitFor((frame) => frame.includes('100 own messages loaded'));
      const lines = ui.frame().trimEnd().split('\n');
      const width = columns * 9 + 24;
      const height = rows * 19 + 36;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>Synthetic TG Manager: actual App render at ${columns} columns by ${rows} rows</title>
<rect width="100%" height="100%" fill="#111827"/>
<g fill="#e5e7eb" font-family="monospace" font-size="14">
<text x="12" y="22" fill="#67e8f9">SYNTHETIC UI · ${columns}×${rows} · OFFLINE</text>
${lines.map((line, index) => `<text x="12" y="${48 + index * 19}" xml:space="preserve">${escapeXML(line)}</text>`).join('\n')}
</g></svg>\n`;
      writeFileSync(`assets/${name}.svg`, svg);
      console.log(`Captured ${name}: ${lines.length} rows`);
    } finally {
      await ui.close();
    }
  }
} else {
  const stdout = new TerminalOutput(process.stdout);
  const instance = render(<App client={syntheticClient()} settings={settings} />, {
    stdout,
    alternateScreen: true,
  });
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    stdout.destroy();
  }
}
