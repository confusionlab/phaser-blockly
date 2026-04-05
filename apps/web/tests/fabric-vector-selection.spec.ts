import { expect, test } from '@playwright/test';
import {
  isVectorSelectionDirectTarget,
  replaceFabricObjectInParentContainer,
  resolveVectorGroupEditingRootTarget,
  resolveVectorGroupEntrySelectionTarget,
  resolveVectorSelectionDirectTarget,
} from '../src/lib/editor/fabricVectorSelection';

type FakeFabricObject = {
  add?: (...objects: FakeFabricObject[]) => void;
  getObjects?: () => FakeFabricObject[];
  group?: FakeFabricObject | null;
  insertAt?: (index: number, ...objects: FakeFabricObject[]) => void;
  parent?: FakeFabricObject | null;
  remove?: (...objects: FakeFabricObject[]) => void;
  setCoords?: () => void;
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

  test('resolves the outermost edited group when exiting nested group editing', () => {
    const leaf = createObject('rect');
    const subgroup = createGroup([leaf]);
    const rootGroup = createGroup([subgroup]);
    const fabricCanvas = {
      getObjects: () => [rootGroup],
    };

    const resolved = resolveVectorGroupEditingRootTarget(fabricCanvas, [rootGroup, subgroup]);

    expect(resolved).toBe(rootGroup);
  });

  test('promotes closed-group descendants back to their group shell for direct selection', () => {
    const leaf = createObject('rect');
    const rootGroup = createGroup([leaf]);

    expect(resolveVectorSelectionDirectTarget(leaf, [])).toBe(rootGroup);
    expect(isVectorSelectionDirectTarget(leaf, [])).toBe(false);
    expect(isVectorSelectionDirectTarget(rootGroup, [])).toBe(true);
  });

  test('keeps ancestor siblings targetable while editing a nested group', () => {
    const editableLeaf = createObject('rect');
    const editableGroup = createGroup([editableLeaf]);
    const siblingLeaf = createObject('rect');
    const siblingGroup = createGroup([siblingLeaf]);
    const rootGroup = createGroup([editableGroup, siblingGroup]);

    expect(resolveVectorSelectionDirectTarget(editableLeaf, [rootGroup, editableGroup])).toBe(editableLeaf);
    expect(resolveVectorSelectionDirectTarget(siblingLeaf, [rootGroup, editableGroup])).toBe(siblingGroup);
    expect(isVectorSelectionDirectTarget(siblingLeaf, [rootGroup, editableGroup])).toBe(false);
    expect(isVectorSelectionDirectTarget(siblingGroup, [rootGroup, editableGroup])).toBe(true);
  });

  test('replaces a grouped child inside its parent container instead of duplicating it at root', () => {
    const childA = createObject('rect');
    const childB = createObject('rect');
    const replacement = createObject('path');
    const rootGroup = createGroup([childA, childB]);
    const canvasChildren = [rootGroup];
    const fabricCanvas = {
      add(object: FakeFabricObject) {
        canvasChildren.push(object);
      },
      getObjects: () => canvasChildren,
      insertAt(index: number, ...objects: FakeFabricObject[]) {
        canvasChildren.splice(index, 0, ...objects);
      },
      remove(...objects: FakeFabricObject[]) {
        for (const object of objects) {
          const index = canvasChildren.indexOf(object);
          if (index >= 0) {
            canvasChildren.splice(index, 1);
          }
        }
      },
    };

    const groupChildren = [childA, childB];
    rootGroup.getObjects = () => groupChildren;
    rootGroup.insertAt = (index: number, ...objects: FakeFabricObject[]) => {
      groupChildren.splice(index, 0, ...objects);
      objects.forEach((object) => {
        object.group = rootGroup;
        object.parent = rootGroup;
      });
    };
    rootGroup.remove = (...objects: FakeFabricObject[]) => {
      for (const object of objects) {
        const index = groupChildren.indexOf(object);
        if (index >= 0) {
          groupChildren.splice(index, 1);
        }
      }
    };

    const replaced = replaceFabricObjectInParentContainer(fabricCanvas, childA, replacement);

    expect(replaced).toBe(true);
    expect(fabricCanvas.getObjects()).toEqual([rootGroup]);
    expect(rootGroup.getObjects?.()).toEqual([replacement, childB]);
  });
});
