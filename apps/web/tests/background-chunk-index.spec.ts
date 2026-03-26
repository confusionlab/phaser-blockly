import { expect, test } from '@playwright/test';
import { MutableBackgroundChunkIndex, getCachedBackgroundChunkIndex } from '../src/lib/background/chunkIndex';

test.describe('Background chunk index', () => {
  test('queries only chunks inside the requested range', () => {
    const index = new MutableBackgroundChunkIndex<string>();
    index.replaceAllFromRecord({
      '-3,4': 'north-west',
      '0,0': 'center',
      '1,0': 'east',
      '7,-2': 'far-east',
    });

    const visible = index.query({
      minCx: -1,
      maxCx: 2,
      minCy: -1,
      maxCy: 1,
    });

    expect(visible).toEqual([
      { key: '0,0', cx: 0, cy: 0, value: 'center' },
      { key: '1,0', cx: 1, cy: 0, value: 'east' },
    ]);
  });

  test('tracks incremental add, update, and delete operations', () => {
    const index = new MutableBackgroundChunkIndex<number>();
    expect(index.set('2,3', 10)).toBe(true);
    expect(index.set('2,3', 11)).toBe(true);
    expect(index.set('bad-key', 99)).toBe(false);
    expect(index.size).toBe(1);
    expect(index.get('2,3')).toEqual({ key: '2,3', cx: 2, cy: 3, value: 11 });

    expect(index.delete('2,3')).toBe(true);
    expect(index.delete('2,3')).toBe(false);
    expect(index.size).toBe(0);
    expect(index.query({
      minCx: 0,
      maxCx: 4,
      minCy: 0,
      maxCy: 4,
    })).toEqual([]);
  });

  test('reuses cached indexes for immutable chunk records', () => {
    const record = {
      '0,0': 'a',
      '5,1': 'b',
    };

    const first = getCachedBackgroundChunkIndex(record);
    const second = getCachedBackgroundChunkIndex(record);

    expect(first).toBe(second);
    expect(second.query({
      minCx: 4,
      maxCx: 5,
      minCy: 1,
      maxCy: 1,
    })).toEqual([
      { key: '5,1', cx: 5, cy: 1, value: 'b' },
    ]);
  });
});
