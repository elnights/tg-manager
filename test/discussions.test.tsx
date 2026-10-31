import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import React from 'react';
import {Api} from 'teleproto';
import {returnBigInt} from 'teleproto/Helpers.js';
import {getPeerId} from 'teleproto/Utils.js';
import {
  chatsFromDialogs,
  discussionChat,
  type DialogRecord,
  type MessageRecord,
  type TelegramApi,
} from '../src/telegram.js';
import {checkOwnChats} from '../src/dialogs.js';
import {fetchDiscussionPage, discussionThread} from '../src/discussions.js';
import {App} from './helpers/App.js';
import {testTerminal} from './helpers/terminal.js';
import {photo, image} from './helpers/media.js';

function fixture({joined = false, count = 2, ownPost = true, general = true} = {}) {
  const channel = new Api.Channel({
    id: returnBigInt(100),
    accessHash: returnBigInt(123),
    title: 'Synthetic news',
    broadcast: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
  const group = new Api.Channel({
    id: returnBigInt(200),
    accessHash: returnBigInt(456),
    title: 'Synthetic discussion',
    megagroup: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
  const channelId = getPeerId(channel);
  const groupId = getPeerId(group);
  const root = (id: number, post: number): MessageRecord => ({
    id,
    message: `Forwarded post ${post}`,
    senderId: 100,
    peerId: new Api.PeerChannel({channelId: group.id}),
    fwdFrom: {fromId: new Api.PeerChannel({channelId: channel.id}), channelPost: post},
  });
  const records = new Map<string, MessageRecord[]>([
    [
      channelId,
      [
        {id: 300, message: 'Channel post', senderId: ownPost ? 42 : 99, replies: {replies: 3}},
        {id: 250, message: 'Older post', senderId: 99},
      ],
    ],
    [
      groupId,
      [
        ...Array.from({length: count}, (_, index) => ({
          id: 300 - index,
          message: `My comment ${index}`,
          senderId: 42,
          replyTo: {replyToTopId: index % 2 ? 80 : 100},
        })),
        ...(general ? [{id: 70, message: 'My general message', senderId: 42}] : []),
        {id: 50, message: 'Other comment', senderId: 99, replyTo: {replyToTopId: 100}},
        root(100, 300),
        root(80, 250),
      ].sort((a, b) => b.id - a.id),
    ],
  ]);
  const dialogs: DialogRecord[] = [
    {id: channelId, title: channel.title, entity: channel, isChannel: true, isGroup: false},
    ...(joined ? [{id: groupId, title: group.title, entity: group, isChannel: true, isGroup: true}] : []),
  ];
  const calls = {
    full: [] as Api.TypeInputChannel[],
    threads: [] as number[],
    reads: [] as {peer: string; options: Parameters<TelegramApi['getMessages']>[1]}[],
    scans: [] as {peer: string; topMsgId?: number}[],
    deletes: [] as {peer: string; ids: number[]}[],
  };
  const controls: {
    linkedId?: string;
    chats: Api.TypeChat[];
    full?: () => Promise<void>;
    thread?: (post: number) => Promise<void>;
    read?: (peer: string, options: Parameters<TelegramApi['getMessages']>[1]) => Promise<void>;
  } = {linkedId: '200', chats: [channel, group]};
  const threadId = (record: MessageRecord) =>
    record.replyTo && 'replyToTopId' in record.replyTo ? record.replyTo.replyToTopId : undefined;
  const client: TelegramApi = {
    api: {
      channels: {
        async getFullChannel({channel: input}) {
          calls.full.push(input);
          await controls.full?.();
          return {fullChat: {linkedChatId: controls.linkedId}, chats: controls.chats};
        },
      },
      messages: {
        async getDiscussionMessage({msgId}) {
          calls.threads.push(msgId);
          await controls.thread?.(msgId);
          return {
            messages: (records.get(groupId) ?? []).filter(
              (record) => record.id === (msgId === 300 ? 100 : 80),
            ),
            chats: [channel, group],
          };
        },
      },
    },
    async getMe() {
      return {id: 42, firstName: 'Synthetic account'};
    },
    async *iterDialogs() {
      yield* dialogs;
    },
    async getMessages(entity, options) {
      const peer = getPeerId(entity);
      calls.reads.push({peer, options});
      await controls.read?.(peer, options);
      return (records.get(peer) ?? [])
        .filter((record) =>
          options.ids
            ? options.ids.includes(record.id)
            : (!options.fromUser || record.senderId === 42) &&
              (!options.offsetId || record.id < options.offsetId) &&
              ((options.topMsgId ?? options.replyTo) === undefined ||
                threadId(record) === (options.topMsgId ?? options.replyTo)),
        )
        .slice(0, options.ids ? undefined : options.limit);
    },
    async *iterMessages(entity, options) {
      assert.equal(options.fromUser, 'me');
      const peer = getPeerId(entity);
      calls.scans.push({peer, topMsgId: options.topMsgId});
      yield* (records.get(peer) ?? []).filter(
        (record) =>
          record.senderId === 42 && (options.topMsgId === undefined || threadId(record) === options.topMsgId),
      );
    },
    async deleteMessages(entity, ids, options) {
      assert.equal(options.revoke, true);
      const peer = getPeerId(entity);
      calls.deletes.push({peer, ids});
      records.set(
        peer,
        (records.get(peer) ?? []).filter((record) => !ids.includes(record.id)),
      );
    },
  };
  return {client, calls, controls, dialogs, records, channel, group, channelId, groupId, root};
}
async function ready(ui: ReturnType<typeof testTerminal>) {
  await ui.waitFor(
    (frame) =>
      frame.includes('My comment 0') &&
      !frame.includes('Loading history') &&
      !frame.includes('Loading discussion'),
  );
}
async function comments(ui: ReturnType<typeof testTerminal>) {
  await ui.press('\t');
  await ui.press('\t');
}
async function confirmDelete(ui: ReturnType<typeof testTerminal>) {
  await ui.press('DELETE');
  assert.ok(ui.frame().includes('DELETE_'));
  await ui.press('\r');
}

test('linked discussion resolution retains the real group identity and access hash without joining', async () => {
  const mock = fixture();
  const [channel] = chatsFromDialogs(mock.dialogs);
  const discussion = await discussionChat(mock.client, channel!);
  assert.equal(discussion?.id, mock.groupId);
  assert.equal(discussion?.entity, mock.group);
  assert.equal(discussion?.discussionFor, mock.channelId);
  assert.match(discussion!.title, /Synthetic news.*Synthetic discussion/);
  const request = mock.calls.full[0];
  assert.ok(request instanceof Api.InputChannel);
  assert.equal(String(request.channelId), '100');
  assert.equal(String(request.accessHash), '123');
  assert.equal(mock.calls.deletes.length, 0);
  mock.controls.linkedId = undefined;
  assert.equal(await discussionChat(mock.client, channel!), undefined);
  mock.controls.linkedId = '0';
  assert.equal(await discussionChat(mock.client, channel!), undefined);
  mock.controls.linkedId = '200';
  mock.controls.chats = [mock.channel];
  await assert.rejects(discussionChat(mock.client, channel!), /discussion group is unavailable/);
  mock.controls.chats = [
    new Api.ChannelForbidden({id: mock.group.id, accessHash: returnBigInt(456), title: 'Unavailable'}),
  ];
  await assert.rejects(discussionChat(mock.client, channel!), /discussion group is unavailable/);
  mock.controls.chats = [mock.group];
  mock.group.min = true;
  await assert.rejects(discussionChat(mock.client, channel!), /discussion group is unavailable/);
});

test('supergroups do not resolve their linked broadcast channel as a discussion', async () => {
  const mock = fixture({joined: true});
  const chats = chatsFromDialogs(mock.dialogs);
  assert.equal(chats[0]?.isBroadcast, true);
  assert.equal(chats[1]?.isBroadcast, undefined);
  assert.equal(await discussionChat(mock.client, chats[1]!), undefined);
  assert.equal(mock.calls.full.length, 0);
});

test('channels automatically show posts as All and the entire discussion as Mine, including general chat', async () => {
  const mock = fixture({ownPost: false});
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    assert.ok(
      ui.frame().includes('POSTS · All') &&
        ui.frame().includes('DISCUSSION · Entire group · t to change scope'),
    );
    assert.ok(ui.frame().includes('[Post #300] You:') && ui.frame().includes('[General] You:'));
    assert.ok(ui.frame().includes('My general message'));
    assert.ok(!ui.frame().includes('Other comment'));
    assert.ok(ui.frame().includes('Loaded: 1 chats'));
    assert.equal(mock.calls.reads.find((call) => call.peer === mock.channelId)?.options.fromUser, undefined);
    assert.equal(mock.calls.reads.find((call) => call.peer === mock.groupId)?.options.fromUser, 'me');
    await comments(ui);
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('Other comment'));
    assert.ok(ui.frame().includes('POSTS · All'));
    await ui.press('\x1b[Z');
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('POSTS · Mine') && !frame.includes('Loading history'));
    assert.ok(ui.frame().includes('Other comment'), 'the discussion author filter is independent');
  } finally {
    await ui.close();
  }
});

test('pane marks remain separate and deletion verifies only the discussion peer despite overlapping IDs', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await ui.press('\t');
    await ui.press(' ');
    await ui.press('\t');
    assert.ok(ui.frame().includes('Posts: 1 selected'));
    await ui.press('s');
    await ui.press('d');
    await ui.waitFor((frame) => frame.includes('DELETE 3 of YOUR messages'));
    assert.ok(ui.frame().includes(`Chat ID: ${mock.groupId}`));
    assert.ok(ui.frame().includes('Entire discussion group, including comments and general chat.'));
    await ui.press('?');
    await ui.press('\x1b');
    await confirmDelete(ui);
    await ui.waitFor((frame) => frame.includes('3 verified absent') && !frame.includes('Loading history'));
    assert.deepEqual(mock.calls.deletes, [{peer: mock.groupId, ids: [300, 299, 70]}]);
    assert.ok(
      mock.calls.reads.some(
        (call) =>
          call.peer === mock.groupId &&
          call.options.ids?.includes(300) &&
          call.options.fromUser === undefined,
      ),
    );
    assert.equal(mock.records.get(mock.channelId)?.[0]?.id, 300);
    assert.ok(ui.frame().includes('Posts: 1 selected'));
  } finally {
    await ui.close();
  }
});

