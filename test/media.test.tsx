import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import React from 'react';
import {renderToString} from 'ink';
import {Api} from 'teleproto';
import {returnBigInt} from 'teleproto/Helpers.js';
import {
  attachmentFor,
  decodePreview,
  downloadAttachment,
  openAttachment,
  PREVIEW_BYTES,
  MEDIA_BYTES,
  type Attachment,
} from '../src/media.js';
import {messageRecords, messageRows} from '../src/messages.js';
import {MessageDetails, previewRows} from '../src/MessageDetails.js';
import {App} from './helpers/App.js';
import {testTerminal} from './helpers/terminal.js';
import {photo, image} from './helpers/media.js';
import type {TelegramApi} from '../src/telegram.js';

const attachment = () => attachmentFor({id: 5, media: photo()})!;
const noProgress = () => {};

test('real Telegram photo/video records retain captions and expose bounded thumbnails and metadata', () => {
  const record = new Api.Message({
    id: 5,
    peerId: new Api.PeerUser({userId: returnBigInt(42)}),
    date: 0,
    message: 'Synthetic caption',
    media: photo(),
  });
  const [message] = messageRecords([record], '42', 'all');
  assert.equal(message!.content, 'Synthetic caption');
  assert.equal(message!.attachment!.source, record);
  const video = new Api.MessageMediaDocument({
    document: new Api.Document({
      id: returnBigInt(2),
      accessHash: returnBigInt(3),
      fileReference: Buffer.alloc(0),
      date: 0,
      dcId: 1,
      mimeType: 'video/mp4',
      size: returnBigInt(2048),
      attributes: [
        new Api.DocumentAttributeVideo({w: 1920, h: 1080, duration: 12}),
        new Api.DocumentAttributeFilename({fileName: '../../example.mp4'}),
      ],
      thumbs: [new Api.PhotoSize({type: 'm', w: 320, h: 180, size: 10000})],
    }),
  });
  const found = attachmentFor({id: 5, media: video})!;
  assert.equal(found.label, 'Video');
  assert.equal(found.size, 2048);
  assert.equal(found.duration, 12);
  assert.equal(found.extension, '.mp4');
  assert.ok(found.preview instanceof Api.PhotoSize);
  assert.equal(attachmentFor({id: 5, media: {unrecognized: true}}), undefined);
});

test('preview requests always specify a thumbnail, enforce limits and respect cancellation', async () => {
  const calls: unknown[] = [];
  const client: Pick<TelegramApi, 'downloadMedia'> = {
    async downloadMedia(source, options) {
      calls.push(options);
      assert.equal(source, value.source);
      return image;
    },
  };
  const value = attachment();
  const task = new AbortController();
  assert.equal(await downloadAttachment(client, value, true, task.signal, noProgress), image);
  assert.equal((calls[0] as {thumb: unknown}).thumb, value.preview);
  await assert.rejects(
    downloadAttachment(client, {...value, preview: undefined}, true, task.signal, noProgress),
    /No image thumbnail/,
  );
  await assert.rejects(
    downloadAttachment(client, {...value, size: MEDIA_BYTES + 1}, false, task.signal, noProgress),
    /50 MiB/,
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    downloadAttachment(
      {downloadMedia: async () => Buffer.alloc(PREVIEW_BYTES + 1)},
      value,
      true,
      task.signal,
      noProgress,
    ),
    /size limit/,
  );
  await assert.rejects(
    downloadAttachment(
      {
        downloadMedia: async (_source, options) => {
          await options.progressCallback?.(returnBigInt(PREVIEW_BYTES + 1), returnBigInt(PREVIEW_BYTES + 1));
          assert.fail('oversized transfers must stop in the progress callback');
        },
      },
      value,
      true,
      task.signal,
      noProgress,
    ),
    /size limit/,
  );
  await assert.rejects(
    downloadAttachment(
      {
        downloadMedia: async () => {
          task.abort();
          return image;
        },
      },
      value,
      true,
      task.signal,
      noProgress,
    ),
    /abort/i,
  );
});

test('attachments without thumbnails stay readable and never trigger an automatic original download', async () => {
  let downloads = 0;
  const value = {
    ...attachment(),
    label: 'File',
    preview: undefined,
    mime: 'application/pdf',
    extension: '.pdf',
  };
  const message = {id: 5, date: '', content: 'Document caption', own: true, author: 'You', attachment: value};
  const ui = testTerminal(
    <MessageDetails
      message={message}
      client={{
        downloadMedia: async () => {
          downloads++;
          return image;
        },
      }}
      width={79}
      height={23}
      onClose={() => {}}
    />,
  );
  try {
    await ui.waitFor((frame) => frame.includes('No image preview is available'));
    assert.ok(ui.frame().includes('Document caption') && ui.frame().includes('application/pdf'));
    assert.equal(downloads, 0);
  } finally {
    await ui.close();
  }
});

