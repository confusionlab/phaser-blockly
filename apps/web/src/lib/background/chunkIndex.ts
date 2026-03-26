import { parseChunkKey, type ChunkRange } from './chunkMath';

export interface IndexedBackgroundChunk<T> {
  key: string;
  cx: number;
  cy: number;
  value: T;
}

export interface ReadonlyBackgroundChunkIndex<T> {
  readonly size: number;
  has(key: string): boolean;
  get(key: string): IndexedBackgroundChunk<T> | null;
  entries(): IndexedBackgroundChunk<T>[];
  query(range: ChunkRange): IndexedBackgroundChunk<T>[];
}

function cloneChunkEntry<T>(entry: IndexedBackgroundChunk<T>): IndexedBackgroundChunk<T> {
  return {
    key: entry.key,
    cx: entry.cx,
    cy: entry.cy,
    value: entry.value,
  };
}

export class MutableBackgroundChunkIndex<T> implements ReadonlyBackgroundChunkIndex<T> {
  private readonly byKey = new Map<string, IndexedBackgroundChunk<T>>();
  private readonly rows = new Map<number, Map<number, IndexedBackgroundChunk<T>>>();

  get size(): number {
    return this.byKey.size;
  }

  clear(): void {
    this.byKey.clear();
    this.rows.clear();
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): IndexedBackgroundChunk<T> | null {
    const entry = this.byKey.get(key);
    return entry ? cloneChunkEntry(entry) : null;
  }

  set(key: string, value: T): boolean {
    const parsed = parseChunkKey(key);
    if (!parsed) {
      return false;
    }

    const existing = this.byKey.get(key);
    if (existing) {
      existing.value = value;
      return true;
    }

    const entry: IndexedBackgroundChunk<T> = {
      key,
      cx: parsed.cx,
      cy: parsed.cy,
      value,
    };

    this.byKey.set(key, entry);
    let row = this.rows.get(parsed.cy);
    if (!row) {
      row = new Map<number, IndexedBackgroundChunk<T>>();
      this.rows.set(parsed.cy, row);
    }
    row.set(parsed.cx, entry);
    return true;
  }

  delete(key: string): boolean {
    const entry = this.byKey.get(key);
    if (!entry) {
      return false;
    }

    this.byKey.delete(key);
    const row = this.rows.get(entry.cy);
    row?.delete(entry.cx);
    if (row && row.size === 0) {
      this.rows.delete(entry.cy);
    }
    return true;
  }

  replaceAll(entries: Iterable<readonly [string, T]>): void {
    this.clear();
    for (const [key, value] of entries) {
      this.set(key, value);
    }
  }

  replaceAllFromRecord(record: Record<string, T>): void {
    this.replaceAll(Object.entries(record));
  }

  entries(): IndexedBackgroundChunk<T>[] {
    return Array.from(this.byKey.values(), (entry) => cloneChunkEntry(entry));
  }

  query(range: ChunkRange): IndexedBackgroundChunk<T>[] {
    const results: IndexedBackgroundChunk<T>[] = [];
    for (let cy = range.minCy; cy <= range.maxCy; cy += 1) {
      const row = this.rows.get(cy);
      if (!row) {
        continue;
      }
      for (let cx = range.minCx; cx <= range.maxCx; cx += 1) {
        const entry = row.get(cx);
        if (entry) {
          results.push(cloneChunkEntry(entry));
        }
      }
    }
    return results;
  }
}

const cachedChunkIndexByRecord = new WeakMap<object, MutableBackgroundChunkIndex<unknown>>();

export function getCachedBackgroundChunkIndex<T>(
  record: Record<string, T>,
): ReadonlyBackgroundChunkIndex<T> {
  // Callers should treat cached records as immutable snapshots. Mutable editor state
  // should use MutableBackgroundChunkIndex directly so writes stay explicit.
  const existing = cachedChunkIndexByRecord.get(record as object) as MutableBackgroundChunkIndex<T> | undefined;
  if (existing) {
    return existing;
  }

  const index = new MutableBackgroundChunkIndex<T>();
  index.replaceAllFromRecord(record);
  cachedChunkIndexByRecord.set(record as object, index as MutableBackgroundChunkIndex<unknown>);
  return index;
}