test('post scope follows the highlight and Mine uses a thread search; scan and deletion stay in that thread', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await ui.press('\t');
    await ui.press('t');
    await ui.waitFor(
      (frame) =>
        frame.includes('DISCUSSION · Post #300 · t to change scope') &&
        frame.includes('My comment 0') &&
        !frame.includes('Loading discussion'),
    );
    assert.ok(!ui.frame().includes('My comment 1') && !ui.frame().includes('My general message'));
    assert.ok(
      mock.calls.reads.some(
        (call) =>
          call.peer === mock.groupId &&
          call.options.topMsgId === 100 &&
          call.options.fromUser === 'me' &&
          call.options.replyTo === undefined,
      ),
    );
    await ui.press('\t');
    await ui.press(' ');
    await ui.press('\x1b[Z');
    await ui.press('\x1b[B');
    await ui.waitFor(
      (frame) =>
        frame.includes('DISCUSSION · Post #250 · t to change scope') &&
        frame.includes('My comment 1') &&
        !frame.includes('Loading discussion'),
    );
    assert.ok(ui.frame().includes('Mine [v] · 1 loaded · 0 selected'));
    await ui.press('\t');
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('DELETE 1 of YOUR messages'));
    assert.ok(ui.frame().includes('Selected post #250; this thread only.'));
    assert.deepEqual(mock.calls.scans, [{peer: mock.groupId, topMsgId: 80}]);
    await confirmDelete(ui);
    await ui.waitFor((frame) => frame.includes('1 verified absent'));
    assert.deepEqual(mock.calls.deletes, [{peer: mock.groupId, ids: [299]}]);
    assert.ok(mock.records.get(mock.groupId)?.some((record) => record.id === 300));
    assert.ok(mock.records.get(mock.groupId)?.some((record) => record.id === 70));
  } finally {
    await ui.close();
  }
});

