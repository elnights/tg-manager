import {TelegramClient} from 'teleproto';
import {StringSession} from 'teleproto/sessions';
import {parseCredentials, type ApiCredentials} from './credentials.js';
import {loadCredentials} from './credentialStore.js';
import {loadSession, writeSession} from './session.js';

export function credentials({
  allowSaved = true,
  environment = process.env,
  readSaved = loadCredentials,
}: {
  allowSaved?: boolean;
  environment?: {TG_API_ID?: string; TG_API_HASH?: string};
  readSaved?: () => ApiCredentials | undefined;
} = {}) {
  const {TG_API_ID, TG_API_HASH} = environment;
  if (TG_API_ID !== undefined || TG_API_HASH !== undefined || !allowSaved)
    return parseCredentials(TG_API_ID ?? '', TG_API_HASH ?? '');
  const saved = readSaved();
  if (saved) return saved;
  return parseCredentials('', '');
}

export function makeClient({apiId, apiHash}: ApiCredentials = credentials()) {
  const session = loadSession();
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });
}

export function saveSession(client: TelegramClient) {
  writeSession(client.session.save() as string);
}
