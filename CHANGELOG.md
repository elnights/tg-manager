# Changelog

## 0.5.0 (Unreleased)

### Added

- Preview photos and available video/document thumbnails in message details with portable colour or monochrome cells; show attachment metadata and explicitly open supported originals in the system viewer.
- Show an animated top-right activity indicator with operation counts and cancellation feedback; label own-message filtering while checks run.
- Show chat-type badges and filter any combination of private chats, bots, basic groups, supergroups and channels.
- Split channel posts and discussions into independent panes, with Mine/All filters and selected-post or entire-group scope, including general chat.
- Follow post highlights with debounced, cached thread loading and preserve correct deletion scope and peer identity.
- Filter loaded chats to conversations containing your own messages, with cancellable checks and pagination support.

- Search loaded chats, load more conversations, and refresh the chat list.
- Page Up/Down and Home/End navigation in both panels.
- Read-only, scrolling message details and full notice details.
- Keyboard help, synthetic terminal previews, and private vulnerability reporting.
- Contributor checks and a manual trusted-publishing workflow template.

### Fixed

- Show the `t` scope shortcut beside the discussion pane's scope label.
- Show `p` in the footer legend and clarify that it toggles private chats and bots together.
- Resolve comments through nested reply chains even when source posts are not loaded; incomplete context stays unavailable instead of being mislabeled General.

- Keep the top header and chat-list viewport stable when switching chat types and resolving discussions.
- Highlight a comment’s source post automatically and use `g` to focus it, including older posts outside the loaded page.

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
