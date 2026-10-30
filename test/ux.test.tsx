import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToString} from 'ink';
import stringWidth from 'string-width';
import {stripVTControlCharacters} from 'node:util';
import type {TelegramClient} from 'teleproto';
import {App} from '../src/App.js';
import {Footer, type FooterState} from '../src/Footer.js';
import {StatusBar} from '../src/StatusBar.js';
import {Help, helpSections} from '../src/Help.js';
import {absentMessageIds} from '../src/messages.js';
import {testTerminal} from './helpers/terminal.js';

const footerState: FooterState = {focus: 'chats', busy: false, cancelling: false, confirm: false, canConfirm: false,
  selectPrompt: false, hasChat: true, canNavigate: true, canSelect: true, hasOwn: true,
  selected: 0, hasMore: true, includePrivate: false};
const plain = (node: React.ReactNode, columns = 200) => stripVTControlCharacters(renderToString(node, {columns}));

test('footer shows only available actions with complete bindings across narrow widths', () => {
  for (const focus of ['chats', 'messages'] as const) for (const width of [0, 1, 6, 7, 15, 24, 40, 60, 80, 120]) {
    const output = plain(<Footer width={width} {...footerState} focus={focus}/>, Math.max(1, width));
    assert.equal(output.includes('\n'), false);
    assert.ok(stringWidth(output) <= width);
    assert.ok(!output.includes('|') && !output.includes('…'), 'drop whole shortcuts instead of truncating');
    if (width >= 6) assert.ok(output.includes('? Help'));
    if (focus === 'chats') assert.ok(!output.includes('Select') && !output.includes('Delete'));
    else assert.ok(!output.includes('Private') && !output.includes('Resize') && !output.includes('Delete'));
  }
  const selected = plain(<Footer width={140} {...footerState} focus="messages" selected={2}/>);
  assert.match(selected, /d Delete/);
  const unavailable = plain(<Footer width={140} {...footerState} focus="messages" hasMore={false} canSelect={false} hasOwn={false}/>);
  assert.ok(!unavailable.includes('Select') && !unavailable.includes('Next'));
  const busy = plain(<Footer width={140} {...footerState} busy/>);
  assert.match(busy, /Esc Stop after request/);
  assert.ok(!busy.includes('Navigate') && !busy.includes('Delete'));
  assert.ok(!plain(<Footer width={140} {...footerState} confirm/>).includes('Enter'));
  assert.match(plain(<Footer width={140} {...footerState} confirm canConfirm/>), /Enter Confirm/);
});

