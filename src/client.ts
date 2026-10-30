import fs from 'node:fs';
import path from 'node:path';
import {TelegramClient} from 'teleproto';
import {StringSession} from 'teleproto/sessions';
import {parseCredentials, type ApiCredentials} from './credentials.js';

export const dataDir = path.resolve('.local');
const sessionFile = path.join(dataDir, 'session.txt');

export function credentials() {
  return parseCredentials(process.env.TG_API_ID ?? '', process.env.TG_API_HASH ?? '');
}

export function makeClient({apiId, apiHash}: ApiCredentials = credentials()) {
  const session = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, 'utf8').trim() : '';
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });
}

export function saveSession(client: TelegramClient) {
  fs.mkdirSync(dataDir, {recursive: true, mode: 0o700});
  fs.writeFileSync(sessionFile, client.session.save() as string, {mode: 0o600});
  fs.chmodSync(sessionFile, 0o600);
}
