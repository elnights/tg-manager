import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {adjustChatPercent, DEFAULT_CHAT_PERCENT, panelWidths, Panels, Row, useTerminalSize} from './ui.js';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import type {TelegramClient} from 'teleproto';
import {fetchMessagePage, ownMessageIds, PAGE, type Message, type MessageView} from './messages.js';

type Chat = {id: string; title: string; entity: any; isPrivate: boolean};
type Focus = 'chats' | 'messages';
type Confirm = {ids: number[]; chat: Chat; kind: 'selected' | 'all'};
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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState('Connecting...');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [selectAllPrompt, setSelectAllPrompt] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [refresh, setRefresh] = useState(0);
  const chats = includePrivate ? allChats : allChats.filter(chat => !chat.isPrivate);
  const active = chats[chatIndex];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [dialogs, me] = await Promise.all([client.getDialogs({limit: 500}), client.getMe()]);
        if (!cancelled) {
          setSelfId(me.id.toString());
          setChats(dialogs.filter(d => d.entity && (d.isUser || d.isGroup || d.isChannel)).map(d => ({
            id: String(d.id), title: d.title || '(untitled)', entity: d.entity!, isPrivate: d.isUser,
          })));
          setStatus(`Loaded ${dialogs.length} chats (maximum 500).`);
        }
      } catch (e) {if (!cancelled) setStatus(`ERROR: ${String(e)}`);}
    })();
    return () => {cancelled = true;};
  }, [client]);

  const fetchPage = useCallback((chat: Chat, offsetId = 0): Promise<Message[]> =>
    fetchMessagePage(client, chat.entity, selfId, view, offsetId), [client, selfId, view]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setSelected(new Set()); setMessageIndex(0); setHasMore(false);
    if (!active || !selfId) {
      busyRef.current = false; setBusy(false);
      if (selfId) setStatus(includePrivate ? 'No chats found.' : 'No groups or channels found. Press p to show private chats.');
      return;
    }
    busyRef.current = true; setBusy(true); setStatus(`Loading ${active.title}...`);
    void fetchPage(active).then(items => {
      if (cancelled) return;
      setMessages(items); setHasMore(items.length === PAGE);
      setStatus(`Loaded ${items.length} ${view === 'mine' ? 'own messages' : 'messages from all authors'}. L loads all; n loads next page.`);
    }).catch(e => {if (!cancelled) setStatus(`ERROR loading: ${String(e)}`);})
      .finally(() => {if (!cancelled) {busyRef.current = false; setBusy(false);}});
    return () => {cancelled = true;};
  }, [active?.id, selfId, refresh, fetchPage]);

  const loadMore = async () => {
    if (!active || busyRef.current || !hasMore || !messages.length) return;
    busyRef.current = true; setBusy(true);
    try {
      const next = await fetchPage(active, messages[messages.length - 1]!.id);
      setMessages(prev => [...prev, ...next]); setHasMore(next.length === PAGE);
      setStatus(`Loaded ${messages.length + next.length} messages${next.length === PAGE ? '; more available' : '; end of history'}.`);
    } catch (e) {setStatus(`ERROR: ${String(e)}`);}
    finally {busyRef.current = false; setBusy(false);}
  };

  const loadAll = async () => {
    if (!active || busyRef.current || !hasMore) return;
    busyRef.current = true; setBusy(true);
    const current = active;
    let all = [...messages];
    let more: boolean = hasMore;
    setStatus(`Loading entire history for ${current.title}...`);
    try {
      while (more) {
        const next = await fetchPage(current, all[all.length - 1]?.id ?? 0);
        all.push(...next);
        more = next.length === PAGE;
        setMessages([...all]); setHasMore(more);
        setStatus(`Loading all: ${all.length} messages${more ? '...' : ' — complete'}`);
      }
    } catch (e) {setStatus(`Paused after ${all.length} messages: ${String(e)}`);}
    finally {busyRef.current = false; setBusy(false);}
  };

  const markLoaded = () => {
    const ids = ownMessageIds(messages);
    setSelected(new Set(ids));
    setStatus(`Selected ${ids.length} loaded own messages. Nothing deleted.`);
  };

  const selectEntireHistory = async () => {
    if (!active || busyRef.current) return;
    setSelectAllPrompt(false);
    busyRef.current = true; setBusy(true);
    const chat = active;
    let all = [...messages];
    let more = hasMore;
    setSelected(new Set(ownMessageIds(all)));
    try {
      while (more) {
        const next = await fetchPage(chat, all[all.length - 1]?.id ?? 0);
        all = [...all, ...next];
        more = next.length === PAGE;
        setMessages(all);
        setSelected(new Set(ownMessageIds(all)));
        setHasMore(more);
        setStatus(`Selecting own messages: ${ownMessageIds(all).length} marked / ${all.length} loaded${more ? '...' : ' — done'}`);
      }
    } catch (e) {
      setStatus(`Load interrupted at ${all.length}; selected ${ownMessageIds(all).length} own messages: ${String(e)}`);
    } finally {busyRef.current = false; setBusy(false);}
  };

  // Mass delete scans server-side with fromUser: me, independent of UI pagination.
  const scanAll = async () => {
    if (!active || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const chat = active;
    const ids: number[] = [];
    try {
      setStatus('Scanning ALL your messages (no deletions yet)...');
      for await (const msg of client.iterMessages(chat.entity, {fromUser: 'me', limit: undefined})) {
        ids.push(msg.id);
        if (ids.length % 200 === 0) setStatus(`Scanning: ${ids.length} messages found...`);
      }
      setStatus(`Scan complete: ${ids.length} messages. Nothing deleted.`);
      if (ids.length) {setConfirm({kind: 'all', ids, chat}); setConfirmationText('');}
    } catch (e) {setStatus(`Scan failed; nothing deleted: ${String(e)}`);}
    finally {busyRef.current = false; setBusy(false);}
  };

  const doDelete = async () => {
    if (!confirm || busyRef.current) return;
    const {ids, chat} = confirm;
    setConfirm(null); setConfirmationText(''); busyRef.current = true; setBusy(true);
    let requested = 0;
    try {
      for (let i = 0; i < ids.length; i += PAGE) {
        await client.deleteMessages(chat.entity, ids.slice(i, i + PAGE), {revoke: true});
        requested += Math.min(PAGE, ids.length - i);
        setStatus(`Requested deletion: ${requested}/${ids.length}...`);
      }
      setStatus(`Requested deletion of ${requested} messages. Reloading...`);
    } catch (e) {setStatus(`STOPPED after ${requested} requests: ${String(e)}. Reload and verify.`);}
    finally {busyRef.current = false; setBusy(false); setRefresh(v => v + 1);}
  };

  useInput((input, key) => {
    if (selectAllPrompt) {
      if (key.escape || input.toLowerCase() === 'c') {setSelectAllPrompt(false); return;}
      if (input.toLowerCase() === 'n') {setSelectAllPrompt(false); markLoaded(); return;}
      if (input.toLowerCase() === 'y') {void selectEntireHistory(); return;}
      return;
    }
    if (confirm) {
      if (key.escape) {setConfirm(null); setConfirmationText(''); return;}
      if (key.return) {
        if (confirmationText === 'DELETE') void doDelete();
        else setStatus('Enter exactly DELETE to confirm.');
        return;
      }
      if (key.backspace || key.delete) setConfirmationText(t => t.slice(0, -1));
      else if (/^[a-zA-Z]$/.test(input)) setConfirmationText(t => (t + input).slice(0, 12));
      return;
    }
    if (busyRef.current) return;
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
      setStatus(nextChats.length ? `Showing ${nextChats.length} ${nextIncludePrivate ? 'chats including private chats' : 'groups/channels'}.` :
        nextIncludePrivate ? 'No chats found.' : 'No groups or channels found. Press p to show private chats.');
      return;
    }
    if (input === 'c') {
      setSelected(new Set());
      setStatus(selected.size ? `Cleared selection (${selected.size} messages).` : 'No messages selected.');
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
      if (!messages[messageIndex]!.own) {setStatus('Only your own messages can be marked for deletion.'); return;}
      const id = messages[messageIndex]!.id;
      setSelected(prev => {const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;});
    }
    if (input === 'n') void loadMore();
    if (input === 'L') void loadAll();
    if (input === 'd' && selected.size && active) {
      const ids = ownMessageIds(messages, selected);
      if (ids.length) {setConfirm({kind: 'selected', ids, chat: active}); setConfirmationText('');}
    }
  });

  const widths = panelWidths(size.columns, chatPercent);
  const {width: lineWidth, leftWidth, rightWidth} = widths;
  const helpLines = [
    `p ${includePrivate ? 'hide' : 'show'} private chats | v mine/all | c clear selection | r reload | q quit`,
    `[ ] chat width | 0 reset chat width (${DEFAULT_CHAT_PERCENT}%) | Tab panels | Up/Down move`,
    'Space mark | s select own | n next | L all | d delete | A delete all own',
  ];
  const baseHeight = helpLines.length + 3; // title, panel heading, status, help rows
  // Leave Ink's trailing newline a physical row; the remaining layout fits even
  // when a terminal is shorter than the headers, footer and confirmation dialog.
  const height = Math.max(1, size.rows - 1);
  const confirmationHeight = confirm || selectAllPrompt ? 5 : 0;
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

  if (height < baseHeight + confirmationHeight) {
    return <Row width={lineWidth} color="yellowBright">Enlarge the terminal to show the interface.</Row>;
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
        {!chats.length && listHeight > 0 && <Row width={leftWidth} color="gray">{includePrivate ? 'No chats' : 'No groups/channels'}</Row>}
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
    {helpLines.map(line => <Row key={line} width={lineWidth} color="white">{line}</Row>)}
    <Row width={lineWidth} color={status.startsWith('ERROR') || status.startsWith('STOPPED') ? 'redBright' : 'yellowBright'}>
      {`${busy ? '[WORKING] ' : ''}${status}`}
    </Row>
    {selectAllPrompt && <Box height={confirmationHeight} flexShrink={0} flexDirection="column" borderColor="cyanBright" borderStyle="single" overflow="hidden">
      <Row width={Math.max(0, lineWidth - 2)} bold color="cyanBright">{`SELECT OWN: ${messages.length} messages are loaded.`}</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="white">Load the rest of this view and select only your own messages?</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="yellowBright">Y = load and select own | N = select loaded own | Esc = cancel</Row>
    </Box>}
    {confirm && <Box height={confirmationHeight} flexShrink={0} flexDirection="column" borderColor="redBright" borderStyle="double" overflow="hidden">
      <Row width={Math.max(0, lineWidth - 2)} bold color="redBright">{`DELETE ${confirm.ids.length} of YOUR messages in ${confirm.chat.title}?`}</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="white">Deletion can affect other participants and cannot be undone.</Row>
      <Row width={Math.max(0, lineWidth - 2)} color="yellowBright">{`Type DELETE and Enter (Esc to cancel): ${confirmationText}_`}</Row>
    </Box>}
  </Box>;
}
