import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import type {TelegramClient} from 'teleproto';
import {App} from '../src/App.js';
import {CredentialPrompt} from '../src/CredentialPrompt.js';
import {Auth} from '../src/Auth.js';
import {start} from '../src/index.js';
import {parseCredentials, type ApiCredentials} from '../src/credentials.js';
import {fetchMessagePage, ownMessageIds} from '../src/messages.js';
import {testTerminal} from './helpers/terminal.js';

const hash = '0123456789abcdef0123456789abcdef';
function message(id: number, own = true) {
  return {id, date: 0, message: `message-${id}`, senderId: {toString: () => own ? '42' : '99'},
    sender: own ? undefined : {firstName: 'Other', lastName: 'Person'}};
}
function mockClient(records = [message(5), message(4, false), message(3)], dialogs = [
  {id: 'chat', title: 'Test chat', entity: 'test-chat', isUser: false, isGroup: true, isChannel: false},
]) {
  const requests: {limit?: number; offsetId?: number; fromUser?: string}[] = [];
  const scans: {fromUser?: string}[] = [];
  const deletions: number[][] = [];
  const entities: unknown[] = [];
  const deleted = new Set<number>();
  const fake = {
    async getMe() {return {id: {toString: () => '42'}};},
    async getDialogs() {return dialogs;},
    async getMessages(_entity: unknown, options: typeof requests[number]) {
      requests.push(options);
      entities.push(_entity);
      return records.filter(record => !deleted.has(record.id) &&
        (!options.offsetId || record.id < options.offsetId) &&
        (!options.fromUser || record.senderId.toString() === '42')).slice(0, options.limit ?? 100);
    },
    async *iterMessages(_entity: unknown, options: typeof scans[number]) {
      scans.push(options);
      for (const record of records) if (record.senderId.toString() === '42' && !deleted.has(record.id)) yield record;
    },
    async deleteMessages(_entity: unknown, ids: number[], options: {revoke: boolean}) {
      assert.equal(options.revoke, true);
      deletions.push(ids);
      ids.forEach(id => deleted.add(id));
    },
  };
  return {client: fake as unknown as TelegramClient, requests, scans, deletions, entities};
}

test('API credentials validate without including submitted secrets in errors', () => {
  assert.deepEqual(parseCredentials(' 12345 ', ` ${hash} `), {apiId: 12345, apiHash: hash});
  for (const id of ['', '0', '-1', '1.5', 'abc', '9007199254740992']) assert.throws(() => parseCredentials(id, hash), /API ID/);
  for (const value of ['', 'not-a-hash', 'x'.repeat(32), hash + 'a']) {
    assert.throws(() => parseCredentials('12345', value), error => error instanceof Error &&
      error.message === 'API hash must contain exactly 32 hexadecimal characters.');
  }
});

test('an explicitly supplied incomplete configuration fails instead of showing the credentials form', async () => {
  const id = process.env.TG_API_ID;
  const apiHash = process.env.TG_API_HASH;
  delete process.env.TG_API_ID;
  delete process.env.TG_API_HASH;
  try {await assert.rejects(start({allowCredentialPrompt: false}), /Invalid API credentials in the supplied configuration/);}
  finally {
    if (id === undefined) delete process.env.TG_API_ID; else process.env.TG_API_ID = id;
    if (apiHash === undefined) delete process.env.TG_API_HASH; else process.env.TG_API_HASH = apiHash;
  }
});

test('API credential form supports pasted values, masks the hash and submits validated credentials', async () => {
  let submitted: ApiCredentials | undefined;
  const ui = testTerminal(<CredentialPrompt onSubmit={value => {submitted = value;}}/>);
  try {
    await ui.waitFor(frame => frame.includes('API CREDENTIALS'));
    await ui.press('12345');
    await ui.press('\r');
    await ui.press(hash);
    await ui.waitFor(frame => frame.includes('*'.repeat(32)));
    assert.ok(ui.frames.every(frame => !frame.includes(hash)), 'the API hash must never be rendered');
    await ui.press('\r');
    assert.deepEqual(submitted, {apiId: 12345, apiHash: hash});
  } finally {await ui.close();}
});

