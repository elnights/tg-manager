import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToString} from 'ink';
import stringWidth from 'string-width';
import {stripVTControlCharacters} from 'node:util';
import type {TelegramApi} from '../src/telegram.js';
import {App} from './helpers/App.js';
import {Footer, footerShortcuts, legendRows, type FooterState} from '../src/Footer.js';
import {StatusBar} from '../src/StatusBar.js';
import {Help, helpSections} from '../src/Help.js';
import {absentMessageIds} from '../src/messages.js';
import {testTerminal} from './helpers/terminal.js';

const footerState: FooterState = {
  focus: 'chats',
  busy: false,
  cancelling: false,
  confirm: false,
  canConfirm: false,
  selectPrompt: false,
  hasChat: true,
  canNavigate: true,
  canSelect: true,
  hasOwn: true,
  selected: 0,
  hasMore: true,
  includePrivate: false,
};
const plain = (node: React.ReactNode, columns = 200) =>
  stripVTControlCharacters(renderToString(node, {columns}));

test('every active binding survives label shortening and wrapping in either panel', () => {
  const modes = [
    {},
    {selected: 12},
    {canSelect: false, hasOwn: false, hasMore: false},
    {hasChat: false},
    {busy: true},
    {busy: true, cancelling: true},
    {hasNotice: true},
    {chatsMore: true, canInspect: true},
    {searching: true},
    {initialError: true, hasChat: false},
    {confirm: true},
    {confirm: true, confirmationText: 'DELETE', canConfirm: true},
    {confirm: true, promptVisible: false},
    {selectPrompt: true},
    {selectPrompt: true, promptVisible: false},
  ];
  for (const focus of ['chats', 'messages'] as const)
    for (const mode of modes)
      for (const width of [12, 24, 39, 59, 79, 119, 199, 299]) {
        const state = {...footerState, ...mode, focus};
        const shortcuts = footerShortcuts(state);
        const output = plain(<Footer width={width} {...state} />, width);
        for (const shortcut of shortcuts)
          assert.ok(output.includes(shortcut.key), `missing ${shortcut.key} at ${width}: ${output}`);
        assert.deepEqual(
          legendRows(shortcuts, width).flatMap((row) => row.shortcuts.map((item) => item.key)),
          shortcuts.map((item) => item.key),
        );
        assert.ok(output.split('\n').every((line) => stringWidth(line) <= width));
        assert.ok(!output.includes('|') && !output.includes('…'));
      }
});

test('the active-binding list includes every global key and excludes paused application commands', () => {
  const globals = ['Tab/←→', 'p', 'v', 'r', 'A', '[ ]', '0', 'q/Ctrl+C', '?'];
  for (const focus of ['chats', 'messages'] as const) {
    const keys = footerShortcuts({...footerState, focus, selected: 12, hasNotice: true}).map(
      (item) => item.key,
    );
    for (const key of [...globals, 'c', 'Esc']) assert.ok(keys.includes(key), `${focus}: missing ${key}`);
    if (focus === 'messages') for (const key of ['Space', 's', 'd', 'n', 'L']) assert.ok(keys.includes(key));
    else for (const key of ['Space', 's', 'd', 'n', 'L']) assert.ok(!keys.includes(key));
  }
  assert.deepEqual(
    footerShortcuts({...footerState, busy: true}).map((item) => item.key),
    ['Esc', '?', 'Ctrl+C'],
  );
  assert.deepEqual(
    footerShortcuts({...footerState, confirm: true, promptVisible: false}).map((item) => item.key),
    ['Esc', '?', 'Ctrl+C'],
  );
  assert.deepEqual(
    footerShortcuts({...footerState, selectPrompt: true}).map((item) => item.key),
    ['Y/y', 'N/n', 'Esc/C/c', '?', 'Ctrl+C'],
  );
});

