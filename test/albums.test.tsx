import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React from 'react';
import {returnBigInt} from 'teleproto/Helpers.js';
import {messageItems, messageRecords, messageRows, ownMessageIds} from '../src/messages.js';
import {appendPage} from '../src/operations.js';
import {initialView, viewReducer} from '../src/state.js';
import {MessageDetails} from '../src/MessageDetails.js';
import type {MessageRecord, TelegramApi} from '../src/telegram.js';
import {App} from './helpers/App.js';
import {testTerminal} from './helpers/terminal.js';
import {photo, image} from './helpers/media.js';

const groupedId = returnBigInt('9007199254740993');
function album(ids = [5, 4, 3]): MessageRecord[] {
  return ids.map((id) => ({
    id,
    groupedId,
    senderId: 42,
    message: id === 3 ? 'Album caption' : '',
    media: photo(id),
  }));
}
function fixture(records: MessageRecord[]) {
  const reads: Parameters<TelegramApi['getMessages']>[1][] = [];
  const deletes: number[][] = [];
  const client: TelegramApi = {
    async getMe() {
      return {id: 42};
    },
    async *iterDialogs() {
      yield {id: -20, entity: 'synthetic-group', title: 'Synthetic albums', isGroup: true};
    },
    async getMessages(entity, options) {
      assert.equal(entity, 'synthetic-group');
      reads.push(options);
      return records
        .filter((record) =>
          options.ids
            ? options.ids.includes(record.id)
            : (!options.fromUser || record.senderId === 42) &&
              (!options.offsetId || record.id < options.offsetId),
        )
        .slice(0, options.ids ? undefined : options.limit);
    },
    async *iterMessages() {
      yield* records.filter((record) => record.senderId === 42);
    },
    async deleteMessages(entity, ids) {
      assert.equal(entity, 'synthetic-group');
      deletes.push(ids);
      records.splice(0, records.length, ...records.filter((record) => !ids.includes(record.id)));
    },
  };
  return {client, reads, deletes};
}

test('album rows combine captions and comments, preserve per-item authorship and keep a stable ID as pages grow', () => {
  const raw = album();
  raw[0]!.senderId = 99;
  raw[1]!.replies = {replies: 7};
  const messages = messageRecords(raw, '42', 'all');
  const firstPage = appendPage({items: [], cursor: 0, more: true}, messages.slice(0, 2));
  const before = messageRows(firstPage.items)[0]!;
  const history = appendPage(firstPage, [
    ...messages.slice(1),
    {id: 2, content: 'Older', date: '', author: 'You', own: true},
  ]);
  const rows = messageRows(history.items);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.id, before.id);
  assert.equal(rows[0]!.content, 'Album caption');
  assert.equal(rows[0]!.comments, 7);
  assert.equal(rows[0]!.author, 'Multiple authors');
  assert.deepEqual(
    messageItems(rows[0]!).map((item) => item.id),
    [3, 4, 5],
  );
  assert.deepEqual(ownMessageIds([rows[0]!]), [3, 4]);
  assert.deepEqual(ownMessageIds(rows, new Set([3, 5])), [3]);
  assert.equal(history.cursor, 2);
  assert.equal(history.items.length, 4);
  assert.equal(messages[0]!.album, undefined, 'grouping does not mutate raw history');
});

test('source-post navigation finds any album member and removal clamps the cursor to grouped rows', () => {
  const chat = {
    id: '-10020',
    entity: 'synthetic-channel',
    title: 'Synthetic',
    isPrivate: false,
    isBroadcast: true,
  };
  const items = messageRecords([...album(), {id: 2, message: 'Older post', senderId: 42}], '42', 'all');
  const state = {
    ...initialView,
    chats: [chat],
    activeId: chat.id,
    view: 'all' as const,
    selected: new Set([4]),
    messageIndex: 2,
  };
  const history = {items, cursor: 2, more: false};
  const located = viewReducer(state, {type: 'locatedPost', chatId: chat.id, view: 'all', postId: 4, history});
  assert.equal(located.messageIndex, 0);
  assert.deepEqual([...located.selected], [4]);
  const end = viewReducer(located, {type: 'index', index: 99});
  assert.equal(end.messageIndex, 1);
  const removed = viewReducer(end, {type: 'absent', chatId: chat.id, ids: new Set([2])});
  assert.equal(removed.messageIndex, 0);
  assert.equal(removed.history.items.length, 3);
});

test('paging merges album rows without losing cursors; partial marks expand only to owned loaded members', async () => {
  const members = album();
  const records = Array.from({length: 103}, (_, index) => {
    const id = 103 - index;
    return members.find((item) => item.id === id) ?? {id, message: `Message ${id}`, senderId: 42};
  });
  const mock = fixture(records);
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 100 msgs') && !frame.includes('Loading history'));
    await ui.press('\t');
    await ui.press('\x1b[F');
    assert.ok(ui.frame().includes('[Album: 2 items]'));
    await ui.press(' ');
    assert.ok(ui.frame().includes('2 selected'));
    await ui.press('n');
    await ui.waitFor((frame) => frame.includes('/ 103 msgs') && !frame.includes('Loading history'));
    assert.ok(mock.reads.some((options) => options.offsetId === 4));
    assert.ok(ui.frame().includes('> [~] [Album: 3 items]'));
    assert.equal(ui.frame().split('[Album: 3 items]').length - 1, 1);
    await ui.press(' ');
    assert.ok(ui.frame().includes('3 selected'));
    await ui.press('d');
    await ui.waitFor((frame) => frame.includes('DELETE 3 of YOUR messages'));
    await ui.press('DELETE');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('3 verified absent'));
    assert.deepEqual(mock.deletes, [[3, 4, 5]]);
    assert.ok(records.some((record) => record.id === 2));
  } finally {
    await ui.close();
  }
});

