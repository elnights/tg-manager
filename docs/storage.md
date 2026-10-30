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
- API credentials entered in the form are used for that run only. The app also
  accepts environment variables or an explicitly supplied credentials file.
- Chats load in pages of up to 100; press `m` for more. Search covers loaded chats.
  Message pages contain up to 100 messages; Enter opens the full text preview.
  Media is not downloaded. Large histories stay in memory.
- Only messages recognized as yours can be marked or deleted. Anonymous
  administrator or channel-as-sender posts may not be recognized as yours.
- Telegram permissions and rate limits can interrupt operations. Cancellation
  cannot abort an in-flight API call; it stops further pages/batches afterward.
- User permissions do not protect against another process running as the same
  user, and underlying filesystems must support private permissions and atomic
  rename/hard-link operations for the storage guarantees.
