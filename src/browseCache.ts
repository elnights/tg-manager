import {messageRows, PAGE} from './messages.js';
import type {Cancellation, History} from './operations.js';
import type {Raster} from './media.js';

export const BROWSE_DELAY = 200;
export const BROWSE_TTL = 60_000;
type SavedHistory = {history: History; index: number; namespace?: string};

class Recent<T> {
  private entries = new Map<string, {value: T; time: number}>();
  constructor(
    private limit: number,
    private now: () => number,
  ) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (this.now() - entry.time >= BROWSE_TTL) return;
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, {value, time: this.now()});
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  clear() {
    this.entries.clear();
  }
}

// App-owned read data only. Verification, scans and deletion always use the raw client.
export class BrowseCache {
  private histories: Recent<SavedHistory>;
  private values: Recent<unknown>;
  private generation = 0;
  private scrolls: Recent<number>;
  private previews = new Map<object, {image: Raster; time: number}>();
  private pending = new Map<string, {promise: Promise<unknown>; consumers: Set<Cancellation>}>();
  constructor(
    readonly owner?: object,
    private now: () => number = Date.now,
  ) {
    this.histories = new Recent(20, now);
    this.values = new Recent(60, now);
    this.scrolls = new Recent(60, now);
  }
  offset(key: string) {
    return this.scrolls.get(key) ?? 0;
  }
  scroll(key: string, offset: number) {
    this.scrolls.set(key, offset);
  }
  preview(source: object): Raster | undefined {
    const saved = this.previews.get(source);
    if (!saved) return;
    this.previews.delete(source);
    if (this.now() - saved.time >= BROWSE_TTL) return;
    this.previews.set(source, saved);
    return saved.image;
  }
  savePreview(source: object, image: Raster) {
    this.previews.delete(source);
    if (image.data.byteLength > 4 * 1024 * 1024) return;
    this.previews.set(source, {image, time: this.now()});
    let bytes = [...this.previews.values()].reduce((sum, item) => sum + item.image.data.byteLength, 0);
    while (bytes > 4 * 1024 * 1024) {
      const oldest = this.previews.keys().next().value!;
      bytes -= this.previews.get(oldest)!.image.data.byteLength;
      this.previews.delete(oldest);
    }
  }
  key(...parts: unknown[]) {
    return JSON.stringify(parts);
  }
  history(key: string) {
    return this.histories.get(key);
  }
  value<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }
  has(key: string) {
    return this.values.get(key) !== undefined;
  }
  save(key: string, history: History, namespace?: string) {
    const previous = this.histories.get(key);
    if (previous?.history === history && previous.namespace === namespace) return;
    const limit = PAGE * 3;
    const bounded =
      history.items.length > limit
        ? {items: history.items.slice(0, limit), cursor: history.items[limit - 1]!.id, more: true}
        : history;
    this.histories.set(key, {
      history: bounded,
      namespace,
      index: Math.min(previous?.index ?? 0, Math.max(0, messageRows(bounded.items).length - 1)),
    });
  }
  position(key: string, index: number) {
    const saved = this.histories.get(key);
    if (saved) saved.index = Math.max(0, Math.min(index, messageRows(saved.history.items).length - 1));
  }
  async read<T>(
    key: string,
    load: (task: Cancellation) => Promise<T>,
    consumer: Cancellation = {cancelled: false},
  ): Promise<T> {
    const saved = this.values.get(key);
    if (saved !== undefined) return saved as T;
    let entry = this.pending.get(key);
    if (!entry) {
      const consumers = new Set([consumer]);
      const task = {
        get cancelled() {
          return [...consumers].every((item) => item.cancelled);
        },
      };
      const generation = this.generation;
      const promise = Promise.resolve()
        .then(() => load(task))
        .then((value) => {
          if (generation === this.generation && !task.cancelled && value !== undefined)
            this.values.set(key, value);
          return value;
        });
      entry = {promise, consumers};
      this.pending.set(key, entry);
      while (this.pending.size > 60) this.pending.delete(this.pending.keys().next().value!);
      const captured = entry;
      void promise
        .finally(() => {
          if (this.pending.get(key) === captured) this.pending.delete(key);
        })
        .catch(() => {});
    } else entry.consumers.add(consumer);
    return entry.promise as Promise<T>;
  }
  clear() {
    this.generation++;
    this.histories.clear();
    this.values.clear();
    this.pending.clear();
    this.scrolls.clear();
    this.previews.clear();
  }
}
