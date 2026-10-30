# Changelog

## 0.5.0 (Unreleased)

### Added

- Filter loaded chats to conversations containing your own messages, with cancellable checks and pagination support.

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
- Improve active-pane contrast with white text on dark blue.

### Changed

- Separate view toggles and loaded counts into a top strip; simplify the action footer.
- Keep layout and extended navigation shortcuts in keyboard help.

- Store sessions in the user data directory and migrate legacy sessions safely.
- Verify accepted deletion batches before reporting success or stopping.
- Share commands and message operations; retain existing Unicode rendering coverage.
