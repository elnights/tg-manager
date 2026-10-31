import {Api} from 'teleproto';
import {getInputPeer, getPeerId} from 'teleproto/Utils.js';
import {albumRecords, messageRecords, PAGE, type Message, type MessageView} from './messages.js';
import type {Cancellation} from './operations.js';
import type {Chat, MessageRecord, TelegramApi} from './telegram.js';

export type DiscussionTarget = {chat: Chat; postId?: number; rootId?: number};
export type DiscussionContext = {label: string; postId?: number};

function forwardedPost(record: MessageRecord, channelId: string): number | undefined {
  const forward = record.fwdFrom;
  if (!forward || !('channelPost' in forward) || !validId(forward.channelPost)) return;
  if (!('fromId' in forward) || !(forward.fromId instanceof Api.PeerChannel)) return;
  try {
    if (getPeerId(forward.fromId) === channelId) return forward.channelPost;
  } catch {
    /* An incomplete forward cannot establish its source channel. */
  }
}

const MAX_CONTEXT_DEPTH = 16;
const GENERAL: DiscussionContext = {label: 'General'};
const UNAVAILABLE: DiscussionContext = {label: 'Context unavailable'};
function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function postContext(postId: number): DiscussionContext {
  return {label: `Post #${postId}`, postId};
}
function localPeer(peer: unknown, chat: Chat): boolean {
  return peer == null || (peer instanceof Api.PeerChannel && getPeerId(peer) === chat.id);
}
function contextStep(
  record: MessageRecord,
  chat: Chat,
): {context: DiscussionContext} | {parent: number} | undefined {
  const post = forwardedPost(record, chat.discussionFor ?? '');
  if (post !== undefined && (!record.replyTo || record.senderId?.toString() === chat.discussionFor))
    return {context: postContext(post)};
  const reply = record.replyTo;
  if (reply) {
    // The thread top belongs to this discussion even when the direct reply
    // quotes a message from another chat. Only direct IDs use replyToPeerId.
    const top = 'replyToTopId' in reply ? reply.replyToTopId : undefined;
    if (validId(top)) return {parent: top};
    const direct = 'replyToMsgId' in reply ? reply.replyToMsgId : undefined;
    const peer = 'replyToPeerId' in reply ? reply.replyToPeerId : undefined;
    if (validId(direct) && localPeer(peer, chat)) return {parent: direct};
    return;
  }
  // Incomplete/hidden forwards and sparse lookup records are not evidence of
  // general conversation. A forwarded channel post may have unavailable context.
  if (record.fwdFrom || (chat.discussionFor && record.senderId?.toString() === chat.discussionFor)) return;
  if (typeof record.message === 'string' || record.media || record.className === 'MessageService')
    return {context: GENERAL};
}

async function resolveContexts(
  client: Pick<TelegramApi, 'getMessages'>,
  chat: Chat,
  records: readonly (MessageRecord | undefined)[],
  contexts: Map<number, DiscussionContext>,
  task: Cancellation,
): Promise<Map<number, DiscussionContext>> {
  const known = new Map<number, MessageRecord>();
  const keep = (record: MessageRecord | undefined) => {
    if (!record || record.className === 'MessageEmpty' || !localPeer(record.peerId, chat)) return;
    known.set(record.id, record);
  };
  records.forEach(keep);
  type Resolution = {context: DiscussionContext} | {missing: number} | undefined;
  const remember = (path: number[], context: DiscussionContext): Resolution => {
    for (const id of path) contexts.set(id, context);
    while (contexts.size > 300) contexts.delete(contexts.keys().next().value!);
    return {context};
  };
  const walk = (start: number): Resolution => {
    const path: number[] = [];
    const seen = new Set<number>();
    let id = start;
    for (let depth = 0; depth <= MAX_CONTEXT_DEPTH; depth++) {
      if (seen.has(id)) return;
      seen.add(id);
      const cached = contexts.get(id);
      if (cached) return remember(path, cached);
      const record = known.get(id);
      if (!record) return {missing: id};
      path.push(id);
      const step = contextStep(record, chat);
      if (!step) return;
      if ('context' in step) return remember(path, step.context);
      id = step.parent;
    }
  };
  const attempted = new Set<number>();
  for (let depth = 0; depth < MAX_CONTEXT_DEPTH && !task.cancelled; depth++) {
    const missing = new Set<number>();
    for (const record of records) {
      if (!record) continue;
      const result = walk(record.id);
      if (result && 'missing' in result && !attempted.has(result.missing)) missing.add(result.missing);
    }
    const ids = [...missing].slice(0, PAGE);
    if (!ids.length) break;
    ids.forEach((id) => attempted.add(id));
    const requested = new Set(ids);
    try {
      for (const record of await client.getMessages(chat.entity, {ids}))
        if (record && requested.has(record.id)) keep(record);
    } catch {
      // Keep the received page; failed lookups stay unavailable and uncached.
      break;
    }
  }
  return new Map(
    records.flatMap((record) => {
      if (!record) return [];
      const result = walk(record.id);
      return [[record.id, result && 'context' in result ? result.context : UNAVAILABLE]];
    }),
  );
}