test('status keeps summary alongside information and distinguishes requested from verified progress', () => {
  const props = {
    width: 150,
    view: 'mine' as const,
    loaded: 100,
    hasMore: true,
    selected: 12,
    progress: null,
    notice: null,
  };
  assert.match(
    plain(<StatusBar {...props} notice={{text: 'Selected loaded messages.', level: 'info'}} />),
    /Mine · 100 own messages loaded · 12 selected · More may be available · Selected loaded messages/,
  );
  assert.match(
    plain(<StatusBar {...props} progress={{label: 'Scanning', completed: 2450}} />),
    /Scanning · 2,450 found/,
  );
  assert.match(
    plain(
      <StatusBar {...props} progress={{label: 'Deleting', completed: 400, total: 1200, verified: 300}} />,
    ),
    /Deleting · 400 \/ 1,200 requested · 300 verified/,
  );
  const narrow = plain(<StatusBar {...props} width={30} progress={{label: 'Loading', completed: 200}} />, 30);
  assert.equal(narrow.includes('\n'), false);
  assert.match(narrow, /Loading/);
});

test('loaded count is exact and history availability is a separate statement', () => {
  for (const view of ['mine', 'all'] as const)
    for (const hasMore of [true, false]) {
      const output = plain(
        <StatusBar
          width={100}
          view={view}
          loaded={100}
          hasMore={hasMore}
          selected={0}
          progress={null}
          notice={null}
        />,
      );
      assert.ok(output.includes(view === 'mine' ? '100 own messages loaded' : '100 messages loaded'));
      assert.equal(output.includes('More may be available'), hasMore);
      assert.ok(!output.includes('100+'));
    }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}
function fixture(count = 2) {
  const records = Array.from({length: count}, (_, index) => ({
    id: count - index,
    message: `synthetic-${index}`,
    senderId: {toString: () => '42'},
  }));
  const deleted = new Set<number>();
  const calls = {pages: 0, scans: 0, deletes: [] as number[][], verifies: 0};
  const client = {
    async getMe() {
      return {id: 42};
    },
    async *iterDialogs() {
      yield* await this.getDialogs();
    },
    async getDialogs() {
      return [{id: 1, title: 'Synthetic group', entity: 'synthetic', isGroup: true}];
    },
    async getMessages(_entity: unknown, options: {ids?: number[]; offsetId?: number; limit?: number}) {
      if (options.ids) calls.verifies++;
      else calls.pages++;
      return records
        .filter(
          (record) =>
            !deleted.has(record.id) &&
            (options.ids
              ? options.ids.includes(record.id)
              : !options.offsetId || record.id < options.offsetId),
        )
        .slice(0, options.limit ?? 100);
    },
    async *iterMessages() {
      calls.scans++;
      yield* records;
    },
    async deleteMessages(_entity: unknown, ids: number[]) {
      calls.deletes.push(ids);
      ids.forEach((id) => deleted.add(id));
    },
  };
  return {client, calls, records, deleted};
}
async function ready(ui: ReturnType<typeof testTerminal>) {
  await ui.waitFor(
    (frame) => /Mine · [1-9][\d,]* own messages loaded/.test(frame) && !frame.includes('Loading history'),
  );
}
async function confirm(ui: ReturnType<typeof testTerminal>) {
  for (const letter of 'DELETE') await ui.press(letter);
  await ui.press('\r');
}

test('normal-width UI keeps A and c discoverable and shows one stable exact load count', async () => {
  const mock = fixture(100);
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />, {columns: 80, rows: 24});
  const footer = () => {
    const lines = ui.frame().trimEnd().split('\n');
    return lines.slice(lines.findIndex((line) => line.startsWith('Mine ·')) + 1).join(' ');
  };
  const status = () =>
    ui
      .frame()
      .trimEnd()
      .split('\n')
      .find((line) => line.startsWith('Mine ·'))!
      .trim();
  try {
    await ready(ui);
    const initial = 'Mine · 100 own messages loaded · 0 selected · More may be available';
    assert.equal(status(), initial);
    assert.match(footer(), /(?:^| )A(?: |$)/);
    assert.equal(mock.calls.pages, 1, 'display changes must not trigger an extra page request');
    await ui.press('\t');
    assert.match(footer(), /(?:^| )A(?: |$)/);
    await ui.press(' ');
    assert.match(footer(), /(?:^| )c(?: |$)/);
    assert.match(footer(), /(?:^| )A(?: |$)/);
    await ui.press('\t');
    assert.match(footer(), /(?:^| )c(?: |$)/);
    await ui.press('c');
    assert.equal(status(), initial);
    assert.ok(!footer().split(/\s+/).includes('c'));
    await ui.press('p');
    assert.equal(status(), initial, 'toggling chat visibility must not flash another status');
    await ui.press('\t');
    await ui.press('n');
    await ui.waitFor(
      (frame) =>
        frame.includes('100 own messages loaded') &&
        !frame.includes('More may be available') &&
        !frame.includes('Loading history'),
    );
    assert.equal(status(), 'Mine · 100 own messages loaded · 0 selected');
    assert.match(footer(), /(?:^| )A(?: |$)/);
    assert.ok(!footer().split(/\s+/).includes('n') && !footer().split(/\s+/).includes('L'));
    assert.ok(ui.frames.every((frame) => !frame.includes('100+') && !frame.includes('Loaded 100')));
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    await ui.close();
  }
});

