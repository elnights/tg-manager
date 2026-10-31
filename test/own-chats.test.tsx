import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {App} from './helpers/App.js';
import {testTerminal} from './helpers/terminal.js';
import {checkOwnChats} from '../src/dialogs.js';
import {hasOwnMessages} from '../src/messages.js';
import {chatsFromDialogs, type MessageRecord, type TelegramApi} from '../src/telegram.js';

function fixture(count = 4) {
  const dialogs = Array.from({length: count}, (_, index) => ({
    id: `chat-${index}`,
    title: `Group ${String(index).padStart(3, '0')}`,
    entity: `chat-${index}`,
    isGroup: true,
  }));
  const records = new Map<string, MessageRecord[]>(
    dialogs.map((chat, index) => [
      chat.id,
      [
        {id: 20, message: `Other in ${chat.id}`, senderId: 99},
        ...(index % 2 ? [{id: 10, message: `Own in ${chat.id}`, senderId: 42}] : []),
      ],
    ]),
  );
  const calls: {entity: unknown; limit?: number; fromUser?: 'me'; ids?: number[]}[] = [];
  const controls: {probe?: (entity: string) => Promise<void>; deletions: number} = {deletions: 0};
  const client: TelegramApi = {
    async getMe() {
      return {id: 42, firstName: 'Synthetic'};
    },
    async *iterDialogs() {
      yield* dialogs;
    },
    async getMessages(entity, options) {
      calls.push({entity, ...options});
      if (options.limit === 1) await controls.probe?.(String(entity));
      return (records.get(String(entity)) ?? [])
        .filter((record) =>
          options.ids
            ? options.ids.includes(record.id)
            : (!options.fromUser || record.senderId === 42) &&
              (!options.offsetId || record.id < options.offsetId),
        )
        .slice(0, options.ids ? undefined : options.limit);
    },
    async *iterMessages(entity) {
      yield* (records.get(String(entity)) ?? []).filter((record) => record.senderId === 42);
    },
    async deleteMessages(entity, ids) {
      controls.deletions++;
      records.set(
        String(entity),
        (records.get(String(entity)) ?? []).filter((record) => !ids.includes(record.id)),
      );
    },
  };
  return {client, calls, controls, dialogs, records};
}
async function ready(ui: ReturnType<typeof testTerminal>, mock: ReturnType<typeof fixture>) {
  await ui.waitFor(
    (frame) =>
      mock.calls.some((call) => call.limit === 100) &&
      frame.includes('With my messages: off [o]') &&
      !frame.includes('Loading history'),
  );
}

test('own-chat checks ask for one own message per stable chat ID, including older messages', async () => {
  const mock = fixture();
  const progress: number[] = [];
  const result = await checkOwnChats(
    mock.client,
    chatsFromDialogs(mock.dialogs),
    {cancelled: false},
    (checked) => progress.push(checked),
  );
  assert.equal(result.complete, true);
  assert.deepEqual([...result.ids], ['chat-1', 'chat-3']);
  assert.deepEqual(progress, [1, 2, 3, 4]);
  assert.ok(mock.calls.every((call) => call.limit === 1 && call.fromUser === 'me' && !call.ids));
  assert.equal(
    await hasOwnMessages(
      {getMessages: async () => [undefined, {id: 1, className: 'MessageEmpty'}]},
      'synthetic',
    ),
    false,
  );
});

test('cancellation keeps the received probe and stops before requesting another chat; failure is incomplete', async () => {
  const mock = fixture();
  const task = {cancelled: false};
  mock.controls.probe = async () => {
    task.cancelled = true;
  };
  const cancelled = await checkOwnChats(mock.client, chatsFromDialogs(mock.dialogs), task, () => {});
  assert.equal(cancelled.complete, false);
  assert.equal(mock.calls.length, 1);
  mock.controls.probe = async () => {
    throw new Error('Synthetic check failure');
  };
  const failed = await checkOwnChats(
    mock.client,
    chatsFromDialogs(mock.dialogs),
    {cancelled: false},
    () => {},
  );
  assert.equal(failed.complete, false);
  assert.match(String(failed.failure), /Synthetic check failure/);
});

