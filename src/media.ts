import {Api} from 'teleproto';
import jpeg from 'jpeg-js';
import {chmod, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {MessageRecord, TelegramApi} from './telegram.js';
import {boundedText} from './text.js';

export const PREVIEW_BYTES = 1024 * 1024;
export const MEDIA_BYTES = 50 * 1024 * 1024;
type PhotoSize = Api.PhotoSize | Api.PhotoCachedSize | Api.PhotoStrippedSize;
export type Attachment = {
  label: string;
  name?: string;
  mime?: string;
  size?: number;
  dimensions?: string;
  duration?: number;
  preview?: PhotoSize;
  extension?: string;
  source: Api.Message | Api.TypeMessageMedia;
};
export type Raster = {width: number; height: number; data: Uint8Array};

function photoSize(sizes: readonly Api.TypePhotoSize[]): PhotoSize | undefined {
  const available = sizes.flatMap((size) => {
    if (size instanceof Api.PhotoSizeProgressive)
      return [new Api.PhotoSize({type: size.type, w: size.w, h: size.h, size: Math.max(...size.sizes)})];
    return size instanceof Api.PhotoSize || size instanceof Api.PhotoCachedSize ? [size] : [];
  });
  const bounded = available.filter(
    (size) =>
      (size instanceof Api.PhotoSize ? size.size : size.bytes.length) <= PREVIEW_BYTES &&
      size.w * size.h <= 2_000_000,
  );
  const small = bounded.filter((size) => size.w <= 640 && size.h <= 640);
  return (
    small.sort((a, b) => b.w * b.h - a.w * a.h)[0] ??
    bounded.sort((a, b) => a.w * a.h - b.w * b.h)[0] ??
    sizes.find((size): size is Api.PhotoStrippedSize => size instanceof Api.PhotoStrippedSize)
  );
}

// Use trusted MIME extensions for the viewer, never an attachment-supplied path
// or executable suffix. Other documents remain readable as metadata.
const extensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
};

export function attachmentFor(record: MessageRecord): Attachment | undefined {
  const media = record.media;
  const source = record instanceof Api.Message ? record : media;
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const preview = media.ttlSeconds ? undefined : photoSize(media.photo.sizes);
    return {
      label: media.ttlSeconds ? 'Disappearing photo' : 'Photo',
      mime: 'image/jpeg',
      source: source as Attachment['source'],
      preview,
      extension: media.ttlSeconds ? undefined : '.jpg',
      dimensions: preview && 'w' in preview ? `${preview.w}×${preview.h} preview` : undefined,
    };
  }
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    const video = doc.attributes.find((item) => item instanceof Api.DocumentAttributeVideo);
    const audio = doc.attributes.find((item) => item instanceof Api.DocumentAttributeAudio);
    const name = doc.attributes.find((item) => item instanceof Api.DocumentAttributeFilename);
    const sticker = doc.attributes.some((item) => item instanceof Api.DocumentAttributeSticker);
    const size = Number(doc.size.toString());
    return {
      label: video
        ? 'Video'
        : audio
          ? audio.voice
            ? 'Voice message'
            : 'Audio'
          : sticker
            ? 'Sticker'
            : 'File',
      source: source as Attachment['source'],
      name: name?.fileName ? boundedText(name.fileName, 160) : undefined,
      mime: boundedText(doc.mimeType, 80),
      size: Number.isSafeInteger(size) && size >= 0 ? size : undefined,
      dimensions: video ? `${video.w}×${video.h}` : undefined,
      duration: video?.duration ?? audio?.duration,
      preview: media.ttlSeconds ? undefined : photoSize(doc.thumbs ?? []),
      extension: media.ttlSeconds ? undefined : extensions[doc.mimeType],
    };
  }
  return undefined;
}

export function attachmentText(attachment: Attachment): string {
  return [
    attachment.label,
    attachment.name && `Name: ${attachment.name}`,
    attachment.mime && `Type: ${attachment.mime}`,
    attachment.size !== undefined && `Size: ${(attachment.size / 1024 / 1024).toFixed(2)} MiB`,
    attachment.dimensions,
    attachment.duration !== undefined && `Duration: ${attachment.duration}s`,
  ]
    .filter((part) => part !== undefined && part !== false)
    .join('\n');
}

export async function downloadAttachment(
  client: Pick<TelegramApi, 'downloadMedia'>,
  attachment: Attachment,
  preview: boolean,
  signal: AbortSignal,
  update: (downloaded: number, total: number) => void,
): Promise<Buffer> {
  signal.throwIfAborted();
  if (!client.downloadMedia) throw new Error('Media downloads are unavailable in this client.');
  if (preview && !attachment.preview) throw new Error('No image thumbnail is available.');
  const limit = preview ? PREVIEW_BYTES : MEDIA_BYTES;
  if (!preview && attachment.size !== undefined && attachment.size > limit)
    throw new Error('This attachment exceeds the 50 MiB download limit.');
  const data = await client.downloadMedia(attachment.source, {
    ...(preview ? {thumb: attachment.preview} : {}),
    signal,
    progressCallback: (downloaded, total) => {
      signal.throwIfAborted();
      const received = Number(downloaded.toString());
      const expected = Number(total.toString());
      if (received > limit || expected > limit) throw new Error('Media download exceeds the size limit.');
      update(received, expected);
    },
  });
  signal.throwIfAborted();
  if (!Buffer.isBuffer(data) || !data.length) throw new Error('The attachment is unavailable.');
  if (data.length > limit) throw new Error('Media download exceeds the size limit.');
  return data;
}

export function decodePreview(data: Buffer): Raster {
  if (data.length > PREVIEW_BYTES) throw new Error('Preview exceeds the size limit.');
  return jpeg.decode(data, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false,
    maxResolutionInMP: 2,
    maxMemoryUsageInMB: 32,
  });
}

export type MediaFiles = {root?: string; open?: (file: string) => Promise<unknown>};
export async function openAttachment(
  data: Buffer,
  attachment: Attachment,
  signal: AbortSignal,
  files: MediaFiles = {},
): Promise<{file: string; error?: string}> {
  signal.throwIfAborted();
  if (!attachment.extension || !Object.values(extensions).includes(attachment.extension))
    throw new Error('This file type can be inspected but cannot be opened from the app.');
  const directory = await mkdtemp(path.join(files.root ?? tmpdir(), 'tg-manager-media-'));
  const file = path.join(directory, `attachment${attachment.extension}`);
  try {
    await chmod(directory, 0o700);
    await writeFile(file, data, {mode: 0o600, flag: 'wx'});
    signal.throwIfAborted();
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
  // Keep explicitly opened files in the private temporary directory: a viewer
  // may read them after this reader closes. The OS/user can remove them later.
  try {
    const openFile =
      files.open ??
      (async (file: string) => {
        const {default: open} = await import('open');
        signal.throwIfAborted();
        return open(file);
      });
    signal.throwIfAborted();
    await openFile(file);
    return {file};
  } catch (error) {
    if (signal.aborted) {
      await rm(directory, {recursive: true, force: true});
      signal.throwIfAborted();
    }
    return {file, error: error instanceof Error ? error.message : 'No system viewer is available.'};
  }
}
