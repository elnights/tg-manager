# TG Manager

A local terminal app for browsing Telegram chats and managing messages authored
by your account. Log in with a QR code, view your messages or everyone's,
and select your messages for deletion after explicit confirmation.

## Setup

Requires **Node.js 24+**, macOS or Linux, and an interactive terminal.

### npm CLI

Once the first npm release is published:

```sh
npm install --global tg-manager-tui
tg-manager
```

Get your Telegram API ID and hash from [my.telegram.org](https://my.telegram.org/).
If credentials are missing, the TUI asks for your API ID and API hash before
login. The hash is masked, and entered credentials are used only for that run.
You can also supply a file with `tg-manager --config /path/to/credentials`, or
export `TG_API_ID` and `TG_API_HASH` in your shell. An explicitly supplied config
must contain valid credentials; incomplete configuration reports an error.

Use `tg-manager --help` for command-line options, `tg-manager --version` for the
installed version, or `tg-manager --demo` to preview the TUI offline.

### From source

```sh
git clone https://github.com/elnights/tg-manager.git
cd tg-manager
npm ci
```

Run:

```sh
npm start
```

`npm start` prompts for missing credentials. Optionally copy `.env.example` to
`.env` and fill in the values; `npm start` loads it when present.

On first launch, scan the QR code in Telegram: **Settings → Devices → Link
Desktop Device**. Enter your cloud password in the terminal if prompted.
Later launches reuse the saved session.

## Usage

The left panel shows groups and channels by default. Press `p` to include
private chats, or press it again to hide them. Select a conversation, switch to
the right panel, and mark the messages you want to delete. Key names are
case-sensitive.

| Key | Action |
| --- | --- |
| `Tab`, `←`, `→` | Switch panels |
| `↑` / `k`, `↓` / `j` | Move the cursor in the focused panel |
| `Space` | Toggle the current message's selection (messages panel) |
| `p` | Include / hide private chats in the conversation list |
| `v` | Switch between your messages and messages from all authors |
| `s` | Select your loaded messages; offer to load the rest of the current view and select yours (messages panel) |
| `c` | Clear all message marks in the main view (either panel) |
| `n` | Load the next 100 messages (messages panel) |
| `L` | Load the remaining history for the current view (messages panel) |
| `d` | Request deletion of marked messages (messages panel) |
| `A` | Delete all your messages in the active chat after confirmation, including unloaded messages (either panel) |
| `r` | Reload the active chat's messages |
| `[` / `]` | Narrow / widen the chat panel |
| `0` | Reset the chat panel width to 32% of the available width |
| `q` | Quit from the main view |
| `Ctrl+C` | Quit at any time, including during a request |

The message header shows `[MINE]` or `[ALL]`. All-authors mode includes sender
names. Other people's messages have a `[-]` marker and cannot be selected or
deleted. Switching views reloads the history and clears selection.
Toggling private chats keeps the active conversation and its marks when it
remains visible; hiding the active private chat selects the first group/channel
and clears its messages and marks.

In the select-all prompt, press `Y` to load the rest of the current view and
select your messages, `N` to select only your loaded messages, or `Esc` / `C`
to cancel. Both deletion modes require typing `DELETE` and pressing `Enter`;
`Esc` cancels the confirmation.
Other main-view keys are paused while a prompt or request is active.

**Deletion is irreversible.** The app requests deletion for everyone where
Telegram permits it. Quitting during deletion does not undo completed batches.

## Storage and limits

- The Telegram session is stored unencrypted in `.local/session.txt` with file
  permissions `0600`. It grants access to your account. Keep it and `.env`
  private; revoke the session through Telegram's Devices settings when needed.
  This path is relative to the working directory, so launch from the same
  directory to reuse a session.
- Panel width is saved in `~/.config/tg-manager/settings.json` and can range from
  20–70%, subject to the available terminal width.
- The chat list loads up to 500 dialogs. Message previews start with 100 messages
  and show one line per message; media contents are not downloaded.
- The default view and bulk deletion scan use Telegram's `fromUser: 'me'`
  filter. All-authors view uses sender IDs (or outgoing private-message
  metadata) to identify yours. Anonymous administrator or channel-as-sender
  posts may not be identified as yours.
  API restrictions and rate limits can interrupt large operations.

## Development

```sh
npm run typecheck
npm test
npm run test:package
npm run repro:emoji
```

The emoji demo runs offline with synthetic titles. Tests cover Unicode width,
truncation, selection backgrounds, divider alignment, keyboard input and resizing.
See [Contributing](CONTRIBUTING.md) and the
[Unicode rendering investigation](docs/unicode-rendering.md). Maintainers can
follow the [publishing guide](docs/publishing.md) to build and verify a release.