test('All in a post discussion includes others but never marks them', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press('t');
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('Other comment') && !frame.includes('Loading discussion'));
    assert.ok(
      mock.calls.reads.some((call) => call.options.replyTo === 100 && call.options.fromUser === undefined),
    );
    await ui.press('s');
    await ui.press('d');
    await ui.waitFor((frame) => frame.includes('DELETE 1 of YOUR messages'));
    await confirmDelete(ui);
    await ui.waitFor((frame) => frame.includes('1 verified absent'));
    assert.ok(mock.records.get(mock.groupId)?.some((record) => record.id === 50));
  } finally {
    await ui.close();
  }
});

test('entire-group navigation preserves discussion marks and ignores the highlighted post', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press(' ');
    const reads = mock.calls.reads.length;
    await ui.press('\x1b[Z');
    await ui.press('\x1b[B');
    await ui.press('\t');
    assert.ok(ui.frame().includes('DISCUSSION · Entire group') && ui.frame().includes('[x] [Post #300]'));
    assert.equal(mock.calls.reads.length, reads);
    assert.equal(mock.calls.threads.length, 0);
  } finally {
    await ui.close();
  }
});

test('media details use the captured post or discussion attachment when their message IDs overlap', async () => {
  const mock = fixture();
  mock.records.get(mock.channelId)![0]!.media = photo(100);
  mock.records.get(mock.groupId)![0]!.media = photo(200);
  const downloaded: string[] = [];
  const client: TelegramApi = {
    ...mock.client,
    async downloadMedia(media) {
      assert.ok(media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo);
      downloaded.push(media.photo.id.toString());
      return image;
    },
  };
  const ui = testTerminal(<App client={client} />);
  try {
    await ready(ui);
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Image preview'));
    await ui.press('\x1b');
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Image preview'));
    assert.deepEqual(downloaded, ['100', '200']);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    await ui.close();
  }
});

