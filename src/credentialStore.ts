import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseCredentials, type ApiCredentials} from './credentials.js';
import {sessionPaths} from './session.js';

export function credentialsPath() {
  return path.join(sessionPaths().directory, 'credentials.json');
}

function privateDirectory(directory: string) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  if (!fs.lstatSync(directory).isDirectory())
    throw new Error('Credentials directory must be a regular directory.');
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

export function loadCredentials(file = credentialsPath()): ApiCredentials | undefined {
  let info: fs.Stats;
  try {
    info = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (!info.isFile()) throw new Error('Saved credentials must be a regular file.');
  privateDirectory(path.dirname(file));
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  const contents = fs.readFileSync(file, 'utf8');
  try {
    const value: unknown = JSON.parse(contents);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('apiId' in value) ||
      typeof value.apiId !== 'number' ||
      !('apiHash' in value) ||
      typeof value.apiHash !== 'string'
    )
      throw new Error('Invalid credentials');
    return parseCredentials(String(value.apiId), value.apiHash);
  } catch {
    throw new Error('Saved API credentials are invalid. Enter your API ID and hash again.');
  }
}

export function saveCredentials(credentials: ApiCredentials, file = credentialsPath()): void {
  const validated = parseCredentials(String(credentials.apiId), credentials.apiHash);
  const directory = path.dirname(file);
  privateDirectory(directory);
  const temporary = path.join(directory, `.credentials-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(validated) + '\n', {flag: 'wx', mode: 0o600});
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}
