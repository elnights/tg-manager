# Keyboard reference

Main-view keys are **case-sensitive**: use lowercase unless shown uppercase.
`A` means Shift+a; `L` means Shift+l. Uppercase `S`, `D`, `P` and lowercase
`a`, `l` have no main-view action. The footer uses the actual accepted key case.

## Navigation

| Key                     | Action                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `↑` / `k`, `↓` / `j`    | Move in the focused panel                                           |
| `Tab`, `←`, `→`         | Cycle panels (Shift+Tab / left arrow reverses)                      |
| `Page Up` / `Page Down` | Move by the visible list height in either panel                     |
| `Home` / `End`          | First / last loaded item in the focused panel                       |
| `g`                     | Focus the source channel post of the highlighted discussion comment |
| `Enter`                 | Open the current message in a read-only scrolling detail view       |
| `!`                     | Read complete notice details                                        |
| `q`                     | Quit from the main view when idle                                   |
| `Ctrl+C`                | Quit at any time, including during a request                        |
| `?`                     | Open help without making a Telegram request                         |

In help, `Esc` or `?` closes it. `↑` / `↓`, `j` / `k`, and Page Up / Page Down
scroll the reference. Other application shortcuts are inactive. Background work
already started continues; closing help does not cancel it.

## Chat management

| Key | Action                                                                       |
| --- | ---------------------------------------------------------------------------- |
| `f` | Choose any combination of chat types with Space; Enter apply, Esc cancel     |
| `p` | Include / hide private chats and bots                                        |
| `v` | Switch Mine / All in the focused message pane, clearing its marks            |
| `t` | Switch Discussion between Selected post and Entire group                     |
| `o` | Find chats and linked discussions containing your own messages               |
| `r` | Reload messages and clear selection; retry failed initialization             |
| `R` | Refresh the chat list, preserving active identity and marks if still visible |
| `m` | Load another 100 dialogs when more may be available                          |
| `/` | Edit the visible loaded-chat title/ID query; Enter apply, Esc restore        |

Search applies only to the loaded list. A full page means more may be available;
the app confirms when no more chats remain. `R` reloads the chat list.
Filtering preserves marks when the active chat stays visible. Switching or
hiding the active chat clears its messages and marks. Empty search results
are distinguished from loading, failed loads and a genuinely empty list.

Chat types occupy a dedicated column: `[P]` private, `[B]` bot, `[G]` basic
group, `[S]` supergroup/forum, `[C]` channel. `f` opens a checklist. Draft choices
and the current row survive help; Esc discards them. Every type can be hidden,
with an explicit empty state and `f` available to restore visibility. Filtering
preserves marks while the active chat remains visible. Hiding a chat clears its
messages and marks.

A channel’s right side splits into Posts (All by default) and Discussion
(Entire group + Mine by default). The source channel stays selected in the list.
The linked discussion’s actual dialog remains a normal supergroup if joined;
no synthetic discussion chat is inserted. Hiding groups affects the chat list,
while a visible channel can still show its discussion.

`t` selects one of two discussion scopes. Selected post follows the highlighted
post automatically; checkbox marks only select messages for deletion. Entire
group ignores the post highlight and includes comments across posts plus general
conversation, even for posts absent from the loaded list. Rows show their source
post, General, or Context unavailable. Unresolved context leaves messages visible. Context resolution follows nested
reply chains independently of the loaded Posts page. General means a confirmed
ordinary group conversation; missing/deleted parents, partial metadata or failed
lookups display Context unavailable. After updating, focus Discussion and press
`r` to clear cached context and reload.

Focusing a comment automatically highlights its source post above, preserving
keyboard focus and marks in Discussion. `g` transfers keyboard focus to Posts.
If necessary the app locates the post’s page and switches Posts to All; switching
author view clears post marks, while a new page keeps only visible own marks.
The normal ownership checks apply to located posts. General/unresolved messages
leave the previous post highlight unchanged. Missing/deleted sources show a
notice and retain the discussion. Source lookups are debounced and cancellable;
late results cannot focus a different comment’s post. `g` also retries a failed
lookup. `r` in Posts reloads the latest page.

Tab cycles Chats → Posts → Discussion → Chats; Shift+Tab reverses. `v` changes
All/Mine in the focused message pane. Each pane has its own marks, cursor and
pagination. Switching focus preserves marks; changing thread, author view or chat
clears the affected selection. Only yours can be marked, including in All mode.
`n`, `L`, `s`, `d`, `r` and `A` act on the focused message pane. With a channel
selected, `A` requires focus in Posts or Discussion. It scans precisely the active
thread or entire group and confirmation names that scope and the real target ID.

Posts remain navigable while the discussion loads. Requests are debounced;
late results cannot retarget the pane. Esc stops automatic loading between
requests, preserving a received page. Focus Discussion and press `r` to retry a
failed/stopped load; `R` also refreshes the discussion link. Missing links use
full-height posts. Access failures never substitute channel history for comments
or join a group. The `o` filter retains a channel for own posts **or** any own
messages in its linked group, including general chat.