test('the rendered legend includes all working keys after focus, selection and terminal size changes', async () => {
  const mock = fixture(202);
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />, {columns: 80, rows: 24});
  const legend = () => {
    const lines = ui.frame().trimEnd().split('\n');
    return lines.slice(lines.findIndex((line) => line.startsWith('Mine ·')) + 1).join('\n');
  };
  const assertKeys = (keys: string[]) => {
    for (const key of keys) assert.ok(legend().includes(key), `missing ${key}: ${legend()}`);
  };
  const globalKeys = ['↑↓/jk', 'Tab/←→', 'p', 'v', 'r', 'A', '[ ]', '0', 'q/Ctrl+C', '?'];
  try {
    await ready(ui);
    // There is one chat, so only the messages panel has navigation work to do.
    assertKeys(globalKeys.filter((key) => key !== '↑↓/jk'));
    await ui.press('\t');
    assertKeys([...globalKeys, 'Space', 's', 'n', 'L']);
    await ui.press(' ');
    assertKeys([...globalKeys, 'Space', 's', 'c', 'd', 'n', 'L']);
    for (const columns of [40, 25, 60, 80, 120]) {
      await ui.resize(columns, 12);
      assertKeys([...globalKeys, 'Space', 's', 'c', 'd', 'n', 'L']);
      assert.ok(ui.frame().trimEnd().split('\n').length <= 11);
    }
    assert.equal(mock.calls.pages, 1);
    assert.equal(mock.calls.deletes.length, 0);
    await ui.press('?');
    await ui.waitFor((frame) => frame.includes('KEYBOARD HELP'));
    const helpLegend = ui.frame().trimEnd().split('\n').at(-1)!;
    for (const key of ['↑↓/jk', 'PgUp/PgDn', 'Esc/?', 'Ctrl+C']) assert.ok(helpLegend.includes(key));
  } finally {
    await ui.close();
  }
});

test('when the terminal cannot fit active keys, only the displayed escape routes remain active', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />, {columns: 80, rows: 24});
  try {
    await ready(ui);
    await ui.resize(13, 3);
    for (const key of ['v', 'p', 'r', 'A']) await ui.press(key);
    assert.equal(mock.calls.pages, 1);
    assert.equal(mock.calls.scans, 0);
    assert.ok(ui.frame().includes('?') && ui.frame().includes('Ctrl+C'));
    assert.ok(ui.frame().trimEnd().split('\n').length <= 2);
    await ui.press('?');
    await ui.waitFor((frame) => frame.includes('Esc/?'));
    await ui.press('\x1b');
    await ui.resize(80, 24);
    await ui.waitFor((frame) => frame.includes('Mine · 2 own messages loaded'));
    assert.equal(mock.calls.pages, 1);
    assert.ok(ui.frame().includes('GROUPS/'), 'hidden private-chat shortcut must not run');
  } finally {
    await ui.close();
  }
});

