import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import type {TelegramApi, AuthClient} from '../src/telegram.js';
import type {QrCodeAuthParams} from 'teleproto/client/methods/auth.js';
import {App} from './helpers/App.js';
import {Auth} from '../src/Auth.js';
import {testTerminal} from './helpers/terminal.js';

const digits = '0123456789abcdef';
const credentials = {apiId: 12345, apiHash: digits.repeat(2)};
function fixture(title = 'Duplicate title') {
  const deleted = new Set<number>();
  const calls = {dialogs: 0, deletes: [] as unknown[], entities: [] as unknown[]};
  const client = {
    async getMe() {
      return {id: 42, firstName: 'Synthetic account'};
    },
    async *iterDialogs() {
      yield* await this.getDialogs();
    },
    async getDialogs() {
      calls.dialogs++;
      return [
        {id: '-10001', title, entity: 'first', isGroup: true},
        {id: '-10002', title, entity: 'second', isGroup: true},
      ];
    },
    async getMessages(_entity: unknown, _options: {ids?: number[]}) {
      return deleted.has(7) ? [] : [{id: 7, message: 'Synthetic message', senderId: 42}];
    },
    async *iterMessages() {
      yield {id: 7};
    },
    async deleteMessages(entity: unknown, ids: number[]) {
      calls.entities.push(entity);
      calls.deletes.push([...ids]);
      ids.forEach((id) => deleted.add(id));
    },
  };
  return {client, calls};
}
const appClient = (client: TelegramApi) => client;

test('confirmation shows captured account, duplicate-title ID, scope and exact count; paste needs separate Enter', async () => {
  const mock = fixture();
  const ui = testTerminal(<App client={appClient(mock.client)} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 1 msgs'));
    await ui.press('\x1b[B');
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    assert.match(ui.frame(), /Account: Synthetic account \(ID 42\)/);
    assert.match(ui.frame(), /Chat ID: -10002/);
    assert.match(ui.frame(), /entire-history deletion; exact count: 1/);
    assert.match(ui.frame(), /irreversible.*other participants/);
    await ui.press('DELETE');
    assert.equal(mock.calls.deletes.length, 0);
    await ui.press('?');
    await ui.press('\r');
    await ui.press('\x1b');
    assert.match(ui.frame(), /DELETE_/);
    await ui.press('\r');
    await ui.waitFor(() => mock.calls.deletes.length === 1);
    assert.deepEqual(mock.calls.entities, ['second']);
  } finally {
    await ui.close();
  }
});

test('25x24 and long titles cannot accept hidden input; resizing typed DELETE cannot bypass the gate', async () => {
  const mock = fixture('Long title '.repeat(100));
  const ui = testTerminal(<App client={appClient(mock.client)} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 1 msgs'));
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    assert.match(ui.frame(), /Chat ID: -10001/);
    await ui.press('DELETE');
    await ui.resize(25, 24);
    await ui.waitFor((frame) => frame.includes('Enlarge the terminal'));
    await ui.press('\r');
    assert.equal(mock.calls.deletes.length, 0);
    await ui.press('DELETE');
    await ui.resize(80, 30);
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    assert.match(ui.frame(), /DELETE_/);
    await ui.press('\x1b');
    assert.equal(mock.calls.deletes.length, 0);
  } finally {
    await ui.close();
  }
});

test('initial loading failure retries once while pending and distinguishes empty success', async () => {
  const mock = fixture();
  let release!: () => void;
  mock.client.getDialogs = async () => {
    mock.calls.dialogs++;
    if (mock.calls.dialogs === 1) throw new Error('Synthetic offline');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return [];
  };
  const ui = testTerminal(<App client={appClient(mock.client)} />);
  try {
    await ui.waitFor((frame) => frame.includes('Connecting failed'));
    await ui.press('r');
    await ui.waitFor((frame) => frame.includes('Connecting'));
    await ui.press('r');
    await ui.press('r');
    assert.equal(mock.calls.dialogs, 2);
    release();
    await ui.waitFor((frame) => frame.includes('No groups or channels found'));
    assert.ok(!ui.frame().includes('Connecting failed'));
  } finally {
    release?.();
    await ui.close();
  }
});

test('a resolved confirmation warning clears before deletion progress and long results have readable details', async () => {
  const mock = fixture();
  let release!: () => void;
  mock.client.deleteMessages = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new Error('Synthetic long failure '.repeat(30));
  };
  const ui = testTerminal(<App client={appClient(mock.client)} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 1 msgs'));
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    await ui.press('\r');
    await ui.press('DELETE');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Deleting'));
    assert.ok(!ui.frame().includes('Enter exactly DELETE'));
    assert.match(ui.frame(), /Esc Stop after request/);
    release();
    await ui.waitFor((frame) => frame.includes('0 / 1 requested'));
    await ui.press('!');
    await ui.waitFor((frame) => frame.includes('NOTICE DETAILS'));
    await ui.press('\x1b[F');
    assert.match(ui.frame(), /taken effect/);
    await ui.press('\x1b');
    assert.match(ui.frame(), /0 \/ 1 requested/);
  } finally {
    release?.();
    await ui.close();
  }
});

