# Repository security checks

To report a vulnerability, use the repository's enabled
[private reporting form](https://github.com/elnights/tg-manager/security/advisories/new).
See the [security policy](../SECURITY.md) for supported versions and reporting guidance.

Never commit Telegram sessions, API hashes, passwords, message exports or private
logs. `.gitignore` excludes credentials, local storage, session files, common
export filenames and logs. The npm package uses an explicit file allowlist;
`npm run test:package` checks the artifact and installed CLI.

The secret-scanning workflow has only `contents: read`, checks full reachable
history and tracked working files, and runs Gitleaks locally. It downloads a
version and SHA-256 pinned upstream binary. No source is uploaded to an analysis
service, and no findings artifacts, source excerpts or PR comments are published.
Only paths, commit IDs, line numbers and rule names reach the log. Default
Gitleaks rules are supplemented with Telegram API-hash and string-session rules.

To run the same review locally, install
[Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), then:

```sh
npm run test:secrets
```

Stage new public files before running so the tracked-file snapshot includes
them. Deleted files are still scanned through history. Untracked files and
symlinks are not read. Reports and the snapshot are removed after the scan.

Following `AGENTS.md`, `.env`, `.env.*` and `.local/` contents are excluded
**before** reading files or generating history diffs. Their names are reviewed
without content inspection. A tracked `.env.example` is permitted by filename,
but its contents are deliberately not verified. Other protected/private
filenames fail the check, including historical occurrences.

## Scope and limitations

Pattern scanning cannot prove that arbitrary text contains no private messages,
and protected contents, unreachable commits, remote-only refs, and GitHub logs or
artifacts are outside this local review. Review any exported data before adding
it. If exposure is found, report the path and commit without copying the secret.
Credential revocation and history rewriting require a separate owner decision.
