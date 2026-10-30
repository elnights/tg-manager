# Agent instructions

- Do not read, search within, or modify `.env`, `.env.*`, or `.local/` and its contents anywhere in this project unless the user explicitly requests it.
- Exclude those paths from searches and bulk file reads.

## Working in this repository

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the module map, safety invariants and relevant regression tests.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for validation. Keep the architecture guide current when responsibilities or safety semantics change.
- Use synthetic Telegram clients, temporary storage fixtures, in-memory settings and injected session persistence. Never authenticate or test deletion against a real account.
- Use `npm run preview:synthetic` or `npm run repro:emoji` for offline previews. Do not use `npm start` for automated checks: it can load the project's protected environment file.