test('focusing comments highlights their source post and g transfers keyboard focus; general chat leaves it alone', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press('\x1b[B');
    await ui.waitFor((frame) => frame.includes('> [-] #250') && frame.includes('[ACTIVE] DISCUSSION'));
    assert.match(ui.frame(), /(?:^|\s)g(?:\s|$)/);
    await ui.press(' ');
    await ui.press('g');
    assert.ok(ui.frame().includes('[ACTIVE] POSTS') && ui.frame().includes('> [-] #250'));
    await ui.press('\t');
    assert.ok(ui.frame().includes('[x] [Post #250]'));
    await ui.press('\x1b[B');
    await ui.press('g');
    assert.ok(ui.frame().includes('[ACTIVE] DISCUSSION') && ui.frame().includes('> [-] #250'));
    assert.doesNotMatch(ui.frame(), /(?:^|\s)g(?:\s|$)/);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    await ui.close();
  }
});

test('an unloaded source post is located with a real page cursor and remains read-only when not authored by me', async () => {
  const mock = fixture();
  mock.records.set(mock.channelId, [
    ...Array.from({length: 100}, (_, index) => ({
      id: 500 - index,
      message: `Newer post ${index}`,
      senderId: 99,
    })),
    {id: 111, message: 'Located older source', senderId: 99, out: true},
  ]);
  mock.records.get(mock.groupId)!.push(mock.root(90, 111), {
    id: 65,
    message: 'Old thread comment',
    senderId: 42,
    replyTo: {replyToTopId: 90},
  });
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press('\x1b[F');
    await ui.press('g');
    await ui.waitFor(
      (frame) =>
        frame.includes('[ACTIVE] POSTS') && frame.includes('> [-] #111') && !frame.includes('Locating post'),
    );
    assert.ok(
      mock.calls.reads.some(
        (call) =>
          call.peer === mock.channelId &&
          call.options.offsetId === 112 &&
          call.options.fromUser === undefined,
      ),
    );
    assert.ok(ui.frame().includes('Posts: 0 selected · 1 loaded'));
    await ui.press(' ');
    assert.ok(ui.frame().includes('Only your own messages can be marked'));
    await ui.press('r');
    await ui.waitFor((frame) => frame.includes('#500'));
    assert.ok(!ui.frame().includes('> [-] #111'));
  } finally {
    await ui.close();
  }
});

