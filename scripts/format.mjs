import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

// Positive allowlists prevent discovery of protected contents, even if ignored
// files are explicitly requested elsewhere. Never use `prettier .`.
const permitted = (file) =>
  !file.split(path.sep).some((part) => part === '.local' || part === '.env' || part.startsWith('.env.'));
function filesIn(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (!permitted(file) || entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return filesIn(file);
    return /\.(?:tsx?|mjs|md|json|yml)$/.test(file) || file === '.github/publish.yml.example' ? [file] : [];
  });
}
const files = ['src', 'test', 'scripts', 'docs', '.github']
  .flatMap(filesIn)
  .concat([
    'package.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'eslint.config.mjs',
    'prettier.config.mjs',
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CHANGELOG.md',
  ]);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/prettier/bin/prettier.cjs',
    process.argv.includes('--write') ? '--write' : '--check',
    ...files,
  ],
  {stdio: 'inherit'},
);
process.exitCode = result.status ?? 1;
