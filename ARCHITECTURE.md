# Architecture and maintenance guide

Repository implementation notes for agents and contributors. Keep this guide
about current responsibilities and invariants; record user-visible changes in
CHANGELOG.md and validation results in the PR. This file stays outside the npm
package's allowlist.

## Module map

| Area              | Files                                                                                                                                         | Responsibility                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Startup           | `src/cli.ts`, `src/index.tsx`, `src/client.ts`                                                                                                | CLI options, credentials, client connection/disconnection, session persistence and terminal lifecycle                                 |
| Login             | `src/CredentialPrompt.tsx`, `src/credentials.ts`, `src/Auth.tsx`                                                                              | Credential validation, QR/cloud-password input, retries and cancellation                                                              |
| Controller        | `src/App.tsx`, `src/state.ts`, `src/useDiscussion.ts`, `src/browseCache.ts`                                                                   | Effects, initialization/retry, active chat/view, filtering, atomic selection changes and captured prompts                             |
| Telegram boundary | `src/telegram.ts`, `src/messages.ts`, `src/discussions.ts`                                                                                    | Narrow client interfaces, typed records, linked discussion resolution, message conversion, authorship checks and absence verification |
| Operations        | `src/operations.ts`, `src/dialogs.ts`, `src/useOperation.ts`                                                                                  | Pagination, own-message scanning, verified deletion and operation lifecycle                                                           |
| Commands          | `src/commands.ts`                                                                                                                             | Bindings, aliases, availability, footer labels and help data, including prompts/readers                                               |
| UI                | `src/MessagePane.tsx`, `src/Confirmation.tsx`, `src/Reader.tsx`, `src/Help.tsx`, `src/Footer.tsx`, `src/StatusBar.tsx`, `src/ViewOptions.tsx` | Measured confirmation, isolated scrolling overlays, footer, progress and persistent notices                                           |
| Terminal text     | `src/ui.tsx`, `src/text.ts`, `src/terminal-output.ts`                                                                                         | Panel dimensions, grapheme-safe rows/wrapping and physical terminal-cell repair                                                       |
| Storage           | `src/session.ts`, `src/credentialStore.ts`, `src/settings.ts`                                                                                 | Private session storage/migration, opt-in API credential storage and injectable layout settings                                       |

`src/media.ts` handles attachment metadata, bounded downloads, JPEG decoding and
private temporary viewer files. `src/MessageDetails.tsx` owns detail-view transfers
and portable image rows; `src/DiscussionDetails.tsx` pairs captured channel-post
details on the left with read-only thread comments on the right. The main
`useDiscussion` instance owns the Mine/All filter shared with details; each reader
keeps its own focus, pagination and scrolling. Details always use the captured
post/album thread. Changing the shared filter clears discussion marks, including
rapid toggles back to a cached view, while preserving post marks. Narrow terminals
show one focused pane. Closing details restores the main screen's focus; `src/Reader.tsx` owns their scrolling and advertised keys.
Album details use single-row section headers and preview boundaries within the
reader's scrolling body; the current item has a textual marker and white text
on dark blue in both its preview header and the item list.

Keep the Ink/React/TypeScript app small. Share related behavior at these existing
boundaries before introducing another abstraction or runtime dependency. The
package exposes a CLI, with no supported programmatic API.

## Safety invariants

### Identity, selection and confirmation

- Use stable chat IDs, never a list index or title, to associate state and results.
  `viewReducer` clears messages and selection atomically when the active chat or
  message view changes. Filtering/refreshing preserves marks if the active chat
  remains visible. Own-chat filtering applies completed server-filtered existence
  checks by stable chat ID, independently of the message-author view. Recheck new
  dialog pages and refreshed lists; failed/cancelled checks turn the filter off
  and retain received dialogs. Refreshing a chat after its last own message is
  deleted removes it atomically from the filtered list.
- Chat types are mutually exclusive: private, bot, basic group, supergroup and
  broadcast channel. Apply a set of enabled types atomically, composing it with
  title/ID search and own-chat filtering. Type badges use a fixed terminal-cell
  column. A type filter affects dialogs, not a visible channel’s linked pane.