test('JPEG previews have decoder budgets and fit terminal cells in color and monochrome', () => {
  const decoded = decodePreview(image);
  assert.equal(decoded.width, 80);
  assert.equal(decoded.height, 40);
  for (const color of [false, true]) {
    const rows = previewRows(decoded, 24, 8, color);
    assert.ok(rows.length <= 8);
    const output = renderToString(<>{rows}</>, {columns: 25});
    assert.ok(color ? output.includes('▀') : !output.includes('▀'));
  }
  assert.throws(() => decodePreview(Buffer.from('not a photo')));
  const oversized = Buffer.from(image);
  const marker = oversized.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(marker >= 0);
  oversized.writeUInt16BE(3000, marker + 5);
  oversized.writeUInt16BE(3000, marker + 7);
  assert.throws(() => decodePreview(oversized), /resolution/i);
});

test('opening is explicit, uses private generated paths and retains a usable file if no viewer exists', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tg-manager-media-test-'));
  const opened: string[] = [];
  try {
    const value = {...attachment(), name: '../../untrusted.exe'};
    const task = new AbortController();
    const result = await openAttachment(image, value, task.signal, {
      root,
      open: async (file) => {
        opened.push(file);
      },
    });
    assert.deepEqual(opened, [result.file]);
    assert.equal(path.basename(result.file), 'attachment.jpg');
    assert.deepEqual(await readFile(result.file), image);
    if (process.platform !== 'win32') {
      assert.equal((await stat(result.file)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(result.file))).mode & 0o777, 0o700);
    }
    const fallback = await openAttachment(image, value, task.signal, {
      root,
      open: async () => {
        throw new Error('Synthetic headless terminal');
      },
    });
    assert.match(fallback.error!, /headless/);
    assert.deepEqual(await readFile(fallback.file), image);
    await assert.rejects(
      openAttachment(image, {...value, extension: '.exe'}, task.signal, {
        root,
        open: async () => {
          assert.fail('must not open');
        },
      }),
      /cannot be opened/,
    );
    task.abort();
    await assert.rejects(
      openAttachment(image, value, task.signal, {
        root,
        open: async () => {
          assert.fail('must not open');
        },
      }),
      /abort/i,
    );
    assert.equal((await readdir(root)).length, 2);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('details load previews, keep scrolling and only open a full attachment on its displayed key', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tg-manager-media-ui-'));
  const requests: boolean[] = [];
  const opened: string[] = [];
  const [message] = messageRecords([{id: 5, message: 'Synthetic caption', media: photo()}], '42', 'mine');
  const client = {
    async downloadMedia(_source: Attachment['source'], options: {thumb?: unknown}) {
      requests.push(Boolean(options.thumb));
      return image;
    },
  };
  const files = {
    root,
    open: async (file: string) => {
      opened.push(file);
    },
  };
  const details = (width: number) => (
    <MessageDetails
      message={message!}
      client={client}
      width={width}
      height={23}
      onClose={() => {}}
      files={files}
    />
  );
  const ui = testTerminal(details(79), {columns: 80, rows: 24});
  try {
    await ui.waitFor((frame) => frame.includes('Image preview') && frame.includes('o Open'));
    assert.deepEqual(requests, [true]);
    await ui.press('p');
    assert.deepEqual(requests, [true], 'successful previews cannot be reloaded with an undisplayed key');
    assert.equal(opened.length, 0);
    for (const columns of [25, 40, 120]) {
      await ui.resize(columns, 24);
      ui.instance.rerender(details(columns - 1));
      await ui.instance.waitUntilRenderFlush();
      assert.ok(ui.frame().trimEnd().split('\n').length <= 23);
    }
    await ui.press('d');
    assert.equal(opened.length, 0);
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('System viewer launch requested'));
    await ui.press('p');
    assert.deepEqual(requests, [true, false]);
    assert.equal(opened.length, 1);
  } finally {
    await ui.close();
    await rm(root, {recursive: true, force: true});
  }
});

for (const album of [false, true]) {
  test(`failed ${album ? 'album-item' : 'single-item'} previews offer Retry preview only until a retry succeeds`, async () => {
    const messages = messageRecords(
      (album ? [5, 6] : [5]).map((id) => ({
        id,
        message: 'Synthetic caption',
        media: photo(id),
        ...(album ? {groupedId: returnBigInt(123)} : {}),
      })),
      '42',
      'mine',
    );
    let attempts = 0;
    let release!: () => void;
    const ui = testTerminal(
      <MessageDetails
        message={messageRows(messages)[0]!}
        client={{
          async downloadMedia(_source, options) {
            assert.ok(options.thumb, 'retry downloads only the thumbnail');
            attempts++;
            if (attempts === 1) throw new Error('Synthetic preview failure');
            if (attempts === 2)
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            return image;
          },
        }}
        width={159}
        height={34}
        onClose={() => {}}
      />,
      {columns: 160, rows: 35},
    );
    try {
      await ui.waitFor((frame) => frame.includes('Preview unavailable') && frame.includes('p Retry preview'));
      await ui.press('p');
      await ui.waitFor((frame) => frame.includes('Loading preview'));
      assert.ok(!ui.frame().includes('p Retry preview'));
      await ui.press('p');
      assert.equal(attempts, 2, 'a pending retry cannot start another download');
      release();
      await ui.waitFor((frame) => frame.includes('Image preview') && !frame.includes('Loading preview'));
      assert.ok(!ui.frame().includes('p Retry preview'));
      await ui.press('p');
      assert.equal(attempts, 2);
      if (album) {
        await ui.press(']');
        await ui.waitFor((frame) => frame.includes('Viewing item 2/2') && frame.includes('Image preview'));
        assert.ok(!ui.frame().includes('p Retry preview'));
        await ui.press('p');
        assert.equal(attempts, 3, 'the next item loads automatically and has no stale retry action');
      }
    } finally {
      release?.();
      await ui.close();
    }
  });
}

