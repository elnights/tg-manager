import fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

type Location = {platform?: NodeJS.Platform; home?: string; xdgDataHome?: string; cwd?: string};
export function sessionPaths({
  platform = process.platform,
  home = homedir(),
  xdgDataHome = process.env.XDG_DATA_HOME,
  cwd = process.cwd(),
}: Location = {}) {
  const root =
    platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : xdgDataHome && path.isAbsolute(xdgDataHome)
        ? xdgDataHome
        : path.join(home, '.local', 'share');
  const directory = path.join(root, 'tg-manager');
  return {
    directory,
    file: path.join(directory, 'session.txt'),
    legacy: path.join(cwd, '.local', 'session.txt'),
  };
}
type Paths = ReturnType<typeof sessionPaths>;

function privateDirectory(directory: string) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  if (!fs.lstatSync(directory).isDirectory())
    throw new Error('Session directory must be a regular directory.');
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

// Publish a complete private file atomically. Migration uses a hard link so a
// concurrent launch cannot replace a session that another process just saved.
function store(value: string, paths: Paths, overwrite: boolean) {
  privateDirectory(paths.directory);
  const temporary = path.join(paths.directory, `.session-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, value, {flag: 'wx', mode: 0o600});
    if (overwrite) fs.renameSync(temporary, paths.file);
    else fs.linkSync(temporary, paths.file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function migrateSession(paths: Paths = sessionPaths()): boolean {
  // lstat also treats an existing symlink as occupied; never follow/overwrite it.
  try {
    fs.lstatSync(paths.file);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let legacy: fs.Stats;
  try {
    legacy = fs.lstatSync(paths.legacy);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (!legacy.isFile()) return false;
  const value = fs.readFileSync(paths.legacy, 'utf8').trim();
  if (!value) return false;
  try {
    store(value, paths, false);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

export function loadSession(paths: Paths = sessionPaths()): string {
  migrateSession(paths);
  let file: fs.Stats;
  try {
    file = fs.lstatSync(paths.file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
  privateDirectory(paths.directory);
  if (!file.isFile()) throw new Error('Session must be a regular file.');
  if (process.platform !== 'win32') fs.chmodSync(paths.file, 0o600);
  return fs.readFileSync(paths.file, 'utf8').trim();
}

export function writeSession(value: string, paths: Paths = sessionPaths()): void {
  store(value, paths, true);
}