- Broadcast channels retain their identity in the chat list. Posts default to All;
  an independent discussion pane defaults to Entire group + Mine. Entire group
  includes general chat. Own-chat checks retain the source channel for own posts
  or messages anywhere in its discussion; do not insert synthetic group dialogs.
- Resolve linked groups using `channels.getFullChannel` and post roots using
  `messages.getDiscussionMessage`. Validate the returned group peer and forwarded
  source channel/post before using a thread ID. Never substitute the channel on
  failure or join implicitly. Preserve exact album (`groupedId`) identifiers;
  resolve sibling items in a bounded source-channel lookup independent of loaded
  pages and author filters. Use thread metadata or the first album item, never
  caption position, to request the discussion; use the first validated forwarded
  album message as its shared group root. `MSG_ID_INVALID` and empty discussion
  responses leave the post discussion unavailable with no operation target or
  persistent footer error. Other RPC/validation failures remain errors; an
  unavailable post must never fetch or scan the entire group.
  Carry a typed source post ID alongside context
  labels; never derive navigation targets by parsing display strings. Direct
  replies fall back from an absent top ID to the reply ID. Follow same-group
  reply chains in batches until a forwarded source post or confirmed ordinary
  group root is reached; do not assume the direct parent is the thread root.
  A valid local thread top takes precedence over a cross-peer quote; foreign
  direct reply IDs cannot reuse a coincident group message ID. Cycles, missing
  or partial metadata, failed reads and the 16-hop lookup limit remain Context
  unavailable and uncached, never General. Cache only resolved paths, bounded to
  300 IDs per group/source. Context discovery never requires loaded channel posts
  and checks cancellation before requesting another ancestor batch. Thread Mine uses `topMsgId` + `fromUser`; Teleproto
  ignores its sender filter in the `replyTo`/GetReplies branch. Thread All uses
  `replyTo`. Group context lookups are batched, bounded and independent of loaded
  channel posts. Failed/unresolved context labels never discard message rows.
- Each message pane owns its cursor, authors, pagination and marks. Changing
  channel/thread/view clears the affected marks immediately. Discussion results
  carry a source/scope/post/view/revision key; reject late responses. Debounce
  post changes and bound cached pages; refresh/deletion invalidates caches.
  Automatic discussion reads allow post navigation, while explicit load/scan/
  deletion operations keep their existing synchronous duplicate guard.
- Automatic chat and discussion reads wait 200 ms after navigation and never
  acquire the explicit-operation guard. Fresh histories restore without waiting;
  refresh bypasses the debounce. App-owned `BrowseCache` separates client/account,
  peer, scope/thread/album and author view, shares in-flight reads with independent
  cancellation consumers, and expires data after 60 seconds. Retain at most 20
  histories of three pages, preserving a real pagination cursor, plus 60 read
  resources and 60 scroll positions. Cache positions, never deletion marks.
  Refresh/deletion clears caches and prevents pending reads from repopulating
  invalidated resources. Verification and own-message scans always use the raw
  client. Decoded thumbnails have a separate 4 MiB budget and use original source
  object identity, never bare message IDs; originals remain explicit downloads.
- Histories retain individual messages and raw pagination cursors; `messageRows`
  groups albums only for presentation and navigation. An album keeps the first
  loaded item's row ID as older members arrive. Source-post navigation matches
  every member ID. Marking a row toggles only its owned loaded members; new page
  members remain unmarked, and partial selection uses `[~]`. Selection counts,
  deletion confirmations and verification always count individual message IDs.
  Details capture the row and peer, resolve missing album items read-only, and
  never add those inspection results to history or selection. Each attachment
  uses its original message object; switching details items aborts its transfer.
- Focusing a linked discussion row highlights its channel post while keeping
  keyboard focus in the discussion. `g` explicitly transfers focus. A missing
  loaded post is located with a contiguous All-authors page and a real cursor;
  require the exact source ID before replacing history. Switch Posts to All
  atomically, clearing marks on a view change and retaining only visible own
  marks otherwise. Preserve discussion selection. Stale/cancelled lookups and
  open prompts/readers cannot retarget either pane. Refresh after deletion
  revalidates history without clearing unrelated post marks.
