import {boundedText} from './text.js';
import {Api} from 'teleproto';
import {getInputChannel, getPeerId} from 'teleproto/Utils.js';
import type {EntityLike} from 'teleproto/define.js';
import type {ApiCredentials, QrCodeAuthParams} from 'teleproto/client/methods/auth.js';
import type {DownloadMediaInterface} from 'teleproto/client/methods/downloads.js';

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
  peerId?: Api.TypePeer;
  replyTo?: object;
  fwdFrom?: object;
  replies?: {replies: number};
};
export type MessageOptions = {
  limit?: number;
  offsetId?: number;
  fromUser?: 'me';
  ids?: number[];
  replyTo?: number;
  topMsgId?: number;
};
export interface TelegramApi {
  downloadMedia?(
    media: Api.Message | Api.TypeMessageMedia,
    options: Pick<DownloadMediaInterface, 'thumb' | 'signal' | 'progressCallback'>,
  ): Promise<Buffer | string | undefined>;
  api?: {
    channels: {
      getFullChannel(options: {channel: Api.TypeInputChannel}): Promise<{
        fullChat: object;
        chats: readonly Api.TypeChat[];
      }>;
    };
    messages?: {
      getDiscussionMessage(options: {peer: Api.TypeInputPeer; msgId: number}): Promise<{
        messages: readonly MessageRecord[];
        chats: readonly Api.TypeChat[];
      }>;
    };
  };
  getMe(): Promise<Account>;
  iterDialogs(options: {limit?: number}): AsyncIterable<DialogRecord>;
  getMessages(entity: Entity, options: MessageOptions): Promise<readonly (MessageRecord | undefined)[]>;
  iterMessages(
    entity: Entity,
    options: {fromUser: 'me'; limit?: number; topMsgId?: number},
  ): AsyncIterable<MessageRecord>;
  deleteMessages(entity: Entity, ids: number[], options: {revoke: true}): Promise<unknown>;
}
export interface AuthClient {
  checkAuthorization(): Promise<boolean>;
  signInUserWithQrCode(credentials: ApiCredentials, params: QrCodeAuthParams): Promise<unknown>;
}
export type Chat = {
  id: string;
  title: string;
  entity: Entity;
  isPrivate: boolean;
  isBroadcast?: boolean;
  discussionFor?: string;
  type?: ChatType;
};
export const chatTypes = ['private', 'bot', 'group', 'supergroup', 'channel'] as const;
export type ChatType = (typeof chatTypes)[number];
export const chatTypeLabels: Record<ChatType, {symbol: string; label: string}> = {
  private: {symbol: 'P', label: 'Private conversations'},
  bot: {symbol: 'B', label: 'Bots'},
  group: {symbol: 'G', label: 'Basic groups'},
  supergroup: {symbol: 'S', label: 'Supergroups / forums'},
  channel: {symbol: 'C', label: 'Channels'},
};
export const defaultChatTypes: ReadonlySet<ChatType> = new Set(['group', 'supergroup', 'channel']);
export function chatType(chat: Chat): ChatType {
  return chat.type ?? (chat.isBroadcast ? 'channel' : chat.isPrivate ? 'private' : 'group');
}
export function chatsFromDialogs(dialogs: readonly DialogRecord[]): Chat[] {
  const seen = new Set<string>();
  return dialogs.flatMap((dialog) => {
    if (!dialog.entity || !dialog.id || !(dialog.isUser || dialog.isGroup || dialog.isChannel)) return [];
    const id = String(dialog.id);
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        title: dialog.title || '(untitled)',
        entity: dialog.entity,
        isPrivate: Boolean(dialog.isUser),
        type: dialog.isUser
          ? typeof dialog.entity === 'object' && 'bot' in dialog.entity && dialog.entity.bot
            ? 'bot'
            : 'private'
          : dialog.isChannel
            ? dialog.isGroup
              ? 'supergroup'
              : 'channel'
            : 'group',
        ...(dialog.isChannel && !dialog.isGroup ? {isBroadcast: true} : {}),
      },
    ];
  });
}

export function mergeChats(chats: readonly Chat[]): Chat[] {
  const seen = new Set<string>();
  return chats.filter((chat) => {
    if (seen.has(chat.id)) return false;
    seen.add(chat.id);
    return true;
  });
}

export async function discussionChat(
  client: Pick<TelegramApi, 'api'>,
  channel: Chat,
): Promise<Chat | undefined> {
  if (!channel.isBroadcast) return;
  if (!client.api) throw new Error('This client cannot resolve channel discussions.');
  const result = await client.api.channels.getFullChannel({channel: getInputChannel(channel.entity)});
  const linkedId = 'linkedChatId' in result.fullChat ? result.fullChat.linkedChatId : undefined;
  if (!linkedId || String(linkedId) === '0') return;
  // Use the returned entity (and its access hash), including groups not in
  // dialogs. Never fall back to the broadcast peer when resolution fails.
  const group = result.chats.find((chat) => String(chat.id) === String(linkedId));
  if (!(group instanceof Api.Channel) || !group.megagroup || group.min)
    throw new Error('The linked discussion group is unavailable.');
  return {
    id: getPeerId(group),
    title: `Discussion: ${channel.title} / ${group.title}`,
    entity: group,
    isPrivate: false,
    discussionFor: channel.id,
    type: 'supergroup',
  };
}
export function accountIdentity(account: Account): string {
  return `${boundedText([account.firstName, account.lastName].filter(Boolean).join(' ') || account.username || 'Account', 40)} (ID ${account.id})`;
}
