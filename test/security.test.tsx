import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('secret review excludes protected contents and prints only finding locations', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'tg-manager-security-'));
  const script = fileURLToPath(new URL('../scripts/scan-secrets.mjs', import.meta.url));
  const scanner = path.join(root, 'fake-scanner.mjs');
  try {
    const git = (args: string[]) => execFileSync('git', args, {cwd: root, stdio: 'pipe'});
    git(['init', '--quiet']);
    fs.writeFileSync(path.join(root, 'public.ts'), 'export const synthetic = true;');
    fs.writeFileSync(path.join(root, '.env.example'), 'synthetic-protected-fixture');
    git(['add', 'public.ts', '.env.example']);
    git([
      '-c',
      'user.name=Synthetic',
      '-c',
      'user.email=synthetic@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'synthetic fixture',
    ]);
    fs.writeFileSync(
      scanner,
      `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'git') {
  const options = args[args.indexOf('--log-opts') + 1];
  if (!options.includes('exclude)**/.env') || !options.includes('exclude)**/.local/**')) process.exit(3);
} else if (fs.existsSync(path.join(args[1], '.env.example'))) process.exit(3);
// Simulate a scanner which includes sensitive fields in its report and logs.
const secret = 'synthetic-value-that-must-never-be-printed';
console.error(secret);
fs.writeFileSync(args[args.indexOf('--report-path') + 1], JSON.stringify([
  {File: 'public.ts', Commit: 'synthetic-commit', StartLine: 1, RuleID: 'synthetic-rule', Secret: secret, Match: secret},
]));
process.exit(1);
`,
      {mode: 0o700},
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env, GITLEAKS_BINARY: scanner},
    });
    assert.equal(result.status, 1);
    const output = result.stdout + result.stderr;
    assert.match(output, /Secret finding:.*public.ts.*synthetic-commit/);
    assert.ok(!output.includes('synthetic-value-that-must-never-be-printed'));
    assert.ok(!output.includes('could not complete'), 'both scans must run with the expected exclusions');
    assert.ok(!output.includes('synthetic-protected-fixture'));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
