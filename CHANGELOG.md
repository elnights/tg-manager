# Changelog

## 0.5.0 (Unreleased)

### Added

- Search loaded chats, load more conversations, and refresh the chat list.
- Page Up/Down and Home/End navigation in both panels.
- Read-only, scrolling message details and full notice details.
- Keyboard help, synthetic terminal previews, and private vulnerability reporting.
- Contributor checks and a manual trusted-publishing workflow template.

### Fixed

- Require fully visible account, chat ID, message count and warnings before deletion.
- Retry incorrect cloud passwords and stop pending login work on cancellation.
- Recover failed initial loads without restarting the app.
- Keep deletion progress visible and preserve results until acknowledged.
- Keep the chat list steady while messages load.

### Changed

- Store sessions in the user data directory and migrate legacy sessions safely.
- Verify accepted deletion batches before reporting success or stopping.
- Share commands and message operations; retain existing Unicode rendering coverage.