Chat types share one top-header layout. Message counts reserve their widest
loaded value, and the footer reserves channel/background bindings, so groups,
channels, private chats and pending/missing discussions share the same chat-list
position and viewport. Pane-specific scope and selection counts stay inside the
right panes.

`{` / `}` reduces/increases the posts share of the split. `0` resets it to 50%
and chat width to 32%. Short terminals show the focused right pane with a hint
to switch; expanding the terminal restores both panes and their selections.

Message and notice details wrap and scroll with arrows, j/k, Page Up/Down and
Home/End; Esc or Enter closes them and restores focus. Selection, deletion, chat
changes and other application commands are paused in these readers.

Toggling private chats preserves the active chat and selection if it remains
visible. Hiding an active private chat selects the first visible group/channel
and resets messages and marks.

## Message selection

| Key     | Action                                                                                    |
| ------- | ----------------------------------------------------------------------------------------- |
| `Space` | Toggle the current own message (messages panel)                                           |
| `s`     | Select own loaded messages; if more may exist, offer to load the rest of the current view |
| `c`     | Clear selection from either panel                                                         |

In the selection prompt, `Y` / `y` loads the remaining view and selects only
your messages. `N` / `n` selects loaded own messages. `Esc`, `C` / `c` cancels
without changing existing marks. Selection never deletes anything.

## Loading and pagination

| Key   | Action                                                           |
| ----- | ---------------------------------------------------------------- |
| `n`   | Load the next page, up to 100 messages (messages panel)          |
| `L`   | Load the remaining current view, keeping marks (messages panel)  |
| `Esc` | Stop between requests; keep the in-flight page when it completes |

Mine uses Telegram's own-message filter. All mode loads all
authors but only marks yours. Loaded counts are exact, such as
`100 own messages loaded`. “More may be available” separately indicates that
the next page has not been checked. A full page alone does not prove that more
messages exist. Routine loads and selection changes update these persistent
counters without a temporary duplicate notice. Operations block other application
commands, except help and stopping, to prevent duplicate requests and changes of target.

## Deletion

| Key              | Action                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| `d`              | Confirm deletion of selected own messages (messages panel)                  |
| `A`              | Scan all your messages in the focused chat/thread/group scope, then confirm |
| `DELETE` + Enter | Confirm exactly, in uppercase                                               |
| `Esc`            | Cancel confirmation or stop between deletion batches                        |

Other main-view commands are inactive in a prompt. `?` opens help and preserves
the prompt and typed confirmation. After a scan is stopped, its partial results
never become a deletion prompt.

Deletion requests use batches of up to 100. **Requested** counts IDs in API calls
that returned successfully. **Verified absent** counts IDs checked afterward
without an author filter and found absent from the chat. This does not prove
that every other participant's client has synchronized. Verification failure or
still-present IDs stop subsequent batches. An unsuccessful API call may still
have taken effect, so reload and verify before retrying.

Esc waits for the in-flight deletion request and its verification, then stops.
Ctrl+C exits immediately. Neither can undo completed or in-flight requests.
Confirmation shows the account, bounded title, full stable ID, exact count,
selected-message or entire-history scope, irreversible warning and full input.
All context must fit before typing or Enter is accepted. Pasting DELETE does not
submit it; help preserves the captured target and text, and resizing rechecks fit.

Telegram may wait or retry during a request. No live countdown is available.
Rate-limit errors show
server seconds when provided; retry later. Esc takes effect between requests,
including after verification of an accepted deletion batch.

The final requested/verified result remains visible across reloads until Esc.
Errors and warnings also remain until dismissed; routine information expires.

## Layout and settings

| Key       | Action                                                 |
| --------- | ------------------------------------------------------ |
| `[` / `]` | Narrow / widen the chat panel by two percentage points |
| `{` / `}` | Reduce / increase posts height in the channel split    |
| `0`       | Reset chat width to 32% and posts height to 50%        |
| `?`       | Open keyboard help                                     |

Width is saved to `~/.config/tg-manager/settings.json` and clamped to 20–70%,
subject to terminal width. A short terminal shows an enlargement hint while
retaining the legend; help scrolls independently. Both panels list the global
controls: panel switching (including arrow aliases), private-chat visibility,
view, reload, delete-all, width adjustment/reset, quit and help. Selection and
pagination keys appear when their actions are available. Prompts and background
work list their own accepted keys, including Ctrl+C.

The legend always reserves room for every active key. It first shortens labels,
then uses key names with descriptions where space allows. At narrower widths,
additional legend rows reduce the message area instead of hiding bindings.
If even the key names cannot fit in the terminal, application commands pause
until it is enlarged; help and Ctrl+C remain available.