- Deletion captures the focused pane, actual peer, IDs and source/thread scope.
  A selected-post scan must include the resolved thread filter; Entire group
  scans include general chat. Channel and group message IDs can overlap and
  must never share a selection or verification namespace.
- Only own messages may enter a deletion target. Mine uses Telegram's own-message
  filter; All checks sender identity or outgoing private-message metadata. An
  outgoing channel post alone is insufficient proof of authorship.
- Capture the chat entity and message IDs when opening confirmation. Help must
  preserve that snapshot and typed input; other navigation cannot retarget it.
- Accept deletion only when account/target ID, bounded title, exact count, scope,
  irreversible warning, full input and accepted keys fit. Recheck on resize.
  Require exact uppercase `DELETE` and a separate Enter event; paste cannot submit.

### Operations and cancellation

- Media comes from the captured message object, including the correct discussion
  peer; never cache attachments by bare message ID. Only details request bounded
  thumbnails, and originals require an explicit reader action. Abort and discard
  late results on close. Preview retry (`p`) is available only after a failed
  thumbnail download or decode; hide it during retries and after success.
  Expand compact Telegram thumbnails before JPEG decoding and identify unsupported
  formats before calling the decoder. Limit transfer bytes and decoder memory/resolution.
  Use ordinary terminal cells, with monochrome fallback, so resizing and clearing
  remain inside Ink. Native graphics protocols and external decoders are unnecessary.
- Viewer files use a private temporary directory and generated MIME-based names,
  never Telegram-provided paths or executable extensions. Opening is injected in
  tests. Retain explicitly opened files for asynchronous viewers, show their path
  if opening fails, and keep them outside session storage and the repository.
- `useOperation.begin()` guards duplicates synchronously with a ref. Finish every
  task in cleanup/finally, and check `task.active` before publishing asynchronous
  results. Message results also carry their chat ID and view into the reducer.
- Cancellation stops before another request/iterator item. Keep a page already
  received. An in-flight RPC or library retry may still finish; do not promise
  immediate cancellation or invent a rate-limit countdown.
- Entire-history deletion scans own messages independently of the loaded UI view.
  Deduplicate and snapshot IDs before deleting in batches.
- `deleteOwnMessages()` increments requested counts only after an acknowledged
  deletion. Verify those exact IDs without an author filter, even after Escape.
  Increment verified counts only for absent messages. Partial/failed verification
  stops subsequent batches; failed requests may still have taken effect.

### Pagination and lifecycle

- Message pagination retains an explicit cursor, deduplicates IDs and rejects
  non-advancing pages. A full page means more may exist; it does not prove it.
  Keep large scan buffers local and publish bounded snapshots rather than cloning
  all accumulated messages for every item/page.
- Dialog pagination retains Teleproto's iterator across loads. It owns pinned
  dialogs and the date/ID/peer cursor; an offset message ID alone is insufficient.
  The app adds stable-ID deduplication and a duplicate-only-page guard. After a
  failed iterator, refresh creates a new one. Search covers loaded chats only.
- Teleproto auth `onError: true` means stop. Retry recoverable password errors;
  stop fatal errors/cancellation. Use QR `abortSignal`, settle pending password
  input on cleanup and reject late callbacks before saving or advancing.
- Startup owns client disconnection. Settings writes run from an effect, outside
  React updater functions; failed persistence retains the in-memory setting.
  Preserve existing storage paths and migration behavior unless changing them is
  explicitly part of the task; see [storage](docs/storage.md).
- API credential setup validates the pair before asking whether to save. Only
  explicit Y/Enter consent invokes injected persistence; N uses the pair once,
  and Esc exits without saving. A save failure keeps setup open for retry or N.
  `credentialStore` writes unencrypted JSON beside the session using private
  permissions and atomic replacement. Reject nonregular files/directories on
  read, validate saved data and never expose the hash in errors. `client.credentials`
  loads saved credentials only when neither environment key is present and no
  explicit `--config` was supplied; never mix credential sources or fall back
  from an invalid explicit configuration. Tests inject credential storage and
  isolate installed-CLI user paths; never access real saved credentials.

