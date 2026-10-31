import React from 'react';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import {App} from '../src/App.js';
import {TerminalOutput} from '../src/terminal-output.js';
import type {DialogRecord, TelegramApi} from '../src/telegram.js';
import {testTerminal} from '../test/helpers/terminal.js';
import {Api} from 'teleproto';
import {returnBigInt} from 'teleproto/Helpers.js';
import {getPeerId} from 'teleproto/Utils.js';
import type {MessageRecord} from '../src/telegram.js';
import {photo, image} from '../test/helpers/media.js';
import {terminalSVG} from './terminal-svg.js';

const hikingMessages = [
  'Train at 08:42? I’ll bring coffee ☕',
  'Forecast looks good for Saturday ☀️',
  'Saved the trail map. See you there! 🥾',
  'Meet by the main entrance, platform side 🚉',
  'Count me in + one very excited dog 🐕',
  'Anyone need a spare rain jacket?',
  'That view was worth the early alarm 🏔️',
  'Photos from today are in the album 📸',
  'Same time next weekend? 🙌',
  'Found a little bakery near the station 🥐',
  'Back home. Thanks for a lovely day 💚',
  'I’ll book the tickets tonight 🎟️',
  'Let’s try the riverside route this time 🌿',
  'Water, snacks, charged phone. Ready ✅',
  'Running five minutes late, sorry! 😅',
  'There’s a direct train back at 17:16 🚆',
  'The GPX file works in Mapy.cz too 🗺️',
  'I can bring an extra thermos of tea 🍵',
  'Good call on the earlier train 👍',
  'Lunch stop at the little place by the bridge?',
];
const channelPosts = [
  'Night trams are back this weekend 🚋',
  'New café on the corner. Open until 10 ☕',
  'Free museum night this Saturday 🏛️',
  'Sunday market: pastries, flowers, vinyl 🌷',
  'Five little bookshops worth a detour 📚',
  'Autumn walks along the river 🍂',
  'Live jazz in the courtyard tonight 🎷',
  'A tiny guide to the best dumplings 🥟',
];
const discussionMessages = [
  'Anyone up for coffee before the market? ☕',
  'Finally, somewhere open late 🙌',
  'Went last year. Absolutely worth it ✨',
  'Perfect timing, thanks for the heads-up 🚋',
  'Their cinnamon buns are dangerous 🥐',
  'Do we need to book a time slot?',
  'That’s my route home. Great news! 💚',
  'Adding this to the weekend list ☕',
  'Count me in! Bringing a friend 🎨',
  'The stop by the bridge is open too 👍',
  'Tried it yesterday. Lovely little place 🌿',
  'Is the photography exhibition included? 📷',
];

