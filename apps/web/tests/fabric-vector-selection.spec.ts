import { expect, test } from '@playwright/test';
import { resolveVectorGroupEntrySelectionTarget } from '../src/lib/editor/fabricVectorSelection';

type FakeFabricObject = {
  getObjects?: () => FakeFabricObject[];
  group?: FakeFabricObject | null;
  parent?: FakeFabricObject | null;
  type: string;
};

function createObject(type: string): FakeFabricObject {
  return { type };
}

function createGroup(children: FakeFabricObject[]): FakeFabricObject {
  const group: FakeFabricObject = {
    type: 'group',
    getObjects: () => children,
  };
  children.forEach((child) => {
    child.group = group;
    child.parent = group;
  });
  return group;
}

test.describe('fabric vector selection', () => {
  test('resolves the direct child when entering a nested group from its shell', () => {
    const leaf = createObject('rect');
    const subgroup = createGroup([leaf]);
    const rootGroup = createGroup([subgroup]);

    const resolved = resolveVectorGroupEntrySelectionTarget(
      rootGroup,
      rootGroup,
      [leaf, subgroup],
    );

    expect(resolved).toBe(subgroup);
  });

  test('resolves a directly hit child when entering a group', () => {
    const directChild = createObject('rect');
    const rootGroup = createGroup([directChild]);

    const resolved = resolveVectorGroupEntrySelectionTarget(
      rootGroup,
      directChild,
      [],
    );

    expect(resolved).toBe(directChild);
  });
});
