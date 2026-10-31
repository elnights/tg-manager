import {useCallback, useEffect, useRef, useState} from 'react';
import {discussionChat, type Chat, type TelegramApi} from './telegram.js';
import {
  discussionThread,
  fetchDiscussionPage,
  type DiscussionTarget,
  type DiscussionContext,
} from './discussions.js';
import {appendPage, type History} from './operations.js';
import {PAGE, type MessageView} from './messages.js';
import {describeError} from './errors.js';

type Pane = {
  key: string;
  history: History;
  selected: Set<number>;
  messageIndex: number;
  status: 'loading' | 'ready' | 'error' | 'none' | 'stopped';
  target?: DiscussionTarget;
  error?: string;
};
function empty(key: string): Pane {
  return {
    key,
    history: {items: [], cursor: 0, more: false},
    selected: new Set(),
    messageIndex: 0,
    status: 'loading',
  };
}

export function useDiscussion(
  client: TelegramApi,
  channel: Chat | undefined,
  selfId: string,
  postId: number | undefined,
) {
  const [scope, setScope] = useState<'group' | 'post'>('group');
  const [view, setView] = useState<MessageView>('mine');
  const [revision, setRevision] = useState(0);
  const [stored, setStored] = useState<Pane>(() => empty(''));
  const sourceId = channel?.id;
  const entity = channel?.entity;
  const selectedPostId = scope === 'post' ? postId : undefined;
  const key = `${sourceId ?? ''}:${scope}:${selectedPostId ?? ''}:${view}:${revision}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const cache = useRef(new Map<string, Pane>());
  const groups = useRef(new Map<string, Promise<Chat | undefined>>());
  const contexts = useRef(new Map<string, Map<number, DiscussionContext>>());
  const labels = useCallback(
    (peer: string) => {
      const contextKey = `${peer}:${sourceId}`;
      let found = contexts.current.get(contextKey);
      if (!found) {
        found = new Map();
        contexts.current.set(contextKey, found);
        if (contexts.current.size > 24) contexts.current.delete(contexts.current.keys().next().value!);
      }
      return found;
    },
    [sourceId],
  );
  const cancelRef = useRef<(() => void) | undefined>(undefined);
  const pane = stored.key === key ? stored : empty(key);

  useEffect(() => {
    if (!sourceId || !entity || !selfId) return;
    let disposed = false;
    const task = {cancelled: false};
    cancelRef.current = () => {
      task.cancelled = true;
    };
    const publish = (next: Pane) => {
      if (!disposed && currentKey.current === key) setStored(next);
    };
    const saved = cache.current.get(key);
    if (saved) {
      publish({...saved, selected: new Set()});
      return () => {
        disposed = true;
      };
    }
    const timer = setTimeout(
      () => {
        if (task.cancelled) {
          publish({...empty(key), status: 'stopped'});
          return;
        }
        void (async () => {
          let target: DiscussionTarget | undefined;
          try {
            let pending = groups.current.get(sourceId);
            if (!pending) {
              pending = discussionChat(client, {
                id: sourceId,
                entity,
                title: channel.title,
                isPrivate: false,
                isBroadcast: true,
              });
              groups.current.set(sourceId, pending);
              if (groups.current.size > 24) groups.current.delete(groups.current.keys().next().value!);
              void pending.catch(() => {
                if (groups.current.get(sourceId) === pending) groups.current.delete(sourceId);
              });
            }
            const group = await pending;
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
                ? await discussionThread(client, channel, group, selectedPostId!)
                : {chat: group};
            if (disposed || currentKey.current !== key) return;
            if (task.cancelled) {
              publish({...empty(key), status: 'stopped'});
              return;
            }
            const items = await fetchDiscussionPage(
              client,
              target,
              selfId,
              view,
              0,
              labels(target.chat.id),
              task,
            );
            const next: Pane = {
              ...empty(key),
              target,
              history: appendPage({items: [], cursor: 0, more: true}, items),
              status: 'ready',
            };
            publish(next);
            if (!disposed && !task.cancelled && currentKey.current === key) {
              cache.current.set(key, next);
              if (cache.current.size > 12) cache.current.delete(cache.current.keys().next().value!);
            }
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
      scope === 'post' ? 180 : 0,
    );
    return () => {
      disposed = true;
      task.cancelled = true;
      clearTimeout(timer);
    };
  }, [client, sourceId, entity, channel, selfId, scope, selectedPostId, view, revision, key, labels]);

  const update = (change: (previous: Pane) => Pane) => {
    setStored((previous) =>
      previous.key === key && currentKey.current === key ? change(previous) : previous,
    );
  };
  return {
    ...pane,
    view,
    scope,
    toggleView: () => setView((value) => (value === 'mine' ? 'all' : 'mine')),
    toggleScope: () => setScope((value) => (value === 'group' ? 'post' : 'group')),
    cancel: () => cancelRef.current?.(),
    reload: () => {
      cache.current.clear();
      groups.current.clear();
      contexts.current.clear();
      setRevision((value) => value + 1);
    },
    select: (selected: Set<number>) => update((previous) => ({...previous, selected})),
    index: (messageIndex: number) => update((previous) => ({...previous, messageIndex})),
    publish: (history: History, selected?: Set<number>) =>
      update((previous) => {
        const next = {...previous, history, ...(selected ? {selected} : {})};
        const cachedHistory =
          history.items.length > PAGE
            ? {items: history.items.slice(0, PAGE), cursor: history.items[PAGE - 1]!.id, more: true}
            : history;
        cache.current.set(key, {...next, history: cachedHistory, selected: new Set(), messageIndex: 0});
        return next;
      }),
    fetch: (cursor: number, task: {readonly cancelled: boolean}) => {
      if (!pane.target) throw new Error('Discussion target unavailable.');
      return fetchDiscussionPage(
        client,
        pane.target,
        selfId,
        view,
        cursor,
        labels(pane.target.chat.id),
        task,
      );
    },
    remove: (peer: string, ids: ReadonlySet<number>) => {
      cache.current.clear();
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
