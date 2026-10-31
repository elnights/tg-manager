import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('the npm tarball installs a working CLI with production dependencies only', {timeout: 180_000}, () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'tg-manager-package-'));
  const install = path.join(temporary, 'install');
  const run = (command, args, cwd = root) =>
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    run(npm, ['run', 'build']);
    const [packed] = JSON.parse(
      run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]),
    );
    const names = packed.files.map((file) => file.path);
    for (const name of names) {
      assert.ok(
        name === 'package.json' ||
          name === 'README.md' ||
          name === 'CONTRIBUTING.md' ||
          name === 'LICENSE' ||
          name === 'LICENSE.md' ||
          name === 'SECURITY.md' ||
          name === 'CHANGELOG.md' ||
          /^dist\/[\w-]+\.js$/.test(name) ||
          /^docs\/[\w-]+\.md$/.test(name),
        `unexpected package entry: ${name}`,
      );
    }
    for (const excluded of ['src/', 'test/', 'scripts/', '.github/', 'assets/']) {
      assert.ok(
        !names.some((name) => name === excluded || name.startsWith(excluded)),
        `exclude contributor material: ${excluded}`,
      );
    }
    assert.ok(names.includes('dist/cli.js'));
    assert.ok(names.includes('dist/index.js'));
    assert.ok(names.includes('dist/emoji-demo.js'));
    assert.ok(!names.includes('dist/login.js'), 'exclude the unused legacy login entry');
    assert.equal(packed.files.find((file) => file.path === 'dist/cli.js').mode & 0o111, 0o111);

    run(npm, [
      'install',
      '--prefix',
      install,
      '--no-save',
      '--package-lock=false',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(temporary, packed.filename),
    ]);
    const command = path.join(install, 'node_modules', '.bin', 'tg-manager');
    const {version, name} = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(run(command, ['--version'], install).trim(), version);
    const help = run(command, ['--help'], install);
    for (const option of ['--config', '--demo', '--version']) assert.ok(help.includes(option));
    assert.ok(help.includes('DELETE'));
    assert.equal(
      run(command, ['--config', path.join(temporary, 'absent-config'), '--help'], install),
      help,
      'help must not load credentials',
    );
    assert.ok(
      readFileSync(path.join(install, 'node_modules', name, 'dist', 'cli.js'), 'utf8').startsWith(
        '#!/usr/bin/env node\n',
      ),
    );
    for (const dependency of ['tsx', 'typescript', '@xterm/headless']) {
      assert.equal(
        existsSync(path.join(install, 'node_modules', dependency)),
        false,
        `${dependency} is development-only`,
      );
    }
    run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "await import('teleproto'); await import('qrcode-terminal'); await import('jpeg-js'); await import('open');",
      ],
      install,
    );
    const terminalCLI = (args, inputKey) =>
      run(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
      import {PassThrough} from 'node:stream';
      process.env.CI = 'false';
      process.env.CONTINUOUS_INTEGRATION = 'false';
      delete process.env.TG_API_ID;
      delete process.env.TG_API_HASH;
      const input = new PassThrough();
      input.isTTY = true;
      input.setRawMode = input.ref = input.unref = () => input;
      Object.defineProperty(process, 'stdin', {value: input});
      Object.defineProperty(process.stdout, 'isTTY', {value: true});
      process.stdout.columns = 80;
      process.stdout.rows = 24;
      process.argv = [process.execPath, ...${JSON.stringify(args)}];
      setTimeout(() => input.write(${JSON.stringify(inputKey)}), 250);
      await import(${JSON.stringify(pathToFileURL(command).href)});
    `,
        ],
        install,
      );
    const demo = terminalCLI(['--demo'], 'q');
    assert.ok(
      demo.includes('CHATS') && demo.includes('MESSAGES') && demo.includes('Sample'),
      'the installed offline demo must render using production dependencies',
    );
    const setup = terminalCLI([], '\x1b');
    assert.ok(setup.includes('API CREDENTIALS'), 'missing credentials must open the setup UI');
    assert.ok(!setup.includes('Connecting to Telegram'), 'cancelling setup must not connect to Telegram');
    const incomplete = path.join(temporary, 'incomplete-credentials.txt');
    writeFileSync(incomplete, 'UNRELATED=1\n');
    assert.throws(
      () => terminalCLI(['--config', incomplete], '\x1b'),
      (error) =>
        error.status === 1 &&
        error.stderr.includes('Invalid API credentials in the supplied configuration') &&
        !error.stdout.includes('API CREDENTIALS'),
    );
    const invalid = spawnSync(command, ['--unknown-option'], {cwd: install, encoding: 'utf8'});
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Unknown option/);
    const nonInteractive = spawnSync(command, [], {cwd: install, encoding: 'utf8'});
    assert.equal(nonInteractive.status, 1);
    assert.match(nonInteractive.stderr, /interactive terminal is required/);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
});
