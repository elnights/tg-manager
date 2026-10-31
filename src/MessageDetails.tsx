import React, {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Text} from 'ink';
import stringWidth from 'string-width';
import {Reader} from './Reader.js';
import {Row} from './ui.js';
import {albumRecords, messageItems, messageRecords, type Message} from './messages.js';
import type {Chat, TelegramApi} from './telegram.js';
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

type DetailsClient = Pick<TelegramApi, 'downloadMedia'> & Partial<Pick<TelegramApi, 'getMessages'>>;

function DetailSection({title, width, active = false}: {title: string; width: number; active?: boolean}) {
  const label = `${active ? '[CURRENT]' : '──'} ${title} `;
  return (
    <Row
      width={width}
      bold
      color={active ? '#ffffff' : 'cyanBright'}
      backgroundColor={active ? '#1e3a8a' : undefined}
    >
      {label + '─'.repeat(Math.max(0, width - stringWidth(label)))}
    </Row>
  );
}

export function MessageDetails({
  message,
  client,
  chat,
  selfId,
  ...props
}: {
  message: Message;
  client: DetailsClient;
  chat?: Chat;
  selfId?: string;
  width: number;
  height: number;
  onClose: () => void;
  files?: MediaFiles;
}) {
  const [items, setItems] = useState(() => messageItems(message));
  const [selectedId, setSelectedId] = useState(() => messageItems(message)[0]!.id);
  const [albumStatus, setAlbumStatus] = useState(
    message.groupedId && client.getMessages && chat && selfId ? 'Loading album items…' : '',
  );
  useEffect(() => {
    if (!message.groupedId || !client.getMessages || !chat || !selfId) return;
    let disposed = false;
    void albumRecords({getMessages: client.getMessages.bind(client)}, chat, message.id, message.groupedId)
      .then((records) => {
        if (disposed) return;
        const found = new Map(messageItems(message).map((item) => [item.id, item]));
        for (const item of messageRecords(records, selfId, 'all'))
          if (!found.has(item.id)) found.set(item.id, item);
        setItems([...found.values()].sort((a, b) => a.id - b.id));
        setAlbumStatus(records.length ? '' : 'No additional album items are accessible.');
      })
      .catch((error) => {
        if (!disposed) setAlbumStatus(`Album items unavailable: ${describeError(error)}`);
      });
    return () => {
      disposed = true;
    };
  }, [client, chat, selfId, message]);
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const current = items[index]!;
  return (
    <MessageItemDetails
      key={current.id}
      {...props}
      client={client}
      message={current}
      album={message.groupedId ? items : undefined}
      albumStatus={albumStatus}
      albumIndex={index}
      onItem={(next) => setSelectedId(items[next]!.id)}
    />
  );
}

function MessageItemDetails({
  message,
  client,
  width,
  height,
  onClose,
  files,
  album,
  albumStatus,
  albumIndex,
  onItem,
}: {
  message: Message;
  client: Pick<TelegramApi, 'downloadMedia'>;
  width: number;
  height: number;
  onClose: () => void;
  files?: MediaFiles;
  album?: readonly Message[];
  albumStatus: string;
  albumIndex: number;
  onItem: (index: number) => void;
}) {
  const attachment = message.attachment;
  const canPreview = Boolean(attachment?.preview && client.downloadMedia);
  const canOpen = Boolean(
    attachment?.extension && client.downloadMedia && (attachment.size ?? 0) <= MEDIA_BYTES,
  );
  const [image, setImage] = useState<Raster>();
  const [previewFailed, setPreviewFailed] = useState(false);
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
      if (preview) setPreviewFailed(false);
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
        if (!task.signal.aborted) {
          if (preview) setPreviewFailed(true);
          setStatus(`${preview ? 'Preview unavailable' : 'Cannot open media'}: ${describeError(error)}`);
        }
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
  const mediaLines: ReactNode[] = attachment
    ? [
        '',
        attachmentText(attachment),
        ...(album ? [<DetailSection title={`Preview · #${message.id}`} width={width} />] : []),
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
  const text = `${message.context ? message.context + '\n' : ''}${message.author} · ${message.date}\n${message.content}`;
  const extraLines: ReactNode[] = album
    ? [
        '',
        <DetailSection
          title={`Viewing item ${albumIndex + 1}/${album.length} · #${message.id}`}
          width={width}
          active
        />,
        text,
        ...mediaLines,
        <DetailSection title={`End preview · #${message.id}`} width={width} />,
        '',
        ...(albumStatus ? [albumStatus, ''] : []),
        <DetailSection title="Album items" width={width} />,
        ...album.flatMap((item, index) => [
          '',
          <DetailSection
            title={`MESSAGE #${item.id} · Item ${index + 1}/${album.length}`}
            width={width}
            active={item.id === message.id}
          />,
          `${item.author}${item.date ? ` · ${item.date}` : ''}`,
          item.content,
          ...(item.attachment ? [attachmentText(item.attachment)] : []),
        ]),
      ]
    : mediaLines;
  return (
    <Reader
      title={
        album
          ? `ALBUM · ${album.length} items · #${message.id} · Read only`
          : `MESSAGE ${message.id} · Read only`
      }
      text={album ? `Items: ${album.map((item) => `#${item.id}`).join(', ')}` : text}
      width={width}
      height={height}
      onClose={onClose}
      extraLines={extraLines}
      progress={progress}
      media={{
        preview: canPreview && previewFailed,
        open: canOpen && !saved.current,
        busy: Boolean(progress),
        previous: albumIndex > 0,
        next: albumIndex < (album?.length ?? 1) - 1,
      }}
      onMediaAction={(action) => {
        if (action === 'mediaPrevious') onItem(albumIndex - 1);
        else if (action === 'mediaNext') onItem(albumIndex + 1);
        else void run(action === 'mediaPreview');
      }}
    />
  );
}
