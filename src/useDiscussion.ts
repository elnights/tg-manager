import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {discussionChat, type Chat, type TelegramApi} from './telegram.js';
import {
  discussionThread,
  fetchDiscussionPage,
  type DiscussionTarget,
  type DiscussionContext,
} from './discussions.js';
import {appendPage, type Cancellation, type History} from './operations.js';
import {albumRecords, type Message, type MessageView} from './messages.js';
import {describeError} from './errors.js';
import {BrowseCache, BROWSE_DELAY} from './browseCache.js';

export type DiscussionFilter = {view: MessageView; toggleView: () => void};

type Pane = {
  key: string;
  history: History;
  selected: Set<number>;
  messageIndex: number;
  status: 'waiting' | 'loading' | 'ready' | 'error' | 'none' | 'stopped';
  target?: DiscussionTarget;
  error?: string;
};
function empty(key: string): Pane {
  return {
    key,
    history: {items: [], cursor: 0, more: false},
    selected: new Set(),
    messageIndex: 0,
    status: 'waiting',
  };
}

export function useDiscussion(
  client: TelegramApi,
  channel: Chat | undefined,
  selfId: string,
  post: Message | undefined,
  options: {cache?: BrowseCache; scope?: 'group' | 'post'; enabled?: boolean; filter?: DiscussionFilter} = {},
) {
  const cache = useMemo(() => options.cache ?? new BrowseCache(client), [options.cache, client]);
  const [scope, setScope] = useState<'group' | 'post'>(options.scope ?? 'group');
  const [localView, setView] = useState<MessageView>('mine');
  const view = options.filter?.view ?? localView;
  const [revision, setRevision] = useState(0);
  const [stored, setStored] = useState<Pane>(() => empty(''));
  const sourceId = channel?.id;
  const entity = channel?.entity;
  const selectedPostId = scope === 'post' ? post?.id : undefined;
  const groupedId = scope === 'post' ? post?.groupedId : undefined;
  const historyKey = cache.key(
    'discussion',
    selfId,
    sourceId,
    scope,
    groupedId ? `album:${groupedId}` : selectedPostId,
    view,
  );
  const key = cache.key(historyKey, revision);
  const currentKey = useRef(key);
  currentKey.current = key;
  const contexts = useRef(new Map<string, Map<number, DiscussionContext>>());
  const labels = useCallback(
    (peer: string) => {
      const contextKey = cache.key(peer, sourceId);
      let found = contexts.current.get(contextKey);
      if (!found) {
        found = new Map();
        contexts.current.set(contextKey, found);
        if (contexts.current.size > 24) contexts.current.delete(contexts.current.keys().next().value!);
      }
      return found;
    },
    [cache, sourceId],
  );
  const page = useCallback(
    (target: DiscussionTarget, cursor: number, task: Cancellation) =>
      cache.read(
        cache.key('discussion-page', selfId, sourceId, target.chat.id, target.rootId, view, cursor),
        (shared) => fetchDiscussionPage(client, target, selfId, view, cursor, labels(target.chat.id), shared),
        task,
      ),
    [cache, client, selfId, sourceId, view, labels],
  );
  const immediate = useRef(false);
  const cancelRef = useRef<(() => void) | undefined>(undefined);
  const pane = stored.key === key ? stored : empty(key);
  const enabled = options.enabled !== false;
  useEffect(() => {
    // Retire the previous marks even if navigation returns before a read starts.
    setStored((previous) => (previous.key === key ? previous : empty(key)));
    if (!sourceId || !entity || !selfId || !enabled) return;
    let disposed = false;
    const task = {cancelled: false};
    cancelRef.current = () => {
      task.cancelled = true;
    };
    const publish = (next: Pane) => {
      if (!disposed && currentKey.current === key) setStored(next);
    };
    const saved = cache.history(historyKey);
    const groupKey = cache.key('group', selfId, sourceId);
    const threadKey = (peer: string) =>
      cache.key('thread', selfId, sourceId, peer, groupedId ? `album:${groupedId}` : selectedPostId);
    const cachedGroup = cache.value<Chat | null>(groupKey);
    const canRestore = saved && cachedGroup && (scope === 'group' || cache.has(threadKey(cachedGroup.id)));
    const timer = setTimeout(
      () => {
        if (task.cancelled) {
          publish({...empty(key), status: 'stopped'});
          return;
        }
        publish({...empty(key), status: 'loading'});
        void (async () => {
          let target: DiscussionTarget | undefined;
          try {
            const group = await cache.read(
              groupKey,
              async () => (await discussionChat(client, channel)) ?? null,
              task,
            );
            if (disposed || currentKey.current !== key) return;
            if (task.cancelled) {
              publish({...empty(key), status: 'stopped'});
              return;
            }
            if (!group) {
              publish({...empty(key), status: 'none'});
              return;
            }
            if (scope === 'post' && selectedPostId === undefined) {
              publish({...empty(key), status: 'ready', error: 'Highlight a post to show its discussion.'});
              return;
            }
            target =
              scope === 'post'
                ? await cache.read(
                    threadKey(group.id),
                    (shared) =>
                      discussionThread(
                        client,
                        channel,
                        group,
                        selectedPostId!,
                        groupedId,
                        shared,
                        (api, chat, id, album) =>
                          cache.read(
                            cache.key('album', selfId, chat.id, album),
                            () => albumRecords(api, chat, id, album),
                            shared,
                          ),
                      ),
                    task,
                  )
                : {chat: group};
            if (disposed || currentKey.current !== key) return;
            if (task.cancelled) {
              publish({...empty(key), status: 'stopped'});
              return;
            }
            if (!target) {
              publish({
                ...empty(key),
                status: 'ready',
                error:
                  'No accessible discussion for this post. Comments may be disabled or the discussion post removed.',
              });
              return;
            }
            const compatible =
              saved?.namespace === cache.key(target.chat.id, target.rootId) ? saved : undefined;
            const history =
              compatible?.history ??
              appendPage({items: [], cursor: 0, more: true}, await page(target, 0, task));
            publish({
              ...empty(key),
              target,
              history,
              messageIndex: compatible?.index ?? 0,
              status: task.cancelled ? 'stopped' : 'ready',
            });
          } catch (error) {
            publish({
              ...empty(key),
              target,
              status: task.cancelled ? 'stopped' : 'error',
              error: describeError(error),
            });
          }
        })();
      },
      canRestore || immediate.current ? 0 : BROWSE_DELAY,
    );
    immediate.current = false;
    return () => {
      disposed = true;
      task.cancelled = true;
      clearTimeout(timer);
    };
  }, [
    client,
    sourceId,
    entity,
    channel,
    selfId,
    scope,
    selectedPostId,
    groupedId,
    view,
    revision,
    key,
    historyKey,
    cache,
    page,
    enabled,
  ]);

  useEffect(() => {
    if (stored.key !== key || stored.status !== 'ready' || !stored.target) return;
    cache.save(historyKey, stored.history, cache.key(stored.target.chat.id, stored.target.rootId));
    cache.position(historyKey, stored.messageIndex);
  }, [cache, historyKey, key, stored]);

  const update = (change: (previous: Pane) => Pane) => {
    setStored((previous) =>
      previous.key === key && currentKey.current === key ? change(previous) : previous,
    );
  };
  return {
    ...pane,
    view,
    scope,
    toggleView: options.filter?.toggleView ?? (() => setView((value) => (value === 'mine' ? 'all' : 'mine'))),
    toggleScope: () => setScope((value) => (value === 'group' ? 'post' : 'group')),
    cancel: () => cancelRef.current?.(),
    reload: () => {
      immediate.current = true;
      cache.clear();
      contexts.current.clear();
      setRevision((value) => value + 1);
    },
    select: (selected: Set<number>) => update((previous) => ({...previous, selected})),
    index: (messageIndex: number) => update((previous) => ({...previous, messageIndex})),
    publish: (history: History, selected?: Set<number>) =>
      update((previous) => ({...previous, history, ...(selected ? {selected} : {})})),
    fetch: (cursor: number, task: Cancellation) => {
      if (!pane.target) throw new Error('Discussion target unavailable.');
      return page(pane.target, cursor, task);
    },
    remove: (peer: string, ids: ReadonlySet<number>) => {
      cache.clear();
      update((previous) =>
        previous.target?.chat.id === peer
          ? {
              ...previous,
              history: {
                ...previous.history,
                items: previous.history.items.filter((item) => !ids.has(item.id)),
              },
              selected: new Set([...previous.selected].filter((id) => !ids.has(id))),
              messageIndex: 0,
            }
          : previous,
      );
    },
  };
}