test('closing message details aborts a preview and late completion cannot affect the restored app', async () => {
  let release!: () => void;
  let signal: AbortSignal | undefined;
  let downloads = 0;
  const client: TelegramApi = {
    async getMe() {
      return {id: 42};
    },
    async *iterDialogs() {
      yield {id: 1, entity: 'group', isGroup: true, title: 'Synthetic media'};
    },
    async getMessages() {
      return [{id: 5, message: 'Synthetic caption', senderId: 42, media: photo()}];
    },
    async *iterMessages() {},
    async deleteMessages() {
      assert.fail('reader must not delete');
    },
    async downloadMedia(_media, options) {
      downloads++;
      signal = options.signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return image;
    },
  };
  const ui = testTerminal(<App client={client} />);
  try {
    await ui.waitFor((frame) => frame.includes('Synthetic caption'));
    assert.equal(downloads, 0);
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Loading preview'));
    assert.equal(downloads, 1);
    await ui.press('o');
    assert.equal(downloads, 1, 'a pending preview must not start an original download');
    await ui.press('\x1b');
    assert.equal(signal!.aborted, true);
    release();
    await ui.waitFor((frame) => frame.includes('TG MANAGER'));
    assert.ok(!ui.frame().includes('Image preview'));
  } finally {
    release?.();
    await ui.close();
  }
});

test('closing during an original download prevents late file creation and viewer launch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tg-manager-cancel-media-'));
  let release!: () => void;
  let signal: AbortSignal | undefined;
  const value = {...attachment(), preview: undefined};
  const message = {id: 5, date: '', content: 'Synthetic photo', own: true, author: 'You', attachment: value};
  const client = {
    async downloadMedia(_media: Attachment['source'], options: {signal?: AbortSignal}) {
      signal = options.signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return image;
    },
  };
  const ui = testTerminal(
    <MessageDetails
      message={message}
      client={client}
      width={79}
      height={23}
      onClose={() => {}}
      files={{
        root,
        open: async () => {
          assert.fail('cancelled download must not open a viewer');
        },
      }}
    />,
  );
  try {
    await ui.waitFor((frame) => frame.includes('o Open'));
    await ui.press('o');
    await ui.waitFor((frame) => frame.includes('Downloading media'));
    ui.instance.rerender(<></>);
    await ui.instance.waitUntilRenderFlush();
    assert.equal(signal!.aborted, true);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await readdir(root), []);
  } finally {
    release?.();
    await ui.close();
    await rm(root, {recursive: true, force: true});
  }
});

test('compact Telegram group-photo previews decode and cache without SOI errors or original downloads', async () => {
  const compact = Buffer.from([1, 1, 1, 0x28, 0xa2, 0x8a, 0]);
  const decoded = decodePreview(compact);
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 1);
  const media = photo();
  (media.photo as Api.Photo).sizes = [new Api.PhotoStrippedSize({type: 'i', bytes: compact})];
  let downloads = 0;
  const client: TelegramApi = {
    async getMe() {
      return {id: 42};
    },
    async *iterDialogs() {
      yield {id: '-5', title: 'Regular group', entity: 'synthetic-group', isGroup: true};
    },
    async getMessages() {
      return [{id: 5, message: 'Compact photo', senderId: 42, media}];
    },
    async *iterMessages() {},
    async deleteMessages() {
      assert.fail('read-only inspection');
    },
    async downloadMedia(_source, options) {
      assert.ok(options.thumb);
      downloads++;
      return compact;
    },
  };
  const ui = testTerminal(<App client={client} />);
  try {
    await ui.waitFor((frame) => frame.includes('Compact photo'));
    await ui.press('\t');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Image preview'));
    assert.ok(!ui.frame().includes('SOI not found'));
    await ui.press('\x1b');
    await ui.press('\r');
    await ui.waitFor((frame) => frame.includes('Image preview'));
    assert.equal(downloads, 1);
  } finally {
    await ui.close();
  }
});

test('non-JPEG thumbnails identify unsupported formats before calling the JPEG decoder', () => {
  for (const [data, format] of [
    [Buffer.from('RIFF0000WEBP'), 'WebP'],
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'PNG'],
    [Buffer.from('GIF89a'), 'GIF'],
  ] as const) {
    assert.throws(() => decodePreview(data), new RegExp(`${format} thumbnail format is unsupported`));
  }
});
