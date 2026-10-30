import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {deleteOwnMessages, loadMessageHistory, scanOwnMessages} from '../src/operations.js';
import type {Message} from '../src/messages.js';
import {App} from './helpers/App.js';
import {testTerminal} from './helpers/terminal.js';

const page = (start: number, count = 100): Message[] =>
  Array.from({length: count}, (_, index) => ({
    id: start - index,
    author: 'You',
    content: 'Synthetic',
    own: true,
    date: '',
  }));
test('history preserves accepted pages on cancellation and rejects non-advancing pages', async () => {
  const task = {cancelled: false};
  let requests = 0;
  let loaded = 0;
  const result = await loadMessageHistory(
    {items: page(300), cursor: 201, more: true},
    async (cursor) => {
      requests++;
      assert.equal(cursor, 201);
      task.cancelled = true;
      return page(200);
    },
    task,
    (history) => {
      loaded = history.items.length;
    },
  );
  assert.equal(requests, 1);
  assert.equal(loaded, 200);
  assert.equal(result.cursor, 101);
  await assert.rejects(
    loadMessageHistory(
      result,
      async () => page(200),
      {cancelled: false},
      () => {},
    ),
    /did not advance/,
  );
});
test('deletion snapshots IDs and target, verifies accepted batch after cancel and stops on partial verification', async () => {
  const ids = Array.from({length: 205}, (_, index) => 300 - index);
  const task = {cancelled: false};
  let deleted = 0;
  let verified = 0;
  const target = {entity: 'original', ids};
  const result = await deleteOwnMessages(
    {
      async deleteMessages(entity, batch) {
        assert.equal(entity, 'original');
        deleted++;
        ids.length = 0;
        target.entity = 'changed';
        task.cancelled = true;
        assert.equal(batch.length, 100);
      },
      async getMessages(entity, options) {
        assert.equal(entity, 'original');
        verified++;
        assert.equal(options.ids!.length, 100);
        return [];
      },
    },
    target,
    task,
    () => {},
  );
  assert.deepEqual(result, {requested: 100, verified: 100, total: 205, cancelled: true});
  assert.equal(deleted, 1);
  assert.equal(verified, 1);
  const failure = await deleteOwnMessages(
    {
      async deleteMessages() {
        deleted++;
      },
      async getMessages() {
        return [{id: 300}];
      },
    },
    {entity: 'original', ids: [300, 299, ...Array.from({length: 100}, (_, index) => 298 - index)]},
    {cancelled: false},
    () => {},
  );
  assert.equal(failure.requested, 100);
  assert.equal(failure.verified, 99);
  assert.match(String(failure.failure), /still present/);
  assert.equal(deleted, 2);
});
test('cancelled own scan does not request the next iterator item', async () => {
  const task = {cancelled: false};
  let requested = 0;
  const ids = await scanOwnMessages(
    {
      async *iterMessages() {
        requested++;
        yield {id: 2};
        requested++;
        yield {id: 1};
      },
    },
    'chat',
    task,
    () => {
      task.cancelled = true;
    },
  );
  assert.deepEqual(ids, [2]);
  assert.equal(requested, 1);
});
test('settings write failure retains usable in-memory width and saves only changes', async () => {
  const writes: number[] = [];
  const client = {
    async getMe() {
      return {id: 42};
    },
    async *iterDialogs() {
      yield* await this.getDialogs();
    },
    async getDialogs() {
      return [];
    },
    async getMessages() {
      return [];
    },
    async *iterMessages() {},
    async deleteMessages() {},
  };
  const ui = testTerminal(
    <App
      client={client}
      settings={{
        read: () => 32,
        write(value) {
          writes.push(value);
          throw new Error('Read only fixture');
        },
      }}
    />,
  );
  try {
    await ui.waitFor((frame) => frame.includes('No groups or channels'));
    assert.deepEqual(writes, []);
    await ui.press(']');
    await ui.press(']');
    await ui.press('0');
    assert.deepEqual(writes, [34, 36, 32]);
    assert.ok(ui.frame().includes('TG MANAGER'));
  } finally {
    await ui.close();
  }
});