test('help opens and closes with ? or Esc, isolates input, and makes no Telegram requests', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
  try {
    await ready(ui);
    const before = {...mock.calls};
    await ui.press('?');
    await ui.waitFor((frame) => frame.includes('KEYBOARD HELP'));
    for (const key of ['v', 'p', 'A', 'L', 'n', 'r', 'c', 's', 'd', ' ', '[', ']', '0', 'q', '\t'])
      await ui.press(key);
    assert.ok(ui.frame().includes('KEYBOARD HELP'));
    assert.deepEqual(mock.calls, before);
    await ui.press('?');
    await ui.waitFor((frame) => frame.includes('TG MANAGER'));
    assert.match(ui.frame(), /Mine · 2 own messages loaded · 0 selected/);
    await ui.press('?');
    await ui.press('\x1b');
    await ui.waitFor((frame) => frame.includes('TG MANAGER'));
    assert.deepEqual(mock.calls, before);
  } finally {
    await ui.close();
  }
});

test('help contains every section and binding, scrolls at small sizes and stays inside the viewport', async () => {
  const ui = testTerminal(<Help width={39} height={7} onClose={() => {}} />, {columns: 40, rows: 8});
  try {
    await ui.waitFor((frame) => frame.includes('KEYBOARD HELP'));
    for (let step = 0; step < 150; step++) await ui.press('\x1b[B');
    assert.ok(ui.frames.some((frame) => frame.includes('Layout and settings')));
    assert.ok(ui.frames.some((frame) => frame.includes('Requested / verified')));
    for (const frame of ui.frames) {
      assert.ok(frame.trimEnd().split('\n').length <= 7);
      assert.ok(frame.split('\n').every((line) => stringWidth(line) <= 39));
    }
    const reference = helpSections.flatMap((section) => section.entries.flat()).join(' ');
    for (const key of ['A (Shift+a)', 'L (Shift+l)', 'n', 'c', 'v', '[ / ]', '0', 'q'])
      assert.ok(reference.includes(key));
    assert.deepEqual(
      helpSections.map((section) => section.title),
      [
        'Navigation',
        'Chat management',
        'Message selection',
        'Loading and pagination',
        'Deletion',
        'Layout and settings',
      ],
    );
  } finally {
    await ui.close();
  }
});

test('deletion confirmation remains exact and help preserves the prompt without deleting', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
  try {
    await ready(ui);
    await ui.press('\t');
    await ui.press('s');
    await ui.press('d');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    await ui.press('\r');
    assert.equal(mock.calls.deletes.length, 0);
    for (const letter of 'delete') await ui.press(letter);
    await ui.press('\r');
    assert.equal(mock.calls.deletes.length, 0);
    await ui.press('?');
    await ui.press('A');
    await ui.press('\x1b');
    assert.ok(ui.frame().includes('delete_'));
    await ui.press('\x1b');
    assert.ok(!ui.frame().includes('Type DELETE'));
    assert.equal(mock.calls.scans, 0);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    await ui.close();
  }
});

test('hidden confirmation in a small terminal cannot accept destructive input', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
  try {
    await ready(ui);
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    await ui.resize(40, 6);
    await ui.waitFor((frame) => frame.includes('Enlarge the terminal'));
    await confirm(ui);
    assert.equal(mock.calls.deletes.length, 0);
    assert.ok(!ui.frame().split('\n').at(-1)!.includes('Enter Confirm'));
    await ui.resize(200, 30);
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    assert.ok(ui.frame().includes('cancel): _'), 'hidden input must not modify the confirmation');
    await ui.press('\x1b');
  } finally {
    await ui.close();
  }
});

test('load-all publishes progress, prevents duplicate requests, and Esc keeps the in-flight page', async () => {
  const mock = fixture(350);
  const gate = deferred<typeof mock.records>();
  const get = mock.client.getMessages.bind(mock.client);
  mock.client.getMessages = async (entity, options) =>
    options.offsetId ? (mock.calls.pages++, gate.promise) : get(entity, options);
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
  try {
    await ready(ui);
    await ui.press('\t');
    await ui.press('L');
    await ui.waitFor((frame) => frame.includes('Loading'));
    await ui.press('L');
    await ui.press('n');
    await ui.press('A');
    assert.equal(mock.calls.pages, 2);
    assert.equal(mock.calls.scans, 0);
    await ui.press('?');
    await ui.press('\x1b');
    assert.ok(ui.frame().includes('Loading'), 'Esc in help closes help without stopping work');
    await ui.press('\x1b');
    await ui.waitFor((frame) => frame.includes('Stopping'));
    gate.resolve(mock.records.slice(100, 200));
    await ui.waitFor((frame) => frame.includes('Stopped loading at 200 loaded'));
    assert.ok(ui.frame().includes('(200)'));
    assert.equal(mock.calls.pages, 2);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    gate.resolve([]);
    await ui.close();
  }
});

