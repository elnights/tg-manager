# Publishing

This repository builds the `tg-manager-tui` npm package and `tg-manager` CLI.
Releases require Node.js 24+ and retain the WTFPL license.

## Release checks

1. Update the version in package.json and package-lock.json together. Date the
   matching changelog entry when releasing.
2. Run:

   ```sh
   npm ci
   npm run lint
   npm run format:check
   npm run typecheck
   npm test
   npm run test:package
   npm run build
   npm audit --omit=dev
   npm run test:secrets
   git diff --check
   ```

   Secret scanning requires Gitleaks 8.30.1; see [security checks](security.md).

3. Run `npm run repro:emoji` and `npm run preview:synthetic` in a terminal.
   Check navigation, focus, resizing and synthetic confirmation. Never use a real
   Telegram account for release testing.
4. Pack and inspect the tarball, then install it with production dependencies
   only. `test:package` automates this check. Source, fixtures and contributor
   tooling must stay out of the package.
5. Publish the reviewed artifact only after approval. Version `X.Y.Z` corresponds
   to npm `tg-manager-tui@X.Y.Z`, Git tag `vX.Y.Z`, the GitHub release and
   `tg-manager-tui-X.Y.Z.tgz`. Attach that tarball and its SHA-256 to the release;
   use the changelog for release notes. Never reuse versions or move release tags.

## First publication

Verify ownership or availability of `tg-manager-tui` before publishing.
For a new name, bootstrap it with an authorized npm account and 2FA using
[npm's unscoped-package instructions](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).
Trusted publishers are configured in an existing package's settings, so plan for
this manual first publication before setting up OIDC. A local publish does not
establish CI provenance. Keep npm credentials out of the repository.

## Trusted publishing setup

[Trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires npm
11.5.1+ and Node 22.14+; this project uses Node 24+. Use GitHub-hosted runners.
Configure the package's npm trusted publisher with:

| Field                | Value                     |
| -------------------- | ------------------------- |
| User or organization | `elnights`                |
| Repository           | `tg-manager`              |
| Workflow filename    | `publish.yml`             |
| Environment          | `npm-release`             |
| Direct publishing    | Allowed for this template |

A new configuration must publish successfully within two days or be recreated.

Before moving `.github/publish.yml.example` to `.github/workflows/publish.yml`:

- Create the `npm-release` environment with required approval and protected `v*` tags.
- Protect release tags and review workflow changes. Retain minimal permissions,
  `persist-credentials: false` and full commit pins for external Actions.
- Confirm the npm publisher settings match the workflow exactly.

The template stays inactive until moved. Once enabled, dispatch it manually on
an approved version tag after CI and Secret scanning pass. It checks tag/version
consistency, retains the exact tarball and checksum as `npm-artifact` for 14 days,
and publishes those bytes with OIDC. Attach that download to the GitHub release.
Review token restrictions after trusted publishing works.

[npm provenance](https://docs.npmjs.com/generating-provenance-statements/) requires
a public repository and public package; `repository.url` must match the source.
It links the package to its source and build, without certifying code safety.
After installation, use `npm audit signatures` to verify attestations.
