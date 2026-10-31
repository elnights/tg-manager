import {chatsFromDialogs, discussionChat, mergeChats, type Chat, type DialogRecord} from './telegram.js';
import type {Cancellation} from './operations.js';
import {hasOwnMessages} from './messages.js';
import type {TelegramApi} from './telegram.js';

export async function checkOwnChats(
  client: Pick<TelegramApi, 'getMessages' | 'api'>,
  chats: readonly Chat[],
  task: Cancellation,
  update: (checked: number, total: number) => void,
): Promise<{ids: Set<string>; chats: Chat[]; complete: boolean; failure?: unknown}> {
  const ids = new Set<string>();
  const found = mergeChats(chats);
  const probes = new Map<string, boolean>();
  const probe = async (chat: Chat) => {
    if (!probes.has(chat.id)) probes.set(chat.id, await hasOwnMessages(client, chat.entity));
    return probes.get(chat.id)!;
  };
  let checked = 0;
  try {
    for (const chat of found) {
      if (task.cancelled) break;
      let own = await probe(chat);
      if (!own && chat.isBroadcast && !task.cancelled) {
        const discussion = await discussionChat(client, chat);
        if (discussion && !task.cancelled) own = await probe(discussion);
      }
      if (own) ids.add(chat.id);
      update(++checked, found.length);
    }
    return {ids, chats: found, complete: checked === found.length && !task.cancelled};
  } catch (failure) {
    return {ids, chats: found, complete: false, failure};
  }
}

export async function hasOwnChatMessages(
  client: Pick<TelegramApi, 'getMessages' | 'api'>,
  chat: Chat,
  task: Cancellation,
): Promise<boolean | undefined> {
  if (await hasOwnMessages(client, chat.entity)) return true;
  if (task.cancelled) return undefined;
  if (!chat.isBroadcast) return false;
  const group = await discussionChat(client, chat);
  if (task.cancelled) return undefined;
  return group ? hasOwnMessages(client, group.entity) : false;
}

export const DIALOG_PAGE = 100;
export type DialogSource = {iterDialogs(options: {limit?: number}): AsyncIterable<DialogRecord>};
export function createDialogPager(client: DialogSource) {
  // Retain Teleproto's iterator, including its date/id/peer cursor and pinned
  // handling. Recreating getDialogs with only offsetId would skip conversations.
  const iterator = client.iterDialogs({limit: undefined})[Symbol.asyncIterator]();
  const seen = new Set<string>();
  let exhausted = false;
  let failed = false;
  return {
    async next(task: Cancellation): Promise<{chats: Chat[]; more: boolean}> {
      if (failed) throw new Error('Chat pagination stopped; press R to reload chats.');
      const records: DialogRecord[] = [];
      try {
        while (!exhausted && records.length < DIALOG_PAGE && !task.cancelled) {
          const item = await iterator.next();
          if (item.done) {
            exhausted = true;
            break;
          }
          records.push(item.value);
        }
        const chats = chatsFromDialogs(records).filter((chat) => {
          if (seen.has(chat.id)) return false;
          seen.add(chat.id);
          return true;
        });
        if (records.length === DIALOG_PAGE && !chats.length)
          throw new Error('Chat pagination did not advance; press R to reload chats.');
        return {chats, more: !exhausted};
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    async close() {
      await iterator.return?.();
    },
  };
}