test('API credential form reports invalid fields and allows editing partial credentials', async () => {
  let submitted: ApiCredentials | undefined;
  const ui = testTerminal(<CredentialPrompt initialId="12345" initialHash="bad" onSubmit={value => {submitted = value;}}/>);
  try {
    await ui.waitFor(frame => frame.includes('API CREDENTIALS'));
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor(frame => frame.includes('exactly 32 hexadecimal'));
    assert.equal(submitted, undefined);
    for (let i = 0; i < 3; i++) await ui.press('\x7f');
    await ui.press(hash);
    await ui.press('\r');
    assert.deepEqual(submitted, {apiId: 12345, apiHash: hash});
  } finally {await ui.close();}
});

test('API credential form can be cancelled without submitting credentials', async () => {
  let submitted = false;
  const ui = testTerminal(<CredentialPrompt onSubmit={() => {submitted = true;}}/>);
  try {
    await ui.waitFor(frame => frame.includes('API CREDENTIALS'));
    await ui.press('\x1b');
    await ui.instance.waitUntilExit();
    assert.equal(submitted, false);
  } finally {await ui.close();}
});

test('QR login receives UI-entered credentials without reading environment credentials', async () => {
  const provided = {apiId: 12345, apiHash: hash};
  let received: unknown;
  const client = {
    async checkAuthorization() {return false;},
    async signInUserWithQrCode(value: unknown) {
      received = value;
      throw new Error('Mock login stopped before session persistence');
    },
  } as unknown as TelegramClient;
  const ui = testTerminal(<Auth client={client} apiCredentials={provided} onAuthenticated={() => {}}/>);
  try {
    await ui.waitFor(frame => frame.includes('Mock login stopped'));
    assert.deepEqual(received, provided);
  } finally {await ui.close();}
});

test('message views use the correct Telegram filter and identify authors without network lookups', async () => {
  const {client, requests} = mockClient();
  const mine = await fetchMessagePage(client, 'test-chat', '42', 'mine');
  assert.deepEqual(requests[0], {limit: 100, offsetId: 0, fromUser: 'me'});
  assert.deepEqual(ownMessageIds(mine), [5, 3]);
  const all = await fetchMessagePage(client, 'test-chat', '42', 'all', 5);
  assert.deepEqual(requests[1], {limit: 100, offsetId: 5});
  assert.deepEqual(all.map(item => [item.id, item.own, item.author]), [[4, false, 'Other Person'], [3, true, 'You']]);
  assert.deepEqual(ownMessageIds(all, new Set([4, 3])), [3]);
});

test('outgoing private messages without sender IDs are own; unidentified channel posts remain read-only', async () => {
  const records = [
    {id: 5, out: true, isPrivate: true},
    {id: 4, out: true, isPrivate: false},
    {id: 3, out: false, isPrivate: true},
  ];
  const client = {async getMessages() {return records;}} as unknown as TelegramClient;
  const all = await fetchMessagePage(client, 'chat', '42', 'all');
  assert.deepEqual(all.map(item => item.own), [true, false, false]);
  assert.deepEqual(ownMessageIds(all), [5]);
});

async function confirmDelete(ui: ReturnType<typeof testTerminal>) {
  for (const letter of 'DELETE') await ui.press(letter);
  await ui.press('\r');
}