test('wrong cloud password retries with useful text and persists/advances exactly once', async () => {
  let attempts = 0;
  let saved = 0;
  let advanced = 0;
  let authorized = false;
  const client = {
    async checkAuthorization() {
      return authorized;
    },
    async signInUserWithQrCode(_credentials: unknown, params: QrCodeAuthParams) {
      assert.ok(params.abortSignal);
      assert.equal(await params.password!('synthetic hint'), 'bad');
      attempts++;
      assert.equal(await params.onError(new Error('PASSWORD_HASH_INVALID')), false);
      assert.equal(await params.password!('synthetic hint'), 'good');
      attempts++;
      authorized = true;
    },
  } satisfies AuthClient;
  const ui = testTerminal(
    <Auth
      client={client}
      apiCredentials={credentials}
      persistSession={() => {
        saved++;
      }}
      onAuthenticated={() => {
        advanced++;
      }}
    />,
  );
  try {
    await ui.waitFor((frame) => frame.includes('Cloud password required'));
    await ui.press('bad');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('PASSWORD_HASH_INVALID') && frame.includes('Password: _'));
    await ui.press('good');
    await ui.press('\r');
    await ui.waitFor(() => advanced === 1);
    assert.equal(attempts, 2);
    assert.equal(saved, 1);
  } finally {
    await ui.close();
  }
});

for (const password of [false, true])
  test(`authentication cleanup aborts ${password ? 'password' : 'QR'} work and ignores late success`, async () => {
    let params!: QrCodeAuthParams;
    let saved = 0;
    let advanced = 0;
    let settled = false;
    let authorized = false;
    const client = {
      async checkAuthorization() {
        return authorized;
      },
      async signInUserWithQrCode(_credentials: unknown, value: QrCodeAuthParams) {
        params = value;
        if (password) await params.password!('test');
        else
          await new Promise<void>((resolve) =>
            params.abortSignal!.addEventListener('abort', () => resolve(), {once: true}),
          );
        settled = true;
        authorized = true;
      },
    } satisfies AuthClient;
    const ui = testTerminal(
      <Auth
        client={client}
        apiCredentials={credentials}
        persistSession={() => {
          saved++;
        }}
        onAuthenticated={() => {
          advanced++;
        }}
      />,
    );
    await ui.waitFor(() => Boolean(params));
    await ui.close();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(params.abortSignal!.aborted, true);
    assert.equal(settled, true);
    assert.equal(saved, 0);
    assert.equal(advanced, 0);
  });

test('an early account lookup failure waits for the in-flight dialog request before allowing Retry', async () => {
  const mock = fixture();
  let release!: () => void;
  let accounts = 0;
  mock.client.getMe = async () => {
    accounts++;
    throw new Error('Synthetic account failure');
  };
  mock.client.getDialogs = async () => {
    mock.calls.dialogs++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return [];
  };
  const ui = testTerminal(<App client={appClient(mock.client)} />);
  try {
    await ui.waitFor(() => mock.calls.dialogs === 1);
    await ui.press('r');
    await ui.press('r');
    assert.equal(accounts, 1);
    assert.equal(mock.calls.dialogs, 1);
    release();
    await ui.waitFor((frame) => frame.includes('Connecting failed'));
  } finally {
    release?.();
    await ui.close();
  }
});

test('a later reload error retains the unacknowledged deletion result in notice details', async () => {
  const mock = fixture();
  const getMessages = mock.client.getMessages;
  let failReload = false;
  mock.client.getMessages = async (entity, options) => {
    if (failReload && !options.ids) throw new Error('Synthetic reload failure');
    return getMessages(entity, options);
  };
  const ui = testTerminal(<App client={appClient(mock.client)} />);
  try {
    await ui.waitFor((frame) => frame.includes('/ 1 msgs'));
    await ui.press('A');
    await ui.waitFor((frame) => frame.includes('Type DELETE'));
    await ui.press('DELETE');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('1 verified absent') && !frame.includes('Loading history'));
    failReload = true;
    await ui.press('r');
    await ui.waitFor((frame) => frame.includes('ERROR:'));
    await ui.press('!');
    await ui.waitFor((frame) => frame.includes('NOTICE DETAILS'));
    assert.match(ui.frame(), /1 verified absent/);
    assert.match(ui.frame(), /Synthetic reload failure/);
    await ui.press('\x1b');
    await ui.press('\x1b');
    assert.ok(!ui.frame().includes('verified absent'));
  } finally {
    await ui.close();
  }
});
