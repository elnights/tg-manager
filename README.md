# TG Manager

Browse Telegram chats in your terminal, switch between your messages and all
authors, and select your own messages for deletion with explicit confirmation.
Groups and channels appear by default; private chats are one key away.

Synthetic example (no account data):

```text
TG MANAGER / Weekend project
[ACTIVE] GROUPS/CHANNELS          MESSAGES [MINE]
> Weekend project                > [ ] You: Example message
Mine · 100+ loaded · 0 selected
Tab Switch · p Private · [ ] Resize · ? Help
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

| Key | Action |
| --- | --- |
| `↑` / `↓`, `j` / `k` | Navigate the focused panel |
| `Tab`, `←`, `→` | Switch panels |
| `p` | Show / hide private chats |
| `v` | Switch Mine / All authors |
| `Space`, `s`, `c` | Mark one / select own / clear selection |
| `n`, **`L`** | Load next page / remaining view |
| `d` | Confirm deletion of marked own messages |
| `?` | Open the complete keyboard reference |
| `Esc` | Cancel a prompt, stop work after the current request, or dismiss an alert |
| `q`, `Ctrl+C` | Quit from the main view / anytime |

Keys are case-sensitive. The footer adapts to focus and available actions.
The status bar shows the view, loaded and selected counts, and operation progress.
`100+` means another page may exist; reaching the end removes the `+`.
All-authors mode labels senders; other people's messages are read-only (`[-]`).

## Deletion safety

**Deletion is irreversible** and can affect other participants. Both selected
and entire-history deletion require typing exactly `DELETE` and pressing Enter.
Uppercase **`A`** scans all your messages in the active chat before asking for
confirmation. It never deletes automatically.

Progress separates accepted deletion requests from messages verified absent by
ID. A failed request may still have taken effect; reload and verify before
retrying. Esc stops between batches and verifies an accepted in-flight batch.
Ctrl+C exits immediately; completed or in-flight requests cannot be undone.
Warnings and errors remain until dismissed with Esc.

## Documentation

- [Complete keyboard reference](docs/keyboard.md), including prompts and cancellation
- [Session storage, migration and limits](docs/storage.md)
- [Terminal rendering and regression tests](docs/unicode-rendering.md)
- [Contributing](CONTRIBUTING.md) and [publishing](docs/publishing.md)
- [Repository security checks](docs/security.md)

## License

WTFPL — Do What The Fuck You Want To Public License.

I don't give a fuck what you do with this code. Use it, modify it, fork it,
sell it, or throw it away. No permission needed.

See [LICENSE](LICENSE).
