import {getPeerId} from 'teleproto/Utils.js';
import type {Chat, Entity, MessageRecord, TelegramApi} from './telegram.js';
import {attachmentFor, type Attachment} from './media.js';

export const PAGE = 100;
export type MessageView = 'mine' | 'all';
export type Message = {
  id: number;
  date: string;
  content: string;
  own: boolean;
  author: string;
  context?: string;
  sourcePostId?: number;
  groupedId?: string;
  comments?: number;
  attachment?: Attachment;
  album?: readonly Message[];
};

export function messageItems(message: Message): readonly Message[] {
  return message.album ?? [message];
}

// Histories and cursors retain individual messages. Only the visible rows are
// grouped, so pagination and verified deletion keep their original ID space.
export function messageRows(messages: readonly Message[]): Message[] {
  const albums = new Map<string, Message[]>();
  for (const message of messages) {
    if (!message.groupedId) continue;
    const items = albums.get(message.groupedId) ?? [];
    items.push(message);
    albums.set(message.groupedId, items);
  }
  const seen = new Set<string>();
  return messages.flatMap((message) => {
    if (!message.groupedId) return [message];
    if (seen.has(message.groupedId)) return [];
    seen.add(message.groupedId);
    const items = albums.get(message.groupedId)!.sort((a, b) => a.id - b.id);
    const first = items[0]!;
    const captions = items.filter((item) => item.content !== '[media]' && item.content !== '[service]');
    const comments = items.find((item) => item.comments !== undefined)?.comments;
    const authors = new Set(items.map((item) => item.author));
    return [
      {
        ...first,
        id: message.id,
        album: items,
        content: captions.map((item) => item.content).join('\n') || '[media]',
        own: items.some((item) => item.own),
        author: authors.size === 1 ? first.author : 'Multiple authors',
        ...(comments === undefined ? {} : {comments}),
      },
    ];
  });
}

export async function albumRecords(
  client: Pick<TelegramApi, 'getMessages'>,
  chat: Pick<Chat, 'id' | 'entity'>,
  postId: number,
  groupedId: string,
): Promise<MessageRecord[]> {
  const ids = Array.from({length: 19}, (_, index) => postId - 9 + index).filter((id) => id > 0);
  const records = await client.getMessages(chat.entity, {ids});
  return records
    .filter((record): record is MessageRecord =>
      Boolean(
        record &&
        record.className !== 'MessageEmpty' &&
        ids.includes(record.id) &&
        (!record.peerId || getPeerId(record.peerId) === chat.id) &&
        record.groupedId?.toString() === groupedId,
      ),
    )
    .sort((a, b) => a.id - b.id);
}

export async function hasOwnMessages(
  client: Pick<TelegramApi, 'getMessages'>,
  entity: Entity,
): Promise<boolean> {
  const messages = await client.getMessages(entity, {limit: 1, fromUser: 'me'});
  return messages.some((message) => message && message.className !== 'MessageEmpty');
}

function authorName(message: MessageRecord): string {
  const sender = message.sender;
  if (sender) {
    if ('title' in sender && sender.title) return String(sender.title);
    if ('firstName' in sender) {
      const name = [sender.firstName, 'lastName' in sender ? sender.lastName : ''].filter(Boolean).join(' ');
      if (name) return name;
      if ('username' in sender && sender.username) return `@${sender.username}`;
    }
  }
  return message.senderId ? `Sender ${message.senderId}` : 'Unknown sender';
}

export async function fetchMessagePage(
  client: Pick<TelegramApi, 'getMessages'>,
  entity: Entity,
  selfId: string,
  view: MessageView,
  offsetId = 0,
): Promise<Message[]> {
  const found = await client.getMessages(entity, {
    limit: PAGE,
    offsetId,
    ...(view === 'mine' ? {fromUser: 'me'} : {}),
  });
  return messageRecords(found, selfId, view);
}

export function messageRecords(
  found: readonly (MessageRecord | undefined)[],
  selfId: string,
  view: MessageView,
): Message[] {
  return found
    .filter((message): message is MessageRecord => Boolean(message && message.className !== 'MessageEmpty'))
    .map((message) => {
      // Telegram may omit from_id on outgoing private messages. Channel posts
      // can also be "outgoing", so that flag alone is not proof of authorship.
      const senderId = message.senderId?.toString();
      const own =
        view === 'mine' ||
        senderId === selfId ||
        (!senderId && message.isPrivate === true && message.out === true);
      return {
        id: message.id,
        date: message.date ? new Date(message.date * 1000).toLocaleString() : '',
        content: message.message || (message.media ? '[media]' : '[service]'),
        own,
        author: own ? 'You' : authorName(message),
        ...(message.groupedId ? {groupedId: message.groupedId.toString()} : {}),
        ...(message.media ? {attachment: attachmentFor(message)} : {}),
        ...(message.replies ? {comments: message.replies.replies} : {}),
      };
    });
}

export function ownMessageIds(messages: readonly Message[], selected?: ReadonlySet<number>): number[] {
  return messages
    .flatMap(messageItems)
    .filter((message) => message.own && (!selected || selected.has(message.id)))
    .map((message) => message.id);
}

// A successful deletion RPC only acknowledges a request. Check the exact IDs
// without a view/author filter before reporting any message as verified absent.
export async function absentMessageIds(
  client: Pick<TelegramApi, 'getMessages'>,
  entity: Entity,
  ids: number[],
): Promise<number[]> {
  const remaining = await client.getMessages(entity, {ids});
  const present = new Set(
    remaining
      .filter((message): message is MessageRecord =>
        Boolean(message && String(message.className) !== 'MessageEmpty'),
      )
      .map((message) => message.id),
  );
  return ids.filter((id) => !present.has(id));
}