test('locating a source hidden by Mine switches only posts to All and preserves discussion marks', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await ui.press('\t');
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('POSTS · Mine') && !frame.includes('Loading history'));
    await ui.press(' ');
    await ui.press('\t');
    await ui.press('\x1b[B');
    await ui.press(' ');
    await ui.waitFor(
      (frame) =>
        frame.includes('POSTS · All') && frame.includes('> [-] #250') && !frame.includes('Locating post'),
    );
    assert.ok(ui.frame().includes('[ACTIVE] DISCUSSION') && ui.frame().includes('[x] [Post #250]'));
    assert.ok(ui.frame().includes('Posts: 0 selected') && ui.frame().includes('Mine [v]'));
    assert.ok(
      mock.calls.reads.some(
        (call) =>
          call.peer === mock.channelId &&
          call.options.offsetId === 251 &&
          call.options.fromUser === undefined,
      ),
    );
    assert.equal(
      mock.calls.reads.filter(
        (call) =>
          call.peer === mock.channelId &&
          call.options.limit === 100 &&
          call.options.offsetId === 0 &&
          call.options.fromUser === undefined,
      ).length,
      1,
    );
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    await ui.close();
  }
});

test('a late source lookup cannot override the post for a newly focused comment', async () => {
  const mock = fixture();
  mock.records.get(mock.groupId)!.push(mock.root(90, 111), {
    id: 65,
    message: 'Old thread comment',
    senderId: 42,
    replyTo: {replyToTopId: 90},
  });
  mock.records.get(mock.channelId)!.push({id: 111, message: 'Old source', senderId: 99});
  let release!: () => void;
  mock.controls.read = async (peer, options) => {
    if (peer === mock.channelId && options.offsetId === 112)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  // Keep the source off the initial page while retaining it for the lookup.
  const read = mock.client.getMessages;
  mock.client.getMessages = async (entity, options) => {
    const records = await read(entity, options);
    return getPeerId(entity) === mock.channelId && !options.offsetId
      ? records.filter((record) => record?.id !== 111)
      : records;
  };
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press('\x1b[F');
    await ui.press('g');
    await ui.waitFor((frame) => frame.includes('Locating post #111'));
    await ui.press('\x1b[H');
    await ui.waitFor((frame) => frame.includes('[ACTIVE] DISCUSSION') && frame.includes('> [ ] #300'));
    release();
    await delay(20);
    assert.ok(ui.frame().includes('[ACTIVE] DISCUSSION') && !ui.frame().includes('> [-] #111'));
  } finally {
    release?.();
    await ui.close();
  }
});

test('missing source posts preserve the comment and a later g retries the lookup', async () => {
  const mock = fixture();
  mock.records.get(mock.groupId)!.push(mock.root(90, 111), {
    id: 65,
    message: 'Old thread comment',
    senderId: 42,
    replyTo: {replyToTopId: 90},
  });
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press('\x1b[F');
    await ui.waitFor((frame) => frame.includes('Source post #111 is unavailable'));
    assert.ok(ui.frame().includes('[ACTIVE] DISCUSSION'));
    mock.records.get(mock.channelId)!.push({id: 111, message: 'Restored source', senderId: 99});
    await ui.press('g');
    await ui.waitFor((frame) => frame.includes('[ACTIVE] POSTS') && frame.includes('> [-] #111'));
  } finally {
    await ui.close();
  }
});