test('all-authors view displays incoming messages but selection and deletion include only own messages', async () => {
  const mock = mockClient();
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    assert.ok(ui.frame().includes('[MINE]'));
    await ui.press('v');
    await ui.waitFor(frame => frame.includes('Loaded 3 messages from all authors'));
    assert.ok(ui.frame().includes('[-] Other Person:'));
    await ui.press('\t');
    await ui.press('\x1b[B');
    await ui.press(' ');
    await ui.waitFor(frame => frame.includes('Only your own messages can be marked'));
    assert.ok(ui.frame().includes('MARKED 0'));
    await ui.press('s');
    await ui.waitFor(frame => frame.includes('Selected 2 loaded own messages'));
    await ui.press('d');
    await ui.waitFor(frame => frame.includes('DELETE 2 of YOUR messages'));
    assert.equal(mock.deletions.length, 0);
    await ui.press('\x1b');
    await ui.waitFor(frame => !frame.includes('Type DELETE'));
    assert.equal(mock.deletions.length, 0);
    await ui.press('d');
    await ui.waitFor(frame => frame.includes('Type DELETE'));
    await confirmDelete(ui);
    await ui.waitFor(frame => frame.includes('Loaded 1 messages from all authors'));
    assert.deepEqual(mock.deletions, [[5, 3]]);
    assert.equal(mock.requests.at(-1)!.fromUser, undefined);
  } finally {await ui.close();}
});

test('switching message views resets selection and restores the own-message server filter', async () => {
  const mock = mockClient();
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.waitFor(frame => frame.includes('MARKED 1'));
    await ui.press('v');
    await ui.waitFor(frame => frame.includes('Loaded 3 messages from all authors'));
    assert.ok(ui.frame().includes('MARKED 0'));
    await ui.press('v');
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    assert.equal(mock.requests.at(-1)!.fromUser, 'me');
    assert.ok(ui.frame().includes('MARKED 0'));
  } finally {await ui.close();}
});

test('pagination and select-entire-history operate on all authors while marking only own messages', async () => {
  const records = Array.from({length: 202}, (_, index) => message(300 - index, index % 70 === 0));
  const mock = mockClient(records);
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 3 own messages'));
    await ui.press('v');
    await ui.waitFor(frame => frame.includes('Loaded 100 messages from all authors'));
    await ui.press('\t');
    await ui.press('n');
    await ui.waitFor(frame => frame.includes('Loaded 200 messages; more available'));
    assert.deepEqual(mock.requests.at(-1), {limit: 100, offsetId: 201});
    await ui.press('s');
    await ui.waitFor(frame => frame.includes('SELECT OWN: 200 messages'));
    await ui.press('y');
    await ui.waitFor(frame => frame.includes('3 marked / 202 loaded'));
    assert.deepEqual(mock.requests.at(-1), {limit: 100, offsetId: 101});
    await ui.press('d');
    await ui.waitFor(frame => frame.includes('DELETE 3 of YOUR messages'));
    await confirmDelete(ui);
    await ui.waitFor(() => mock.deletions.length > 0);
    assert.deepEqual(mock.deletions, [[300, 230, 160]]);
  } finally {await ui.close();}
});

test('bulk deletion scan always filters to me even while viewing all authors', async () => {
  const mock = mockClient();
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    await ui.press('v');
    await ui.waitFor(frame => frame.includes('Loaded 3 messages from all authors'));
    await ui.press('A');
    await ui.waitFor(frame => frame.includes('DELETE 2 of YOUR messages'));
    assert.equal(mock.scans[0]!.fromUser, 'me');
    await confirmDelete(ui);
    await ui.waitFor(() => mock.deletions.length > 0);
    assert.deepEqual(mock.deletions, [[5, 3]]);
  } finally {await ui.close();}
});

