# Session storage and limits

Telegram sessions are unencrypted authorization credentials. Keep them private.
Revoke unwanted sessions through Telegram's Devices settings.

## Stable user location

| Platform                            | Session file                                           |
| ----------------------------------- | ------------------------------------------------------ |
| macOS                               | `~/Library/Application Support/tg-manager/session.txt` |
| Linux with absolute `XDG_DATA_HOME` | `$XDG_DATA_HOME/tg-manager/session.txt`                |
| Linux fallback                      | `~/.local/share/tg-manager/session.txt`                |

Empty or relative `XDG_DATA_HOME` values use the Linux fallback. macOS ignores
`XDG_DATA_HOME`. Normal launches always use this user location, regardless of
the working directory. Changing the data-home environment intentionally changes
the Linux storage location.

Session directories use `0700`, and files use `0600` where supported. Existing
permissions are tightened on load/save. Writes publish a complete private file
atomically. The app does not print session contents.

## Migration

On launch, if the user session does not exist, the app checks for a nonempty
regular `.local/session.txt` in the launch directory and copies it privately.
Start once from the old checkout to migrate its session. The source is kept,
unchanged; migration never overwrites a destination, including one created by
a concurrent launch. Legacy symlinks and empty files are skipped.

When a destination already exists, it wins and the legacy source is not read.
If no legacy session exists, the integrated QR login creates a session in the
user directory. Subsequent launches reuse it from every working directory.
Migration errors are reported rather than silently creating another session.
Inspect or remove an old copy yourself only after confirming the migration.
Development tests use synthetic temporary files and never access real sessions.

## Other storage and limits

- Panel width is stored in `~/.config/tg-manager/settings.json`.
- API credentials can be saved with consent during setup; see below. The app
  also accepts environment variables or an explicitly supplied credentials file.
- Chats load in pages of up to 100; press `m` for more. Search covers loaded chats.
  Message pages contain up to 100 messages; Enter opens the full text preview.
  Only opening message details fetches bounded image thumbnails. Large histories stay in memory.
- Only messages recognized as yours can be marked or deleted. Anonymous
  administrator or channel-as-sender posts may not be recognized as yours.
- Telegram permissions and rate limits can interrupt operations. Cancellation
  cannot abort an in-flight API call; it stops further pages/batches afterward.
- User permissions do not protect against another process running as the same
  user, and underlying filesystems must support private permissions and atomic
  rename/hard-link operations for the storage guarantees.

## API credentials

After entering an API ID/hash in setup, choose **Y / Enter** at
“Save API credentials on this device?” to remember the pair, or **N** to use it
only for the current run. Cancelling before that choice writes nothing.

The saved file is `credentials.json` beside `session.txt` in the user data
directory listed above. It contains the API ID and hash as unencrypted JSON.
The directory uses `0700` and the file uses `0600` where supported. Saves replace
the file atomically; loads validate the contents and tighten permissions. The hash
is masked in setup and is never included in validation or save-error messages.

Normal launches load this pair when neither `TG_API_ID` nor `TG_API_HASH` is set.
Environment credentials take priority as a complete pair; partial or invalid
values open setup instead of being combined with saved values. `--config` must
supply valid credentials through the existing environment-file mechanism; it
never falls back to saved credentials. Neither source is saved automatically.
A missing or invalid saved file opens setup again.

To forget the saved API credentials, remove `credentials.json` from that
directory. The next launch asks for the pair again unless you provide it through
environment variables or `--config`. This does not remove or revoke the Telegram
login session; manage that separately through Telegram’s Devices settings.

An external credentials file for `--config` uses this format (replace both values):

```text
TG_API_ID=YOUR_API_ID
TG_API_HASH=YOUR_API_HASH
```

Keep that file private as well. When running from source, pass it with
`npm start -- --config /path/to/credentials`.

## Media details

Photo previews and available video/document thumbnails are JPEG images downloaded
into memory only. Previews are limited to 1 MiB and decoding to 2 megapixels / an
approximate 32 MiB decoder budget. No native image programs, platform binaries or
terminal graphics protocol are required. Unsupported or missing thumbnails leave
captions and attachment metadata readable. There is no inline video/audio playback.

Pressing `o` explicitly downloads a supported original, up to 50 MiB, into a new
`tg-manager-media-*` directory under the operating system's temporary directory.
Directories use `0700` and files `0600` where supported. Generated filenames use
known media extensions; attachment-provided paths and executable suffixes are
never used. The platform's default viewer handles these files, including WSL's
Windows opener when available. Headless systems retain a usable saved-file path.

Explicitly opened files remain in their private temporary directories so viewers
can read them after details close. Remove them yourself when finished, or let the
OS clean its temporary directory. Cancelling before launch removes an incomplete
temporary file. Previews are released when details close; media is never stored
in the repository or the session directory.
