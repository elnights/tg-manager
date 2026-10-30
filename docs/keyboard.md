# Keyboard reference

Main-view keys are **case-sensitive**: use lowercase unless shown uppercase.
`A` means Shift+a; `L` means Shift+l. Uppercase `S`, `D`, `P` and lowercase
`a`, `l` have no main-view action. The footer uses the actual accepted key case.

## Navigation

| Key | Action |
| --- | --- |
| `↑` / `k`, `↓` / `j` | Move in the focused panel |
| `Tab`, `←`, `→` | Switch panels |
| `q` | Quit from the main view when idle |
| `Ctrl+C` | Quit at any time, including during a request |
| `?` | Open help without making a Telegram request |

In help, `Esc` or `?` closes it. `↑` / `↓`, `j` / `k`, and Page Up / Page Down
scroll the reference. Other application shortcuts are inactive. Background work
already started continues; closing help does not cancel it.

## Chat management

| Key | Action |
| --- | --- |
| `p` | Include / hide private chats |
| `v` | Switch Mine / All authors, reload and clear selection |
| `r` | Reload the active chat and clear selection |

Toggling private chats preserves the active chat and selection if it remains
visible. Hiding an active private chat selects the first visible group/channel
and resets messages and marks.

## Message selection

| Key | Action |
| --- | --- |
| `Space` | Toggle the current own message (messages panel) |
| `s` | Select own loaded messages; if more may exist, offer to load the rest of the current view |
| `c` | Clear selection from either panel |

In the selection prompt, `Y` / `y` loads the remaining view and selects only
your messages. `N` / `n` selects loaded own messages. `Esc`, `C` / `c` cancels
without changing existing marks. Selection never deletes anything.

## Loading and pagination

| Key | Action |
| --- | --- |
| `n` | Load the next page, up to 100 messages (messages panel) |
| `L` | Load the remaining current view, keeping marks (messages panel) |
| `Esc` | Stop between requests; keep the in-flight page when it completes |

The default Mine view uses Telegram's own-message filter. All mode loads all
authors but only marks yours. `100+ loaded` means another page may exist, not
that its exact count is known. Operations block other application commands,
except help and stopping, to prevent duplicate requests and changes of target.
Loading and selecting publish progress at most about eight times per second.

## Deletion

| Key | Action |
| --- | --- |
| `d` | Confirm deletion of selected own messages (messages panel) |
| `A` | Scan all your messages in the active chat, then ask for deletion confirmation |
| `DELETE` + Enter | Confirm exactly, in uppercase |
| `Esc` | Cancel confirmation or stop between deletion batches |

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
The final requested/verified result remains visible across reloads until Esc.
Errors and warnings also remain until dismissed; routine information expires.

## Layout and settings

| Key | Action |
| --- | --- |
| `[` / `]` | Narrow / widen the chat panel by two percentage points |
| `0` | Reset chat width to 32% |
| `?` | Open keyboard help |

Width is saved to `~/.config/tg-manager/settings.json` and clamped to 20–70%,
subject to terminal width. A short terminal shows an enlargement hint while
retaining the footer; help scrolls independently. Lower-priority footer actions
disappear when they cannot fit as complete shortcuts.
