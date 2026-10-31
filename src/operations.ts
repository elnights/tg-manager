import {describeError} from './errors.js';
import {absentMessageIds, ownMessageIds, PAGE, type Message} from './messages.js';
import type {Entity, TelegramApi} from './telegram.js';

export type Cancellation = {readonly cancelled: boolean};
export type History = {items: Message[]; cursor: number; more: boolean};
function appendTo(history: History, page: Message[], seen: Set<number>): void {
  const unique = page.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const cursor = page.at(-1)?.id ?? history.cursor;
  const more = page.length === PAGE;
  if ((page.length && history.cursor && cursor >= history.cursor) || (more && !unique.length)) {
    throw new Error('Pagination did not advance; reload to retry.');
  }
  history.items.push(...unique);
  history.cursor = cursor;
  history.more = more;
}
export function appendPage(initial: History, page: Message[]): History {
  const history = {...initial, items: [...initial.items]};
  appendTo(history, page, new Set(initial.items.map((item) => item.id)));
  return history;
}

export async function loadMessageHistory(
  initial: History,
  fetch: (cursor: number) => Promise<Message[]>,
  task: Cancellation,
  publish: (history: History) => void,
  singlePage = false,
): Promise<History> {
  const history = {...initial, items: [...initial.items]};
  const seen = new Set(history.items.map((item) => item.id));
  let lastUpdate = 0;
  const snapshot = () => ({...history, items: [...history.items]});
  try {
    while (history.more && !task.cancelled) {
      appendTo(history, await fetch(history.cursor), seen);
      if (Date.now() - lastUpdate >= 120) {
        publish(snapshot());
        lastUpdate = Date.now();
      }
      if (singlePage) break;
    }
    return snapshot();
  } finally {
    publish(snapshot());
  }
}

export async function scanOwnMessages(
  client: Pick<TelegramApi, 'iterMessages'>,
  entity: Entity,
  task: Cancellation,
  update: (count: number) => void,
  topMsgId?: number,
): Promise<number[]> {
  const ids = new Set<number>();
  const source = client.iterMessages(entity, {
    fromUser: 'me',
    limit: undefined,
    ...(topMsgId === undefined ? {} : {topMsgId}),
  });
  const iterator = source[Symbol.asyncIterator]();
  try {
    // Check before requesting another item: iterator.next() can start an RPC.
    while (!task.cancelled) {
      const next = await iterator.next();
      if (next.done || task.cancelled) break;
      ids.add(next.value.id);
      update(ids.size);
    }
  } finally {
    await iterator.return?.();
  }
  return [...ids];
}

export type DeletionResult = {
  requested: number;
  verified: number;
  total: number;
  cancelled: boolean;
  failure?: unknown;
};
export async function deleteOwnMessages(
  client: Pick<TelegramApi, 'deleteMessages' | 'getMessages'>,
  target: {entity: Entity; ids: readonly number[]},
  task: Cancellation,
  publish: (absent: ReadonlySet<number>, result: DeletionResult) => void,
): Promise<DeletionResult> {
  const ids = [...new Set(target.ids)];
  const entity = target.entity;
  const result: DeletionResult = {requested: 0, verified: 0, total: ids.length, cancelled: false};
  try {
    for (let index = 0; index < ids.length && !task.cancelled; index += PAGE) {
      const batch = ids.slice(index, index + PAGE);
      await client.deleteMessages(entity, batch, {revoke: true});
      result.requested += batch.length;
      publish(new Set(), {...result});
      // Cancellation never skips verification of an acknowledged batch.
      const absent = new Set(await absentMessageIds(client, entity, batch));
      result.verified += absent.size;
      publish(absent, {...result});
      if (absent.size !== batch.length)
        throw new Error('Some requested messages are still present; reload and verify before retrying.');
    }
  } catch (failure) {
    result.failure = failure;
  }
  result.cancelled = task.cancelled;
  return result;
}
export function deletionSummary(result: DeletionResult): string {
  return `${result.cancelled ? 'Stopped. ' : ''}${result.requested} / ${result.total} requested; ${result.verified} verified absent.${
    result.failure
      ? ` ${describeError(result.failure)} An unsuccessful request may still have taken effect.`
      : ''
  }`;
}
export function selectedOwn(history: History): Set<number> {
  return new Set(ownMessageIds(history.items));
}