### Terminal layout and feedback

- Show an animated, high-contrast activity badge at the right of the existing
  title row for explicit operations, discussion reads and source-post lookup.
  Include the operation, counts when known and cancellation state; keep detailed
  progress in the bottom status area. Own-chat filtering displays checking or
  stopping until its result is applied. Reserve these states in the view strip
  so they cannot add rows during work. Reserve the normal
  footer's space while busy so chat lists do not move or change viewport height.
  Do not insert transient banners above the panels during chat navigation.
  Use the same view strip for every chat type, with pane-specific summaries
  inside the panes. Reserve the widest loaded message count and Mine hint width,
  plus footer space for channel/background actions, across chat navigation.
  Pending, missing and resolved discussions must not shift the chat viewport.
  Keep the view strip height stable during message loading and focus changes.
  Use explicit white on dark blue for active headers, with a textual focus marker
  so focus stays visible across terminal palettes.
- Derive matching, availability and advertised bindings from `commands.ts`.
  Show view toggles and exact loaded counts in the top view strip; reserve the
  footer for actions and the private-chat/bot shortcut. Extended navigation and
  layout bindings stay in help.
  Keep every active binding discoverable through the strip, footer or help.
  Readers/help isolate input from the underlying app; help may overlay an existing prompt.
- Progress takes precedence during work. Preserve errors/results until
  acknowledged, with full text in the notice reader. Successful confirmation
  clears resolved validation warnings without discarding earlier results.
- Preserve Unicode variation selectors, joiners and grapheme boundaries. Use the
  existing width/wrapping helpers and output adapter; string length and plain
  snapshots do not establish physical terminal-cell correctness. See the
  [Unicode rendering investigation](docs/unicode-rendering.md).

## Validation map

| Change                                                                 | Relevant coverage                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Confirmation, login, retry and notice retention                        | `test/safety.test.tsx`                                                                      |
| Own-message selection and message views                                | `test/features.test.tsx`, `test/own-chats.test.tsx`                                         |
| Album grouping, pagination, item details and per-message deletion      | `test/albums.test.tsx`, `test/discussions.test.tsx`, `test/media.test.tsx`                  |
| Channel discussions, discovery, peer isolation and comment deletion    | `test/discussions.test.tsx`, `test/discussion-context.test.tsx`, `test/chat-types.test.tsx` |
| Pagination, deletion verification and settings failures                | `test/operations.test.tsx`                                                                  |
| Search, dialog pages, detail input isolation and stable loading layout | `test/navigation.test.tsx`, `test/browse-cache.test.tsx`                                    |
| Footer/help availability, cancellation and deletion UI                 | `test/ux.test.tsx`                                                                          |
| Grapheme/layout and terminal-cell behavior                             | `test/ui.test.tsx`, `test/terminal-output.test.tsx`                                         |
| Session migration and scanner exclusions                               | `test/session.test.tsx`, `test/security.test.tsx`                                           |
| Credential save consent, permissions, failure recovery and precedence  | `test/credentials.test.tsx`, `test/features.test.tsx`                                       |
| Allowlisted artifact and production-only installed CLI                 | `test/package.test.mjs`                                                                     |

`test/helpers/App.tsx` injects memory settings into the real App;
`test/helpers/terminal.tsx` supplies input, resize and frame controls. Use deferred
fake responses to inspect pending, cancelled and late-result states. Never use
real credentials, sessions, chat contents or deletion requests in fixtures.

Run the checks in [CONTRIBUTING.md](CONTRIBUTING.md) for implementation changes.
For terminal behavior, also exercise `npm run preview:synthetic` and
`npm run repro:emoji` offline. Keep full regression coverage when changing safety
or Unicode handling. [Publishing](docs/publishing.md) and
[security checks](docs/security.md) describe release/artifact and scanner scope.
