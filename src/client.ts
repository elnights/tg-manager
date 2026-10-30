import {TelegramClient} from 'teleproto';
import {StringSession} from 'teleproto/sessions';
import {parseCredentials, type ApiCredentials} from './credentials.js';
import {loadSession, writeSession} from './session.js';

export function credentials() {
  return parseCredentials(process.env.TG_API_ID ?? '', process.env.TG_API_HASH ?? '');
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
