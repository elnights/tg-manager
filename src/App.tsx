import React, {useCallback, useEffect, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {adjustChatPercent, DEFAULT_CHAT_PERCENT, panelWidths, Panels, Row, useTerminalSize} from './ui.js';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import type {TelegramClient} from 'teleproto';
import {absentMessageIds, fetchMessagePage, ownMessageIds, PAGE, type Message, type MessageView} from './messages.js';
import {Footer} from './Footer.js';
import {Help} from './Help.js';
import {StatusBar, useNotice} from './StatusBar.js';
import {useOperation} from './useOperation.js';

type Chat = {id: string; title: string; entity: any; isPrivate: boolean};
type Focus = 'chats' | 'messages';
type Confirm = {ids: number[]; chat: Chat};
const CONFIG_PATH = join(homedir(), '.config', 'tg-manager', 'settings.json');
function readChatPercent(): number {
  try {
    const value = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).chatPercent;
    return Number.isFinite(value) && value >= 20 && value <= 70 ? value : DEFAULT_CHAT_PERCENT;
  } catch { return DEFAULT_CHAT_PERCENT; }
}
function saveChatPercent(chatPercent: number): void {
  try {
    mkdirSync(dirname(CONFIG_PATH), {recursive: true, mode: 0o700});
    writeFileSync(CONFIG_PATH, JSON.stringify({chatPercent}, null, 2) + '\n', {mode: 0o600});
  } catch { /* Settings can remain in memory if home is read-only. */ }
}
export function App({client}: {client: TelegramClient}) {
  const {exit} = useApp();
  const size = useTerminalSize();
  const [chatPercent, setChatPercent] = useState(readChatPercent);
  const [allChats, setChats] = useState<Chat[]>([]);
  const [includePrivate, setIncludePrivate] = useState(false);
  const [chatIndex, setChatIndex] = useState(0);
  const [selfId, setSelfId] = useState('');
  const [view, setView] = useState<MessageView>('mine');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageIndex, setMessageIndex] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState<Focus>('chats');
  const [hasMore, setHasMore] = useState(false);
  const {progress, current: busyRef, begin, cancel} = useOperation();
  const {notice, notify, dismissNotice} = useNotice();
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [selectAllPrompt, setSelectAllPrompt] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [refresh, setRefresh] = useState(0);
  const chats = includePrivate ? allChats : allChats.filter(chat => !chat.isPrivate);
  const active = chats[chatIndex];

  useEffect(() => {
    let disposed = false;
    const task = begin('Connecting');
    void (async () => {
      try {
        const [dialogs, me] = await Promise.all([client.getDialogs({limit: 500}), client.getMe()]);
        if (!disposed) {
          setSelfId(me.id.toString());
          setChats(dialogs.filter(d => d.entity && (d.isUser || d.isGroup || d.isChannel)).map(d => ({
            id: String(d.id), title: d.title || '(untitled)', entity: d.entity!, isPrivate: d.isUser,
          })));
          notify(`Loaded ${dialogs.length} chats (maximum 500).`);
        }
      } catch (e) {if (!disposed) notify(`Connecting failed: ${String(e)}`, 'error');}
      finally {task?.finish();}
    })();
    return () => {disposed = true; task?.finish();};
  }, [client]);

  const fetchPage = useCallback((chat: Chat, offsetId = 0): Promise<Message[]> =>
    fetchMessagePage(client, chat.entity, selfId, view, offsetId), [client, selfId, view]);

  useEffect(() => {
    let disposed = false;
    setMessages([]); setSelected(new Set()); setMessageIndex(0); setHasMore(false);
    if (!active || !selfId) {
      if (selfId) notify(includePrivate ? 'No chats found.' : 'No groups or channels found. Press p to show private chats.');
      return;
    }
    const task = begin('Loading');
    void fetchPage(active).then(items => {
      if (disposed) return;
      setMessages(items); setHasMore(items.length === PAGE);
      notify(`Loaded ${items.length} ${view === 'mine' ? 'own messages' : 'messages from all authors'}.`);
    }).catch(e => {if (!disposed) notify(`Loading failed: ${String(e)}`, 'error');})
      .finally(() => {if (!disposed) task?.finish();});
    return () => {disposed = true; task?.finish();};
  }, [active?.id, selfId, refresh, fetchPage]);

  const loadMore = async () => {
    if (!active || !hasMore || !messages.length) return;
    const task = begin('Loading');
    if (!task) return;
    try {
      const next = await fetchPage(active, messages[messages.length - 1]!.id);
      const seen = new Set(messages.map(message => message.id));
      const unique = next.filter(item => !seen.has(item.id));
      if (next.length === PAGE && !unique.length) throw new Error('Pagination did not advance; reload to retry.');
      setMessages(prev => [...prev, ...unique]); setHasMore(next.length === PAGE);
      notify(`Loaded ${messages.length + unique.length} messages${next.length === PAGE ? '; more available' : '; end of history'}.`);
    } catch (e) {notify(`Loading failed: ${String(e)}`, 'error');}
    finally {task.finish();}
  };

  const markLoaded = () => {
    const ids = ownMessageIds(messages);
    setSelected(new Set(ids));
    notify(`Selected ${ids.length} loaded own messages. Nothing deleted.`);
  };

  // Keep the scan in local collections; publish snapshots at most every 120 ms
  // and always once on completion/cancellation, rather than cloning per page.
  const loadHistory = async (selectOwn: boolean) => {
    if (!active) return;
    const task = begin(selectOwn ? 'Selecting' : 'Loading');
    if (!task) return;
    setSelectAllPrompt(false);
    const all = [...messages];
    const seen = new Set(all.map(message => message.id));
    const own = new Set(ownMessageIds(all));
    let more = hasMore;
    const publish = () => {
      setMessages([...all]); setHasMore(more);
      if (selectOwn) setSelected(new Set(own));
    };
    try {
      while (more && !task.cancelled) {
        const next = await fetchPage(active, all[all.length - 1]?.id ?? 0);
        let added = 0;
        for (const item of next) if (!seen.has(item.id)) {
          all.push(item); seen.add(item.id); added++;
          if (item.own) own.add(item.id);
        }
        more = next.length === PAGE;
        if (more && !added) throw new Error('Pagination did not advance; reload to retry.');
        if (task.update(all.length)) publish();
      }
      notify(task.cancelled ? `Stopped ${selectOwn ? 'selecting' : 'loading'} at ${all.length} loaded. Nothing deleted.` :
        selectOwn ? `Selected ${own.size} own / ${all.length} loaded. Nothing deleted.` : `Loaded entire view: ${all.length} messages.`, task.cancelled ? 'warning' : 'info');
    } catch (e) {notify(`Stopped at ${all.length} loaded: ${String(e)}`, 'error');}
    finally {publish(); task.finish();}
  };

  // Mass deletion scans server-side with fromUser: me, independent of UI pagination.
  const scanAll = async () => {
    if (!active) return;
    const task = begin('Scanning');
    if (!task) return;
    const ids = new Set<number>();
    try {
      for await (const msg of client.iterMessages(active.entity, {fromUser: 'me', limit: undefined})) {
        if (task.cancelled) break;
        ids.add(msg.id); task.update(ids.size);
      }
      if (task.cancelled) {notify(`Scan stopped at ${ids.size} found. Nothing deleted.`, 'warning'); return;}
      notify(`Scan complete: ${ids.size} messages. Nothing deleted.`);
      if (ids.size) {setConfirm({ids: [...ids], chat: active}); setConfirmationText('');}
    } catch (e) {notify(`Scan failed; nothing deleted: ${String(e)}`, 'error');}
    finally {task.finish();}
  };

  const doDelete = async () => {
    if (!confirm || confirmationText !== 'DELETE') return;
    const task = begin('Deleting');
    if (!task) return;
    const {ids, chat} = confirm;
    setConfirm(null); setConfirmationText('');
    let requested = 0;
    let verified = 0;
    let failure: unknown;
    try {
      for (let i = 0; i < ids.length && !task.cancelled; i += PAGE) {
        const batch = ids.slice(i, i + PAGE);
        await client.deleteMessages(chat.entity, batch, {revoke: true});
        requested += batch.length;
        task.update(requested, {total: ids.length, verified});
        // Even after Esc, verify the in-flight batch before stopping.
        const absent = new Set(await absentMessageIds(client, chat.entity, batch));
        verified += absent.size;
        setMessages(previous => previous.filter(message => !absent.has(message.id)));
        setSelected(previous => new Set([...previous].filter(id => !absent.has(id))));
        task.update(requested, {total: ids.length, verified});
        if (absent.size !== batch.length) throw new Error('Some requested messages are still present; reload and verify before retrying.');
      }
    } catch (e) {failure = e;}
    finally {
      notify(`${task.cancelled ? 'Stopped. ' : ''}${requested} / ${ids.length} requested; ${verified} verified absent.${failure ? ` ${String(failure)} An unsuccessful request may still have taken effect.` : ''}`,
        failure ? 'error' : task.cancelled ? 'warning' : 'result');
      task.finish(); setRefresh(value => value + 1);
    }
  };

  useInput((input, key) => {
    if (helpOpen) return;
    if (input === '?') {setHelpOpen(true); return;}
    if (selectAllPrompt) {
      if (key.escape || input.toLowerCase() === 'c') {setSelectAllPrompt(false); return;}
      if (input.toLowerCase() === 'n') {setSelectAllPrompt(false); markLoaded(); return;}
      if (input.toLowerCase() === 'y') {void loadHistory(true); return;}
      return;
    }
    if (confirm) {
      if (key.escape) {setConfirm(null); setConfirmationText(''); return;}
      // Never accept a destructive confirmation while its context is hidden by
      // the small-terminal fallback. Help and cancellation still work.
      if (size.rows < 10 || size.columns < 25) return;
      if (key.return) {
        if (confirmationText === 'DELETE') void doDelete();
        else notify('Enter exactly DELETE to confirm.', 'warning');
        return;
      }
      if (key.backspace || key.delete) setConfirmationText(t => t.slice(0, -1));
      else if (/^[a-zA-Z]$/.test(input)) setConfirmationText(t => (t + input).slice(0, 12));
      return;
    }
    if (busyRef.current) {
      if (key.escape) {dismissNotice(); cancel();}
      return;
    }
    if (key.escape) {dismissNotice(); return;}
    if (input === '[' || input === ']' || input === '0') {
      setChatPercent(previous => {
        const next = adjustChatPercent(previous, input);
        saveChatPercent(next);
        return next;
      });
      return;
    }
    if (input === 'q') {exit(); return;}
    if (input === 'p') {
      const nextIncludePrivate = !includePrivate;
      const nextChats = nextIncludePrivate ? allChats : allChats.filter(chat => !chat.isPrivate);
      const nextIndex = Math.max(0, nextChats.findIndex(chat => chat.id === active?.id));
      setIncludePrivate(nextIncludePrivate);
      setChatIndex(nextIndex);
      if (nextChats[nextIndex]?.id !== active?.id) {
        setMessages([]); setSelected(new Set()); setMessageIndex(0); setHasMore(false);
      }
      notify(nextChats.length ? `Showing ${nextChats.length} ${nextIncludePrivate ? 'chats including private chats' : 'groups/channels'}.` :
        nextIncludePrivate ? 'No chats found.' : 'No groups or channels found. Press p to show private chats.');
      return;
    }
    if (input === 'c') {
      setSelected(new Set());
      notify(selected.size ? `Cleared selection (${selected.size} messages).` : 'No messages selected.');
      return;
    }
    if (input === 'v') {
      setSelected(new Set()); setMessages([]); setMessageIndex(0); setHasMore(false);
      setView(previous => previous === 'mine' ? 'all' : 'mine');
      return;
    }
    if (key.tab || key.leftArrow || key.rightArrow) {setFocus(f => f === 'chats' ? 'messages' : 'chats'); return;}
    if (key.upArrow || input === 'k') {
      if (focus === 'chats') setChatIndex(i => Math.max(0, i - 1));
      else setMessageIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      if (focus === 'chats') setChatIndex(i => Math.max(0, Math.min(chats.length - 1, i + 1)));
      else setMessageIndex(i => Math.max(0, Math.min(messages.length - 1, i + 1)));
      return;
    }
    if (input === 'r') {setRefresh(n => n + 1); return;}
    if (input === 'A') {void scanAll(); return;}
    if (input === 's' && focus === 'messages') {
      if (hasMore) setSelectAllPrompt(true);
      else markLoaded();
      return;
    }
    if (focus !== 'messages') return;
    if (input === ' ' && messages[messageIndex]) {
      if (!messages[messageIndex]!.own) {notify('Only your own messages can be marked for deletion.'); return;}
      const id = messages[messageIndex]!.id;
      setSelected(prev => {const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;});
    }
    if (input === 'n') void loadMore();
    if (input === 'L') void loadHistory(false);
    if (input === 'd' && selected.size && active) {
      const ids = ownMessageIds(messages, selected);
      if (ids.length) {setConfirm({ids, chat: active}); setConfirmationText('');}
    }
  });

  const widths = panelWidths(size.columns, chatPercent);
  const {width: lineWidth, leftWidth, rightWidth} = widths;
  const height = Math.max(1, size.rows - 1);
  const confirmationHeight = confirm || selectAllPrompt ? 5 : 0;
  const baseHeight = 4; // title, panel heading, status, footer
  const listHeight = Math.max(0, height - baseHeight - confirmationHeight);
  const chatStart = Math.max(0, chatIndex - listHeight + 1);
  const messageStart = Math.max(0, messageIndex - listHeight + 1);
  const visibleChats = chats.slice(chatStart, chatStart + listHeight);
  const visibleMessages = messages.slice(messageStart, messageStart + listHeight);
  const header = (title: string, panel: Focus, width: number) =>
    <Row width={width} backgroundColor={focus === panel ? 'blueBright' : undefined}
      color={focus === panel ? 'black' : 'white'} bold>
      {`${focus === panel ? '[ACTIVE]' : '[      ]'} ${title}`}
    </Row>;

  const footer = <Footer width={lineWidth} focus={focus} busy={Boolean(progress)} cancelling={Boolean(progress?.cancelling)}
    confirm={Boolean(confirm)} canConfirm={confirmationText === 'DELETE' && height >= baseHeight + confirmationHeight && lineWidth >= 24} selectPrompt={selectAllPrompt}
    hasChat={Boolean(active)} canNavigate={focus === 'chats' ? chats.length > 1 : messages.length > 1}
    canSelect={Boolean(messages[messageIndex]?.own)} hasOwn={messages.some(message => message.own)}
    selected={selected.size} hasMore={hasMore} includePrivate={includePrivate}/>;
  const statusBar = <StatusBar width={lineWidth} view={view} loaded={messages.length} hasMore={hasMore}
    selected={selected.size} progress={progress} notice={notice}/>;

  if (helpOpen) return <Help width={lineWidth} height={height} onClose={() => setHelpOpen(false)}/>;
  if (height < baseHeight + confirmationHeight || lineWidth < 24) {
    return <Box width={lineWidth} height={height} flexDirection="column" overflow="hidden">
      <Box height={Math.max(0, height - 2)} flexShrink={0} flexDirection="column" overflow="hidden">
        <Row width={lineWidth} color="yellowBright">Enlarge the terminal to show the interface.</Row>
      </Box>
      {height >= 2 && statusBar}
      {footer}
    </Box>;
  }

  return <Box flexDirection="column" width={lineWidth} height={height} overflow="hidden">
    <Row width={lineWidth} bold color="white">{`TG MANAGER / ${active?.title || 'Select chat'}`}</Row>
    <Panels widths={widths} height={listHeight + 1}
      chats={<>
        {header(`${includePrivate ? 'ALL CHATS' : 'GROUPS/CHANNELS'} (${chats.length})`, 'chats', leftWidth)}
        {visibleChats.map((chat, i) => {
          const current = chatStart + i === chatIndex;
          const focused = focus === 'chats';
          return <Row key={chat.id} width={leftWidth} bold={current && focused}
            color={current && focused ? 'black' : current ? 'yellowBright' : 'white'}
            backgroundColor={current && focused ? 'yellowBright' : undefined}>
            {`${current ? '>' : ' '} ${chat.title}`}
          </Row>;
        })}
        {!chats.length && listHeight > 0 && <Row width={leftWidth} color="white">{includePrivate ? 'No chats' : 'No groups/channels'}</Row>}
      </>}
      messages={<>
        {header(`MESSAGES [${view.toUpperCase()}] (${messages.length}${hasMore ? '+' : ''}) MARKED ${selected.size} — ${active?.title ?? 'No chat'}`, 'messages', rightWidth)}
        {visibleMessages.map((message, i) => {
          const current = messageStart + i === messageIndex;
          const focused = focus === 'messages';
          const checked = selected.has(message.id);
          const line = `${current ? '>' : ' '} ${message.own ? checked ? '[x]' : '[ ]' : '[-]'} ${message.author}: ${message.date} ${message.content}`;
          return <Row key={message.id} width={rightWidth} bold={current && focused}
            color={current && focused ? 'black' : current ? 'yellowBright' : checked ? 'greenBright' : 'white'}
            backgroundColor={current && focused ? 'yellowBright' : undefined}>
            {line}
          </Row>;
        })}
        {!messages.length && listHeight > 0 && <Row width={rightWidth} color="white">No messages</Row>}
      </>}/>
    {selectAllPrompt && <Box height={confirmationHeight} flexShrink={0} flexDirection="column" borderColor="cyanBright" borderStyle="single" overflow="hidden">
      <Row width={Math.max(0, lineWidth - 2)} bold color="cyanBright">{`SELECT OWN: ${messages.length} messages are loaded.`}</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="white">Load the rest of this view and select only your own messages?</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="yellowBright">Y: load and select own · N: loaded own · Esc: cancel</Row>
    </Box>}
    {confirm && <Box height={confirmationHeight} flexShrink={0} flexDirection="column" borderColor="redBright" borderStyle="double" overflow="hidden">
      <Row width={Math.max(0, lineWidth - 2)} bold color="redBright">{`DELETE ${confirm.ids.length} of YOUR messages in ${confirm.chat.title}?`}</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="white">Deletion can affect other participants and cannot be undone.</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="yellowBright">{`Type DELETE and Enter (Esc to cancel): ${confirmationText}_`}</Row>
    </Box>}
    {statusBar}
    {footer}
  </Box>;
}
