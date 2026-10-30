import React, {useCallback, useEffect, useReducer, useRef, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {adjustChatPercent, panelWidths, Panels, Row, useTerminalSize} from './ui.js';
import {fetchMessagePage, ownMessageIds} from './messages.js';
import {footerShortcuts, legendRows, ShortcutLegend, type FooterState} from './Footer.js';
import {wrapText} from './text.js';
import {describeError} from './errors.js';
import {commandFor} from './commands.js';
import {Help} from './Help.js';
import {StatusBar, useNotice} from './StatusBar.js';
import {useOperation} from './useOperation.js';
import {Reader} from './Reader.js';
import {Confirmation, confirmationLines} from './Confirmation.js';
import {accountIdentity, type Chat, type TelegramApi} from './telegram.js';
import {settingsStore, validChatPercent, type SettingsStore} from './settings.js';
import {
  appendPage,
  deleteOwnMessages,
  deletionSummary,
  loadMessageHistory,
  scanOwnMessages,
  selectedOwn,
} from './operations.js';
import {createDialogPager} from './dialogs.js';
import type {Message} from './messages.js';
import {initialView, viewReducer, visibleChats} from './state.js';

type Focus = 'chats' | 'messages';
type Prompt =
  | {kind: 'none'}
  | {kind: 'select'}
  | {kind: 'delete'; ids: number[]; chat: Chat; scope: 'selected' | 'entire'; text: string};
type Initialization = 'loading' | 'ready' | 'error';

export function App({client, settings = settingsStore}: {client: TelegramApi; settings?: SettingsStore}) {
  const {exit} = useApp();
  const size = useTerminalSize();
  const [state, dispatch] = useReducer(viewReducer, initialView);
  const {includePrivate, view, history, messageIndex, selected} = state;
  const messages = history.items;
  const hasMore = history.more;
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
  const [detail, setDetail] = useState<Message | null>(null);
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [focus, setFocus] = useState<Focus>('chats');
  const {progress, current: busyRef, begin, cancel} = useOperation();
  const {notice, notify, dismissNotice, resolveValidation} = useNotice();
  const [helpOpen, setHelpOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>({kind: 'none'});
  const confirm = prompt.kind === 'delete' ? prompt : null;
  const selectAllPrompt = prompt.kind === 'select';
  const confirmationText = confirm?.text ?? '';

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
        if (!disposed && task.active) {
          setSelfId(me.id.toString());
          setAccount(accountIdentity(me));
          setInitialization('ready');
          dispatch({type: 'chats', chats: page.chats});
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
  }, [client, retry, begin, notify]);

  const fetchPage = useCallback(
    (chat: Chat, offsetId = 0) => fetchMessagePage(client, chat.entity, selfId, view, offsetId),
    [client, selfId, view],
  );
  const activeId = active?.id;
  const activeEntity = active?.entity;
  useEffect(() => {
    if (!activeId || !activeEntity || !selfId) return;
    const task = begin('Loading');
    if (!task) return;
    let disposed = false;
    void fetchMessagePage(client, activeEntity, selfId, view)
      .then((items) => {
        if (!disposed && task.active)
          dispatch({
            type: 'history',
            chatId: activeId,
            view,
            history: appendPage({items: [], cursor: 0, more: true}, items),
          });
      })
      .catch((error) => {
        if (!disposed && task.active) {
          dispatch({type: 'failed', chatId: activeId, view});
          notify(`Loading failed: ${describeError(error)}. Press r to retry.`, 'error');
        }
      })
      .finally(task.finish);
    return () => {
      disposed = true;
      task.cancelled = true;
      task.finish();
    };
  }, [client, activeId, activeEntity, selfId, view, refresh, begin, notify]);

  useEffect(() => {
    if (initialization === 'ready' && !activeId && !state.query)
      notify(
        includePrivate ? 'No chats found.' : 'No groups or channels found. Press p to show private chats.',
      );
  }, [initialization, activeId, includePrivate, state.query, notify]);

  const loadChats = async () => {
    const pager = dialogPager.current;
    if (!pager || !chatsMore) return;
    const task = begin('Loading chats');
    if (!task) return;
    try {
      const page = await pager.next(task);
      if (!task.active) return;
      dispatch({type: 'chats', chats: [...state.chats, ...page.chats]});
      setChatsMore(page.more);
      if (task.cancelled) notify('Stopped loading chats after the current request.', 'warning');
    } catch (error) {
      if (task.active) notify(`Chat loading failed: ${describeError(error)}`, 'error');
    } finally {
      task.finish();
    }
  };

  const markLoaded = () => dispatch({type: 'selection', ids: new Set(ownMessageIds(messages))});
  const loadHistory = async (selectOwn: boolean, singlePage = false) => {
    if (!active) return;
    const task = begin(selectOwn ? 'Selecting' : 'Loading');
    if (!task) return;
    const chat = active;
    const capturedView = view;
    setPrompt({kind: 'none'});
    let loaded = messages.length;
    try {
      await loadMessageHistory(
        history,
        (cursor) => fetchPage(chat, cursor),
        task,
        (snapshot) => {
          loaded = snapshot.items.length;
          if (!task.active) return;
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
    if (!active) return;
    const chat = {...active};
    const task = begin('Scanning');
    if (!task) return;
    try {
      const ids = await scanOwnMessages(client, chat.entity, task, (count) => task.update(count));
      if (!task.active) return;
      if (task.cancelled) {
        notify(`Scan stopped at ${ids.length} found. Nothing deleted.`, 'warning');
        return;
      }
      if (ids.length) setPrompt({kind: 'delete', ids, chat, scope: 'entire', text: ''});
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
        task.update(result.requested, {total: result.total, verified: result.verified});
      });
      if (!task.active) return;
      notify(deletionSummary(result), result.failure ? 'error' : result.cancelled ? 'warning' : 'result');
      dispatch({type: 'selection', ids: new Set()});
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
  const chatStateLines = wrapText(
    `Chats: ${state.chats.length} loaded; ${chatsMore ? 'more may be available (m)' : initialization === 'ready' ? 'exhausted' : initialization}`,
    lineWidth,
  );
  const chromeHeight = 3 + accountLines.length + chatStateLines.length + searchLines.length;
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
    ),
  );
  const baseHeight = chromeHeight + footerHeight;
  const listHeight = Math.max(0, height - baseHeight - confirmationHeight);
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
    if (helpOpen || noticeOpen || detail) return;
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
        setChatPercent((previous) => adjustChatPercent(previous, input as '[' | ']' | '0'));
        break;
      case 'private':
        dispatch({type: 'private'});
        break;
      case 'view':
        dispatch({type: 'view'});
        break;
      case 'clear':
        dispatch({type: 'selection', ids: new Set()});
        break;
      case 'focus':
        setFocus((previous) => (previous === 'chats' ? 'messages' : 'chats'));
        break;
      case 'up':
      case 'page':
      case 'ends': {
        const count = focus === 'chats' ? chats.length : messages.length;
        const index = focus === 'chats' ? chatIndex : messageIndex;
        const delta =
          (key.upArrow || key.pageUp || input === 'k' ? -1 : 1) *
          (command === 'page' ? Math.max(1, listHeight) : 1);
        const next = key.home ? 0 : key.end ? count - 1 : Math.max(0, Math.min(count - 1, index + delta));
        if (focus === 'chats') dispatch({type: 'active', id: chats[next]?.id});
        else dispatch({type: 'index', index: next});
        break;
      }
      case 'reload':
        if (initialization === 'error') {
          dismissNotice();
          setRetry((value) => value + 1);
        } else {
          dispatch({type: 'reload'});
          setRefresh((value) => value + 1);
        }
        break;
      case 'search':
        setSearch({original: state.query});
        break;
      case 'chats':
        setRetry((value) => value + 1);
        break;
      case 'moreChats':
        void loadChats();
        break;
      case 'detail':
        setDetail(messages[messageIndex] ?? null);
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
        if (next.has(message.id)) next.delete(message.id);
        else next.add(message.id);
        dispatch({type: 'selection', ids: next});
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
        if (ids.length && active)
          setPrompt({kind: 'delete', ids, chat: {...active}, scope: 'selected', text: ''});
        break;
      }
    }
  });

  const chatStart = Math.max(0, chatIndex - listHeight + 1);
  const messageStart = Math.max(0, messageIndex - listHeight + 1);
  const header = (title: string, panel: Focus, width: number) => (
    <Row
      width={width}
      backgroundColor={focus === panel ? 'blueBright' : undefined}
      color={focus === panel ? 'black' : 'white'}
      bold
    >
      {`${focus === panel ? '[ACTIVE]' : '[      ]'} ${title}`}
    </Row>
  );
  const statusBar = (
    <StatusBar
      width={lineWidth}
      view={view}
      loaded={messages.length}
      hasMore={hasMore}
      selected={selected.size}
      progress={progress}
      notice={notice}
    />
  );
  if (detail)
    return (
      <Reader
        title={`MESSAGE ${detail.id} · Read only`}
        text={`${detail.author} · ${detail.date}\n${detail.content}`}
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
      <Row width={lineWidth} bold color="white">{`TG MANAGER / ${active?.title || 'Select chat'}`}</Row>
      {accountLines.map((line, index) => (
        <Row key={`account-${index}`} width={lineWidth}>
          {line}
        </Row>
      ))}
      {chatStateLines.map((line, index) => (
        <Row key={`chats-${index}`} width={lineWidth}>
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
            {header(
              `${includePrivate ? 'ALL CHATS' : 'GROUPS/CHANNELS'} (${chats.length})`,
              'chats',
              leftWidth,
            )}
            {chats.slice(chatStart, chatStart + listHeight).map((chat) => {
              const current = chat.id === active?.id;
              return (
                <Row
                  key={chat.id}
                  width={leftWidth}
                  bold={current && focus === 'chats'}
                  color={current && focus === 'chats' ? 'black' : current ? 'yellowBright' : 'white'}
                  backgroundColor={current && focus === 'chats' ? 'yellowBright' : undefined}
                >{`${current ? '>' : ' '} ${chat.title}`}</Row>
              );
            })}
            {!chats.length && listHeight > 0 && (
              <Row width={leftWidth}>
                {initialization === 'loading'
                  ? 'Loading chats…'
                  : initialization === 'error'
                    ? 'Loading failed; r Retry'
                    : state.query
                      ? 'No matching loaded chats'
                      : includePrivate
                        ? 'No chats'
                        : 'No groups/channels'}
              </Row>
            )}
          </>
        }
        messages={
          <>
            {header(
              `MESSAGES [${view.toUpperCase()}] (${messages.length}) MARKED ${selected.size} — ${active?.title ?? 'No chat'}`,
              'messages',
              rightWidth,
            )}
            {messages.slice(messageStart, messageStart + listHeight).map((message, index) => {
              const current = messageStart + index === messageIndex;
              const checked = selected.has(message.id);
              return (
                <Row
                  key={message.id}
                  width={rightWidth}
                  bold={current && focus === 'messages'}
                  color={
                    current && focus === 'messages'
                      ? 'black'
                      : current
                        ? 'yellowBright'
                        : checked
                          ? 'greenBright'
                          : 'white'
                  }
                  backgroundColor={current && focus === 'messages' ? 'yellowBright' : undefined}
                >
                  {`${current ? '>' : ' '} ${message.own ? (checked ? '[x]' : '[ ]') : '[-]'} ${message.author}: ${message.date} ${message.content}`}
                </Row>
              );
            })}
            {!messages.length && listHeight > 0 && (
              <Row width={rightWidth}>
                {state.messageStatus === 'loading'
                  ? 'Loading messages…'
                  : state.messageStatus === 'error'
                    ? 'Loading failed; r Retry'
                    : 'No messages'}
              </Row>
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
          >{`SELECT OWN: ${messages.length} messages are loaded.`}</Row>
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
