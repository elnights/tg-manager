import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import qr from 'qrcode-terminal';
import type {AuthClient} from './telegram.js';
import type {ApiCredentials} from './credentials.js';

type Props = {
  client: AuthClient;
  apiCredentials: ApiCredentials;
  onAuthenticated: () => void;
  persistSession?: () => void;
};

export function Auth({client, apiCredentials, onAuthenticated, persistSession}: Props) {
  const {exit} = useApp();
  const cancelLogin = useRef<() => void>(() => {});
  const [status, setStatus] = useState('Checking Telegram session...');
  const [qrText, setQrText] = useState('');
  const [passwordHint, setPasswordHint] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const passwordResolver = useRef<((value: string) => void) | null>(null);
  const [error, setError] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      cancelLogin.current();
      exit();
      return;
    }
    if (!passwordResolver.current) return;
    if (key.return) {
      const resolve = passwordResolver.current;
      passwordResolver.current = null;
      setPasswordHint(undefined);
      resolve(password);
      setPassword('');
    } else if (key.backspace || key.delete) {
      setPassword((p) => p.slice(0, -1));
    } else if (!key.ctrl && !key.meta && !key.escape && input) {
      setPassword((p) => p + input);
    }
  });

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const cleanup = () => {
      disposed = true;
      controller.abort();
      passwordResolver.current?.('');
      passwordResolver.current = null;
    };
    cancelLogin.current = cleanup;
    (async () => {
      try {
        if (await client.checkAuthorization()) {
          if (!disposed) onAuthenticated();
          return;
        }
        if (disposed) return;
        setStatus('Telegram → Settings → Devices → Link Desktop Device');
        const {apiId, apiHash} = apiCredentials;
        await client.signInUserWithQrCode(
          {apiId, apiHash},
          {
            abortSignal: controller.signal,
            qrCode: async (code) => {
              if (disposed) throw new Error('Login cancelled');
              const token = code.token.toString('base64url');
              qr.generate(`tg://login?token=${token}`, {small: true}, (value) => {
                if (!disposed) setQrText(value);
              });
            },
            password: async (hint) => {
              if (disposed) throw new Error('Login cancelled');
              setPassword('');
              setPasswordHint(hint || ' ');
              return await new Promise<string>((resolve) => {
                passwordResolver.current = resolve;
              });
            },
            onError: async (e) => {
              if (!disposed) setError(e.message);
              return (
                disposed ||
                !/PASSWORD_HASH_INVALID|Password is empty|SRP_ID_INVALID|SRP_PASSWORD_CHANGED/i.test(
                  e.message,
                )
              );
            },
          },
        );
        if (!disposed) {
          if (!(await client.checkAuthorization())) throw new Error('Authorization not completed');
          if (disposed) return;
          if (persistSession) persistSession();
          else throw new Error('Session persistence is unavailable.');
          if (!disposed) onAuthenticated();
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();
    return cleanup;
  }, [client, apiCredentials, onAuthenticated, persistSession]);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyanBright">
        TG MANAGER — LOGIN
      </Text>
      <Text>{status}</Text>
      {qrText && !passwordHint && <Text>{qrText}</Text>}
      {passwordHint !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellowBright">
            Cloud password required{passwordHint.trim() ? ` (hint: ${passwordHint})` : ''}
          </Text>
          <Text>Password: {'*'.repeat(password.length)}_</Text>
        </Box>
      )}
      {error && <Text color="redBright">{error}</Text>}
      <Text dimColor>
        QR expires automatically; the next code will appear here. Esc cancels; Ctrl+C to quit.
      </Text>
    </Box>
  );
}
