#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';

async function main() {
  const {values} = parseArgs({
    options: {
      help: {type: 'boolean', short: 'h'},
      version: {type: 'boolean', short: 'v'},
      demo: {type: 'boolean'},
      config: {type: 'string'},
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`TG Manager — manage your own Telegram messages

Usage: tg-manager [options]

Options:
  -h, --help          Show this help
  -v, --version       Show the installed version
      --config PATH   Load TG_API_ID and TG_API_HASH from an environment file
      --demo          Run the offline emoji demo without Telegram access

Requires Node.js 24+ and an interactive terminal.
Use --config, export TG_API_ID/TG_API_HASH, or enter them in the TUI when asked.
On first launch, scan the QR code in Telegram's Devices settings.

Groups and channels are shown by default. Press p to include private chats.
Main keys: Tab switch panel; arrows or j/k move; PgUp/PgDn page; Home/End ends;
/ search loaded chats; R refresh chats; m more chats; Enter inspect a message;
Space mark; s select own;
c clear selection; n next page; L load all; v view mine/all;
d delete marked; A delete all own messages; [ / ] adjust chat width;
0 reset chat width to 32%; r reload messages/retry initialization; ! notice details; ? keyboard help; q quit; Ctrl+C quit anytime.
Esc stops background work after the in-flight request; completed batches stay deleted.
Deletion requires typing DELETE and pressing Enter; Esc cancels.`);
    return;
  }
  if (values.version) {
    const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(version);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('An interactive terminal is required. Run tg-manager --help for usage.');
  }
  if (values.demo) {
    await import('./emoji-demo.js');
    return;
  }
  if (values.config) process.loadEnvFile(values.config);
  const {start} = await import('./index.js');
  await start({allowCredentialPrompt: !values.config});
}

main().catch((error) => {
  console.error(`tg-manager: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