test('own-chat toggle preserves the active chat and marks, composes with private visibility, search and All view', async () => {
  const mock = fixture();
  mock.dialogs[3]!.isGroup = false;
  Object.assign(mock.dialogs[3]!, {isUser: true});
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('\x1b[B');
    await ui.waitFor((frame) => frame.includes('/ 1 msgs'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('With my messages: on [o]'));
    assert.ok(ui.frame().includes('TG MANAGER / Group 001'));
    assert.ok(ui.frame().includes('1 selected'));
    assert.ok(
      !ui.frame().includes('Group 000') &&
        !ui.frame().includes('Group 002') &&
        !ui.frame().includes('Group 003'),
    );
    assert.ok(!ui.frame().trimEnd().split('\n').at(-1)!.split(/\s+/).includes('o'));
    await ui.press('p');
    assert.ok(ui.frame().includes('Group 003'));
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('All [v]') && frame.includes('/ 2 msgs'));
    assert.ok(ui.frame().includes('Other in chat-1'));
    assert.ok(ui.frame().includes('With my messages: on [o]'));
    await ui.press('/');
    await ui.press('Group 003');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 003') && frame.includes('/ 2 msgs'));
    assert.ok(!ui.frame().includes('Own in chat-1'));
    assert.equal(mock.controls.deletions, 0);
  } finally {
    await ui.close();
  }
});

test('filtering out the active chat clears its messages and selection; turning the filter off restores all chats', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('All [v]') && frame.includes('/ 1 msgs'));
    await ui.press('o');
    await ui.waitFor(
      (frame) =>
        frame.includes('With my messages: on [o]') &&
        frame.includes('TG MANAGER / Group 001') &&
        frame.includes('/ 2 msgs'),
    );
    assert.ok(!ui.frame().includes('Other in chat-0'));
    assert.ok(ui.frame().includes('0 selected'));
    const before = mock.calls.length;
    await ui.press('o');
    assert.ok(ui.frame().includes('With my messages: off [o]') && ui.frame().includes('Group 000'));
    assert.equal(mock.calls.length, before, 'disabling the filter must not request messages');
  } finally {
    await ui.close();
  }
});

test('cancelled or failed checks leave the original list and selection usable, and can be retried', async () => {
  const mock = fixture();
  let release!: () => void;
  mock.controls.probe = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('Checking chats'));
    const header = ui.frame().split('\n')[0]!;
    assert.match(header, /Checking chats 0\/4 · Esc stop\s*$/);
    assert.ok(ui.frame().includes('With my messages: checking'));
    assert.ok(!ui.frame().includes('With my messages: on'));
    await ui.waitFor((frame) => frame.split('\n')[0] !== header);
    assert.match(ui.frame().split('\n')[0]!, /Checking chats 0\/4 · Esc stop\s*$/);
    await ui.press('o');
    assert.equal(mock.calls.filter((call) => call.limit === 1).length, 1);
    await ui.press('\x1b');
    assert.match(ui.frame().split('\n')[0]!, /Stopping chat checks 0\/4/);
    assert.ok(ui.frame().includes('With my messages: stopping'));
    release();
    await ui.waitFor(
      (frame) => frame.includes('Stopped checking chats') && frame.includes('With my messages: off [o]'),
    );
    assert.ok(ui.frame().includes('Group 000') && ui.frame().includes('Group 003'));
    assert.ok(!ui.frame().split('\n')[0]!.includes('Stopping chat checks'));
    mock.controls.probe = async () => {
      throw new Error('Synthetic probe failure');
    };
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('Synthetic probe failure'));
    assert.ok(ui.frame().includes('With my messages: off [o]') && ui.frame().includes('Group 000'));
    assert.ok(!ui.frame().split('\n')[0]!.includes('Checking chats'));
    mock.controls.probe = undefined;
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('With my messages: on [o]'));
    assert.ok(!ui.frame().includes('Group 000'));
    assert.equal(mock.controls.deletions, 0);
  } finally {
    release?.();
    await ui.close();
  }
});

