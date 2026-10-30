# Keyboard reference

Main-view keys are **case-sensitive**: use lowercase unless shown uppercase.
`A` means Shift+a; `L` means Shift+l. Uppercase `S`, `D`, `P` and lowercase
`a`, `l` have no main-view action. The footer uses the actual accepted key case.

## Navigation

| Key                     | Action                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `↑` / `k`, `↓` / `j`    | Move in the focused panel                                     |
| `Tab`, `←`, `→`         | Switch panels                                                 |
| `Page Up` / `Page Down` | Move by the visible list height in either panel               |
| `Home` / `End`          | First / last loaded item in the focused panel                 |
| `Enter`                 | Open the current message in a read-only scrolling detail view |
| `!`                     | Read complete notice details                                  |
| `q`                     | Quit from the main view when idle                             |
| `Ctrl+C`                | Quit at any time, including during a request                  |
| `?`                     | Open help without making a Telegram request                   |

In help, `Esc` or `?` closes it. `↑` / `↓`, `j` / `k`, and Page Up / Page Down
scroll the reference. Other application shortcuts are inactive. Background work
already started continues; closing help does not cancel it.

## Chat management

| Key | Action                                                                       |
| --- | ---------------------------------------------------------------------------- |
| `p` | Include / hide private chats                                                 |
| `v` | Switch Mine / All authors, reload and clear selection                        |
| `r` | Reload messages and clear selection; retry failed initialization             |
| `R` | Refresh the chat list, preserving active identity and marks if still visible |
| `m` | Load another 100 dialogs when more may be available                          |
| `/` | Edit the visible loaded-chat title/ID query; Enter apply, Esc restore        |

Search applies only to the loaded list. A full page means more may be available;
the app confirms when no more chats remain. `R` reloads the chat list.
Filtering preserves marks when the active chat stays visible. Switching or
hiding the active chat clears its messages and marks. Empty search results
are distinguished from loading, failed loads and a genuinely empty list.

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

The default Mine view uses Telegram's own-message filter. All mode loads all
authors but only marks yours. Loaded counts are exact, such as
`100 own messages loaded`. “More may be available” separately indicates that
the next page has not been checked. A full page alone does not prove that more
messages exist. Routine loads and selection changes update these persistent
counters without a temporary duplicate notice. Operations block other application
commands, except help and stopping, to prevent duplicate requests and changes of target.

## Deletion

| Key              | Action                                                                        |
| ---------------- | ----------------------------------------------------------------------------- |
| `d`              | Confirm deletion of selected own messages (messages panel)                    |
| `A`              | Scan all your messages in the active chat, then ask for deletion confirmation |
| `DELETE` + Enter | Confirm exactly, in uppercase                                                 |
| `Esc`            | Cancel confirmation or stop between deletion batches                          |

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
| `0`       | Reset chat width to 32%                                |
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
