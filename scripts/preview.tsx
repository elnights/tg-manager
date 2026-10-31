import React from 'react';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import {App} from '../src/App.js';
import {TerminalOutput} from '../src/terminal-output.js';
import type {TelegramApi} from '../src/telegram.js';
import {testTerminal} from '../test/helpers/terminal.js';
import {Api} from 'teleproto';
import {returnBigInt} from 'teleproto/Helpers.js';
import {getPeerId} from 'teleproto/Utils.js';
import type {MessageRecord} from '../src/telegram.js';
import {photo, image} from '../test/helpers/media.js';

// Public, synthetic fixtures only: no authentication, disk settings or sessions.
function syntheticClient(channelMode = false, slow = false, mediaMode = false): TelegramApi {
  const channel = new Api.Channel({
    id: returnBigInt(1000),
    accessHash: returnBigInt(123),
    title: 'Synthetic news',
    broadcast: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
  const group = new Api.Channel({
    id: returnBigInt(2000),
    accessHash: returnBigInt(456),
    title: 'Synthetic discussion',
    megagroup: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
  const records: MessageRecord[] = Array.from({length: 202}, (_, index) => ({
    id: 300 - index,
    message:
      index === 0
        ? 'Example message — inspect with Enter before marking.'
        : `Synthetic planning message ${index}`,
    senderId: index % 3 === 0 ? 99 : 42,
  }));
  const comments: MessageRecord[] = records.map((record, index) => ({
    ...record,
    senderId: index === 0 ? 42 : record.senderId,
    message: index === 0 ? 'Synthetic general conversation' : `Synthetic comment ${index}`,
    ...(index === 0 ? {} : {replyTo: {replyToTopId: 1000 + 300 - (index % 3)}}),
  }));
  if (mediaMode) records[1]!.media = photo();
  const root = (post: number): MessageRecord => ({
    id: 1000 + post,
    message: 'Forwarded channel post',
    peerId: new Api.PeerChannel({channelId: group.id}),
    fwdFrom: {fromId: new Api.PeerChannel({channelId: channel.id}), channelPost: post},
  });
  const deleted = new Map<string, Set<number>>();
  const peer = (entity: Parameters<TelegramApi['getMessages']>[0]) =>
    entity === group ? 'discussion' : String(entity);
  const source = (entity: Parameters<TelegramApi['getMessages']>[0]) =>
    entity === group ? comments : records;
  return {
    async downloadMedia() {
      if (slow) await delay(600);
      return image;
    },
    api: {
      channels: {
        async getFullChannel() {
          return {fullChat: {linkedChatId: group.id}, chats: [channel, group]};
        },
      },
      messages: {
        async getDiscussionMessage({msgId}) {
          return {messages: [root(msgId)], chats: [channel, group]};
        },
      },
    },
    async getMe() {
      return {id: 42, firstName: 'Synthetic account'};
    },
    async *iterDialogs() {
      for (let index = 0; index < 205; index++)
        yield {
          id: channelMode && index === 0 ? getPeerId(channel) : `-${1000 + index}`,
          title: index === 0 ? (channelMode ? channel.title : 'Weekend project') : `Synthetic group ${index}`,
          entity: channelMode && index === 0 ? channel : `synthetic-${index}`,
          isGroup: !(channelMode && index === 0),
          isChannel: channelMode && index === 0,
        };
    },
    async getMessages(entity, options) {
      if (slow) await delay(options.limit === 1 ? 250 : 600);
      const roots =
        entity === group && options.ids
          ? options.ids.filter((id) => id > 1000).map((id) => root(id - 1000))
          : [];
      return [...source(entity), ...roots]
        .filter(
          (message) =>
            !deleted.get(peer(entity))?.has(message.id) &&
            (options.ids
              ? options.ids.includes(message.id)
              : (!options.offsetId || message.id < options.offsetId) &&
                (!options.fromUser || message.senderId === 42) &&
                ((options.replyTo ?? options.topMsgId) === undefined ||
                  (message.replyTo &&
                    'replyToTopId' in message.replyTo &&
                    message.replyTo.replyToTopId === (options.replyTo ?? options.topMsgId)))),
        )
        .slice(0, options.ids ? undefined : options.limit);
    },
    async *iterMessages(entity, options) {
      for (const record of source(entity))
        if (
          record.senderId === 42 &&
          !deleted.get(peer(entity))?.has(record.id) &&
          (options.topMsgId === undefined ||
            (record.replyTo &&
              'replyToTopId' in record.replyTo &&
              record.replyTo.replyToTopId === options.topMsgId))
        )
          yield record;
    },
    async deleteMessages(entity, ids) {
      const missing = deleted.get(peer(entity)) ?? new Set<number>();
      ids.forEach((id) => missing.add(id));
      deleted.set(peer(entity), missing);
    },
  };
}
const settings = {read: () => 32, write: (_value: number) => {}};
const escapeXML = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
if (process.argv.includes('--capture')) {
  for (const [columns, rows, name, channelMode] of [
    [100, 24, 'synthetic-terminal', false],
    [40, 18, 'synthetic-narrow', false],
    [120, 32, 'synthetic-channel', true],
  ] as const) {
    const ui = testTerminal(<App client={syntheticClient(channelMode)} settings={settings} />, {
      columns,
      rows,
    });
    try {
      await ui.waitFor((frame) => frame.includes('/ 100 msgs'));
      if (channelMode)
        await ui.waitFor(
          (frame) =>
            frame.includes('Synthetic general conversation') && !frame.includes('Loading discussion'),
        );
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
  const instance = render(
    <App
      client={syntheticClient(
        process.argv.includes('--channel'),
        process.argv.includes('--slow'),
        process.argv.includes('--media'),
      )}
      mediaFiles={{
        open: async () => {
          throw new Error('The synthetic preview does not open external applications.');
        },
      }}
      settings={settings}
    />,
    {
      stdout,
      alternateScreen: true,
    },
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.unmount();
    stdout.destroy();
  }
}
