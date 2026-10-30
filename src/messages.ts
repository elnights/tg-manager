import type {Entity, MessageRecord, TelegramApi} from './telegram.js';

export const PAGE = 100;
export type MessageView = 'mine' | 'all';
export type Message = {id: number; date: string; content: string; own: boolean; author: string};

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
  return found
    .filter((message): message is MessageRecord => Boolean(message))
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
      };
    });
}

export function ownMessageIds(messages: Message[], selected?: ReadonlySet<number>): number[] {
  return messages
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
