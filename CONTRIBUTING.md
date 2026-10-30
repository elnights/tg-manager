# Contributing

Use Node.js 24 or newer. If you use nvm, run `nvm use` in the repository.
Install the locked dependencies with `npm ci`.

Before submitting a change, run:

```sh
npm run typecheck
npm test
npm run test:package
```

The automated tests use simulated terminal streams and xterm buffers. They do
not require Telegram credentials, a session, or an interactive terminal.

The package test builds the CLI, creates a tarball, installs it into a temporary
directory with production dependencies only, and checks the installed command
and offline demo.
It may download dependencies from npm. `npm run build` produces JavaScript in
`dist/`; the installed CLI does not require TypeScript or tsx.

For rendering changes, also run `npm run repro:emoji` in an interactive terminal.
Check navigation, focus, `[`, `]`, `0`, selection backgrounds and terminal
resizing. The demo uses synthetic titles and does not connect to Telegram.
See [the rendering investigation](docs/unicode-rendering.md) for the width
mismatch and regression coverage.

Keep changes to deletion or authentication separate from rendering changes.
Describe behavior changes and the checks you ran in the pull request.
For a terminal bug report, include your OS, Node.js version, terminal/version
and a synthetic reproduction. Exclude real chat data, credentials and sessions.

See [Publishing](docs/publishing.md) for release preparation.
