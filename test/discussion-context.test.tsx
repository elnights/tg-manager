import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Api} from 'teleproto';
import {returnBigInt} from 'teleproto/Helpers.js';
import {getPeerId} from 'teleproto/Utils.js';
import {fetchDiscussionPage, type DiscussionContext} from '../src/discussions.js';
import type {Chat, MessageOptions, MessageRecord} from '../src/telegram.js';

const groupPeer = new Api.PeerChannel({channelId: returnBigInt(200)});
const channelPeer = new Api.PeerChannel({channelId: returnBigInt(10)});
const foreignPeer = new Api.PeerChannel({channelId: returnBigInt(999)});
const group: Chat = {
  id: getPeerId(groupPeer),
  entity: 'synthetic-discussion',
  title: 'Synthetic discussion',
  isPrivate: false,
  discussionFor: getPeerId(channelPeer),
};
function message(id: number, replyTo?: Api.MessageReplyHeader): MessageRecord {
  return new Api.Message({
    id,
    peerId: groupPeer,
    date: 0,
    fromId: new Api.PeerUser({userId: returnBigInt(42)}),
    message: `Synthetic message ${id}`,
    replyTo,
  });
}
function root(id: number, postId: number): MessageRecord {
  return new Api.Message({
    id,
    peerId: groupPeer,
    date: 0,
    fromId: channelPeer,
    message: 'Synthetic forwarded post',
    fwdFrom: new Api.MessageFwdHeader({fromId: channelPeer, channelPost: postId, date: 0}),
  });
}
function fixture(page: MessageRecord[], parents: MessageRecord[]) {
  const records = new Map(parents.map((record) => [record.id, record]));
  const calls: MessageOptions[] = [];
  const controls: {afterLookup?: () => void; fail?: boolean} = {};
  const client = {
    async getMessages(entity: unknown, options: MessageOptions) {
      assert.equal(entity, group.entity, 'context lookups stay in the discussion peer');
      calls.push(options);
      if (!options.ids) return page;
      assert.equal(options.fromUser, undefined, 'parents can belong to other authors');
      if (controls.fail) throw new Error('Synthetic context read failed');
      const found = options.ids.map((id) => records.get(id));
      controls.afterLookup?.();
      return found;
    },
  };
  return {client, records, calls, controls};
}

test('nested comment replies resolve their unloaded source through actual Telegram reply headers', async () => {
  const mock = fixture(
    [message(500, new Api.MessageReplyHeader({replyToMsgId: 400}))],
    [
      message(400, new Api.MessageReplyHeader({replyToMsgId: 300})),
      message(300, new Api.MessageReplyHeader({replyToMsgId: 100})),
      root(100, 11),
    ],
  );
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine');
  assert.equal(page[0]?.context, 'Post #11');
  assert.equal(page[0]?.sourcePostId, 11);
  assert.equal(page[0]?.own, true);
  assert.deepEqual(
    mock.calls.filter((call) => call.ids).map((call) => call.ids),
    [[400], [300], [100]],
  );
});

test('a local thread top wins over a quoted message in another peer', async () => {
  const mock = fixture(
    [
      message(
        500,
        new Api.MessageReplyHeader({replyToTopId: 100, replyToPeerId: foreignPeer, replyToMsgId: 123}),
      ),
    ],
    [root(100, 11)],
  );
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine');
  assert.equal(page[0]?.sourcePostId, 11);
  assert.deepEqual(mock.calls.at(-1)?.ids, [100]);
});

test('forwarded content inside a comment keeps the containing thread’s source', async () => {
  const comment = message(500, new Api.MessageReplyHeader({replyToTopId: 100}));
  comment.fwdFrom = new Api.MessageFwdHeader({fromId: channelPeer, channelPost: 99, date: 0});
  const mock = fixture([comment], [root(100, 11)]);
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine');
  assert.equal(page[0]?.sourcePostId, 11);
});

test('absent optional peers and thread IDs still follow the direct reply; hidden forwards remain unavailable', async () => {
  const comment = message(500);
  comment.replyTo = {replyToTopId: null, replyToPeerId: null, replyToMsgId: 100};
  const hidden = message(501, new Api.MessageReplyHeader({replyToMsgId: 101}));
  const hiddenRoot = root(101, 12);
  hiddenRoot.fwdFrom = new Api.MessageFwdHeader({date: 0, fromName: 'Hidden channel'});
  const mock = fixture([comment, hidden], [root(100, 11), hiddenRoot]);
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine');
  assert.equal(page[0]?.sourcePostId, 11);
  assert.equal(page[1]?.context, 'Context unavailable');
});

