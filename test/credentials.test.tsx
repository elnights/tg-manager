import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import React from 'react';
import {credentialsPath, loadCredentials, saveCredentials} from '../src/credentialStore.js';
import {credentials} from '../src/client.js';
import type {ApiCredentials} from '../src/credentials.js';
import {CredentialPrompt} from '../src/CredentialPrompt.js';
import {sessionPaths} from '../src/session.js';
import {testTerminal} from './helpers/terminal.js';

const hexDigits = '0123456789abcdef';
const synthetic = {apiId: 12345, apiHash: hexDigits.repeat(2)};

async function fixture(run: (file: string, root: string) => void | Promise<void>) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'tg-manager-credentials-'));
  try {
    await run(path.join(root, 'data', 'credentials.json'), root);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

test('saved credentials use the session directory; a missing file creates nothing', () =>
  fixture((file) => {
    assert.equal(credentialsPath(), path.join(sessionPaths().directory, 'credentials.json'));
    assert.equal(loadCredentials(file), undefined);
    assert.equal(fs.existsSync(path.dirname(file)), false);
  }));

test('credential saves replace atomically, round-trip and tighten private permissions', () =>
  fixture((file) => {
    saveCredentials(synthetic, file);
    assert.deepEqual(loadCredentials(file), synthetic);
    fs.chmodSync(path.dirname(file), 0o755);
    fs.chmodSync(file, 0o644);
    assert.deepEqual(loadCredentials(file), synthetic);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    const replacement = {...synthetic, apiId: 54321};
    saveCredentials(replacement, file);
    assert.deepEqual(loadCredentials(file), replacement);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.json']);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }));

test('invalid credential files report a useful error without their contents', () =>
  fixture((file) => {
    fs.mkdirSync(path.dirname(file));
    for (const contents of [
      '',
      `{"apiHash":"${synthetic.apiHash}",`,
      'null',
      '[]',
      JSON.stringify({...synthetic, apiId: '12345'}),
      JSON.stringify({...synthetic, apiId: -1}),
      JSON.stringify({...synthetic, apiHash: 'synthetic-invalid-secret'}),
    ]) {
      fs.writeFileSync(file, contents);
      assert.throws(
        () => loadCredentials(file),
        (error) =>
          error instanceof Error &&
          error.message === 'Saved API credentials are invalid. Enter your API ID and hash again.',
      );
    }
  }));

test('invalid input creates no credential file and failed publication cleans temporary files', () =>
  fixture((file) => {
    assert.throws(() => saveCredentials({...synthetic, apiHash: 'invalid'}, file), /API hash/);
    assert.equal(fs.existsSync(path.dirname(file)), false);
    fs.mkdirSync(file, {recursive: true});
    assert.throws(() => saveCredentials(synthetic, file));
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credentials.json']);
    assert.throws(() => loadCredentials(file), /regular file/);
  }));

test('credential reads reject symlinks and saves never overwrite the link target', () =>
  fixture((file, root) => {
    const other = path.join(root, 'other.json');
    fs.writeFileSync(other, JSON.stringify(synthetic));
    fs.mkdirSync(path.dirname(file));
    fs.symlinkSync(other, file);
    assert.throws(() => loadCredentials(file), /regular file/);
    saveCredentials({...synthetic, apiId: 54321}, file);
    assert.equal(JSON.parse(fs.readFileSync(other, 'utf8')).apiId, synthetic.apiId);
    assert.equal(loadCredentials(file)?.apiId, 54321);
  }));

test('credential storage rejects a symlink directory', () =>
  fixture((file, root) => {
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    const target = path.join(other, 'credentials.json');
    fs.writeFileSync(target, JSON.stringify(synthetic));
    fs.symlinkSync(other, path.dirname(file));
    assert.throws(() => loadCredentials(file), /regular directory/);
    assert.throws(() => saveCredentials({...synthetic, apiId: 54321}, file), /regular directory/);
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).apiId, synthetic.apiId);
  }));

test('normal launches reuse saved credentials; explicit configuration and environment take priority', () => {
  assert.deepEqual(credentials({environment: {}, readSaved: () => synthetic}), synthetic);
  const readSaved = () => {
    assert.fail('explicit credentials must not load saved credentials');
  };
  const environment = {TG_API_ID: '54321', TG_API_HASH: synthetic.apiHash};
  for (const allowSaved of [true, false]) {
    assert.deepEqual(credentials({environment, allowSaved, readSaved}), {...synthetic, apiId: 54321});
    for (const incomplete of [{TG_API_ID: '12345'}, {TG_API_HASH: synthetic.apiHash}, {TG_API_ID: ''}])
      assert.throws(() => credentials({environment: incomplete, allowSaved, readSaved}), /API/);
  }
  assert.throws(() => credentials({environment: {}, allowSaved: false, readSaved}), /API ID/);
  assert.throws(() => credentials({environment: {}, readSaved: () => undefined}), /API ID/);
});

for (const choice of ['y', '\r'])
  test(`first setup saves only after ${choice === 'y' ? 'Y' : 'Enter'} and later launches reuse the pair`, () =>
    fixture(async (file) => {
      let submitted: ApiCredentials | undefined;
      let saves = 0;
      const ui = testTerminal(
        <CredentialPrompt
          initialId={String(synthetic.apiId)}
          persistCredentials={(value) => {
            saves++;
            saveCredentials(value, file);
          }}
          onSubmit={(value) => {
            submitted = value;
          }}
        />,
      );
      try {
        await ui.waitFor((frame) => frame.includes('API CREDENTIALS'));
        await ui.press(synthetic.apiHash);
        await ui.press('\r');
        await ui.waitFor((frame) => frame.includes('Save API credentials'));
        assert.equal(fs.existsSync(file), false);
        assert.equal(submitted, undefined);
        await ui.press(choice);
        await ui.press('y');
        assert.equal(saves, 1);
        assert.deepEqual(submitted, synthetic);
        assert.deepEqual(credentials({environment: {}, readSaved: () => loadCredentials(file)}), synthetic);
        assert.ok(ui.frames.every((frame) => !frame.includes(synthetic.apiHash)));
      } finally {
        await ui.close();
      }
    }));

for (const choice of ['n', '\x1b'])
  test(`declining or cancelling credential saving (${choice === 'n' ? 'N' : 'Esc'}) never writes`, () =>
    fixture(async (file) => {
      let submitted: ApiCredentials | undefined;
      const ui = testTerminal(
        <CredentialPrompt
          initialId={String(synthetic.apiId)}
          persistCredentials={() => assert.fail('must not save without consent')}
          onSubmit={(value) => {
            submitted = value;
          }}
        />,
      );
      try {
        await ui.waitFor((frame) => frame.includes('API CREDENTIALS'));
        await ui.press(synthetic.apiHash);
        await ui.press('\r');
        await ui.waitFor((frame) => frame.includes('Save API credentials'));
        await ui.press(choice);
        assert.deepEqual(submitted, choice === 'n' ? synthetic : undefined);
        assert.equal(fs.existsSync(file), false);
      } finally {
        await ui.close();
      }
    }));

for (const retry of [false, true])
  test(`failed credential saving shows a safe error and supports ${retry ? 'retry' : 'using once'}`, async () => {
    let submitted: ApiCredentials | undefined;
    let saves = 0;
    const ui = testTerminal(
      <CredentialPrompt
        initialId={String(synthetic.apiId)}
        persistCredentials={() => {
          if (++saves === 1) throw new Error(`Synthetic failure ${synthetic.apiHash}`);
        }}
        onSubmit={(value) => {
          submitted = value;
        }}
      />,
    );
    try {
      await ui.waitFor((frame) => frame.includes('API CREDENTIALS'));
      await ui.press(synthetic.apiHash);
      await ui.press('\r');
      await ui.press('y');
      await ui.waitFor((frame) => frame.includes('Could not save API credentials'));
      assert.equal(submitted, undefined);
      assert.ok(ui.frames.every((frame) => !frame.includes(synthetic.apiHash)));
      await ui.press(retry ? 'y' : 'n');
      assert.deepEqual(submitted, synthetic);
      assert.equal(saves, retry ? 2 : 1);
    } finally {
      await ui.close();
    }
  });
