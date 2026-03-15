import { expect, test } from '@playwright/test';
import { resolveCostumeToolShortcut } from '../src/components/editors/costume/costumeToolShortcuts';

test.describe('costume tool shortcuts', () => {
  test('resolves vector and bitmap shortcuts', () => {
    expect(resolveCostumeToolShortcut('v', 'vector')).toBe('select');
    expect(resolveCostumeToolShortcut('t', 'vector')).toBe('text');
    expect(resolveCostumeToolShortcut('a', 'vector')).toBe('vector');
    expect(resolveCostumeToolShortcut('b', 'vector')).toBeNull();
    expect(resolveCostumeToolShortcut('b', 'bitmap')).toBe('brush');
    expect(resolveCostumeToolShortcut('e', 'bitmap')).toBe('eraser');
    expect(resolveCostumeToolShortcut('f', 'bitmap')).toBe('fill');
    expect(resolveCostumeToolShortcut('t', 'bitmap')).toBeNull();
    expect(resolveCostumeToolShortcut('l', 'vector')).toBe('line');
    expect(resolveCostumeToolShortcut('l', 'bitmap')).toBe('line');
    expect(resolveCostumeToolShortcut(' ', 'vector')).toBeNull();
  });
});