test('marking a mixed-author album never includes someone else’s item', async () => {
  const raw = album();
  raw[1]!.senderId = 99;
  const mock = fixture(raw);
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('[Album: 2 items]'));
    await ui.press('\t');
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('[Album: 3 items]') && !frame.includes('Loading history'));
    await ui.press(' ');
    assert.ok(ui.frame().includes('2 selected'));
    await ui.press('d');
    await ui.waitFor((frame) => frame.includes('DELETE 2 of YOUR messages'));
    await ui.press('DELETE');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('2 verified absent'));
    assert.deepEqual(mock.deletes, [[3, 5]]);
    assert.deepEqual(
      raw.map((record) => record.id),
      [4],
    );
  } finally {
    await ui.close();
  }
});

test('album details fetch unloaded items for inspection without adding them to selection or history', async () => {
  const mock = fixture(album());
  const read = mock.client.getMessages;
  mock.client.getMessages = async (entity, options) => {
    const records = await read(entity, options);
    return options.ids ? records : records.filter((record) => record?.id === 5);
  };
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('[Album: 1 item]'));
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('ALBUM · 3 items') && frame.includes('Items: #3, #4, #5'));
    assert.ok(
      mock.reads.some(
        (options) => options.ids?.includes(3) && options.ids.length <= 19 && options.fromUser === undefined,
      ),
    );
    await ui.press('\x1b[F');
    assert.ok(ui.frame().includes('MESSAGE #3') && ui.frame().includes('Album caption'));
    await ui.press('d');
    assert.equal(mock.deletes.length, 0);
    await ui.press('\x1b');
    assert.ok(ui.frame().includes('[Album: 1 item]') && ui.frame().includes('/ 1 msgs'));
    await ui.press(' ');
    assert.ok(ui.frame().includes('1 selected'));
  } finally {
    await ui.close();
  }
});

test('album details keep captured items on lookup failure and fit narrow terminals', async () => {
  const mock = fixture(album());
  const read = mock.client.getMessages;
  mock.client.getMessages = async (entity, options) => {
    if (options.ids) throw new Error('Synthetic album read failure');
    return read(entity, options);
  };
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('[Album: 3 items]'));
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Album items unavailable'));
    assert.ok(ui.frame().includes('Items: #3, #4, #5'));
    for (const columns of [25, 40, 80, 120]) {
      await ui.resize(columns, 20);
      assert.ok(ui.frame().trimEnd().split('\n').length <= 19);
    }
    await ui.press('\x1b');
    assert.ok(ui.frame().includes('TG MANAGER'));
    assert.equal(mock.deletes.length, 0);
  } finally {
    await ui.close();
  }
});

test('closing album details discards a late item lookup', async () => {
  const mock = fixture(album());
  const read = mock.client.getMessages;
  let release!: () => void;
  mock.client.getMessages = async (entity, options) => {
    if (options.ids)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return read(entity, options);
  };
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('[Album: 3 items]'));
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Loading album items'));
    await ui.press('\x1b');
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(ui.frame().includes('TG MANAGER') && !ui.frame().includes('ALBUM ·'));
    assert.equal(mock.deletes.length, 0);
  } finally {
    release?.();
    await ui.close();
  }
});

test('album media navigation aborts the previous preview and opens only the displayed item', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tg-manager-album-media-'));
  const messages = messageRecords(album(), '42', 'all');
  const requests: {id: number; preview: boolean; signal?: AbortSignal}[] = [];
  let release!: () => void;
  const opened: string[] = [];
  const ui = testTerminal(
    <MessageDetails
      message={messageRows(messages)[0]!}
      client={{
        async downloadMedia(source, options) {
          const id = messages.find((item) => item.attachment?.source === source)!.id;
          requests.push({id, preview: Boolean(options.thumb), signal: options.signal});
          if (id === 3)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return image;
        },
      }}
      width={159}
      height={34}
      onClose={() => {}}
      files={{
        root,
        open: async (file) => {
          opened.push(file);
        },
      }}
    />,
    {columns: 160, rows: 35},
  );
  try {
    await ui.waitFor((frame) => frame.includes('Viewing item 1/3') && frame.includes('Loading preview'));
    await ui.press(']');
    await ui.waitFor((frame) => frame.includes('Viewing item 2/3 · #4') && frame.includes('Image preview'));
    assert.ok(ui.frame().includes('[CURRENT] Viewing item 2/3 · #4'));
    assert.equal(requests[0]!.signal!.aborted, true);
    release();
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('System viewer launch requested'));
    assert.deepEqual(
      requests.map(({id, preview}) => [id, preview]),
      [
        [3, true],
        [4, true],
        [4, false],
      ],
    );
    assert.equal(opened.length, 1);
    await ui.press(']');
    await ui.waitFor((frame) => frame.includes('Viewing item 3/3 · #5') && frame.includes('Image preview'));
    await ui.press('\x1b[F');
    for (const id of [3, 4, 5]) assert.ok(ui.frame().includes(`MESSAGE #${id}`));
    assert.ok(ui.frame().includes('[CURRENT] MESSAGE #5'));
    assert.ok(!ui.frame().includes('[CURRENT] MESSAGE #4'));
  } finally {
    release?.();
    await ui.close();
    await rm(root, {recursive: true, force: true});
  }
});
