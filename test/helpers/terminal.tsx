import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {setTimeout} from 'node:timers/promises';
import {stripVTControlCharacters} from 'node:util';
import type {ReactNode} from 'react';
import {render} from 'ink';

export function testTerminal(node: ReactNode, options: {columns?: number; rows?: number} = {}) {
  const frames: string[] = [];
  class Output extends Writable {
    isTTY = true;
    columns = options.columns ?? 200;
    rows = options.rows ?? 30;
    override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
      const plain = stripVTControlCharacters(chunk.toString());
      if (plain.trim()) frames.push(plain);
      callback();
    }
  }
  class Input extends PassThrough {
    isTTY = true;
    setRawMode() {return this;}
    ref() {return this;}
    unref() {return this;}
  }
  const stdout = new Output();
  const stdin = new Input();
  const stderr = new PassThrough();
  const instance = render(node, {stdout, stdin, stderr, interactive: true, debug: true,
    patchConsole: false, maxFps: 0, kittyKeyboard: {mode: 'disabled'}});
  const frame = () => frames.at(-1) ?? '';
  return {
    frames, frame, instance,
    async press(value: string) {
      stdin.write(value);
      await new Promise(resolve => setImmediate(resolve));
      await instance.waitUntilRenderFlush();
    },
    async resize(columns: number, rows: number) {
      stdout.columns = columns;
      stdout.rows = rows;
      stdout.emit('resize');
      await new Promise(resolve => setImmediate(resolve));
      await instance.waitUntilRenderFlush();
    },
    async waitFor(predicate: (frame: string) => boolean) {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (predicate(frame())) return;
        await setTimeout(5);
      }
      assert.ok(predicate(frame()), `Expected terminal state was not reached:\n${frame()}`);
    },
    async close() {
      instance.unmount();
      await instance.waitUntilExit();
      instance.cleanup();
      stdin.destroy(); stdout.destroy(); stderr.destroy();
    },
  };
}
