# Contributing

Use Node.js 24 or newer. If you use nvm, run `nvm use` in the repository.
Install the locked dependencies with `npm ci`.

Read [AGENTS.md](AGENTS.md) for repository constraints and
[ARCHITECTURE.md](ARCHITECTURE.md) for the module map, safety invariants and test coverage.

Before submitting a change, run:

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:package
npm run build
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

Use synthetic Telegram clients and temporary session fixtures for changes to
deletion, authentication or storage. Never run destructive tests against a real
account. Describe behavior changes and the checks you ran in the pull request.
For a terminal bug report, include your OS, Node.js version, terminal/version
and a synthetic reproduction. Exclude real chat data, credentials and sessions.

Use `npm run format` for mechanical formatting. Tools operate on explicit public
source/documentation paths and exclude `.env`, `.env.*` and `.local/` before
reading. Do not run broad format/lint commands over the repository. Keep behavior
changes and formatting separate in review where practical.

`npm run preview:synthetic` runs the real App with fake clients and in-memory
settings; `npm run preview:capture` regenerates the README SVG and a narrow preview.
Neither reads real sessions nor connects to Telegram.

See [Publishing](docs/publishing.md) for release preparation.
Run [the local secret review](docs/security.md) before publishing changes.
