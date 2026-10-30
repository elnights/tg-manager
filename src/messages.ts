import type {Api, TelegramClient} from 'teleproto';

export const PAGE = 100;
export type MessageView = 'mine' | 'all';
export type Message = {id: number; date: string; content: string; own: boolean; author: string};

function authorName(message: Api.Message): string {
  const sender = message.sender;
  if (sender) {
    if ('title' in sender && sender.title) return sender.title;
    if ('firstName' in sender) {
      const name = [sender.firstName, sender.lastName].filter(Boolean).join(' ');
      if (name) return name;
      if (sender.username) return `@${sender.username}`;
    }
  }
  return message.senderId ? `Sender ${message.senderId}` : 'Unknown sender';
}

export async function fetchMessagePage(client: TelegramClient, entity: any, selfId: string,
  view: MessageView, offsetId = 0): Promise<Message[]> {
  const found = await client.getMessages(entity, {limit: PAGE, offsetId,
    ...(view === 'mine' ? {fromUser: 'me'} : {})});
  return found.map(message => {
    // Telegram may omit from_id on outgoing private messages. Channel posts
    // can also be "outgoing", so that flag alone is not proof of authorship.
    const senderId = message.senderId?.toString();
    const own = view === 'mine' || senderId === selfId ||
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
  return messages.filter(message => message.own && (!selected || selected.has(message.id))).map(message => message.id);
}

// A successful deletion RPC only acknowledges a request. Check the exact IDs
// without a view/author filter before reporting any message as verified absent.
export async function absentMessageIds(client: TelegramClient, entity: any, ids: number[]): Promise<number[]> {
  const remaining = await client.getMessages(entity, {ids});
  const present = new Set(remaining.filter(message => message && String(message.className) !== 'MessageEmpty').map(message => message.id));
  return ids.filter(id => !present.has(id));
}