// Public, synthetic fixtures only: no authentication, disk settings or sessions.
function syntheticClient(
  channelMode = false,
  slow = false,
  mediaMode = false,
  albumMode = false,
): TelegramApi {
  const channel = new Api.Channel({
    id: returnBigInt(1000),
    accessHash: returnBigInt(123),
    title: 'Prague After Hours 🌆',
    broadcast: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
  const group = new Api.Channel({
    id: returnBigInt(2000),
    accessHash: returnBigInt(456),
    title: 'Prague After Hours · chat 💬',
    megagroup: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
  const snippets = channelMode ? channelPosts : hikingMessages;
  const records: MessageRecord[] = Array.from({length: 202}, (_, index) => ({
    id: 300 - index,
    message: snippets[index % snippets.length],
    senderId: index % 4 === 1 ? 99 : index % 4 === 3 ? 43 : 42,
    sender: channelMode ? {title: channel.title} : {firstName: index % 4 === 1 ? 'Maya' : 'Leo'},
    ...(channelMode ? {replies: {replies: [18, 7, 24, 11][index % 4]!}} : {}),
  }));
  const comments: MessageRecord[] = records.map((record, index) => ({
    ...record,
    replies: undefined,
    senderId: index === 0 ? 42 : record.senderId,
    sender: {firstName: index % 4 === 1 ? 'Maya' : 'Leo'},
    message: discussionMessages[index % discussionMessages.length],
    ...(index === 0 ? {} : {replyTo: {replyToTopId: 1000 + 300 - (index % 3)}}),
  }));
  if (mediaMode) records[1]!.media = photo();
  if (albumMode)
    for (let index = 0; index < 3; index++)
      Object.assign(records[index]!, {
        groupedId: returnBigInt('9007199254740993'),
        media: photo(index + 1),
        message: index === 1 ? 'A little autumn escape 🍂 Three stops worth the walk.' : '',
      });
  const root = (post: number): MessageRecord => ({
    id: 1000 + post,
    message: channelPosts[(300 - post) % channelPosts.length],
    peerId: new Api.PeerChannel({channelId: group.id}),
    fwdFrom: {fromId: new Api.PeerChannel({channelId: channel.id}), channelPost: post},
  });
  const deleted = new Map<string, Set<number>>();
  const peer = (entity: Parameters<TelegramApi['getMessages']>[0]) =>
    entity === group ? 'discussion' : String(entity);
  const source = (entity: Parameters<TelegramApi['getMessages']>[0]) =>
    entity === group ? comments : records;
  const titles = [
    ['Weekend hikers 🥾', 'group'],
    [channel.title, 'channel'],
    ['Flatmates 🪴', 'group'],
    ['TypeScript Weekly 🧑‍💻', 'channel'],
    ['Maya 🎨', 'private'],
    ['Dinner club 🍜', 'group'],
    ['Prague cycling 🚲', 'supergroup'],
    ['Alex 💬', 'private'],
    ['Kyoto trip 🇯🇵', 'group'],
    ['Open Source Café ☕', 'supergroup'],
    ['Little wins ✨', 'group'],
    ['Indie Makers 🚀', 'channel'],
    ['Sunday football ⚽', 'group'],
    ['Book club 📚', 'group'],
    ['Music discoveries 🎧', 'channel'],
    ['Family kitchen 🥘', 'group'],
    ['Nina 🌻', 'private'],
    ['Board game nights 🎲', 'group'],
    ['Trail notes 🌲', 'channel'],
    ['Reminders ⏰', 'bot'],
    ['Film night 🍿', 'group'],
    ['Balcony garden 🌱', 'supergroup'],
    ['Design exchange 🎨', 'supergroup'],
    ['Train deals 🚆', 'channel'],
  ] as const;
  const neighborhoods = ['Vinohrady', 'Letná', 'Karlín', 'Žižkov', 'Dejvice', 'Smíchov', 'Holešovice'];
  const communities = [
    'Running club 🏃',
    'Coffee people ☕',
    'Language swap 💬',
    'Neighbors 🏡',
    'Dog walks 🐕',
  ];
  const dialogs: DialogRecord[] = Array.from({length: 205}, (_, index) => {
    const [title, type] = titles[index] ?? [
      `${neighborhoods[index % neighborhoods.length]} · ${communities[Math.floor(index / neighborhoods.length) % communities.length]} ${index < 100 ? '' : '· weekends'}`.trim(),
      'group',
    ];
    const isChannel = type === 'channel';
    const isUser = type === 'private' || type === 'bot';
    const entity =
      title === channel.title
        ? channel
        : isChannel
          ? new Api.Channel({
              id: returnBigInt(3000 + index),
              accessHash: returnBigInt(100 + index),
              title,
              broadcast: true,
              photo: new Api.ChatPhotoEmpty(),
              date: 0,
            })
          : isUser
            ? new Api.User({id: returnBigInt(4000 + index), firstName: title, bot: type === 'bot'})
            : `preview-group-${index}`;
    return {
      id: isChannel || isUser ? getPeerId(entity as Api.Channel | Api.User) : `-${1000 + index}`,
      title,
      entity,
      isUser,
      isGroup: !isUser && !isChannel,
      isChannel: isChannel || type === 'supergroup',
    };
  });
  if (channelMode) [dialogs[0], dialogs[1]] = [dialogs[1]!, dialogs[0]!];
  return {
    async downloadMedia() {
      if (slow) await delay(600);
      return image;
    },
    api: {
      channels: {
        async getFullChannel({channel: target}) {
          if (!('channelId' in target) || String(target.channelId) !== String(channel.id))
            return {fullChat: {}, chats: []};
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
      return {id: 42, firstName: 'Alex', lastName: 'Morgan'};
    },
    async *iterDialogs() {
      yield* dialogs;
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
if (process.argv.includes('--capture')) {
  for (const [columns, rows, name, channelMode] of [
    [120, 26, 'synthetic-terminal', false],
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
          (frame) => frame.includes(discussionMessages[0]!) && !frame.includes('Loading discussion'),
        );
      if (!channelMode && columns > 80) {
        await ui.press('p');
        await ui.press('\t');
        await ui.press('v');
        await ui.waitFor((frame) => frame.includes(hikingMessages[0]!));
        await ui.press(' ');
        await ui.press('\x1b[B');
        await ui.press('\x1b[B');
        await ui.press(' ');
      }
      const svg = await terminalSVG(ui.rawFrame(), columns, rows);
      writeFileSync(`assets/${name}.svg`, svg);
      console.log(`Captured ${name}: ${columns} × ${rows}`);
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
        process.argv.includes('--album'),
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
