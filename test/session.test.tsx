import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {loadSession, migrateSession, sessionPaths, writeSession} from '../src/session.js';

test('session location is stable across working directories on macOS and Linux', () => {
  const mac = sessionPaths({platform: 'darwin', home: '/home/test', cwd: '/one', xdgDataHome: '/ignored'});
  assert.equal(mac.file, '/home/test/Library/Application Support/tg-manager/session.txt');
  const linux = sessionPaths({platform: 'linux', home: '/home/test', cwd: '/one', xdgDataHome: '/data'});
  assert.equal(linux.file, '/data/tg-manager/session.txt');
  for (const xdgDataHome of ['', 'relative/data'])
    assert.equal(
      sessionPaths({platform: 'linux', home: '/home/test', xdgDataHome}).file,
      '/home/test/.local/share/tg-manager/session.txt',
    );
  for (const platform of ['darwin', 'linux'] as const) {
    const options = {platform, home: '/home/test', xdgDataHome: ''};
    assert.equal(sessionPaths({...options, cwd: '/one'}).file, sessionPaths({...options, cwd: '/two'}).file);
  }
});

function fixture(run: (paths: ReturnType<typeof sessionPaths>, root: string) => void) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'tg-manager-session-'));
  try {
    run(
      sessionPaths({
        platform: 'linux',
        home: root,
        xdgDataHome: path.join(root, 'data'),
        cwd: path.join(root, 'checkout'),
      }),
      root,
    );
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

test('missing and empty legacy sessions do not create a new session', () =>
  fixture((paths) => {
    assert.equal(loadSession(paths), '');
    assert.equal(fs.existsSync(paths.directory), false);
    fs.mkdirSync(path.dirname(paths.legacy), {recursive: true});
    fs.writeFileSync(paths.legacy, '  \n');
    assert.equal(migrateSession(paths), false);
    assert.equal(fs.existsSync(paths.file), false);
  }));

test('migration copies a synthetic session privately, leaves the original and never overwrites', () =>
  fixture((paths) => {
    fs.mkdirSync(path.dirname(paths.legacy), {recursive: true});
    fs.writeFileSync(paths.legacy, 'synthetic-legacy\n', {mode: 0o644});
    assert.equal(migrateSession(paths), true);
    assert.equal(loadSession(paths), 'synthetic-legacy');
    assert.equal(fs.readFileSync(paths.legacy, 'utf8'), 'synthetic-legacy\n');
    fs.writeFileSync(paths.legacy, 'synthetic-second');
    assert.equal(migrateSession(paths), false);
    assert.equal(loadSession(paths), 'synthetic-legacy');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(paths.directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(paths.file).mode & 0o777, 0o600);
    }
    assert.deepEqual(fs.readdirSync(paths.directory), ['session.txt']);
  }));

test('existing destination wins without inspecting an invalid legacy source', () =>
  fixture((paths) => {
    writeSession('synthetic-existing', paths);
    fs.mkdirSync(paths.legacy, {recursive: true});
    assert.equal(migrateSession(paths), false);
    assert.equal(loadSession(paths), 'synthetic-existing');
  }));

test('saving replaces atomically and tightens existing directory/file permissions', () =>
  fixture((paths) => {
    writeSession('synthetic-first', paths);
    fs.chmodSync(paths.directory, 0o755);
    fs.chmodSync(paths.file, 0o644);
    assert.equal(loadSession(paths), 'synthetic-first');
    writeSession('synthetic-next', paths);
    assert.equal(loadSession(paths), 'synthetic-next');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(paths.directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(paths.file).mode & 0o777, 0o600);
    }
  }));

test('migration skips symlink sources and refuses symlink destinations', () =>
  fixture((paths, root) => {
    const other = path.join(root, 'other');
    fs.writeFileSync(other, 'synthetic-other');
    fs.mkdirSync(path.dirname(paths.legacy), {recursive: true});
    fs.symlinkSync(other, paths.legacy);
    assert.equal(migrateSession(paths), false);
    fs.mkdirSync(paths.directory, {recursive: true});
    fs.symlinkSync(other, paths.file);
    assert.throws(() => loadSession(paths), /regular file/);
    assert.equal(fs.readFileSync(other, 'utf8'), 'synthetic-other');
    fs.unlinkSync(other);
    assert.equal(migrateSession(paths), false, 'a dangling destination symlink also wins');
    assert.throws(() => loadSession(paths), /regular file/);
  }));
