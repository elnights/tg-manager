# TG Manager

**TL;DR:** Batch-delete your own Telegram messages from groups and channels.

Browse Telegram chats in your terminal, switch between your messages and all
authors, and select your own messages for deletion with explicit confirmation.
Groups and channels appear by default; private chats are one key away.

Actual UI rendered with synthetic data (100 columns × 24 rows):

![Synthetic TG Manager terminal showing loaded chats, message rows and active keyboard controls](assets/synthetic-terminal.svg)

Text example (synthetic data):

```text
TG MANAGER / Weekend project
Mine [v] · Private: off [p] · With my messages: off [o] · Loaded: 100 chats / 100 msgs
[ACTIVE] GROUPS/CHANNELS          MESSAGES
> Weekend project                > [ ] You: Example message
0 selected · More may be available · More chats may be available
Tab/←→ Panel / Search R Chats m More r Reload A Delete all q/Ctrl+C ? Help
```

## Installation

Requires **Node.js 24+**, macOS or Linux, and an interactive terminal.
After the first npm release is published:

```sh
npm install --global tg-manager-tui
tg-manager
```

To run from source:

```sh
git clone https://github.com/elnights/tg-manager.git
cd tg-manager
npm ci
npm start
```

Use `tg-manager --demo` (or `npm run repro:emoji`) for an offline terminal
preview with synthetic titles. `--help` lists CLI options; `--version` prints
the installed version.

## First launch

Get your API ID and hash from [my.telegram.org](https://my.telegram.org/).
The app asks for missing credentials and masks the hash; values entered in the
form are used only for that run. You can also export `TG_API_ID` and
`TG_API_HASH`, or use `tg-manager --config /path/to/credentials`.
Explicit configuration must contain valid credentials. From source, `npm start`
also loads a local `.env` when present.

Scan the QR code in Telegram: **Settings → Devices → Link Desktop Device**.
Enter your cloud password if prompted. Later launches reuse the private session
in your user data directory, independently of the launch directory.
See [storage and migration](docs/storage.md) before moving an existing install.

## Essential controls

| Key                        | Action                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| `↑` / `↓`, `j` / `k`       | Navigate the focused panel                                                |
| `Tab`, `←`, `→`            | Switch panels                                                             |
| `Page Up/Down`, `Home/End` | Page / first or last loaded item in either panel                          |
| `/`, `R`, `m`              | Search loaded chats / refresh list / load more chats                      |
| `Enter`                    | Inspect a message in a read-only scrolling view                           |
| `r`, `!`                   | Reload messages or retry initialization / read notice details             |
| `p`                        | Show / hide private chats                                                 |
| `o`                        | Show only loaded chats containing your own messages                       |
| `v`                        | Switch Mine / All authors                                                 |
| `Space`, `s`, `c`          | Mark one / select own / clear selection                                   |
| `n`, **`L`**               | Load next page / remaining view                                           |
| `d`                        | Confirm deletion of marked own messages                                   |
| `?`                        | Open the complete keyboard reference                                      |
| `Esc`                      | Cancel a prompt, stop work after the current request, or dismiss an alert |
| `q`, `Ctrl+C`              | Quit from the main view / anytime                                         |

Keys are case-sensitive. The top strip shows Mine/All, private-chat visibility,
and exact loaded chat/message counts. The footer shows actions; `?` opens the
full reference, including layout and extended navigation controls. The bottom
status row shows selection, progress and notices.
“More may be available” means the next page has not been checked.

Use `o` in the top view strip to show only chats containing your own messages.
Enabling it checks each loaded chat with Telegram’s own-message filter; new chat
pages are checked too. It works with Mine/All, private-chat visibility and search.
Escape stops checks. Failed or cancelled checks leave the filter off, retain loaded
chats, and show a notice; press `o` to retry. After deleting a chat’s last own
message, it drops out of the filtered list.

Search covers loaded chat titles and IDs. Use `m` to load more chats and `R` to
refresh the list. Other people's messages appear read-only (`[-]`) in All mode.

## Deletion safety

**Deletion is irreversible** and can affect other participants. Both selected
and entire-history deletion require typing exactly `DELETE` and pressing Enter.
The confirmation shows your account, chat title and ID, deletion scope and exact
count. Enlarge the terminal if the full confirmation cannot fit. Pasting `DELETE` still requires a separate Enter.
Uppercase **`A`** scans all your messages in the active chat before asking for
confirmation. It never deletes automatically.

Progress separates accepted deletion requests from messages verified absent by
ID. A failed request may still have taken effect; reload and verify before
retrying. Esc stops between batches and verifies an accepted in-flight batch.
Ctrl+C exits immediately; completed or in-flight requests cannot be undone.
Warnings, errors and deletion results remain until dismissed with Esc; `!` opens
their full details. During work Esc stops after the current request and any
accepted deletion verification. Telegram may wait or retry internally; the app
cannot expose a reliable countdown or interrupt an in-flight RPC.

## Documentation

- [Complete keyboard reference](docs/keyboard.md), including prompts and cancellation
- [Session storage, migration and limits](docs/storage.md)
- [Terminal rendering and regression tests](docs/unicode-rendering.md)
- [Contributing](CONTRIBUTING.md) and [publishing](docs/publishing.md)
- [Security policy and private reporting](SECURITY.md)
- [Repository security checks](docs/security.md)

## License

WTFPL — Do What The Fuck You Want To Public License.

I don't give a fuck what you do with this code. Use it, modify it, fork it,
sell it, or throw it away. No permission needed.

See [LICENSE](LICENSE).
