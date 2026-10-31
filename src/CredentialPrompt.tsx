import React, {useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {parseCredentials, type ApiCredentials} from './credentials.js';

type Props = {
  initialId?: string;
  initialHash?: string;
  persistCredentials?: (credentials: ApiCredentials) => void;
  onSubmit: (credentials: ApiCredentials) => void;
};

export function CredentialPrompt({initialId = '', initialHash = '', persistCredentials, onSubmit}: Props) {
  const {exit} = useApp();
  const [apiId, setApiId] = useState(initialId);
  const [apiHash, setApiHash] = useState(initialHash);
  const [field, setField] = useState<'id' | 'hash'>(initialId && !initialHash ? 'hash' : 'id');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<ApiCredentials>();
  const submitted = useRef(false);
  useInput((input, key) => {
    if (submitted.current) return;
    if (key.escape) {
      exit();
      return;
    }
    if (pending) {
      const save = key.return || input.toLowerCase() === 'y';
      if (!save && input.toLowerCase() !== 'n') return;
      try {
        if (save) {
          if (!persistCredentials) throw new Error('Credential saving is unavailable.');
          persistCredentials(pending);
        }
      } catch {
        setError('Could not save API credentials. Y retries; N continues without saving.');
        return;
      }
      submitted.current = true;
      onSubmit(pending);
      return;
    }
    if (key.tab || key.upArrow || key.downArrow) {
      setField((previous) => (previous === 'id' ? 'hash' : 'id'));
      setError('');
      return;
    }
    if (key.return) {
      if (field === 'id') {
        setField('hash');
        return;
      }
      try {
        setPending(parseCredentials(apiId, apiHash));
        setError('');
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const update = field === 'id' ? setApiId : setApiHash;
    if (key.backspace || key.delete) update((previous) => previous.slice(0, -1));
    else if (!key.ctrl && !key.meta && input) update((previous) => (previous + input.trim()).slice(0, 128));
    setError('');
  });
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyanBright">
        TG MANAGER — API CREDENTIALS
      </Text>
      <Text>Get your API ID and hash from https://my.telegram.org/.</Text>
      <Text color={!pending && field === 'id' ? 'yellowBright' : 'white'} wrap="truncate-end">
        {`${!pending && field === 'id' ? '>' : ' '} API ID: ${apiId}${!pending && field === 'id' ? '_' : ''}`}
      </Text>
      <Text color={!pending && field === 'hash' ? 'yellowBright' : 'white'} wrap="truncate-end">
        {`${!pending && field === 'hash' ? '>' : ' '} API hash: ${'*'.repeat(apiHash.length)}${!pending && field === 'hash' ? '_' : ''}`}
      </Text>
      {error && <Text color="redBright">{error}</Text>}
      {pending ? (
        <>
          <Text>Save API credentials on this device? [Y/n]</Text>
          <Text>Y / Enter saves locally; N uses them once. Esc / Ctrl+C quits.</Text>
          <Text dimColor>Saved unencrypted with private file permissions in your user data directory.</Text>
        </>
      ) : (
        <>
          <Text>Tab switches fields. Enter continues. Esc / Ctrl+C quits.</Text>
          <Text dimColor>You’ll choose whether to save these credentials before connecting.</Text>
        </>
      )}
    </Box>
  );
}