test('general chat is confirmed by reaching an ordinary group message, including a general reply chain', async () => {
  const mock = fixture(
    [message(500, new Api.MessageReplyHeader({replyToMsgId: 400})), message(501)],
    [message(400, new Api.MessageReplyHeader({replyToMsgId: 300})), message(300)],
  );
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine');
  assert.deepEqual(
    page.map((item) => item.context),
    ['General', 'General'],
  );
  assert.ok(page.every((item) => item.sourcePostId === undefined));
});

test('ancestor lookups batch shared chains and cache only resolved context', async () => {
  const mock = fixture(
    [
      message(500, new Api.MessageReplyHeader({replyToMsgId: 400})),
      message(501, new Api.MessageReplyHeader({replyToMsgId: 401})),
    ],
    [
      message(400, new Api.MessageReplyHeader({replyToMsgId: 100})),
      message(401, new Api.MessageReplyHeader({replyToMsgId: 100})),
      root(100, 11),
    ],
  );
  const contexts = new Map<number, DiscussionContext>();
  const first = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine', 0, contexts);
  assert.deepEqual(
    first.map((item) => item.sourcePostId),
    [11, 11],
  );
  assert.deepEqual(
    mock.calls.filter((call) => call.ids).map((call) => call.ids),
    [[400, 401], [100]],
  );
  const reads = mock.calls.length;
  const next = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine', 0, contexts);
  assert.deepEqual(
    next.map((item) => item.sourcePostId),
    [11, 11],
  );
  assert.equal(mock.calls.length, reads + 1, 'only the visible page needs another read');
});

test('missing ancestors remain unavailable and can be resolved on a later page instead of caching General', async () => {
  const mock = fixture(
    [message(500, new Api.MessageReplyHeader({replyToMsgId: 400}))],
    [message(400, new Api.MessageReplyHeader({replyToMsgId: 100}))],
  );
  const contexts = new Map<number, DiscussionContext>();
  const first = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine', 0, contexts);
  assert.equal(first[0]?.context, 'Context unavailable');
  assert.equal(contexts.size, 0);
  mock.records.set(100, root(100, 11));
  const next = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine', 0, contexts);
  assert.equal(next[0]?.sourcePostId, 11);
});

test('cyclic, sparse, foreign-peer and unreadable context never becomes General', async () => {
  const mock = fixture(
    [
      message(500, new Api.MessageReplyHeader({replyToMsgId: 400})),
      message(501, new Api.MessageReplyHeader({replyToMsgId: 100})),
      message(502, new Api.MessageReplyHeader({replyToPeerId: foreignPeer, replyToMsgId: 200})),
    ],
    [
      message(400, new Api.MessageReplyHeader({replyToMsgId: 300})),
      message(300, new Api.MessageReplyHeader({replyToMsgId: 400})),
      {id: 100},
      root(200, 99),
    ],
  );
  const contexts = new Map<number, DiscussionContext>();
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine', 0, contexts);
  assert.deepEqual(
    page.map((item) => item.context),
    ['Context unavailable', 'Context unavailable', 'Context unavailable'],
  );
  assert.equal(contexts.size, 0);
  assert.ok(mock.calls.length < 6);
  assert.ok(mock.calls.every((call) => !call.ids?.includes(200)));
  mock.controls.fail = true;
  const unreadable = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine');
  assert.equal(unreadable.length, 3);
  assert.ok(unreadable.every((item) => item.context === 'Context unavailable'));
});

test('cancellation keeps visible comments and stops before fetching another ancestor', async () => {
  const mock = fixture(
    [message(500, new Api.MessageReplyHeader({replyToMsgId: 400}))],
    [message(400, new Api.MessageReplyHeader({replyToMsgId: 100})), root(100, 11)],
  );
  const task = {cancelled: false};
  mock.controls.afterLookup = () => {
    task.cancelled = true;
  };
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine', 0, undefined, task);
  assert.equal(page.length, 1);
  assert.equal(page[0]?.context, 'Context unavailable');
  assert.deepEqual(
    mock.calls.filter((call) => call.ids).map((call) => call.ids),
    [[400]],
  );
});

test('very deep reply chains have a bounded lookup budget and remain unavailable when incomplete', async () => {
  const parents = Array.from({length: 99}, (_, index) =>
    message(400 - index, new Api.MessageReplyHeader({replyToMsgId: 399 - index})),
  );
  const mock = fixture([message(500, new Api.MessageReplyHeader({replyToMsgId: 400}))], parents);
  const page = await fetchDiscussionPage(mock.client, {chat: group}, '42', 'mine');
  assert.equal(page[0]?.context, 'Context unavailable');
  assert.ok(mock.calls.length <= 17);
});
