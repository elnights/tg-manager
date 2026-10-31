import React, {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Text} from 'ink';
import {Reader} from './Reader.js';
import type {Message} from './messages.js';
import type {TelegramApi} from './telegram.js';
import {
  attachmentText,
  decodePreview,
  downloadAttachment,
  openAttachment,
  MEDIA_BYTES,
  type MediaFiles,
  type Raster,
} from './media.js';
import type {Progress} from './StatusBar.js';
import {describeError} from './errors.js';

// Half-block pixels are ordinary terminal cells, so Ink owns their scrolling,
// clipping and clearing on every platform. Monochrome terminals use luminance.
export function previewRows(image: Raster, columns: number, rows: number, color: boolean): ReactNode[] {
  if (columns <= 0 || rows <= 0) return [];
  const scale = Math.min(Math.min(80, columns) / image.width, (rows * 2) / image.height, 1);
  const width = Math.max(1, Math.floor(image.width * scale));
  const height = Math.max(1, Math.floor(image.height * scale));
  const rgb = (x: number, y: number) => {
    const offset =
      (Math.min(image.height - 1, Math.floor(y / scale)) * image.width +
        Math.min(image.width - 1, Math.floor(x / scale))) *
      4;
    return [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!] as const;
  };
  const hex = (values: readonly number[]) =>
    '#' + values.map((value) => value.toString(16).padStart(2, '0')).join('');
  return Array.from({length: Math.ceil(height / 2)}, (_, row) => (
    <Text key={row}>
      {Array.from({length: width}, (_, column) => {
        const top = rgb(column, row * 2);
        const bottom = rgb(column, Math.min(height - 1, row * 2 + 1));
        return color ? (
          <Text key={column} color={hex(top)} backgroundColor={hex(bottom)}>
            ▀
          </Text>
        ) : (
          <Text key={column}>{' .:-=+*#%@'[Math.round(((top[0] + top[1] + top[2]) / 765) * 9)]}</Text>
        );
      })}
    </Text>
  ));
}

export function MessageDetails({
  message,
  client,
  width,
  height,
  onClose,
  files,
}: {
  message: Message;
  client: Pick<TelegramApi, 'downloadMedia'>;
  width: number;
  height: number;
  onClose: () => void;
  files?: MediaFiles;
}) {
  const attachment = message.attachment;
  const canPreview = Boolean(attachment?.preview && client.downloadMedia);
  const canOpen = Boolean(
    attachment?.extension && client.downloadMedia && (attachment.size ?? 0) <= MEDIA_BYTES,
  );
  const [image, setImage] = useState<Raster>();
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<Progress | null>(canPreview ? {label: 'Loading preview'} : null);
  const current = useRef<AbortController | null>(null);
  const closed = useRef(false);
  const saved = useRef<string | undefined>(undefined);
  const run = useCallback(
    async (preview: boolean) => {
      if (!attachment || current.current || closed.current) return;
      const task = new AbortController();
      current.current = task;
      setProgress({label: preview ? 'Loading preview' : 'Downloading media'});
      setStatus(preview ? 'Loading image preview…' : 'Downloading attachment for the system viewer…');
      try {
        const data = await downloadAttachment(client, attachment, preview, task.signal, (received, total) => {
          if (!task.signal.aborted)
            setProgress({
              label: preview ? 'Loading preview (KiB)' : 'Downloading media (KiB)',
              completed: Math.floor(received / 1024),
              total: Math.ceil(total / 1024),
            });
        });
        if (preview) {
          const decoded = decodePreview(data);
          if (!task.signal.aborted) {
            setImage(decoded);
            setStatus('Image preview');
          }
        } else {
          const result = await openAttachment(data, attachment, task.signal, files);
          if (!task.signal.aborted) {
            saved.current = result.file;
            setStatus(
              `Saved to: ${result.file}\n${result.error ? `System viewer unavailable: ${result.error}` : 'System viewer launch requested.'}`,
            );
          }
        }
      } catch (error) {
        if (!task.signal.aborted)
          setStatus(`${preview ? 'Preview unavailable' : 'Cannot open media'}: ${describeError(error)}`);
      } finally {
        if (!task.signal.aborted) {
          current.current = null;
          setProgress(null);
        }
      }
    },
    [attachment, client, files],
  );
  useEffect(() => {
    closed.current = false;
    if (canPreview) void run(true);
    return () => {
      closed.current = true;
      current.current?.abort();
      current.current = null;
    };
  }, [canPreview, run]);
  const pixels = useMemo(
    () =>
      image
        ? previewRows(
            image,
            width,
            Math.max(2, Math.min(14, Math.floor(height / 2))),
            process.stdout.hasColors?.(16) ?? false,
          )
        : [],
    [image, width, height],
  );
  const extraLines: ReactNode[] = attachment
    ? [
        '',
        attachmentText(attachment),
        ...(status
          ? [status]
          : [canPreview ? 'Loading image preview…' : 'No image preview is available for this attachment.']),
        ...pixels,
        ...(!canOpen
          ? [
              attachment.size !== undefined && attachment.size > MEDIA_BYTES
                ? 'Opening is limited to attachments up to 50 MiB.'
                : 'System opening is unavailable for this attachment.',
            ]
          : []),
      ]
    : [];
  return (
    <Reader
      title={`MESSAGE ${message.id} · Read only`}
      text={`${message.context ? message.context + '\n' : ''}${message.author} · ${message.date}\n${message.content}`}
      width={width}
      height={height}
      onClose={onClose}
      extraLines={extraLines}
      progress={progress}
      media={{preview: canPreview, open: canOpen && !saved.current, busy: Boolean(progress)}}
      onMediaAction={(action) => void run(action === 'mediaPreview')}
    />
  );
}
