import React, {useCallback, useState} from 'react';
import {render, Text} from 'ink';
import type {TelegramClient} from 'teleproto';
import {App} from './App.js';
import {Auth} from './Auth.js';
import {CredentialPrompt} from './CredentialPrompt.js';
import type {ApiCredentials} from './credentials.js';
import {credentials, makeClient, saveSession} from './client.js';
import {TerminalOutput} from './terminal-output.js';

function Root({client, apiCredentials}: {client: TelegramClient; apiCredentials: ApiCredentials}) {
  const [authorized, setAuthorized] = useState(false);
  const persist = useCallback(() => saveSession(client), [client]);
  const ready = useCallback(() => setAuthorized(true), []);
  return authorized ? (
    <App client={client} />
  ) : (
    <Auth client={client} apiCredentials={apiCredentials} onAuthenticated={ready} persistSession={persist} />
  );
}

export async function start({allowCredentialPrompt = true} = {}) {
  let apiCredentials: ApiCredentials | undefined;
  try {
    apiCredentials = credentials();
  } catch (error) {
    if (!allowCredentialPrompt)
      throw new Error(
        `Invalid API credentials in the supplied configuration: ${error instanceof Error ? error.message : String(error)}`,
        {cause: error},
      );
  }
  let submit!: (value: ApiCredentials) => void;
  const entered = new Promise<ApiCredentials>((resolve) => {
    submit = resolve;
  });
  const stdout = new TerminalOutput(process.stdout);
  const instance = render(
    apiCredentials ? (
      <Text>Connecting to Telegram...</Text>
    ) : (
      <CredentialPrompt
        initialId={process.env.TG_API_ID}
        initialHash={process.env.TG_API_HASH}
        onSubmit={submit}
      />
    ),
    {stdout, exitOnCtrlC: true, alternateScreen: true},
  );
  let exited = false;
  const untilExit = instance.waitUntilExit().then(
    () => {
      exited = true;
    },
    (error) => {
      exited = true;
      throw error;
    },
  );
  let client: TelegramClient | undefined;
  try {
    apiCredentials ??= await Promise.race([entered, untilExit.then(() => undefined)]);
    if (!apiCredentials || exited) return;
    instance.rerender(<Text>Connecting to Telegram...</Text>);
    client = makeClient(apiCredentials);
    const connectingClient = client;
    const connected = client.connect().then(async () => {
      if (exited) await connectingClient.disconnect();
    });
    await Promise.race([connected, untilExit]);
    if (exited) return;
    instance.rerender(<Root client={client} apiCredentials={apiCredentials} />);
    await untilExit;
  } finally {
    instance.unmount();
    try {
      await untilExit;
    } finally {
      try {
        if (client) await client.disconnect();
      } finally {
        stdout.destroy();
      }
    }
  }
}
