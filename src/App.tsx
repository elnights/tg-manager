import React, {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {adjustChatPercent, panelWidths, Panels, PanelHeader, Row, useTerminalSize} from './ui.js';
import {fetchMessagePage, messageItems, messageRows, ownMessageIds} from './messages.js';
import {footerShortcuts, legendRows, ShortcutLegend, type FooterState} from './Footer.js';
import {boundedText, wrapText} from './text.js';
import {describeError} from './errors.js';
import {commandFor, commands} from './commands.js';
import {Help} from './Help.js';
import {TypeFilter, viewOptionLines} from './ViewOptions.js';
import {ActivityHeader, StatusBar, useNotice} from './StatusBar.js';
import {useOperation} from './useOperation.js';
import {Reader} from './Reader.js';
import {MessageDetails} from './MessageDetails.js';
import type {MediaFiles} from './media.js';
import {Confirmation, confirmationLines} from './Confirmation.js';
import {
  accountIdentity,
  chatType,
  chatTypeLabels,
  mergeChats,
  type Chat,
  type TelegramApi,
} from './telegram.js';
import {settingsStore, validChatPercent, type SettingsStore} from './settings.js';
import {
  appendPage,
  deleteOwnMessages,
  deletionSummary,
  loadMessageHistory,
  scanOwnMessages,
  selectedOwn,
} from './operations.js';
import {checkOwnChats, createDialogPager, hasOwnChatMessages} from './dialogs.js';
import {useDiscussion} from './useDiscussion.js';
import {MessagePane} from './MessagePane.js';
import type {Message} from './messages.js';
import {initialView, viewReducer, visibleChats} from './state.js';

type Focus = 'chats' | 'messages' | 'discussion';
type Prompt =
  | {kind: 'none'}
  | {kind: 'select'}
  | {
      kind: 'delete';
      ids: number[];
      chat: Chat;
      scope: 'selected' | 'entire';
      text: string;
      pane: 'messages' | 'discussion';
      discussionScope?: string;
    };
type Initialization = 'loading' | 'ready' | 'error';

export function App({
  client,
  settings = settingsStore,
  mediaFiles,
}: {
  client: TelegramApi;
  settings?: SettingsStore;
  mediaFiles?: MediaFiles;
}) {
  const {exit} = useApp();
  const size = useTerminalSize();
  const [state, dispatch] = useReducer(viewReducer, initialView);
  const {ownOnly} = state;
  const includePrivate = state.types.has('private') || state.types.has('bot');
  const postMessages = useMemo(() => messageRows(state.history.items), [state.history.items]);
  const headerMessageCount = useRef(100);
  headerMessageCount.current = Math.max(headerMessageCount.current, state.history.items.length);
  const ownOnlyRef = useRef(ownOnly);
  ownOnlyRef.current = ownOnly;
  const chats = visibleChats(state);
  const chatIndex = Math.max(
    0,
    chats.findIndex((chat) => chat.id === state.activeId),
  );
  const active = chats.find((chat) => chat.id === state.activeId);
  const [chatPercent, setChatPercent] = useState(() => {
    try {
      return validChatPercent(settings.read());
    } catch {
      return 32;
    }
  });
  const savedPercent = useRef(chatPercent);
  useEffect(() => {
    if (savedPercent.current === chatPercent) return;
    savedPercent.current = chatPercent;
    try {
      settings.write(chatPercent);
    } catch {
      /* Keep usable in-memory settings. */
    }
  }, [chatPercent, settings]);
  const [selfId, setSelfId] = useState('');
  const [account, setAccount] = useState('');
  const [initialization, setInitialization] = useState<Initialization>('loading');
  const dialogPager = useRef<ReturnType<typeof createDialogPager> | null>(null);
  const [chatsMore, setChatsMore] = useState(false);
  const [search, setSearch] = useState<{original: string} | null>(null);
  const [detail, setDetail] = useState<{message: Message; chat: Chat} | null>(null);
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [rawFocus, setFocus] = useState<Focus>('chats');
  const [typesOpen, setTypesOpen] = useState(false);
  const [typeDraft, setTypeDraft] = useState({types: state.types, index: 0});
  const [postPercent, setPostPercent] = useState(50);
  const discussion = useDiscussion(
    client,
    active?.isBroadcast ? active : undefined,
    selfId,
    postMessages[state.messageIndex],
  );
  const showDiscussion = Boolean(active?.isBroadcast && discussion.status !== 'none');
  const focus = rawFocus === 'discussion' && !showDiscussion ? 'messages' : rawFocus;
  const inDiscussion = focus === 'discussion';
  const working = inDiscussion ? discussion : state;
  const {view, history, messageIndex, selected} = working;
  const discussionMessages = useMemo(() => messageRows(discussion.history.items), [discussion.history.items]);
  const messages = inDiscussion ? discussionMessages : postMessages;
  const hasMore = history.more;
  const targetChat = inDiscussion ? discussion.target?.chat : active;
  const focusedPane = inDiscussion ? ('discussion' as const) : ('messages' as const);
  const selectMessages = (ids: Set<number>) =>
    inDiscussion ? discussion.select(ids) : dispatch({type: 'selection', ids});
  const discussionScope = inDiscussion
    ? `Source channel: ${boundedText(active?.title ?? '', 60)} (ID ${active?.id}). ${discussion.scope === 'post' ? `Selected post #${discussion.target?.postId}; this thread only.` : 'Entire discussion group, including comments and general chat.'}`
    : undefined;
  const {progress, current: busyRef, begin, cancel} = useOperation();
  const {notice, notify, dismissNotice, resolveValidation} = useNotice();
  const [helpOpen, setHelpOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>({kind: 'none'});
  const [postLookup, setPostLookup] = useState<{key: string; active: boolean; cancelled: boolean}>();
  const cancelPostLookup = useRef<(() => void) | undefined>(undefined);
  const focusLocatedPost = useRef<string | undefined>(undefined);
  const [postLookupRevision, retryPostLookup] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const confirm = prompt.kind === 'delete' ? prompt : null;
  const selectAllPrompt = prompt.kind === 'select';
  const confirmationText = confirm?.text ?? '';

  const checkChats = useCallback(
    async (chats: Chat[], task: NonNullable<ReturnType<typeof begin>>) => {
      task.update(0, {total: chats.length, label: 'Checking chats'});
      const result = await checkOwnChats(client, chats, task, (completed, total) =>
        task.update(completed, {total, label: 'Checking chats'}),
      );
      if (task.active && !result.complete)
        notify(
          result.failure
            ? `Own-chat check failed: ${describeError(result.failure)}. The "With my messages" filter is off; press o to retry.`
            : 'Stopped checking chats. The "With my messages" filter is off; press o to retry.',
          result.failure ? 'error' : 'warning',
        );
      return result;
    },
    [client, notify],
  );

  const toggleOwnChats = async () => {
    if (ownOnly) {
      dispatch({type: 'ownFilter', enabled: false});
      return;
    }
    const task = begin('Checking chats');
    if (!task) return;
    try {
      const result = await checkChats(state.chats, task);
      if (task.active)
        dispatch({type: 'chats', chats: result.chats, ownOnly: result.complete, ownChatIds: result.ids});
    } finally {
      task.finish();
    }
  };

  useEffect(() => {
    let disposed = false;
    const task = begin('Connecting');
    if (!task) return;
    setInitialization('loading');
    const pager = createDialogPager(client);
    dialogPager.current = pager;
    void (async () => {
      try {
        const [pageResult, meResult] = await Promise.allSettled([pager.next(task), client.getMe()]);
        if (pageResult.status === 'rejected') throw pageResult.reason;
        if (meResult.status === 'rejected') throw meResult.reason;
        const page = pageResult.value;
        const me = meResult.value;
        const own =
          !disposed && task.active && ownOnlyRef.current ? await checkChats(page.chats, task) : undefined;
        if (!disposed && task.active) {
          setSelfId(me.id.toString());
          setAccount(accountIdentity(me));
          setInitialization('ready');
          dispatch({
            type: 'chats',
            chats: own?.chats ?? page.chats,
            ...(own ? {ownChatIds: own.ids, ownOnly: own.complete} : {}),
          });
          setChatsMore(page.more);
        }
      } catch (error) {
        if (!disposed && task.active) {
          setInitialization('error');
          notify(`Connecting failed: ${describeError(error)}. Press r to Retry.`, 'error');
        }
      } finally {
        task.finish();
      }
    })();
    return () => {
      disposed = true;
      task.cancelled = true;
      task.finish();
      void pager.close().catch(() => {});
    };
  }, [client, retry, begin, notify, checkChats]);

  const activeId = active?.id;
  const activeEntity = active?.entity;
  const sourcePostId = inDiscussion ? messages[messageIndex]?.sourcePostId : undefined;
  const sourcePostKey = sourcePostId === undefined ? undefined : `${activeId}:${sourcePostId}:${state.view}`;
  const currentSourcePostKey = useRef(sourcePostKey);
  currentSourcePostKey.current = sourcePostKey;
  const locatingPost = Boolean(sourcePostKey && postLookup?.key === sourcePostKey && postLookup.active);
  const postNavigationPaused = Boolean(
    progress ||
    helpOpen ||
    noticeOpen ||
    detail ||
    typesOpen ||
    prompt.kind !== 'none' ||
    state.messageStatus !== 'ready',
  );
  useEffect(() => {
    if (!activeId || !activeEntity || !selfId || state.messageStatus !== 'loading') return;
    const task = begin('Loading');
    if (!task) return;
    let disposed = false;
    void fetchMessagePage(client, activeEntity, selfId, state.view)
      .then(async (items) => {
        if (disposed || !task.active) return;
        const hasOwn =
          ownOnlyRef.current && !task.cancelled
            ? items.some((message) => message.own) || (await hasOwnChatMessages(client, active!, task))
            : undefined;
        if (!disposed && task.active)
          dispatch({
            type: 'history',
            chatId: activeId,
            view: state.view,
            history: appendPage({items: [], cursor: 0, more: true}, items),
            hasOwn: task.cancelled ? undefined : hasOwn,
          });
      })
      .catch((error) => {
        if (!disposed && task.active) {
          dispatch({type: 'failed', chatId: activeId, view: state.view});
          notify(`Loading failed: ${describeError(error)}. Press r to retry.`, 'error');
        }
      })
      .finally(task.finish);
    return () => {
      disposed = true;
      task.cancelled = true;
      task.finish();
    };
  }, [
    client,
    activeId,
    activeEntity,
    selfId,
    state.view,
    state.messageStatus,
    refresh,
    begin,
    notify,
    active,
  ]);

  useEffect(() => {
    if (!active?.isBroadcast || !sourcePostKey || sourcePostId === undefined || postNavigationPaused) return;
    const index = postMessages.findIndex((message) =>
      messageItems(message).some((item) => item.id === sourcePostId),
    );
    if (index !== -1) {
      if (index !== state.messageIndex) dispatch({type: 'index', index});
      return;
    }
    let disposed = false;
    const request = {key: sourcePostKey, active: false, cancelled: false};
    const timer = setTimeout(() => {
      request.active = true;
      setPostLookup(request);
      void fetchMessagePage(client, active.entity, selfId, 'all', sourcePostId + 1)
        .then((page) => {
          if (disposed || request.cancelled) return;
          if (!page.some((message) => message.id === sourcePostId)) {
            notify(
              `Source post #${sourcePostId} is unavailable. The discussion remains selected.`,
              'warning',
            );
            return;
          }
          dispatch({
            type: 'locatedPost',
            chatId: active.id,
            view: state.view,
            postId: sourcePostId,
            history: appendPage({items: [], cursor: 0, more: true}, page),
          });
          if (state.view === 'mine') notify('Posts switched to All to show the source post.');
          if (focusLocatedPost.current === sourcePostKey) {
            focusLocatedPost.current = undefined;
            setFocus('messages');
          }
        })
        .catch((error) => {
          if (!disposed && !request.cancelled)
            notify(`Source post #${sourcePostId} could not be loaded: ${describeError(error)}`, 'error');
        })
        .finally(() => {
          request.active = false;
          if (mounted.current) setPostLookup((previous) => (previous === request ? undefined : previous));
        });
    }, 180);
    cancelPostLookup.current = () => {
      request.cancelled = true;
      request.active = false;
      clearTimeout(timer);
      focusLocatedPost.current = undefined;
      setPostLookup((previous) => (previous === request ? undefined : previous));
    };
    return () => {
      disposed = true;
      request.active = false;
      clearTimeout(timer);
      if (focusLocatedPost.current === sourcePostKey && currentSourcePostKey.current !== sourcePostKey)
        focusLocatedPost.current = undefined;
    };
  }, [
    client,
    active,
    sourcePostKey,
    sourcePostId,
    postNavigationPaused,
    postMessages,
    selfId,
    state.view,
    state.messageIndex,
    notify,
    postLookupRevision,
  ]);

  useEffect(() => {
    if (initialization === 'ready' && !activeId && !state.query)
      notify(
        ownOnly
          ? 'No loaded chats with your own messages. Press o to show all chats.'
          : includePrivate
            ? 'No chats found.'
            : 'No groups or channels found. Press p to show private chats.',
      );
  }, [initialization, activeId, includePrivate, ownOnly, state.query, notify]);

  useEffect(() => {
    if (!active?.isBroadcast) return;
    if (discussion.status === 'error')
      notify(
        `Discussion loading failed: ${discussion.error}. Focus the discussion pane and press r to retry.`,
        'error',
      );
    if (discussion.status === 'none') notify('This channel has no linked discussion group.');
  }, [active?.isBroadcast, discussion.status, discussion.error, notify]);

  const loadChats = async () => {
    const pager = dialogPager.current;
    if (!pager || !chatsMore) return;
    const task = begin('Loading chats');
    if (!task) return;
    try {
      const page = await pager.next(task);
      if (!task.active) return;
      const own = ownOnly ? await checkChats(page.chats, task) : undefined;
      if (!task.active) return;
      dispatch({
        type: 'chats',
        chats: mergeChats([...state.chats, ...(own?.chats ?? page.chats)]),
        ...(own ? {ownChatIds: new Set([...state.ownChatIds, ...own.ids]), ownOnly: own.complete} : {}),
      });
      setChatsMore(page.more);
      if (task.cancelled) notify('Stopped loading chats after the current request.', 'warning');
    } catch (error) {
      if (task.active) notify(`Chat loading failed: ${describeError(error)}`, 'error');
    } finally {
      task.finish();
    }
  };

  const markLoaded = () => selectMessages(new Set(ownMessageIds(messages)));
  const loadHistory = async (selectOwn: boolean, singlePage = false) => {
    if (!targetChat) return;
    const task = begin(selectOwn ? 'Selecting' : 'Loading');
    if (!task) return;
    const chat = targetChat;
    const capturedView = view;
    setPrompt({kind: 'none'});
    let loaded = history.items.length;
    try {
      await loadMessageHistory(
        history,
        (cursor) =>
          inDiscussion
            ? discussion.fetch(cursor, task)
            : fetchMessagePage(client, chat.entity, selfId, capturedView, cursor),
        task,
        (snapshot) => {
          loaded = snapshot.items.length;
          if (!task.active) return;
          if (inDiscussion) discussion.publish(snapshot, selectOwn ? selectedOwn(snapshot) : undefined);
          else
            dispatch({
              type: 'history',
              chatId: chat.id,
              view: capturedView,
              history: snapshot,
              ...(selectOwn ? {selected: selectedOwn(snapshot)} : {}),
            });
          task.update(loaded);
        },
        singlePage,
      );
      if (task.active && task.cancelled)
        notify(
          `Stopped ${selectOwn ? 'selecting' : 'loading'} at ${loaded} loaded. Nothing deleted.`,
          'warning',
        );
    } catch (error) {
      if (task.active) notify(`Stopped at ${loaded} loaded: ${describeError(error)}`, 'error');
    } finally {
      task.finish();
    }
  };

  const scanAll = async () => {
    if (!targetChat) return;
    const chat = {...targetChat};
    const task = begin('Scanning');
    if (!task) return;
    try {
      const ids = await scanOwnMessages(
        client,
        chat.entity,
        task,
        (count) => task.update(count),
        inDiscussion ? discussion.target?.rootId : undefined,
      );
      if (!task.active) return;
      if (task.cancelled) {
        notify(`Scan stopped at ${ids.length} found. Nothing deleted.`, 'warning');
        return;
      }
      if (ids.length)
        setPrompt({kind: 'delete', ids, chat, scope: 'entire', text: '', pane: focusedPane, discussionScope});
      else notify('Scan complete: 0 messages. Nothing deleted.');
    } catch (error) {
      if (task.active) notify(`Scan failed; nothing deleted: ${describeError(error)}`, 'error');
    } finally {
      task.finish();
    }
  };

  const doDelete = async () => {
    if (!confirm || confirm.text !== 'DELETE') return;
    const task = begin('Deleting');
    if (!task) return;
    const {ids, chat} = confirm;
    resolveValidation();
    setPrompt({kind: 'none'});
    try {
      const result = await deleteOwnMessages(client, {entity: chat.entity, ids}, task, (absent, result) => {
        if (!task.active) return;
        dispatch({type: 'absent', chatId: chat.id, ids: absent});
        discussion.remove(chat.id, absent);
        task.update(result.requested, {total: result.total, verified: result.verified});
      });
      if (!task.active) return;
      notify(deletionSummary(result), result.failure ? 'error' : result.cancelled ? 'warning' : 'result');
      if (confirm.pane === 'discussion') discussion.select(new Set());
      else dispatch({type: 'selection', ids: new Set()});
      discussion.reload();
      dispatch({type: 'revalidate'});
      setRefresh((value) => value + 1);
    } finally {
      task.finish();
    }
  };

  const widths = panelWidths(size.columns, chatPercent);
  const {width: lineWidth, leftWidth, rightWidth} = widths;
  const height = Math.max(1, size.rows - 1);
  const confirmLines = confirm ? confirmationLines(confirm, account, confirmationText, lineWidth) : [];
  const measuredConfirmHeight = confirm
    ? confirmationLines(confirm, account, 'X'.repeat(12), lineWidth).length
    : 0;
  const confirmationHeight = selectAllPrompt ? 5 : 0;
  const searchLines =
    search || state.query
      ? wrapText(`Search loaded chats: ${state.query || '(empty)'}${search ? '_' : ''}`, lineWidth)
      : [];
  const accountLines = wrapText(`Account: ${account}`, lineWidth);
  const optionsLines = viewOptionLines(lineWidth, {
    view,
    includePrivate,
    types: state.types,
    ownOnly,
    ownCheck:
      progress?.label === 'Checking chats' ? (progress.cancelling ? 'stopping' : 'checking') : undefined,
    chats: state.chats.length,
    messages: state.history.items.length,
    reservedMessages: headerMessageCount.current,
    shortcuts: !progress && !search && !selectAllPrompt,
  });
  const chromeHeight = 3 + accountLines.length + optionsLines.length + searchLines.length;
  const footerState: FooterState = {
    focus,
    busy: Boolean(progress),
    cancelling: Boolean(progress?.cancelling),
    confirm: Boolean(confirm),
    canConfirm: confirmationText === 'DELETE',
    selectPrompt: selectAllPrompt,
    hasChat: Boolean(active),
    initialError: initialization === 'error',
    chatsMore,
    searching: Boolean(search),
    canInspect: Boolean(messages[messageIndex]),
    hasDiscussion: showDiscussion,
    backgroundLoading: locatingPost || (showDiscussion && discussion.status === 'loading'),
    canGoToPost: sourcePostId !== undefined,
    canScan: inDiscussion
      ? discussion.status === 'ready' && Boolean(discussion.target)
      : (!active?.isBroadcast || focus === 'messages') && state.messageStatus === 'ready',
    canNavigate: focus === 'chats' ? chats.length > 1 : messages.length > 1,
    canSelect: Boolean(messages[messageIndex]),
    hasOwn: messages.some((message) => message.own),
    selected: selected.size,
    hasMore,
    includePrivate,
    hasNotice: Boolean(notice),
    confirmationText,
  };
  const promptVisible =
    lineWidth >= 24 &&
    (confirm
      ? height >=
        measuredConfirmHeight +
          legendRows(
            footerShortcuts({...footerState, canConfirm: true, confirmationText: 'XXXXXXXXXXXX'}),
            lineWidth,
          ).length
      : height >=
        chromeHeight + confirmationHeight + legendRows(footerShortcuts(footerState), lineWidth).length);
  footerState.promptVisible = promptVisible;
  footerState.canConfirm &&= promptVisible;
  let footerRows = legendRows(footerShortcuts(footerState), lineWidth);
  const legendFits =
    lineWidth >= 8 &&
    height >= footerRows.length &&
    footerRows.every((row) => row.shortcuts.every((item) => item.key.length <= lineWidth));
  if (!legendFits)
    footerRows = legendRows(
      [
        {key: '?', label: 'Help'},
        {key: 'Ctrl+C', label: 'Quit'},
      ],
      lineWidth,
    );
  // The busy legend has fewer bindings. Keep the idle legend's space reserved
  // so fetching a chat's messages cannot grow/shrink the list viewport.
  const footerHeight = Math.min(
    height,
    Math.max(
      footerRows.length,
      progress ? legendRows(footerShortcuts({...footerState, busy: false}), lineWidth).length : 0,
      !confirm && !selectAllPrompt && !search
        ? legendRows(
            footerShortcuts({
              ...footerState,
              busy: false,
              hasDiscussion: true,
              hasNotice: true,
              canGoToPost: true,
              canScan: true,
              backgroundLoading: true,
            }),
            lineWidth,
          ).length
        : 0,
    ),
  );
  const baseHeight = chromeHeight + footerHeight;
  const listHeight = Math.max(0, height - baseHeight - confirmationHeight);
  const compactPanes = showDiscussion && listHeight + 1 < 10;
  const primaryHeight =
    showDiscussion && !compactPanes
      ? Math.max(4, Math.min(listHeight - 3, Math.floor(((listHeight + 1) * postPercent) / 100)))
      : listHeight + 1;
  const discussionHeight = listHeight + 1 - primaryHeight;
  const primaryRows = primaryHeight - (showDiscussion ? 2 : 1);
  const discussionRows = (compactPanes ? listHeight + 1 : discussionHeight) - 2;
  const footer = (
    <Box
      height={footerHeight}
      flexShrink={0}
      flexDirection="column"
      justifyContent="flex-end"
      overflow="hidden"
    >
      <ShortcutLegend width={lineWidth} rows={footerRows} />
    </Box>
  );

  useInput((input, key) => {
    if (helpOpen || noticeOpen || detail || typesOpen) return;
    const command = commandFor(input, key, footerState);
    if (command === 'help') {
      setHelpOpen(true);
      return;
    }
    if (command === 'searchCancel' && search) {
      dispatch({type: 'query', query: search.original});
      setSearch(null);
      return;
    }
    if (command === 'cancelPrompt') {
      setPrompt({kind: 'none'});
      return;
    }
    if (!legendFits) return;
    if (search) {
      if (command === 'searchApply') setSearch(null);
      if (command === 'searchBackspace') dispatch({type: 'query', query: state.query.slice(0, -1)});
      if (command === 'searchEdit')
        dispatch({
          type: 'query',
          query: (state.query + input.replace(/[\x00-\x1f\x7f-\x9f]/g, '')).slice(0, 120),
        });
      return;
    }
    if (selectAllPrompt) {
      if (command === 'selectLoaded') {
        setPrompt({kind: 'none'});
        markLoaded();
      }
      if (command === 'selectRemaining') void loadHistory(true);
      return;
    }
    if (confirm) {
      if (command === 'confirmSubmit') {
        if (confirmationText === 'DELETE') void doDelete();
        else notify('Enter exactly DELETE to confirm.', 'warning', 'validation');
      }
      if (command === 'confirmBackspace') setPrompt({...confirm, text: confirmationText.slice(0, -1)});
      if (command === 'confirmEdit') setPrompt({...confirm, text: (confirmationText + input).slice(0, 12)});
      return;
    }
    if (busyRef.current) {
      if (command === 'cancelOperation') cancel();
      return;
    }
    switch (command) {
      case 'help':
        setHelpOpen(true);
        break;
      case 'quit':
        exit();
        break;
      case 'notice':
        setNoticeOpen(true);
        break;
      case 'dismiss':
        dismissNotice();
        break;
      case 'width':
      case 'reset':
        if (command === 'reset') setPostPercent(50);
        setChatPercent((previous) => adjustChatPercent(previous, input as '[' | ']' | '0'));
        break;
      case 'types':
        setTypeDraft({types: state.types, index: 0});
        setTypesOpen(true);
        break;
      case 'split':
        setPostPercent((value) => Math.max(25, Math.min(75, value + (input === '}' ? 5 : -5))));
        break;
      case 'private':
        dispatch({type: 'private'});
        break;
      case 'ownChats':
        void toggleOwnChats();
        break;
      case 'view':
        if (inDiscussion) discussion.toggleView();
        else dispatch({type: 'view'});
        break;
      case 'discussion':
        discussion.toggleScope();
        break;
      case 'clear':
        selectMessages(new Set());
        break;
      case 'stopDiscussion':
        discussion.cancel();
        cancelPostLookup.current?.();
        break;
      case 'sourcePost': {
        const index = postMessages.findIndex((message) =>
          messageItems(message).some((item) => item.id === sourcePostId),
        );
        if (index !== -1) {
          dispatch({type: 'index', index});
          setFocus('messages');
        } else {
          focusLocatedPost.current = sourcePostKey;
          if (!locatingPost) retryPostLookup((value) => value + 1);
        }
        break;
      }
      case 'focus': {
        const panes: Focus[] = showDiscussion ? ['chats', 'messages', 'discussion'] : ['chats', 'messages'];
        const direction = key.leftArrow || (key.tab && key.shift) ? -1 : 1;
        setFocus(panes[(panes.indexOf(focus) + direction + panes.length) % panes.length]!);
        break;
      }
      case 'up':
      case 'page':
      case 'ends': {
        const count = focus === 'chats' ? chats.length : messages.length;
        const index = focus === 'chats' ? chatIndex : messageIndex;
        const delta =
          (key.upArrow || key.pageUp || input === 'k' ? -1 : 1) *
          (command === 'page'
            ? Math.max(1, focus === 'chats' ? listHeight : inDiscussion ? discussionRows : primaryRows)
            : 1);
        const next = key.home ? 0 : key.end ? count - 1 : Math.max(0, Math.min(count - 1, index + delta));
        if (focus === 'chats') dispatch({type: 'active', id: chats[next]?.id});
        else if (inDiscussion) discussion.index(next);
        else dispatch({type: 'index', index: next});
        break;
      }
      case 'reload':
        if (initialization === 'error') {
          dismissNotice();
          setRetry((value) => value + 1);
        } else {
          if (inDiscussion) discussion.reload();
          else {
            dispatch({type: 'reload'});
            setRefresh((value) => value + 1);
          }
        }
        break;
      case 'search':
        setSearch({original: state.query});
        break;
      case 'chats':
        discussion.reload();
        setRetry((value) => value + 1);
        break;
      case 'moreChats':
        void loadChats();
        break;
      case 'detail':
        if (messages[messageIndex] && targetChat)
          setDetail({message: messages[messageIndex], chat: {...targetChat}});
        break;
      case 'scan':
        void scanAll();
        break;
      case 'select':
        if (hasMore) setPrompt({kind: 'select'});
        else markLoaded();
        break;
      case 'mark': {
        const message = messages[messageIndex];
        if (!message?.own) {
          notify('Only your own messages can be marked for deletion.');
          break;
        }
        const next = new Set(selected);
        const ids = ownMessageIds([message]);
        const unmark = ids.every((id) => next.has(id));
        for (const id of ids) {
          if (unmark) next.delete(id);
          else next.add(id);
        }
        selectMessages(next);
        break;
      }
      case 'next':
        void loadHistory(false, true);
        break;
      case 'load':
        void loadHistory(false);
        break;
      case 'delete': {
        const ids = ownMessageIds(messages, selected);
        if (ids.length && targetChat)
          setPrompt({
            kind: 'delete',
            ids,
            chat: {...targetChat},
            scope: 'selected',
            text: '',
            pane: focusedPane,
            discussionScope,
          });
        break;
      }
    }
  });

  const chatStart = Math.max(0, chatIndex - listHeight + 1);
  const activity =
    progress ??
    (locatingPost
      ? {label: `Locating post #${sourcePostId}`}
      : showDiscussion && discussion.status === 'loading'
        ? {label: 'Loading discussion'}
        : null);
  const statusBar = (
    <StatusBar
      width={lineWidth}
      hasMore={hasMore}
      chatsMore={chatsMore}
      selected={selected.size}
      progress={activity}
      notice={notice}
    />
  );
  if (detail)
    return (
      <MessageDetails
        message={detail.message}
        chat={detail.chat}
        selfId={selfId}
        client={client}
        files={mediaFiles}
        width={lineWidth}
        height={height}
        onClose={() => setDetail(null)}
      />
    );
  if (noticeOpen && notice)
    return (
      <Reader
        title="NOTICE DETAILS"
        text={notice.text}
        width={lineWidth}
        height={height}
        onClose={() => setNoticeOpen(false)}
      />
    );
  if (helpOpen) return <Help width={lineWidth} height={height} onClose={() => setHelpOpen(false)} />;
  if (typesOpen)
    return (
      <TypeFilter
        value={typeDraft}
        onChange={setTypeDraft}
        width={lineWidth}
        height={height}
        paused={helpOpen}
        onApply={(types) => {
          dispatch({type: 'types', types});
          setTypesOpen(false);
        }}
        onCancel={() => setTypesOpen(false)}
        onHelp={() => setHelpOpen(true)}
      />
    );
  if (confirm && promptVisible)
    return (
      <Box width={lineWidth} height={height} flexDirection="column" overflow="hidden">
        <Confirmation lines={confirmLines} width={lineWidth} />
        <Box flexGrow={1} />
        {footer}
      </Box>
    );
  if (height < baseHeight + confirmationHeight || lineWidth < 24 || !promptVisible)
    return (
      <Box width={lineWidth} height={height} flexDirection="column" overflow="hidden">
        <Box
          height={Math.max(0, height - footerHeight - 1)}
          flexShrink={0}
          flexDirection="column"
          overflow="hidden"
        >
          <Row width={lineWidth} color="yellowBright">
            Enlarge the terminal to show the interface.
          </Row>
        </Box>
        {height > footerHeight && statusBar}
        {footer}
      </Box>
    );
  return (
    <Box flexDirection="column" width={lineWidth} height={height} overflow="hidden">
      <ActivityHeader
        title={`TG MANAGER / ${active?.title || 'Select chat'}`}
        width={lineWidth}
        progress={activity}
      />
      {accountLines.map((line, index) => (
        <Row key={`account-${index}`} width={lineWidth}>
          {line}
        </Row>
      ))}
      {optionsLines.map((line, index) => (
        <Row key={`options-${index}`} width={lineWidth} color="cyanBright">
          {line}
        </Row>
      ))}
      {searchLines.map((line, index) => (
        <Row key={index} width={lineWidth} color="cyanBright">
          {line}
        </Row>
      ))}
      <Panels
        widths={widths}
        height={listHeight + 1}
        chats={
          <>
            <PanelHeader
              title={includePrivate ? 'ALL CHATS' : 'GROUPS/CHANNELS'}
              active={focus === 'chats'}
              width={leftWidth}
            />
            {chats.slice(chatStart, chatStart + listHeight).map((chat) => {
              const current = chat.id === active?.id;
              return (
                <Box
                  key={chat.id}
                  width={leftWidth}
                  height={1}
                  flexShrink={0}
                  backgroundColor={current && focus === 'chats' ? 'yellowBright' : undefined}
                >
                  <Row
                    width={Math.min(6, leftWidth)}
                    bold={current && focus === 'chats'}
                    color={current && focus === 'chats' ? 'black' : current ? 'yellowBright' : 'white'}
                  >{`${current ? '>' : ' '} [${chatTypeLabels[chatType(chat)].symbol}]`}</Row>
                  <Row
                    width={Math.max(0, leftWidth - 6)}
                    bold={current && focus === 'chats'}
                    color={current && focus === 'chats' ? 'black' : current ? 'yellowBright' : 'white'}
                  >
                    {chat.title}
                  </Row>
                </Box>
              );
            })}
            {!chats.length && listHeight > 0 && (
              <Row width={leftWidth}>
                {initialization === 'loading'
                  ? 'Loading chats…'
                  : initialization === 'error'
                    ? 'Loading failed; r Retry'
                    : !state.types.size
                      ? 'All chat types hidden; f to edit'
                      : state.query
                        ? 'No matching loaded chats'
                        : ownOnly
                          ? 'No chats with own messages'
                          : includePrivate
                            ? 'No chats'
                            : 'No groups/channels'}
              </Row>
            )}
          </>
        }
        messages={
          <>
            {(!compactPanes || !inDiscussion) && (
              <MessagePane
                title={active?.isBroadcast ? `POSTS · ${state.view === 'mine' ? 'Mine' : 'All'}` : 'MESSAGES'}
                width={rightWidth}
                height={showDiscussion && !compactPanes ? primaryHeight : listHeight + 1}
                active={focus === 'messages'}
                items={postMessages}
                index={state.messageIndex}
                selected={state.selected}
                status={state.messageStatus}
                showIds={Boolean(active?.isBroadcast)}
                context={
                  showDiscussion
                    ? `Posts: ${state.selected.size} selected · ${state.history.items.length} loaded${compactPanes ? ' · Tab: Discussion' : ''}`
                    : undefined
                }
              />
            )}
            {showDiscussion && (!compactPanes || inDiscussion) && (
              <MessagePane
                title={`DISCUSSION · ${discussion.scope === 'group' ? 'Entire group' : `Post #${postMessages[state.messageIndex]?.id ?? '—'}`} · ${commands.find((command) => command.id === 'discussion')!.key} to change scope`}
                width={rightWidth}
                height={compactPanes ? listHeight + 1 : discussionHeight}
                active={inDiscussion}
                items={discussionMessages}
                index={discussion.messageIndex}
                selected={discussion.selected}
                status={discussion.status}
                context={`${discussion.view === 'mine' ? 'Mine' : 'All'} [v] · ${discussion.history.items.length} loaded · ${discussion.selected.size} selected${compactPanes ? ' · Tab: Posts' : ''}`}
                empty={
                  discussion.error ??
                  (discussion.status === 'stopped'
                    ? 'Stopped; r to retry'
                    : discussion.status === 'none'
                      ? 'No linked discussion group'
                      : undefined)
                }
              />
            )}
          </>
        }
      />
      {selectAllPrompt && (
        <Box
          height={confirmationHeight}
          flexShrink={0}
          flexDirection="column"
          borderColor="cyanBright"
          borderStyle="single"
          overflow="hidden"
        >
          <Row
            width={Math.max(0, lineWidth - 2)}
            bold
            color="cyanBright"
          >{`SELECT OWN: ${history.items.length} messages are loaded.`}</Row>
          <Row width={Math.max(0, lineWidth - 2)}>
            Load the rest of this view and select only your own messages?
          </Row>
          <Row width={Math.max(0, lineWidth - 2)} color="yellowBright">
            Y: load and select own · N: loaded own · Esc: cancel
          </Row>
        </Box>
      )}
      {statusBar}
      {footer}
    </Box>
  );
}
