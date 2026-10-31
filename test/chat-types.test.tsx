import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {Api} from 'teleproto';
import {returnBigInt} from 'teleproto/Helpers.js';
import {App} from './helpers/App.js';
import {testTerminal} from './helpers/terminal.js';
import {chatsFromDialogs, chatTypes, type ChatType, type TelegramApi} from '../src/telegram.js';
import {initialView, viewReducer, visibleChats} from '../src/state.js';

function fixture() {
  const dialogs = [
    {id: 'person', title: 'Person', entity: 'person', isUser: true},
    {id: 'bot', title: 'Robot', entity: new Api.User({id: returnBigInt(9), bot: true}), isUser: true},
    {id: 'group', title: 'Project team', entity: 'group', isGroup: true},
    {id: 'supergroup', title: 'Community', entity: 'supergroup', isGroup: true, isChannel: true},
    {id: 'channel', title: 'News', entity: 'channel', isChannel: true},
  ];
  const calls = {deletes: 0};
  const client: TelegramApi = {
    async getMe() {
      return {id: 42};
    },
    async *iterDialogs() {
      yield* dialogs;
    },
    async getMessages() {
      return [{id: 10, senderId: 42, message: 'Synthetic message'}];
    },
    async *iterMessages() {
      yield {id: 10};
    },
    async deleteMessages() {
      calls.deletes++;
    },
  };
  return {dialogs, client, calls};
}

test('all five chat types are distinguished and every combination can be independently filtered', () => {
  const mock = fixture();
  const chats = chatsFromDialogs(mock.dialogs);
  assert.deepEqual(
    chats.map((chat) => chat.type),
    chatTypes,
  );
  for (let mask = 0; mask < 32; mask++) {
    const types = new Set<ChatType>(chatTypes.filter((_type, index) => mask & (1 << index)));
    const state = viewReducer({...initialView, chats}, {type: 'types', types});
    assert.deepEqual(
      visibleChats(state).map((chat) => chat.type),
      [...types],
    );
  }
});

test('the type checklist applies a combination atomically, preserves visible-chat marks and cancels edits', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('Synthetic message') && !frame.includes('Loading history'));
    assert.ok(ui.frame().includes('[G]') && ui.frame().includes('[S]') && ui.frame().includes('[C]'));
    assert.ok(!ui.frame().includes('Person') && !ui.frame().includes('Robot'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.press('f');
    await ui.waitFor((frame) => frame.includes('VIEW OPTIONS / CHAT TYPES'));
    await ui.press(' ');
    await ui.press('j');
    await ui.press(' ');
    await ui.press('?');
    await ui.press('\x1b');
    assert.ok(ui.frame().includes('[x] [P]') && ui.frame().includes('[x] [B]'));
    await ui.press('\r');
    assert.ok(ui.frame().includes('Types: P B G S C [f]') && ui.frame().includes('1 selected'));
    assert.ok(ui.frame().includes('TG MANAGER / Project team'));
    await ui.press('f');
    await ui.press('j');
    await ui.press('j');
    await ui.press(' ');
    await ui.press('\x1b');
    assert.ok(ui.frame().includes('Types: P B G S C [f]') && ui.frame().includes('1 selected'));
    await ui.press('f');
    await ui.press('j');
    await ui.press('j');
    await ui.press(' ');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Person') && !frame.includes('Loading history'));
    assert.ok(ui.frame().includes('0 selected') && !ui.frame().includes('Project team'));
    assert.equal(mock.calls.deletes, 0);
  } finally {
    await ui.close();
  }
});

test('hiding every chat type shows a recoverable empty state and retains loaded dialogs', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('Synthetic message'));
    await ui.press('f');
    await ui.press('j');
    await ui.press('j');
    for (let index = 0; index < 3; index++) {
      await ui.press(' ');
      if (index !== 2) await ui.press('j');
    }
    await ui.press('\r');
    assert.ok(ui.frame().includes('Types: none [f]') && ui.frame().includes('All chat types hidden'));
    assert.ok(ui.frame().includes('Loaded: 5 chats / 0 msgs'));
    await ui.press('f');
    await ui.press(' ');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('TG MANAGER / Person') && frame.includes('Synthetic message'));
  } finally {
    await ui.close();
  }
});

test('a small type checklist cannot apply hidden choices; Escape restores the main view', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client} />);
  try {
    await ui.waitFor((frame) => frame.includes('Synthetic message'));
    await ui.press('f');
    await ui.resize(25, 8);
    await ui.press(' ');
    await ui.press('\r');
    assert.ok(ui.frame().includes('Enlarge'));
    await ui.press('\x1b');
    await ui.resize(120, 30);
    assert.ok(ui.frame().includes('Types: G S C [f]'));
    assert.ok(!ui.frame().includes('Person'));
  } finally {
    await ui.close();
  }
});
