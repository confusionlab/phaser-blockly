import { expect, test } from '@playwright/test';
import {
  normalizeAssetSelection,
  reorderAssetList,
  resolveAssetSelection,
  resolveNextActiveAssetIdAfterRemoval,
} from '../src/lib/editor/assetSidebarList';
import { normalizeLinearDropTarget, normalizeSiblingDropTarget } from '../src/utils/dropTargets';

test.describe('asset sidebar list helpers', () => {
  test('keeps the active item in the bulk selection during range selection', () => {
    const orderedIds = ['costume-a', 'costume-b', 'costume-c', 'costume-d'];

    const resolved = resolveAssetSelection({
      orderedIds,
      selectedIds: ['costume-a', 'costume-c'],
      activeId: 'costume-a',
      anchorId: 'costume-c',
      targetId: 'costume-d',
      append: false,
      range: true,
    });

    expect(resolved.selectedIds).toEqual(['costume-a', 'costume-c', 'costume-d']);
    expect(resolved.anchorId).toBe('costume-c');
  });

  test('command clicking the active item collapses back to the active item only', () => {
    const resolved = resolveAssetSelection({
      orderedIds: ['sound-a', 'sound-b', 'sound-c'],
      selectedIds: ['sound-a', 'sound-b'],
      activeId: 'sound-a',
      anchorId: 'sound-b',
      targetId: 'sound-a',
      append: true,
      range: false,
    });

    expect(resolved.selectedIds).toEqual(['sound-a']);
    expect(resolved.anchorId).toBe('sound-a');
  });

  test('reorders a dragged group while preserving the group order', () => {
    const reordered = reorderAssetList(
      [
        { id: 'one', name: 'One' },
        { id: 'two', name: 'Two' },
        { id: 'three', name: 'Three' },
        { id: 'four', name: 'Four' },
      ],
      ['one', 'two'],
      4,
    );

    expect(reordered?.map((item) => item.id)).toEqual(['three', 'four', 'one', 'two']);
  });

  test('resolves the next active item after deleting the current active item', () => {
    expect(resolveNextActiveAssetIdAfterRemoval(
      ['a', 'b', 'c', 'd'],
      'c',
      ['c'],
    )).toBe('d');

    expect(resolveNextActiveAssetIdAfterRemoval(
      ['a', 'b', 'c', 'd'],
      'd',
      ['c', 'd'],
    )).toBe('b');
  });

  test('normalizes the selection so the active item stays selected', () => {
    expect(normalizeAssetSelection({
      orderedIds: ['first', 'second', 'third'],
      selectedIds: ['third'],
      activeId: 'second',
    })).toEqual(['second', 'third']);
  });

  test('normalizes adjacent raw hover targets into one canonical linear drop target', () => {
    expect(normalizeLinearDropTarget(
      ['one', 'two', 'three'],
      { key: 'one', dropPosition: 'after' },
    )).toEqual({ key: 'two', dropPosition: 'before' });

    expect(normalizeLinearDropTarget(
      ['one', 'two', 'three'],
      { key: 'two', dropPosition: 'before' },
    )).toEqual({ key: 'two', dropPosition: 'before' });
  });

  test('shared sibling normalization collapses a shared gap to one canonical target', () => {
    expect(normalizeSiblingDropTarget({
      target: { key: 'alpha', dropPosition: 'after' },
      targetNode: { key: 'alpha', type: 'item' as const },
      siblings: ['alpha', 'beta', 'gamma'],
      rootDestination: { key: null, dropPosition: null },
      acceptsOnTarget: () => false,
    })).toEqual({ key: 'beta', dropPosition: 'before' });
  });
});