test('direct replies retain a typed source ID and cross-peer quotes cannot link to a coincident group ID', async () => {
  const mock = fixture();
  mock.records.get(mock.groupId)![0]!.replyTo = {replyToTopId: undefined, replyToMsgId: 100};
  const group = await discussionChat(mock.client, chatsFromDialogs(mock.dialogs)[0]!);
  const contexts = new Map();
  const first = await fetchDiscussionPage(mock.client, {chat: group!}, '42', 'mine', 0, contexts);
  assert.equal(first[0]?.sourcePostId, 300);
  const cached = await fetchDiscussionPage(mock.client, {chat: group!}, '42', 'mine', 0, contexts);
  assert.equal(cached[0]?.sourcePostId, 300);
  mock.records.get(mock.groupId)![0]!.replyTo = {
    replyToPeerId: new Api.PeerChannel({channelId: returnBigInt(999)}),
    replyToMsgId: 100,
  };
  const quoted = await fetchDiscussionPage(mock.client, {chat: group!}, '42', 'mine');
  assert.equal(quoted[0]?.sourcePostId, undefined);
});

for (const columns of [25, 40, 80, 100, 120]) {
  test(`chat rows stay in place across groups, channels, private chats and pending discussions at ${columns} columns`, async () => {
    const mock = fixture({joined: true});
    const person = new Api.User({id: returnBigInt(77), firstName: 'Private friend'});
    mock.dialogs.push({id: getPeerId(person), title: 'Private friend', entity: person, isUser: true});
    let release!: () => void;
    mock.controls.full = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const ui = testTerminal(<App client={mock.client} />, {columns, rows: 35});
    const leftRows = () =>
      ui
        .frame()
        .split('\n')
        .flatMap((line, row) => {
          const divider = line.indexOf('|');
          return divider < 0
            ? []
            : [
                {
                  row,
                  text: line
                    .slice(0, divider)
                    .trim()
                    .replace(/^>\s*/, '')
                    .replace(/^(\[[PBGSC]\])\s*/, '$1 '),
                },
              ];
        });
    try {
      await ui.waitFor((frame) => frame.includes('Loading discussion') && !frame.includes('Loading history'));
      await ui.press('p');
      const pending = leftRows();
      assert.ok(pending.length > 3);
      release();
      await ui.waitFor((frame) => !frame.includes('Loading discussion'));
      assert.deepEqual(leftRows(), pending, 'discussion completion cannot resize the chat list');
      await ui.press('\x1b[B');
      await ui.waitFor(
        (frame) => mock.calls.reads.at(-1)?.peer === mock.groupId && !frame.includes('Loading history'),
      );
      assert.deepEqual(leftRows(), pending, 'group header and viewport must match the channel');
      await ui.press('\x1b[B');
      await ui.waitFor(
        (frame) => mock.calls.reads.at(-1)?.peer === getPeerId(person) && !frame.includes('Loading history'),
      );
      assert.deepEqual(leftRows(), pending, 'private-chat header and viewport must match the channel');
      await ui.press('\x1b[A');
      await ui.waitFor((frame) => !frame.includes('Loading history'));
      await ui.press('\x1b[A');
      await ui.waitFor(
        (frame) => !frame.includes('Loading history') && !frame.includes('Loading discussion'),
      );
      assert.deepEqual(leftRows(), pending);
      const full = mock.calls.full.length;
      mock.controls.linkedId = undefined;
      mock.controls.full = undefined;
      await ui.press('R');
      await ui.waitFor(
        (frame) =>
          mock.calls.full.length > full &&
          !frame.includes('Loading discussion') &&
          !frame.includes('Connecting'),
      );
      assert.deepEqual(leftRows(), pending, 'a missing discussion cannot resize the chat list');
    } finally {
      release?.();
      await ui.close();
    }
  });
}

test('hiding group types leaves a channel discussion and its marks available', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press(' ');
    await ui.press('f');
    await ui.press('j');
    await ui.press('j');
    await ui.press(' ');
    await ui.press('j');
    await ui.press(' ');
    await ui.press('\r');
    assert.ok(ui.frame().includes('Types: C [f]'));
    assert.ok(ui.frame().includes('DISCUSSION · Entire group') && ui.frame().includes('[x] [Post #300]'));
    assert.ok(ui.frame().includes('My general message'));
  } finally {
    await ui.close();
  }
});