test('a cancelled scan never opens a deletion prompt or deletes', async () => {
  const mock = fixture();
  const gate = deferred<void>();
  mock.client.iterMessages = async function* () {
    mock.calls.scans++;
    yield mock.records[0]!;
    await gate.promise;
    yield mock.records[1]!;
  };
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
  try {
    await ready(ui);
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('Scanning · 1 found'));
    await ui.press('A');
    await ui.press('\x1b');
    gate.resolve();
    await ui.waitFor((frame) => frame.includes('Scan stopped'));
    assert.ok(!ui.frame().includes('Type DELETE'));
    assert.equal(mock.calls.scans, 1);
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    gate.resolve();
    await ui.close();
  }
});

test('Esc during deletion verifies the accepted batch and never starts another batch', async () => {
  const mock = fixture(205);
  const gate = deferred<void>();
  mock.client.deleteMessages = async (_entity, ids) => {
    mock.calls.deletes.push(ids);
    await gate.promise;
    ids.forEach((id) => mock.deleted.add(id));
  };
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
  try {
    await ready(ui);
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('DELETE 205'));
    await confirm(ui);
    await ui.waitFor((frame) => frame.includes('Deleting'));
    assert.ok(!ui.frame().includes('100 verified'));
    await ui.press('\x1b');
    gate.resolve();
    await ui.waitFor((frame) => frame.includes('Stopped. 100 / 205 requested; 100 verified absent'));
    assert.equal(mock.calls.deletes.length, 1);
    assert.equal(mock.calls.verifies, 1);
    await ui.press('r');
    await ui.waitFor((frame) => frame.includes('100 / 205 requested; 100 verified absent'));
    await ui.press('\x1b');
    await ui.waitFor((frame) => !frame.includes('verified absent'));
  } finally {
    gate.resolve();
    await ui.close();
  }
});

test('failed deletion reports no unacknowledged success and its error survives reload', async () => {
  const mock = fixture();
  mock.client.deleteMessages = async () => {
    throw new Error('synthetic request failure');
  };
  const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
  try {
    await ready(ui);
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    await confirm(ui);
    await ui.waitFor((frame) => frame.includes('0 / 2 requested; 0 verified absent'));
    assert.ok(ui.frame().includes('synthetic request failure'));
    assert.ok(ui.frame().includes('(2)'));
    assert.equal(mock.calls.verifies, 0);
    await ui.press('r');
    await ui.waitFor((frame) => frame.includes('synthetic request failure'));
  } finally {
    await ui.close();
  }
});

test('accepted deletion is not called verified when messages remain or verification fails', async () => {
  for (const fails of [false, true]) {
    const mock = fixture();
    mock.client.deleteMessages = async (_entity, ids) => {
      mock.calls.deletes.push(ids);
    };
    const get = mock.client.getMessages.bind(mock.client);
    if (fails)
      mock.client.getMessages = async (entity, options) => {
        if (options.ids) throw new Error('synthetic verification failure');
        return get(entity, options);
      };
    const ui = testTerminal(<App client={mock.client satisfies TelegramApi} />);
    try {
      await ready(ui);
      await ui.press('A');
      await ui.waitFor((frame) => frame.includes('Type DELETE'));
      await confirm(ui);
      await ui.waitFor((frame) => frame.includes('2 / 2 requested; 0 verified absent'));
      assert.match(ui.frame(), /ERROR:/);
      assert.equal(mock.calls.deletes.length, 1);
    } finally {
      await ui.close();
    }
  }
});

test('verification handles Teleproto undefined/empty entries and checks exact IDs without author filters', async () => {
  const client = {
    async getMessages(_entity: unknown, options: unknown) {
      assert.deepEqual(options, {ids: [3, 2, 1]});
      return [undefined, {id: 2, className: 'MessageEmpty'}, {id: 1, className: 'Message'}];
    },
  };
  assert.deepEqual(await absentMessageIds(client, 'synthetic', [3, 2, 1]), [3, 2]);
});