test('status keeps summary alongside information and distinguishes requested from verified progress', () => {
  const props = {width: 150, view: 'mine' as const, loaded: 100, hasMore: true, selected: 12, progress: null, notice: null};
  assert.match(plain(<StatusBar {...props} notice={{text: 'Selected loaded messages.', level: 'info'}}/>),
    /Mine · 100\+ loaded · 12 selected · Selected loaded messages/);
  assert.match(plain(<StatusBar {...props} progress={{label: 'Scanning', completed: 2450}}/>), /Scanning · 2,450 found/);
  assert.match(plain(<StatusBar {...props} progress={{label: 'Deleting', completed: 400, total: 1200, verified: 300}}/>),
    /Deleting · 400 \/ 1,200 requested · 300 verified/);
  const narrow = plain(<StatusBar {...props} width={30} progress={{label: 'Loading', completed: 200}}/>, 30);
  assert.equal(narrow.includes('\n'), false);
  assert.match(narrow, /Loading/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function fixture(count = 2) {
  const records = Array.from({length: count}, (_, index) => ({id: count - index,
    message: `synthetic-${index}`, senderId: {toString: () => '42'}}));
  const deleted = new Set<number>();
  const calls = {pages: 0, scans: 0, deletes: [] as number[][], verifies: 0};
  const client = {
    async getMe() {return {id: 42};},
    async getDialogs() {return [{id: 1, title: 'Synthetic group', entity: 'synthetic', isGroup: true}];},
    async getMessages(_entity: unknown, options: {ids?: number[]; offsetId?: number; limit?: number}) {
      if (options.ids) calls.verifies++; else calls.pages++;
      return records.filter(record => !deleted.has(record.id) && (options.ids ? options.ids.includes(record.id) :
        !options.offsetId || record.id < options.offsetId)).slice(0, options.limit ?? 100);
    },
    async *iterMessages() {calls.scans++; yield* records;},
    async deleteMessages(_entity: unknown, ids: number[]) {calls.deletes.push(ids); ids.forEach(id => deleted.add(id));},
  };
  return {client, calls, records, deleted};
}
async function ready(ui: ReturnType<typeof testTerminal>) {await ui.waitFor(frame => /Loaded \d+ own messages\./.test(frame));}
async function confirm(ui: ReturnType<typeof testTerminal>) {
  for (const letter of 'DELETE') await ui.press(letter);
  await ui.press('\r');
}

test('help opens and closes with ? or Esc, isolates input, and makes no Telegram requests', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
  try {
    await ready(ui);
    const before = {...mock.calls};
    await ui.press('?');
    await ui.waitFor(frame => frame.includes('KEYBOARD HELP'));
    for (const key of ['v', 'p', 'A', 'L', 'n', 'r', 'c', 's', 'd', ' ', '[', ']', '0', 'q', '\t']) await ui.press(key);
    assert.ok(ui.frame().includes('KEYBOARD HELP'));
    assert.deepEqual(mock.calls, before);
    await ui.press('?');
    await ui.waitFor(frame => frame.includes('TG MANAGER'));
    assert.match(ui.frame(), /Mine · 2 loaded · 0 selected/);
    await ui.press('?');
    await ui.press('\x1b');
    await ui.waitFor(frame => frame.includes('TG MANAGER'));
    assert.deepEqual(mock.calls, before);
  } finally {await ui.close();}
});

test('help contains every section and binding, scrolls at small sizes and stays inside the viewport', async () => {
  const ui = testTerminal(<Help width={39} height={7} onClose={() => {}}/>, {columns: 40, rows: 8});
  try {
    await ui.waitFor(frame => frame.includes('KEYBOARD HELP'));
    for (let step = 0; step < 150; step++) await ui.press('\x1b[B');
    assert.ok(ui.frames.some(frame => frame.includes('Layout and settings')));
    assert.ok(ui.frames.some(frame => frame.includes('Requested / verified')));
    for (const frame of ui.frames) {
      assert.ok(frame.trimEnd().split('\n').length <= 7);
      assert.ok(frame.split('\n').every(line => stringWidth(line) <= 39));
    }
    const reference = helpSections.flatMap(section => section.entries.flat()).join(' ');
    for (const key of ['A (Shift+a)', 'L (Shift+l)', 'n', 'c', 'v', '[ / ]', '0', 'q']) assert.ok(reference.includes(key));
    assert.deepEqual(helpSections.map(section => section.title), ['Navigation', 'Chat management', 'Message selection',
      'Loading and pagination', 'Deletion', 'Layout and settings']);
  } finally {await ui.close();}
});

test('deletion confirmation remains exact and help preserves the prompt without deleting', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
  try {
    await ready(ui); await ui.press('\t'); await ui.press('s'); await ui.press('d');
    await ui.waitFor(frame => frame.includes('Type DELETE'));
    await ui.press('\r');
    assert.equal(mock.calls.deletes.length, 0);
    for (const letter of 'delete') await ui.press(letter);
    await ui.press('\r');
    assert.equal(mock.calls.deletes.length, 0);
    await ui.press('?'); await ui.press('A'); await ui.press('\x1b');
    assert.ok(ui.frame().includes('delete_'));
    await ui.press('\x1b');
    assert.ok(!ui.frame().includes('Type DELETE'));
    assert.equal(mock.calls.scans, 0);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {await ui.close();}
});

test('hidden confirmation in a small terminal cannot accept destructive input', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
  try {
    await ready(ui); await ui.press('A'); await ui.waitFor(frame => frame.includes('Type DELETE'));
    await ui.resize(40, 6);
    await ui.waitFor(frame => frame.includes('Enlarge the terminal'));
    await confirm(ui);
    assert.equal(mock.calls.deletes.length, 0);
    assert.ok(!ui.frame().split('\n').at(-1)!.includes('Enter Confirm'));
    await ui.resize(200, 30);
    await ui.waitFor(frame => frame.includes('Type DELETE'));
    assert.ok(ui.frame().includes('cancel): _'), 'hidden input must not modify the confirmation');
    await ui.press('\x1b');
  } finally {await ui.close();}
});

test('load-all publishes progress, prevents duplicate requests, and Esc keeps the in-flight page', async () => {
  const mock = fixture(350);
  const gate = deferred<typeof mock.records>();
  const get = mock.client.getMessages.bind(mock.client);
  mock.client.getMessages = async (entity, options) => options.offsetId ? (mock.calls.pages++, gate.promise) : get(entity, options);
  const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
  try {
    await ready(ui); await ui.press('\t'); await ui.press('L');
    await ui.waitFor(frame => frame.includes('Loading'));
    await ui.press('L'); await ui.press('n'); await ui.press('A');
    assert.equal(mock.calls.pages, 2);
    assert.equal(mock.calls.scans, 0);
    await ui.press('?'); await ui.press('\x1b');
    assert.ok(ui.frame().includes('Loading'), 'Esc in help closes help without stopping work');
    await ui.press('\x1b');
    await ui.waitFor(frame => frame.includes('Stopping'));
    gate.resolve(mock.records.slice(100, 200));
    await ui.waitFor(frame => frame.includes('Stopped loading at 200 loaded'));
    assert.ok(ui.frame().includes('(200+)'));
    assert.equal(mock.calls.pages, 2);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {gate.resolve([]); await ui.close();}
});

test('a cancelled scan never opens a deletion prompt or deletes', async () => {
  const mock = fixture();
  const gate = deferred<void>();
  mock.client.iterMessages = async function* () {mock.calls.scans++; yield mock.records[0]!; await gate.promise; yield mock.records[1]!;};
  const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
  try {
    await ready(ui); await ui.press('A');
    await ui.waitFor(frame => frame.includes('Scanning · 1 found'));
    await ui.press('A'); await ui.press('\x1b'); gate.resolve();
    await ui.waitFor(frame => frame.includes('Scan stopped'));
    assert.ok(!ui.frame().includes('Type DELETE'));
    assert.equal(mock.calls.scans, 1);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {gate.resolve(); await ui.close();}
});

test('Esc during deletion verifies the accepted batch and never starts another batch', async () => {
  const mock = fixture(205);
  const gate = deferred<void>();
  mock.client.deleteMessages = async (_entity, ids) => {mock.calls.deletes.push(ids); await gate.promise; ids.forEach(id => mock.deleted.add(id));};
  const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
  try {
    await ready(ui); await ui.press('A');
    await ui.waitFor(frame => frame.includes('DELETE 205'));
    await confirm(ui);
    await ui.waitFor(frame => frame.includes('Deleting'));
    assert.ok(!ui.frame().includes('100 verified'));
    await ui.press('\x1b'); gate.resolve();
    await ui.waitFor(frame => frame.includes('Stopped. 100 / 205 requested; 100 verified absent'));
    assert.equal(mock.calls.deletes.length, 1);
    assert.equal(mock.calls.verifies, 1);
    await ui.press('r');
    await ui.waitFor(frame => frame.includes('100 / 205 requested; 100 verified absent'));
    await ui.press('\x1b');
    await ui.waitFor(frame => !frame.includes('verified absent'));
  } finally {gate.resolve(); await ui.close();}
});

test('failed deletion reports no unacknowledged success and its error survives reload', async () => {
  const mock = fixture();
  mock.client.deleteMessages = async () => {throw new Error('synthetic request failure');};
  const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
  try {
    await ready(ui); await ui.press('A'); await ui.waitFor(frame => frame.includes('Type DELETE'));
    await confirm(ui);
    await ui.waitFor(frame => frame.includes('0 / 2 requested; 0 verified absent'));
    assert.ok(ui.frame().includes('synthetic request failure'));
    assert.ok(ui.frame().includes('(2)'));
    assert.equal(mock.calls.verifies, 0);
    await ui.press('r');
    await ui.waitFor(frame => frame.includes('synthetic request failure'));
  } finally {await ui.close();}
});

test('accepted deletion is not called verified when messages remain or verification fails', async () => {
  for (const fails of [false, true]) {
    const mock = fixture();
    mock.client.deleteMessages = async (_entity, ids) => {mock.calls.deletes.push(ids);};
    const get = mock.client.getMessages.bind(mock.client);
    if (fails) mock.client.getMessages = async (entity, options) => {
      if (options.ids) throw new Error('synthetic verification failure');
      return get(entity, options);
    };
    const ui = testTerminal(<App client={mock.client as unknown as TelegramClient}/>);
    try {
      await ready(ui); await ui.press('A'); await ui.waitFor(frame => frame.includes('Type DELETE'));
      await confirm(ui);
      await ui.waitFor(frame => frame.includes('2 / 2 requested; 0 verified absent'));
      assert.match(ui.frame(), /ERROR:/);
      assert.equal(mock.calls.deletes.length, 1);
    } finally {await ui.close();}
  }
});

test('verification handles Teleproto undefined/empty entries and checks exact IDs without author filters', async () => {
  const client = {async getMessages(_entity: unknown, options: unknown) {
    assert.deepEqual(options, {ids: [3, 2, 1]});
    return [undefined, {id: 2, className: 'MessageEmpty'}, {id: 1, className: 'Message'}];
  }} as unknown as TelegramClient;
  assert.deepEqual(await absentMessageIds(client, 'synthetic', [3, 2, 1]), [3, 2]);
});
