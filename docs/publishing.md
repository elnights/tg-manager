# Publishing

The GitHub repository is [elnights/tg-manager](https://github.com/elnights/tg-manager).
It produces the `tg-manager-tui` npm package and installs the
`tg-manager` command. Node.js 24+ is required. Runtime JavaScript is compiled
into `dist/`; consumers do not need TypeScript, tsx or the test packages.

## Release preparation

1. Confirm npm account access to the `tg-manager-tui` name before the first
   release. The project uses WTFPL (see `LICENSE` and the `license` field in
   `package.json`).
2. Update the version in `package.json` and its lockfile if publishing a new
   version. Leave npm credentials in your own npm configuration.
3. Run the release checks:

   ```sh
   npm ci
   npm run typecheck
   npm test
   npm run test:package
   ```

4. In an interactive terminal, run `npm run repro:emoji`. Check navigation,
   focus, row highlighting, panel widths and terminal resizing.
5. Commit with the repository's configured signing key and wait for GitHub CI
   to pass after pushing to the chosen repository.

## Build and inspect the artifact

```sh
npm pack
```

The `prepack` hook rebuilds the CLI and makes its executable entry point ready.
The package uses an explicit file allowlist: generated JavaScript,
documentation and npm's required metadata. Source, tests, working directories
and configuration files are excluded. The package test verifies the contents
and installs the tarball in a temporary location to exercise `--help`,
`--version`, the offline demo, missing-credentials UI, invalid configuration,
invalid arguments and the non-interactive-terminal error. It also verifies the
Telegram and QR-code dependencies can be imported.

You can also install the generated tarball into a separate test prefix:

```sh
npm install --prefix /tmp/tg-manager-preview ./tg-manager-tui-0.4.0.tgz
/tmp/tg-manager-preview/node_modules/.bin/tg-manager --help
/tmp/tg-manager-preview/node_modules/.bin/tg-manager --demo
```

Use `--demo` for a release preview without Telegram credentials or sessions.
The normal CLI requires an interactive terminal. Credentials can be entered in
the UI, exported in the environment or supplied using `--config PATH`.
It retains the existing working-directory
session location documented in the README.

## Publish after review

```sh
npm publish --dry-run
npm publish
```

The `prepublishOnly` hook runs typecheck, rendering tests and the package
installation test. Publishing requires an authorized npm account and an unused
package version. For a scoped public package, include `--access public`.

After the package is published, create the matching Git tag and GitHub release,
and remove the README's first-release qualification. Publishing and release
creation are manual; the CI workflow only runs verification.