test('load-all uses the current view and preserves existing own-message marks', async () => {
  const records = Array.from({length: 102}, (_, index) => message(300 - index, index % 70 === 0));
  const mock = mockClient(records);
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    await ui.press('v');
    await ui.waitFor(frame => frame.includes('Loaded 100 messages from all authors'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.waitFor(frame => frame.includes('MARKED 1'));
    await ui.press('L');
    await ui.waitFor(frame => frame.includes('Loading all: 102 messages — complete'));
    assert.deepEqual(mock.requests.at(-1), {limit: 100, offsetId: 201});
    assert.ok(ui.frame().includes('[ALL] (102)'));
    assert.ok(ui.frame().includes('MARKED 1'));
    assert.equal(mock.deletions.length, 0);
  } finally {await ui.close();}
});

const conversations = [
  {id: 'private', title: 'Direct conversation', entity: 'private', isUser: true, isGroup: false, isChannel: false},
  {id: 'group', title: 'Study group', entity: 'group', isUser: false, isGroup: true, isChannel: false},
  {id: 'megagroup', title: 'Public supergroup', entity: 'megagroup', isUser: false, isGroup: true, isChannel: true},
  {id: 'channel', title: 'News channel', entity: 'channel', isUser: false, isGroup: false, isChannel: true},
  {id: 'bot', title: 'Private bot', entity: 'bot', isUser: true, isGroup: false, isChannel: false},
  {id: 'folder', title: 'Community folder', entity: 'folder', isUser: false, isGroup: false, isChannel: false},
];

test('the default list includes groups, supergroups and channels while excluding private chats and folders', async () => {
  const mock = mockClient(undefined, conversations);
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    const frame = ui.frame();
    assert.ok(frame.includes('GROUPS/CHANNELS (3)'));
    for (const title of ['Study group', 'Public supergroup', 'News channel']) assert.ok(frame.includes(title));
    for (const title of ['Direct conversation', 'Private bot', 'Community folder']) assert.ok(!frame.includes(title));
    assert.deepEqual(mock.entities, ['group']);
  } finally {await ui.close();}
});

test('including and hiding private chats preserves the active group and its message selection', async () => {
  const mock = mockClient(undefined, conversations);
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.waitFor(frame => frame.includes('MARKED 1'));
    await ui.press('p');
    await ui.waitFor(frame => frame.includes('ALL CHATS (5)'));
    assert.ok(ui.frame().includes('Direct conversation'));
    assert.ok(ui.frame().includes('Private bot'));
    assert.ok(!ui.frame().includes('Community folder'));
    assert.ok(ui.frame().includes('TG MANAGER / Study group'));
    assert.ok(ui.frame().includes('MARKED 1'));
    await ui.press('p');
    await ui.waitFor(frame => frame.includes('GROUPS/CHANNELS (3)'));
    assert.ok(ui.frame().includes('TG MANAGER / Study group'));
    assert.ok(ui.frame().includes('MARKED 1'));
    assert.deepEqual(mock.entities, ['group'], 'keeping the active conversation must not refetch its messages');
  } finally {await ui.close();}
});

