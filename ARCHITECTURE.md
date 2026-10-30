# Architecture and maintenance guide

Repository implementation notes for agents and contributors. Keep this guide
about current responsibilities and invariants; record user-visible changes in
CHANGELOG.md and validation results in the PR. This file stays outside the npm
package's allowlist.

## Module map

| Area              | Files                                                                                                                  | Responsibility                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Startup           | `src/cli.ts`, `src/index.tsx`, `src/client.ts`                                                                         | CLI options, credentials, client connection/disconnection, session persistence and terminal lifecycle     |
| Login             | `src/CredentialPrompt.tsx`, `src/credentials.ts`, `src/Auth.tsx`                                                       | Credential validation, QR/cloud-password input, retries and cancellation                                  |
| Controller        | `src/App.tsx`, `src/state.ts`                                                                                          | Effects, initialization/retry, active chat/view, filtering, atomic selection changes and captured prompts |
| Telegram boundary | `src/telegram.ts`, `src/messages.ts`                                                                                   | Narrow client interfaces, typed records, message conversion, authorship checks and absence verification   |
| Operations        | `src/operations.ts`, `src/dialogs.ts`, `src/useOperation.ts`                                                           | Pagination, own-message scanning, verified deletion and operation lifecycle                               |
| Commands          | `src/commands.ts`                                                                                                      | Bindings, aliases, availability, footer labels and help data, including prompts/readers                   |
| UI                | `src/Confirmation.tsx`, `src/Reader.tsx`, `src/Help.tsx`, `src/Footer.tsx`, `src/StatusBar.tsx`, `src/ViewOptions.tsx` | Measured confirmation, isolated scrolling overlays, footer, progress and persistent notices               |
| Terminal text     | `src/ui.tsx`, `src/text.ts`, `src/terminal-output.ts`                                                                  | Panel dimensions, grapheme-safe rows/wrapping and physical terminal-cell repair                           |
| Storage           | `src/session.ts`, `src/settings.ts`                                                                                    | Private session storage/migration and injectable layout settings                                          |

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
- Only own messages may enter a deletion target. Mine uses Telegram's own-message
  filter; All checks sender identity or outgoing private-message metadata. An
  outgoing channel post alone is insufficient proof of authorship.
- Capture the chat entity and message IDs when opening confirmation. Help must
  preserve that snapshot and typed input; other navigation cannot retarget it.
- Accept deletion only when account/target ID, bounded title, exact count, scope,
  irreversible warning, full input and accepted keys fit. Recheck on resize.
  Require exact uppercase `DELETE` and a separate Enter event; paste cannot submit.

### Operations and cancellation

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

### Terminal layout and feedback

- Keep routine loading feedback in the bottom status area. Reserve the normal
  footer's space while busy so chat lists do not move or change viewport height.
  Do not insert transient banners above the panels during chat navigation.
  Keep the view strip height stable during message loading and focus changes.
  Use explicit white on dark blue for active headers, with a textual focus marker
  so focus stays visible across terminal palettes.
- Derive matching, availability and advertised bindings from `commands.ts`.
  Show view toggles and exact loaded counts in the top view strip; reserve the
  footer for actions. Extended navigation and layout bindings stay in help.
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

| Change                                                                 | Relevant coverage                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| Confirmation, login, retry and notice retention                        | `test/safety.test.tsx`                              |
| Own-message selection and message views                                | `test/features.test.tsx`, `test/own-chats.test.tsx` |
| Pagination, deletion verification and settings failures                | `test/operations.test.tsx`                          |
| Search, dialog pages, detail input isolation and stable loading layout | `test/navigation.test.tsx`                          |
| Footer/help availability, cancellation and deletion UI                 | `test/ux.test.tsx`                                  |
| Grapheme/layout and terminal-cell behavior                             | `test/ui.test.tsx`, `test/terminal-output.test.tsx` |
| Session migration and scanner exclusions                               | `test/session.test.tsx`, `test/security.test.tsx`   |
| Allowlisted artifact and production-only installed CLI                 | `test/package.test.mjs`                             |

`test/helpers/App.tsx` injects memory settings into the real App;
`test/helpers/terminal.tsx` supplies input, resize and frame controls. Use deferred
fake responses to inspect pending, cancelled and late-result states. Never use
real credentials, sessions, chat contents or deletion requests in fixtures.

Run the checks in [CONTRIBUTING.md](CONTRIBUTING.md) for implementation changes.
For terminal behavior, also exercise `npm run preview:synthetic` and
`npm run repro:emoji` offline. Keep full regression coverage when changing safety
or Unicode handling. [Publishing](docs/publishing.md) and
[security checks](docs/security.md) describe release/artifact and scanner scope.
