import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {DEFAULT_CHAT_PERCENT} from './ui.js';

export interface SettingsStore {
  read(): number;
  write(chatPercent: number): void;
}
export function validChatPercent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 70
    ? value
    : DEFAULT_CHAT_PERCENT;
}
export const settingsStore: SettingsStore = {
  read() {
    try {
      return validChatPercent(
        JSON.parse(readFileSync(join(homedir(), '.config', 'tg-manager', 'settings.json'), 'utf8'))
          .chatPercent,
      );
    } catch {
      return DEFAULT_CHAT_PERCENT;
    }
  },
  write(chatPercent) {
    const file = join(homedir(), '.config', 'tg-manager', 'settings.json');
    mkdirSync(dirname(file), {recursive: true, mode: 0o700});
    writeFileSync(file, JSON.stringify({chatPercent}, null, 2) + '\n', {mode: 0o600});
  },
};