test('new chat pages are checked and refresh recomputes ownership without changing a retained active chat', async () => {
  const mock = fixture(102);
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('o');
    await ui.waitFor(
      (frame) => frame.includes('With my messages: on [o]') && frame.includes('TG MANAGER / Group 001'),
    );
    await ui.press('m');
    await ui.waitFor((frame) => frame.includes('102 chats') && frame.includes('With my messages: on [o]'));
    assert.deepEqual(
      mock.calls.filter((call) => call.limit === 1).map((call) => call.entity),
      mock.dialogs.map((chat) => chat.id),
    );
    await ui.press('\x1b[F');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 101') && frame.includes('/ 1 msgs'));
    assert.ok(!ui.frame().includes('Group 100'));
    await ui.press('\x1b[H');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 001') && frame.includes('/ 1 msgs'));
    await ui.press('\t');
    await ui.press(' ');
    mock.records.set('chat-3', [{id: 20, message: 'Other only', senderId: 99}]);
    await ui.press('R');
    await ui.waitFor(
      (frame) =>
        frame.includes('100 chats') &&
        frame.includes('With my messages: on [o]') &&
        !frame.includes('Checking chats'),
    );
    assert.ok(ui.frame().includes('TG MANAGER / Group 001') && ui.frame().includes('1 selected'));
    assert.ok(!ui.frame().includes('Group 003'));
  } finally {
    await ui.close();
  }
});

test('a failed check of a newly received page keeps the page and visibly turns off the filter', async () => {
  const mock = fixture(102);
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('With my messages: on [o]'));
    mock.controls.probe = async (entity) => {
      if (entity === 'chat-100') throw new Error('Synthetic new-page failure');
    };
    await ui.press('m');
    await ui.waitFor((frame) => frame.includes('102 chats') && frame.includes('With my messages: off [o]'));
    assert.ok(ui.frame().includes('Synthetic new-page failure'));
    await ui.press('\x1b[F');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 101'));
  } finally {
    await ui.close();
  }
});

test('deleting the last own message removes the chat from the filtered list even in All view', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('With my messages: on [o]') && frame.includes('/ 1 msgs'));
    await ui.press('v');
    await ui.waitFor((frame) => frame.includes('All [v]') && frame.includes('/ 2 msgs'));
    await ui.press('\t');
    await ui.press('\x1b[B');
    await ui.press(' ');
    await ui.press('d');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    for (const letter of 'DELETE') await ui.press(letter);
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 003') && frame.includes('/ 2 msgs'));
    assert.ok(!ui.frame().includes('Own in chat-1'));
    assert.ok(ui.frame().includes('0 selected'));
    assert.equal(mock.controls.deletions, 1);
  } finally {
    await ui.close();
  }
});

test('an empty filtered list can load later matches and recover its active chat', async () => {
  const mock = fixture(101);
  for (const chat of mock.dialogs) mock.records.set(chat.id, []);
  mock.records.set('chat-100', [{id: 10, senderId: 42, message: 'Later own message'}]);
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('o');
    await ui.waitFor(
      (frame) => frame.includes('With my messages: on [o]') && frame.includes('TG MANAGER / Select chat'),
    );
    assert.ok(ui.frame().includes('No chats with own messages') && ui.frame().includes('0 selected'));
    await ui.press('m');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 100') && frame.includes('/ 1 msgs'));
    assert.ok(ui.frame().includes('With my messages: on [o]'));
  } finally {
    await ui.close();
  }
});

test('All view retains a matching chat whose own messages are beyond its loaded page', async () => {
  const mock = fixture(2);
  mock.records.set('chat-1', [
    ...Array.from({length: 100}, (_, index) => ({id: 200 - index, senderId: 99, message: `Other ${index}`})),
    {id: 10, senderId: 42, message: 'Older own message'},
  ]);
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ready(ui, mock);
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('With my messages: on [o]') && frame.includes('/ 1 msgs'));
    await ui.press('v');
    await ui.waitFor(
      (frame) =>
        frame.includes('All [v]') && frame.includes('/ 100 msgs') && !frame.includes('Loading history'),
    );
    assert.ok(ui.frame().includes('TG MANAGER / Group 001'));
    assert.ok(mock.calls.filter((call) => call.entity === 'chat-1' && call.limit === 1).length >= 2);
    assert.equal(mock.controls.deletions, 0);
  } finally {
    await ui.close();
  }
});