test('Escape cancels a pending source-post jump without dropping discussion selection', async () => {
  const mock = fixture();
  mock.records.get(mock.groupId)!.push(mock.root(90, 111), {
    id: 65,
    message: 'Old thread comment',
    senderId: 42,
    replyTo: {replyToTopId: 90},
  });
  let release!: () => void;
  mock.controls.read = async (peer, options) => {
    if (peer === mock.channelId && options.offsetId === 112)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press('\x1b[F');
    await ui.press(' ');
    await ui.press('g');
    await ui.waitFor((frame) => frame.includes('Locating post #111'));
    await ui.press('\x1b');
    release();
    await delay(20);
    assert.ok(ui.frame().includes('[ACTIVE] DISCUSSION') && ui.frame().includes('[x] [Post #111]'));
    assert.ok(
      !ui.frame().includes('Locating post') && !ui.frame().includes('Source post #111 is unavailable'),
    );
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    release?.();
    await ui.close();
  }
});

test('post changes stay responsive during loading, reject a late response and reuse cached threads', async () => {
  const mock = fixture();
  let release!: () => void;
  mock.controls.thread = (post) =>
    post === 300
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : Promise.resolve();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await ui.press('\t');
    await ui.press('t');
    await ui.waitFor(() => mock.calls.threads.includes(300));
    await ui.press('\x1b[B');
    await ui.waitFor((frame) => frame.includes('My comment 1') && !frame.includes('Loading discussion'));
    release();
    await delay(20);
    assert.ok(!ui.frame().includes('My comment 0'));
    mock.controls.thread = undefined;
    await ui.press('\x1b[A');
    await ui.waitFor((frame) => frame.includes('My comment 0') && !frame.includes('Loading discussion'));
    const requests = mock.calls.threads.length;
    await ui.press('\x1b[B');
    await ui.waitFor((frame) => frame.includes('My comment 1'));
    assert.equal(mock.calls.threads.length, requests);
  } finally {
    release?.();
    await ui.close();
  }
});

test('discussion pagination and full-group scan include general messages and retain the channel', async () => {
  const mock = fixture({count: 102});
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press('n');
    await ui.waitFor((frame) => frame.includes('Mine [v] · 103 loaded'));
    assert.ok(mock.calls.reads.some((call) => call.peer === mock.groupId && call.options.offsetId === 201));
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('DELETE 103 of YOUR messages'));
    assert.deepEqual(mock.calls.scans, [{peer: mock.groupId, topMsgId: undefined}]);
    await confirmDelete(ui);
    await ui.waitFor((frame) => frame.includes('103 verified absent'));
    assert.deepEqual(
      mock.calls.deletes.map((call) => [call.peer, call.ids.length]),
      [
        [mock.groupId, 100],
        [mock.groupId, 3],
      ],
    );
    assert.equal(mock.records.get(mock.channelId)?.length, 2);
  } finally {
    await ui.close();
  }
});

test('own-chat filtering retains the channel for general discussion messages and removes it after the last own message', async () => {
  const mock = fixture({ownPost: false, count: 0});
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('My general message') && !frame.includes('Loading history'));
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('With my messages: on [o]'));
    assert.ok(ui.frame().includes('TG MANAGER / Synthetic news') && ui.frame().includes('Loaded: 1 chats'));
    await comments(ui);
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('DELETE 1 of YOUR messages'));
    await confirmDelete(ui);
    await ui.waitFor((frame) => frame.includes('No chats with own messages'));
  } finally {
    await ui.close();
  }
});

