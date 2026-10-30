import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {App} from './helpers/App.js';
import {createDialogPager} from '../src/dialogs.js';
import {describeError} from '../src/errors.js';
import {testTerminal} from './helpers/terminal.js';

function fixture(count = 205) {
  const dialogs = Array.from({length: count}, (_, index) => ({
    id: `chat-${index}`,
    title: `Group ${String(index).padStart(3, '0')}`,
    entity: `entity-${index}`,
    isGroup: true,
  }));
  const records = Array.from({length: 45}, (_, index) => ({
    id: 45 - index,
    message: `Message ${index} ${'Wrapping synthetic text. '.repeat(30)}TAIL-${index}`,
    senderId: 42,
  }));
  const calls = {dialogs: 0, messages: [] as unknown[], deleted: 0, scans: 0};
  const client = {
    async getMe() {
      return {id: 42, firstName: 'Synthetic'};
    },
    async *iterDialogs() {
      for (const dialog of dialogs) {
        calls.dialogs++;
        yield dialog;
      }
    },
    async getMessages(entity: unknown) {
      calls.messages.push(entity);
      return records;
    },
    async *iterMessages() {
      calls.scans++;
      yield* records;
    },
    async deleteMessages() {
      calls.deleted++;
    },
  };
  return {dialogs, client, calls};
}
test('dialog pages exceed 500 without a silent ceiling, deduplicate overlaps and stop duplicate-only loops', async () => {
  const mock = fixture(605);
  const pager = createDialogPager(mock.client);
  const task = {cancelled: false};
  let loaded = 0;
  let more = true;
  while (more) {
    const result = await pager.next(task);
    loaded += result.chats.length;
    more = result.more;
  }
  assert.equal(loaded, 605);
  assert.equal(mock.calls.dialogs, 605);
  await pager.close();
  const duplicate = createDialogPager({
    async *iterDialogs() {
      yield* mock.dialogs.slice(0, 100);
      yield* mock.dialogs.slice(50, 150);
      yield* mock.dialogs.slice(50, 150);
      throw new Error('Must never reach another page');
    },
  });
  assert.equal((await duplicate.next(task)).chats.length, 100);
  assert.equal((await duplicate.next(task)).chats.length, 50);
  await assert.rejects(duplicate.next(task), /did not advance/);
  await duplicate.close();
});
test('search filters only loaded chats, preserves marks on same identity, clears on target change and shows empty results', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 45 msgs'));
    assert.equal(mock.calls.dialogs, 100);
    await ui.press('\t');
    await ui.press(' ');
    await ui.press('/');
    await ui.press('Group 00');
    await ui.press('\r');
    assert.match(ui.frame(), /1 selected/);
    assert.match(ui.frame(), /Search loaded chats: Group 00/);
    assert.deepEqual(mock.calls.messages, ['entity-0']);
    await ui.press('/');
    for (let index = 0; index < 8; index++) await ui.press('\x7f');
    await ui.press('not loaded');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('No matching loaded chats'));
    assert.match(ui.frame(), /0 selected/);
    assert.equal(mock.calls.dialogs, 100);
    await ui.press('/');
    for (let index = 0; index < 10; index++) await ui.press('\x7f');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('/ 45 msgs'));
    await ui.press('m');
    await ui.waitFor((frame) => frame.includes('200 chats'));
    assert.equal(mock.calls.dialogs, 200);
    await ui.press('m');
    await ui.waitFor(
      (frame) => frame.includes('205 chats') && !frame.includes('More chats may be available'),
    );
  } finally {
    await ui.close();
  }
});
test('refresh preserves active ID and selection when dialogs reorder', async () => {
  const mock = fixture(3);
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 45 msgs'));
    await ui.press('\x1b[B');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 001'));
    await ui.press('\t');
    await ui.press(' ');
    mock.dialogs.reverse();
    await ui.press('R');
    await ui.waitFor((frame) => frame.includes('1 selected') && frame.includes('TG MANAGER / Group 001'));
    assert.match(ui.frame(), /1 selected/);
  } finally {
    await ui.close();
  }
});
for (const columns of [80, 40, 25]) {
  test(`chat list keeps its position and viewport while messages load at ${columns} columns`, async () => {
    const mock = fixture(30);
    const getMessages = mock.client.getMessages;
    let release!: () => void;
    mock.client.getMessages = async (entity) => {
      const records = await getMessages(entity);
      if (entity === 'entity-1')
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return records;
    };
    const ui = testTerminal(<App client={mock.client} />, {columns, rows: 24});
    const chatRows = (frame: string) =>
      frame.split('\n').flatMap((line, row) => {
        const divider = line.indexOf('|');
        return divider < 0 ? [] : [{row, text: line.slice(0, divider).trim().replace(/^>\s*/, '')}];
      });
    try {
      await ui.waitFor((frame) => frame.includes('45 msgs') && !frame.includes('Loading history'));
      const before = chatRows(ui.frame());
      assert.ok(before.length > 1, 'the chat list must be visible');
      await ui.press('\x1b[B');
      await ui.waitFor((frame) => frame.includes('Loading history'));
      assert.deepEqual(chatRows(ui.frame()), before, 'loading must not move or resize the chat list');
      assert.ok(!ui.frame().includes('Telegram may wait/retry internally.'));
      release();
      await ui.waitFor((frame) => !frame.includes('Loading history'));
      assert.deepEqual(chatRows(ui.frame()), before, 'completion must preserve the same viewport');
    } finally {
      release?.();
      await ui.close();
    }
  });
}
test('list pages and ends use viewport bounds; message detail isolates keys and restores focus and marks', async () => {
  const mock = fixture(30);
  const ui = testTerminal(<App client={mock.client} />, {columns: 80, rows: 24});
  try {
    await ui.waitFor((frame) => frame.includes('/ 45 msgs'));
    await ui.press('\x1b[F');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 029'));
    await ui.press('\x1b[H');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 000'));
    await ui.press('\x1b[6~');
    assert.ok(!ui.frame().includes('TG MANAGER / Group 000'));
    await ui.press('\x1b[5~');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Group 000'));
    await ui.press('\t');
    await ui.press('\x1b[F');
    await ui.press(' ');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('MESSAGE 1 · Read only'));
    const calls = structuredClone(mock.calls);
    for (const key of [' ', 's', 'd', 'A', 'm', 'R', 'v', '/', '\t']) await ui.press(key);
    assert.deepEqual(mock.calls, calls);
    await ui.resize(40, 12);
    await ui.press('\x1b[F');
    assert.match(ui.frame(), /TAIL-44/);
    await ui.press('\x1b');
    await ui.resize(80, 24);
    assert.match(ui.frame(), /1 selected/);
    await ui.press(' ');
    assert.match(ui.frame(), /0 selected/);
    await ui.press('\x1b[H');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('MESSAGE 45'));
  } finally {
    await ui.close();
  }
});
test('failed incremental dialog loading is actionable and R restarts with a fresh iterator', async () => {
  const mock = fixture(105);
  let failed = false;
  mock.client.iterDialogs = async function* () {
    for (let index = 0; index < mock.dialogs.length; index++) {
      if (index === 100 && !failed) {
        failed = true;
        throw new Error('Synthetic page failure');
      }
      yield mock.dialogs[index]!;
    }
  };
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 45 msgs'));
    await ui.press('m');
    await ui.waitFor((frame) => frame.includes('Synthetic page failure'));
    await ui.press('R');
    await ui.waitFor((frame) => !frame.includes('Connecting') && frame.includes('100 chats'));
    await ui.press('m');
    await ui.waitFor(
      (frame) => frame.includes('105 chats') && !frame.includes('More chats may be available'),
    );
  } finally {
    await ui.close();
  }
});
test('rate-limit error explains server wait without inventing a countdown', () => {
  assert.match(
    describeError({seconds: 90, errorMessage: 'FLOOD_WAIT_90'}),
    /server requested 90 seconds.*Retry later; no live countdown/,
  );
});
