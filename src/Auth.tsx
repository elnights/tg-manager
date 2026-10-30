import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import qr from 'qrcode-terminal';
import type {TelegramClient} from 'teleproto';
import {saveSession} from './client.js';
import type {ApiCredentials} from './credentials.js';

type Props = {client: TelegramClient; apiCredentials: ApiCredentials; onAuthenticated: () => void};

export function Auth({client, apiCredentials, onAuthenticated}: Props) {
  const [status, setStatus] = useState('Checking Telegram session...');
  const [qrText, setQrText] = useState('');
  const [passwordHint, setPasswordHint] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const passwordResolver = useRef<((value: string) => void) | null>(null);
  const [error, setError] = useState('');

  useInput((input, key) => {
    if (!passwordResolver.current) return;
    if (key.return) {
      const resolve = passwordResolver.current;
      passwordResolver.current = null;
      setPasswordHint(undefined);
      resolve(password);
      setPassword('');
    } else if (key.backspace || key.delete) {
      setPassword(p => p.slice(0, -1));
    } else if (!key.ctrl && !key.meta && !key.escape && input) {
      setPassword(p => p + input);
    }
  });

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        if (await client.checkAuthorization()) {
          if (!disposed) onAuthenticated();
          return;
        }
        setStatus('Telegram → Settings → Devices → Link Desktop Device');
        const {apiId, apiHash} = apiCredentials;
        await client.signInUserWithQrCode({apiId, apiHash}, {
          qrCode: async code => {
            if (disposed) throw new Error('Login cancelled');
            const token = code.token.toString('base64url');
            qr.generate(`tg://login?token=${token}`, {small: true}, value => {
              if (!disposed) setQrText(value);
            });
            setError('');
          },
          password: async hint => {
            if (disposed) throw new Error('Login cancelled');
            setPassword('');
            setPasswordHint(hint || ' ');
            return await new Promise<string>(resolve => { passwordResolver.current = resolve; });
          },
          onError: async e => {
            if (!disposed) setError(e.message);
            return !disposed;
          },
        });
        if (!disposed) {
          if (!(await client.checkAuthorization())) throw new Error('Authorization not completed');
          saveSession(client);
          onAuthenticated();
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();
    return () => { disposed = true; };
  }, [client, apiCredentials, onAuthenticated]);

  return <Box flexDirection="column" paddingX={2} paddingY={1}>
    <Text bold color="cyanBright">TG MANAGER — LOGIN</Text>
    <Text>{status}</Text>
    {qrText && !passwordHint && <Text>{qrText}</Text>}
    {passwordHint !== undefined && <Box flexDirection="column" marginTop={1}>
      <Text color="yellowBright">Cloud password required{passwordHint.trim() ? ` (hint: ${passwordHint})` : ''}</Text>
      <Text>Password: {'*'.repeat(password.length)}_</Text>
    </Box>}
    {error && <Text color="redBright">{error}</Text>}
    <Text dimColor>QR expires automatically; the next code will appear here. Ctrl+C to quit.</Text>
  </Box>;
}
