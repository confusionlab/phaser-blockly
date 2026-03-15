import { expect, test } from '@playwright/test';
import { deleteActiveCanvasSelection } from '../src/components/editors/costume/costumeSelectionCommands';

type FakeObject = {
  id: string;
  type?: string;
  isEditing?: boolean;
  getObjects?: () => FakeObject[];
};

type FakeCanvas = {
  activeObject: FakeObject | null;
  operations: string[];
  removedObjects: FakeObject[];
  getActiveObject: () => FakeObject | null;
  discardActiveObject: () => void;
  remove: (...objects: FakeObject[]) => void;
  requestRenderAll: () => void;
};

function createCanvas(activeObject: FakeObject | null): FakeCanvas {
  return {
    activeObject,
    operations: [],
    removedObjects: [],
    getActiveObject() {
      this.operations.push('getActiveObject');
      return this.activeObject;
    },
    discardActiveObject() {
      this.operations.push('discardActiveObject');
      this.activeObject = null;
    },
    remove(...objects: FakeObject[]) {
      this.operations.push(`remove:${objects.map((object) => object.id).join(',')}`);
      this.removedObjects.push(...objects);
    },
    requestRenderAll() {
      this.operations.push('requestRenderAll');
    },
  };
}

test.describe('costume selection commands', () => {
  test('does not delete while editing text', () => {
    const canvas = createCanvas({
      id: 'text-1',
      type: 'i-text',
      isEditing: true,
    });

    expect(deleteActiveCanvasSelection(canvas)).toBe(false);
    expect(canvas.operations).toEqual(['getActiveObject']);
    expect(canvas.removedObjects).toEqual([]);
  });

  test('deletes single active objects after clearing selection state', () => {
    const rect = { id: 'rect-1', type: 'rect' };
    const canvas = createCanvas(rect);

    expect(deleteActiveCanvasSelection(canvas)).toBe(true);
    expect(canvas.operations).toEqual([
      'getActiveObject',
      'discardActiveObject',
      'remove:rect-1',
      'requestRenderAll',
    ]);
    expect(canvas.removedObjects).toEqual([rect]);
  });

  test('deselects marquee selections before removing the selected objects', () => {
    const rectA = { id: 'rect-a', type: 'rect' };
    const rectB = { id: 'rect-b', type: 'rect' };
    const activeSelection = {
      id: 'selection-1',
      type: 'activeSelection',
      getObjects: () => [rectA, rectB],
    };
    const canvas = createCanvas(activeSelection);

    expect(deleteActiveCanvasSelection(canvas)).toBe(true);
    expect(canvas.operations).toEqual([
      'getActiveObject',
      'discardActiveObject',
      'remove:rect-a,rect-b',
      'requestRenderAll',
    ]);
    expect(canvas.removedObjects).toEqual([rectA, rectB]);
  });
});