test('hiding the active private chat switches to the first group and clears its message marks', async () => {
  const mock = mockClient(undefined, conversations);
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    await ui.press('p');
    await ui.press('\x1b[A');
    await ui.waitFor(frame => frame.includes('TG MANAGER / Direct conversation') && frame.includes('Loaded 2 own messages'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.waitFor(frame => frame.includes('MARKED 1'));
    await ui.press('p');
    await ui.waitFor(frame => frame.includes('TG MANAGER / Study group') && frame.includes('Loaded 2 own messages'));
    assert.ok(ui.frame().includes('MARKED 0'));
    assert.ok(!ui.frame().includes('[x]'));
    assert.deepEqual(mock.entities, ['group', 'private', 'group']);
    await ui.press('d');
    assert.ok(!ui.frame().includes('Type DELETE'));
    assert.equal(mock.deletions.length, 0);
  } finally {await ui.close();}
});

test('accounts containing only private chats show a useful empty state and never retain hidden messages or marks', async () => {
  const mock = mockClient(undefined, [conversations[0]!]);
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('No groups or channels found. Press p'));
    assert.ok(ui.frame().includes('No messages'));
    assert.equal(mock.requests.length, 0);
    await ui.press('\x1b[B');
    await ui.press('\x1b[A');
    await ui.press('p');
    await ui.waitFor(frame => frame.includes('TG MANAGER / Direct conversation') && frame.includes('Loaded 2 own messages'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.waitFor(frame => frame.includes('MARKED 1'));
    await ui.press('p');
    await ui.waitFor(frame => frame.includes('No groups or channels found. Press p'));
    assert.ok(ui.frame().includes('MARKED 0'));
    assert.ok(ui.frame().includes('No messages'));
    assert.ok(!ui.frame().includes('message-5'));
    await ui.press('d');
    assert.ok(!ui.frame().includes('Type DELETE'));
    await ui.press('\x1b[B');
    await ui.press('p');
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    assert.ok(ui.frame().includes('MARKED 0'));
    assert.deepEqual(mock.entities, ['private', 'private']);
  } finally {await ui.close();}
});

test('clear selection works from either panel without reloading or deleting messages', async () => {
  const mock = mockClient();
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    await ui.press('\t');
    await ui.press('s');
    await ui.waitFor(frame => frame.includes('MARKED 2'));
    await ui.press('\t');
    await ui.press('c');
    await ui.waitFor(frame => frame.includes('Cleared selection (2 messages)'));
    assert.ok(ui.frame().includes('MARKED 0'));
    assert.ok(!ui.frame().includes('[x]'));
    await ui.press('\t');
    await ui.press('d');
    assert.ok(!ui.frame().includes('Type DELETE'));
    await ui.press(' ');
    await ui.waitFor(frame => frame.includes('MARKED 1'));
    await ui.press('c');
    await ui.waitFor(frame => frame.includes('Cleared selection (1 messages)'));
    assert.ok(ui.frame().includes('MARKED 0'));
    await ui.press('c');
    await ui.waitFor(frame => frame.includes('No messages selected.'));
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.deletions.length, 0);
  } finally {await ui.close();}
});

test('c still cancels the select-entire-history prompt without clearing existing marks', async () => {
  const mock = mockClient(Array.from({length: 101}, (_, index) => message(200 - index)));
  const ui = testTerminal(<App client={mock.client}/>);
  try {
    await ui.waitFor(frame => frame.includes('Loaded 100 own messages'));
    await ui.press('\t');
    await ui.press(' ');
    await ui.press('s');
    await ui.waitFor(frame => frame.includes('SELECT OWN: 100 messages'));
    await ui.press('c');
    await ui.waitFor(frame => !frame.includes('SELECT OWN:'));
    assert.ok(ui.frame().includes('MARKED 1'));
    assert.equal(mock.requests.length, 1);
  } finally {await ui.close();}
});

test('the legend names the width reset and new controls and fits after resizing the terminal', async () => {
  const mock = mockClient();
  const ui = testTerminal(<App client={mock.client}/>, {columns: 80, rows: 24});
  try {
    await ui.waitFor(frame => frame.includes('Loaded 2 own messages'));
    const frame = ui.frame();
    assert.ok(frame.includes('p show private chats'));
    assert.ok(frame.includes('c clear selection'));
    assert.ok(frame.includes('0 reset chat width (32%)'));
    assert.ok(frame.trimEnd().split('\n').length <= 23, 'the legend must fit without scrolling the terminal');
    await ui.press('\t');
    await ui.press(' ');
    await ui.resize(60, 12);
    await ui.waitFor(frame => frame.includes('0 reset chat width (32%)'));
    assert.ok(ui.frame().trimEnd().split('\n').length <= 11);
    await ui.resize(80, 6);
    await ui.waitFor(frame => frame.includes('Enlarge the terminal'));
    await ui.resize(100, 32);
    await ui.waitFor(frame => frame.includes('MARKED 1'));
    assert.ok(ui.frame().includes('0 reset chat width (32%)'));
    assert.ok(ui.frame().trimEnd().split('\n').length <= 31);
    assert.equal(mock.requests.length, 1, 'resizing must preserve the loaded messages and marks');
    await ui.press('p');
    await ui.waitFor(frame => frame.includes('p hide private chats'));
  } finally {await ui.close();}
});