export async function discussionThread(
  client: TelegramApi,
  channel: Chat,
  group: Chat,
  postId: number,
  groupedId?: string,
  task: Cancellation = {cancelled: false},
  resolveAlbum: typeof albumRecords = albumRecords,
): Promise<DiscussionTarget | undefined> {
  if (!client.api?.messages) throw new Error('This client cannot resolve post discussions.');
  if (task.cancelled) return;
  const sourceIds = new Set([postId]);
  let threadPostId = postId;
  if (groupedId) {
    // Telegram albums contain at most ten consecutive messages. Read both
    // sides so the thread owner need not be in the loaded page or Mine view.
    const album = await resolveAlbum(client, channel, postId, groupedId);
    if (task.cancelled) return;
    for (const record of album) sourceIds.add(record.id);
    // Captions can belong to any item; thread metadata identifies the owner.
    threadPostId = (album.find((record) => record.replies) ?? album[0])?.id ?? postId;
  }
  let response;
  try {
    response = await client.api.messages.getDiscussionMessage({
      peer: getInputPeer(channel.entity),
      msgId: threadPostId,
    });
  } catch (error) {
    // A removed/disabled discussion is an unavailable post, not a failed
    // group read. In particular, it must never fall back to the entire group.
    if (
      error &&
      typeof error === 'object' &&
      'errorMessage' in error &&
      error.errorMessage === 'MSG_ID_INVALID'
    )
      return;
    throw error;
  }
  if (!response.messages.length) return;
  // Album forwards have distinct group message IDs, but replies belong to the first
  // item. Validate every candidate against the source channel and album.
  const root = response.messages
    .filter(
      (record) =>
        validId(record.id) &&
        record.peerId &&
        getPeerId(record.peerId) === group.id &&
        sourceIds.has(forwardedPost(record, channel.id) ?? 0),
    )
    .sort((a, b) => a.id - b.id)[0];
  if (!root) throw new Error('No accessible discussion thread for this post.');
  return {chat: group, postId: forwardedPost(root, channel.id)!, rootId: root.id};
}

export async function fetchDiscussionPage(
  client: Pick<TelegramApi, 'getMessages'>,
  target: DiscussionTarget,
  selfId: string,
  view: MessageView,
  cursor = 0,
  contexts = new Map<number, DiscussionContext>(),
  task: Cancellation = {cancelled: false},
): Promise<Message[]> {
  const {chat, rootId, postId} = target;
  // Teleproto chooses GetReplies before its sender-search branch. Mine in a
  // thread must use topMsgId + fromUser, never replyTo + fromUser.
  const records = await client.getMessages(chat.entity, {
    limit: PAGE,
    offsetId: cursor,
    ...(view === 'mine' ? {fromUser: 'me' as const} : {}),
    ...(rootId === undefined ? {} : view === 'mine' ? {topMsgId: rootId} : {replyTo: rootId}),
  });
  const messages = messageRecords(records, selfId, view);
  if (postId !== undefined)
    return messages.map((message) => ({...message, context: `Post #${postId}`, sourcePostId: postId}));
  const resolved = await resolveContexts(client, chat, records, contexts, task);
  return messages.map((message) => {
    const context = resolved.get(message.id) ?? UNAVAILABLE;
    return {
      ...message,
      context: context.label,
      ...(context.postId === undefined ? {} : {sourcePostId: context.postId}),
    };
  });
}