test('joined discussions retain their real dialog and own-chat probes are deduplicated', async () => {
  const mock = fixture({joined: true, ownPost: false});
  const result = await checkOwnChats(
    mock.client,
    chatsFromDialogs(mock.dialogs),
    {cancelled: false},
    () => {},
  );
  assert.equal(result.complete, true);
  assert.deepEqual([...result.ids], [mock.channelId, mock.groupId]);
  assert.equal(result.chats.length, 2);
  assert.equal(result.chats[1]?.title, mock.group.title);
  assert.equal(mock.calls.reads.filter((call) => call.peer === mock.groupId).length, 1);
});

test('unresolved and out-of-view thread contexts stay visible, with no dependency on loaded channel posts', async () => {
  const mock = fixture();
  mock.records
    .get(mock.groupId)!
    .push(
      mock.root(90, 111),
      {id: 65, senderId: 42, message: 'Old thread comment', replyTo: {replyToTopId: 90}},
      {id: 60, senderId: 42, message: 'Unresolved comment', replyTo: {replyToTopId: 999}},
    );
  const group = await discussionChat(mock.client, chatsFromDialogs(mock.dialogs)[0]!);
  const page = await fetchDiscussionPage(mock.client, {chat: group!}, '42', 'mine');
  assert.equal(page.find((item) => item.id === 65)?.context, 'Post #111');
  assert.equal(page.find((item) => item.id === 60)?.context, 'Context unavailable');
  mock.controls.read = async (_peer, options) => {
    if (options.ids) throw new Error('Context unavailable');
  };
  const partial = await fetchDiscussionPage(mock.client, {chat: group!}, '42', 'mine');
  assert.equal(partial.length, page.length);
  assert.equal(partial.find((item) => item.id === 300)?.context, 'Context unavailable');
});

test('thread resolution rejects a root belonging to another channel', async () => {
  const mock = fixture();
  const group = await discussionChat(mock.client, chatsFromDialogs(mock.dialogs)[0]!);
  mock.records.get(mock.groupId)!.find((record) => record.id === 100)!.fwdFrom = {
    fromId: new Api.PeerChannel({channelId: returnBigInt(999)}),
    channelPost: 300,
  };
  await assert.rejects(
    discussionThread(mock.client, chatsFromDialogs(mock.dialogs)[0]!, group!, 300),
    /No accessible discussion/,
  );
});

test('missing discussions use full-height posts; inaccessible discussions allow retry without losing post marks', async () => {
  const mock = fixture();
  mock.controls.linkedId = undefined;
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('no linked discussion group'));
    assert.ok(!ui.frame().includes('DISCUSSION'));
    await ui.press('\t');
    await ui.press(' ');
    mock.controls.linkedId = '200';
    mock.controls.full = async () => {
      throw new Error('CHANNEL_PRIVATE');
    };
    await ui.press('R');
    await ui.waitFor((frame) => frame.includes('Discussion loading failed'));
    assert.ok(ui.frame().includes('Posts: 1 selected'));
    mock.controls.full = undefined;
    await ui.press('\t');
    await ui.press('r');
    await ready(ui);
    assert.ok(ui.frame().includes('Posts: 1 selected'));
  } finally {
    await ui.close();
  }
});

test('cancelled automatic resolution never starts the following history request', async () => {
  const mock = fixture();
  let release!: () => void;
  mock.controls.full = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('Loading discussion') && frame.includes('Channel post'));
    await ui.press('\x1b');
    release();
    await ui.waitFor((frame) => frame.includes('Stopped; r to retry'));
    assert.ok(mock.calls.reads.every((call) => call.peer === mock.channelId));
  } finally {
    release?.();
    await ui.close();
  }
});

test('short terminals show the focused right pane and resizing restores both without losing marks', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui);
    await comments(ui);
    await ui.press(' ');
    await ui.resize(80, 14);
    assert.ok(ui.frame().includes('DISCUSSION') && !ui.frame().includes('POSTS · All'), ui.frame());
    assert.ok(ui.frame().includes('1 selected'));
    await ui.resize(160, 35);
    assert.ok(ui.frame().includes('POSTS · All') && ui.frame().includes('DISCUSSION'));
    assert.ok(ui.frame().includes('[x] [Post #300]'));
  } finally {
    await ui.close();
  }
});
