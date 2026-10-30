import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';

const git = args => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
const protectedPath = file => file.split('/').some(part => part === '.local' || part === '.env' || part.startsWith('.env.'));
const privateName = file => (protectedPath(file) && path.basename(file) !== '.env.example') ||
  /(?:^|\/)(?:session\.txt|[^/]+\.session(?:-journal)?|[^/]+\.log|result\.json|messages\.json|chat-export[^/]*)$/i.test(file);
const logOptions = '--all --full-history -- . :(glob,exclude)**/.env :(glob,exclude)**/.env.* :(glob,exclude)**/.local/**';
const temporary = fs.mkdtempSync(path.join(tmpdir(), 'tg-manager-secret-review-'));
let failed = false;
try {
  // Filename-only checks include protected paths, without reading their blobs.
  let commit = 'working tree';
  const metadata = git(['log', '--all', '--full-history', '--format=commit:%H', '--name-only']);
  for (const line of metadata.split('\n')) {
    if (line.startsWith('commit:')) {commit = line.slice(7); continue;}
    if (line && privateName(line)) {
      console.error(`Private filename: ${JSON.stringify(line)} at ${commit} (contents not inspected)`);
      failed = true;
    }
  }
  const snapshot = path.join(temporary, 'tracked');
  fs.mkdirSync(snapshot, {mode: 0o700});
  for (const file of git(['ls-files', '--cached', '-z']).split('\0').filter(Boolean)) {
    if (privateName(file)) {console.error(`Private tracked filename: ${JSON.stringify(file)} (contents not inspected)`); failed = true;}
    if (protectedPath(file)) continue;
    // Deleted files and symlinks are never read, nor are untracked/local files.
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
    const destination = path.join(snapshot, file);
    fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
    fs.copyFileSync(file, destination);
  }
  for (const [name, args] of [['history', ['git', '--log-opts', logOptions, '.']], ['tracked', ['dir', snapshot]]]) {
    const report = path.join(temporary, `${name}.json`);
    const result = spawnSync(process.env.GITLEAKS_BINARY || 'gitleaks', [...args,
      '--config', path.resolve('.gitleaks.toml'), '--redact=100', '--no-banner', '--no-color',
      '--log-level', 'error', '--report-format', 'json', '--report-path', report], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
    // Never forward scanner logs, source lines, matches or secret fields. Reports
    // stay local and temporary; CI publishes no artifacts or PR comments.
    if (result.error || (result.status !== 0 && result.status !== 1) || !fs.existsSync(report)) {
      console.error(`Secret scan (${name}) could not complete. Install Gitleaks 8.30.1 and retry.`);
      failed = true;
      continue;
    }
    for (const finding of JSON.parse(fs.readFileSync(report, 'utf8'))) {
      console.error(`Secret finding: ${JSON.stringify({path: path.relative(snapshot, finding.File).startsWith('..') ? finding.File : path.relative(snapshot, finding.File),
        commit: finding.Commit || 'working tree', line: finding.StartLine, rule: finding.RuleID})}`);
      failed = true;
    }
    if (result.status !== 0) failed = true;
  }
  console.log(failed ? 'Secret review failed; only finding locations are shown.' : 'Secret review passed: reachable history and tracked files; protected contents excluded.');
} finally {fs.rmSync(temporary, {recursive: true, force: true});}
process.exitCode = failed ? 1 : 0;
