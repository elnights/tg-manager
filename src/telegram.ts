import {boundedText} from './text.js';
import type {EntityLike} from 'teleproto/define.js';
import type {ApiCredentials, QrCodeAuthParams} from 'teleproto/client/methods/auth.js';

export type Entity = EntityLike;
type Identifier = {toString(): string};
export type Account = {id: Identifier; firstName?: string; lastName?: string; username?: string};
export type DialogRecord = {
  id?: Identifier;
  title?: string;
  entity?: Entity;
  isUser?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
};
export type MessageRecord = {
  id: number;
  date?: number;
  message?: string;
  media?: unknown;
  senderId?: Identifier;
  sender?: object;
  isPrivate?: boolean;
  out?: boolean;
  className?: string;
};
export type MessageOptions = {limit?: number; offsetId?: number; fromUser?: 'me'; ids?: number[]};
export interface TelegramApi {
  getMe(): Promise<Account>;
  iterDialogs(options: {limit?: number}): AsyncIterable<DialogRecord>;
  getMessages(entity: Entity, options: MessageOptions): Promise<readonly (MessageRecord | undefined)[]>;
  iterMessages(entity: Entity, options: {fromUser: 'me'; limit?: number}): AsyncIterable<MessageRecord>;
  deleteMessages(entity: Entity, ids: number[], options: {revoke: true}): Promise<unknown>;
}
export interface AuthClient {
  checkAuthorization(): Promise<boolean>;
  signInUserWithQrCode(credentials: ApiCredentials, params: QrCodeAuthParams): Promise<unknown>;
}
export type Chat = {id: string; title: string; entity: Entity; isPrivate: boolean};
export function chatsFromDialogs(dialogs: readonly DialogRecord[]): Chat[] {
  const seen = new Set<string>();
  return dialogs.flatMap((dialog) => {
    if (!dialog.entity || !dialog.id || !(dialog.isUser || dialog.isGroup || dialog.isChannel)) return [];
    const id = String(dialog.id);
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {id, title: dialog.title || '(untitled)', entity: dialog.entity, isPrivate: Boolean(dialog.isUser)},
    ];
  });
}
export function accountIdentity(account: Account): string {
  return `${boundedText([account.firstName, account.lastName].filter(Boolean).join(' ') || account.username || 'Account', 40)} (ID ${account.id})`;
}
