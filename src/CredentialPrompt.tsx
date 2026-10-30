import React, {useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {parseCredentials, type ApiCredentials} from './credentials.js';

type Props = {
  initialId?: string;
  initialHash?: string;
  onSubmit: (credentials: ApiCredentials) => void;
};

export function CredentialPrompt({initialId = '', initialHash = '', onSubmit}: Props) {
  const {exit} = useApp();
  const [apiId, setApiId] = useState(initialId);
  const [apiHash, setApiHash] = useState(initialHash);
  const [field, setField] = useState<'id' | 'hash'>(initialId && !initialHash ? 'hash' : 'id');
  const [error, setError] = useState('');
  useInput((input, key) => {
    if (key.escape) {exit(); return;}
    if (key.tab || key.upArrow || key.downArrow) {
      setField(previous => previous === 'id' ? 'hash' : 'id');
      setError('');
      return;
    }
    if (key.return) {
      if (field === 'id') {setField('hash'); return;}
      try {onSubmit(parseCredentials(apiId, apiHash));}
      catch (error) {setError(error instanceof Error ? error.message : String(error));}
      return;
    }
    const update = field === 'id' ? setApiId : setApiHash;
    if (key.backspace || key.delete) update(previous => previous.slice(0, -1));
    else if (!key.ctrl && !key.meta && input) update(previous => (previous + input.trim()).slice(0, 128));
    setError('');
  });
  return <Box flexDirection="column" paddingX={2} paddingY={1}>
    <Text bold color="cyanBright">TG MANAGER — API CREDENTIALS</Text>
    <Text>Get your API ID and hash from https://my.telegram.org/.</Text>
    <Text color={field === 'id' ? 'yellowBright' : 'white'} wrap="truncate-end">
      {`${field === 'id' ? '>' : ' '} API ID: ${apiId}${field === 'id' ? '_' : ''}`}
    </Text>
    <Text color={field === 'hash' ? 'yellowBright' : 'white'} wrap="truncate-end">
      {`${field === 'hash' ? '>' : ' '} API hash: ${'*'.repeat(apiHash.length)}${field === 'hash' ? '_' : ''}`}
    </Text>
    {error && <Text color="redBright">{error}</Text>}
    <Text>Tab switches fields. Enter continues. Esc / Ctrl+C quits.</Text>
    <Text dimColor>Entered credentials are used for this run and are not saved.</Text>
  </Box>;
}
