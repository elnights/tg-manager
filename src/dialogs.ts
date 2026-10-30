import {chatsFromDialogs, type Chat, type DialogRecord} from './telegram.js';
import type {Cancellation} from './operations.js';

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
