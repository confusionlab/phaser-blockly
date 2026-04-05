import { expect, test } from '@playwright/test';
import { Rect } from 'fabric';
import {
  copyActiveCanvasSelectionToClipboard,
  deleteActiveCanvasSelection,
  duplicateActiveCanvasSelection,
  groupActiveCanvasSelection,
  nudgeActiveCanvasSelection,
  pasteVectorClipboardIntoCanvas,
  ungroupActiveCanvasSelection,
} from '../src/components/editors/shared/fabricSelectionCommands';
import { getVectorClipboard, setVectorClipboard } from '../src/lib/editor/vectorClipboard';

type FakeObject = {
  id: string;
  type?: string;
  isEditing?: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  getObjects?: () => FakeObject[];
  clone?: () => Promise<FakeObject>;
  getBoundingRect?: () => { left?: number; top?: number; width?: number; height?: number };
  set?: (properties: Record<string, unknown>) => void;
  setCoords?: () => void;
  _set?: (key: string, value: unknown) => void;
};

type FakeCanvas = {
  activeObject: FakeObject | null;
  objects: FakeObject[];
  operations: string[];
  removedObjects: FakeObject[];
  addedObjects: FakeObject[];
  getActiveObject: () => FakeObject | null;
  discardActiveObject: () => void;
  getObjects: () => FakeObject[];
  remove: (...objects: FakeObject[]) => void;
  add: (object: FakeObject) => void;
  insertAt: (index: number, ...objects: FakeObject[]) => void;
  setActiveObject: (object: FakeObject) => void;
  requestRenderAll: () => void;
  fire: (eventName: string, payload?: unknown) => void;
};

function createCanvas(activeObject: FakeObject | null, objects: FakeObject[] = []): FakeCanvas {
  return {
    activeObject,
    objects,
    operations: [],
    removedObjects: [],
    addedObjects: [],
    getActiveObject() {
      this.operations.push('getActiveObject');
      return this.activeObject;
    },
    discardActiveObject() {
      this.operations.push('discardActiveObject');
      this.activeObject = null;
    },
    getObjects() {
      return this.objects;
    },
    remove(...objects: FakeObject[]) {
      this.operations.push(`remove:${objects.map((object) => object.id).join(',')}`);
      this.objects = this.objects.filter((existingObject) => !objects.includes(existingObject));
      this.removedObjects.push(...objects);
    },
    add(object) {
      this.operations.push(`add:${object.id}`);
      this.objects.push(object);
      this.addedObjects.push(object);
    },
    insertAt(index, ...objects) {
      this.operations.push(`insertAt:${index}:${objects.map((object) => object.id ?? object.type ?? 'group').join(',')}`);
      this.objects.splice(index, 0, ...objects);
      this.addedObjects.push(...objects);
    },
    setActiveObject(object) {
      this.operations.push(`setActiveObject:${object.id ?? object.type ?? 'selection'}`);
      this.activeObject = object;
    },
    requestRenderAll() {
      this.operations.push('requestRenderAll');
    },
    fire(eventName) {
      this.operations.push(`fire:${eventName}`);
    },
  };
}

test.describe('costume selection commands', () => {
  test.beforeEach(() => {
    setVectorClipboard(null);
  });

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

  test('duplicates a single selected object with the default offset', async () => {
    const canvas = createCanvas({
      id: 'rect-1',
      type: 'rect',
      left: 10,
      top: 15,
      clone: async () => ({
        id: 'rect-1-copy',
        type: 'rect',
        left: 10,
        top: 15,
        set(properties: Record<string, unknown>) {
          Object.assign(this, properties);
        },
      }),
    });

    await expect(duplicateActiveCanvasSelection(canvas)).resolves.toBe(true);
    expect(canvas.operations).toEqual([
      'getActiveObject',
      'add:rect-1-copy',
      'setActiveObject:rect-1-copy',
      'requestRenderAll',
    ]);
    expect(canvas.addedObjects).toHaveLength(1);
    expect(canvas.addedObjects[0]).toMatchObject({
      id: 'rect-1-copy',
      left: 30,
      top: 35,
    });
  });

  test('does not duplicate while editing text', async () => {
    const canvas = createCanvas({
      id: 'text-1',
      type: 'i-text',
      isEditing: true,
      clone: async () => ({
        id: 'text-1-copy',
        type: 'i-text',
      }),
    });

    await expect(duplicateActiveCanvasSelection(canvas)).resolves.toBe(false);
    expect(canvas.operations).toEqual(['getActiveObject']);
    expect(canvas.addedObjects).toEqual([]);
  });

  test('nudges a single selected object by the requested delta', () => {
    const rect = {
      id: 'rect-1',
      type: 'rect',
      left: 10,
      top: 15,
      set(properties: Record<string, unknown>) {
        Object.assign(this, properties);
      },
    };
    const canvas = createCanvas(rect);

    expect(nudgeActiveCanvasSelection(canvas, { x: 3, y: -2 })).toBe(true);
    expect(rect).toMatchObject({ left: 13, top: 13 });
    expect(canvas.operations).toEqual([
      'getActiveObject',
      'getActiveObject',
      'setActiveObject:rect-1',
      'requestRenderAll',
    ]);
  });

  test('nudges marquee selections by moving each selected object', () => {
    const rectA = new Rect({ left: 20, top: 40, width: 10, height: 10 }) as unknown as FakeObject;
    rectA.id = 'rect-a';
    const rectB = new Rect({ left: 50, top: 60, width: 10, height: 10 }) as unknown as FakeObject;
    rectB.id = 'rect-b';
    const activeSelection = {
      id: 'selection-1',
      type: 'activeSelection',
      getObjects: () => [rectA, rectB],
    };
    const canvas = createCanvas(activeSelection);
    const beforeRectA = { left: rectA.left, top: rectA.top };
    const beforeRectB = { left: rectB.left, top: rectB.top };

    expect(nudgeActiveCanvasSelection(canvas, { x: -4, y: 6 })).toBe(true);
    expect(rectA.left).not.toBe(beforeRectA.left);
    expect(rectA.top).not.toBe(beforeRectA.top);
    expect(rectB.left).not.toBe(beforeRectB.left);
    expect(rectB.top).not.toBe(beforeRectB.top);
    expect(canvas.operations).toContain('discardActiveObject');
    expect(canvas.operations).toContain('requestRenderAll');
  });

  test('copies the active selection into the shared vector clipboard', async () => {
    const canvas = createCanvas({
      id: 'rect-1',
      type: 'rect',
      clone: async () => ({
        id: 'rect-1-copy',
        type: 'rect',
      }),
    });

    await expect(copyActiveCanvasSelectionToClipboard(canvas)).resolves.toBe(true);
    expect(canvas.operations).toEqual(['getActiveObject']);
    expect(getVectorClipboard<FakeObject>()).toMatchObject({
      entries: [{ object: { id: 'rect-1-copy', type: 'rect' } }],
      pasteCount: 0,
    });
  });

  test('pastes from the shared vector clipboard and advances the paste offset', async () => {
    await copyActiveCanvasSelectionToClipboard(createCanvas({
      id: 'rect-1',
      type: 'rect',
      left: 10,
      top: 15,
      clone: async () => ({
        id: 'rect-1-copy',
        type: 'rect',
        left: 10,
        top: 15,
        clone: async function () {
          return {
            id: this.id,
            type: this.type,
            left: this.left,
            top: this.top,
            clone: this.clone,
            set: this.set,
          };
        },
        set(properties: Record<string, unknown>) {
          Object.assign(this, properties);
        },
      }),
    }));

    const firstPasteCanvas = createCanvas(null);
    await expect(pasteVectorClipboardIntoCanvas(firstPasteCanvas)).resolves.toBe(true);
    expect(firstPasteCanvas.addedObjects[0]).toMatchObject({
      id: 'rect-1-copy',
      left: 30,
      top: 35,
    });

    const secondPasteCanvas = createCanvas(null);
    await expect(pasteVectorClipboardIntoCanvas(secondPasteCanvas)).resolves.toBe(true);
    expect(secondPasteCanvas.addedObjects[0]).toMatchObject({
      id: 'rect-1-copy',
      left: 50,
      top: 55,
    });
  });

  test('can paste the clipboard centered on a target point', async () => {
    await copyActiveCanvasSelectionToClipboard(createCanvas({
      id: 'rect-1',
      type: 'rect',
      left: 100,
      top: 200,
      width: 80,
      height: 40,
      clone: async () => ({
        id: 'rect-1-copy',
        type: 'rect',
        left: 100,
        top: 200,
        width: 80,
        height: 40,
        getBoundingRect() {
          return {
            left: this.left,
            top: this.top,
            width: this.width,
            height: this.height,
          };
        },
        clone: async function () {
          return {
            id: this.id,
            type: this.type,
            left: this.left,
            top: this.top,
            width: this.width,
            height: this.height,
            getBoundingRect: this.getBoundingRect,
            clone: this.clone,
            set: this.set,
          };
        },
        set(properties: Record<string, unknown>) {
          Object.assign(this, properties);
        },
      }),
    }));

    const pasteCanvas = createCanvas(null);
    await expect(pasteVectorClipboardIntoCanvas(pasteCanvas, {
      moveOffset: 0,
      targetCenter: { x: 512, y: 512 },
    })).resolves.toBe(true);
    expect(pasteCanvas.addedObjects[0]).toMatchObject({
      id: 'rect-1-copy',
      left: 472,
      top: 492,
    });
  });

  test('groups an active multi-selection into a single group object', () => {
    const rectA = new Rect({ left: 10, top: 20, width: 30, height: 40 }) as unknown as FakeObject;
    rectA.id = 'rect-a';
    const rectB = new Rect({ left: 70, top: 80, width: 20, height: 25 }) as unknown as FakeObject;
    rectB.id = 'rect-b';
    const activeSelection = {
      id: 'selection-1',
      type: 'activeSelection',
      getObjects: () => [rectA, rectB],
    };
    const canvas = createCanvas(activeSelection, [rectA, rectB]);

    expect(groupActiveCanvasSelection(canvas as any)).toBe(true);
    expect(canvas.operations).toContain('discardActiveObject');
    expect(canvas.operations).toContain('remove:rect-a,rect-b');
    expect(canvas.operations).toContain('insertAt:0:group');
    expect(canvas.operations).toContain('setActiveObject:group');
    expect(canvas.operations).toContain('requestRenderAll');
    expect(canvas.objects).toHaveLength(1);
    expect(canvas.objects[0]?.type).toBe('group');
    expect(canvas.activeObject?.type).toBe('group');
  });

  test('ungroups a selected group back into its children', () => {
    const rectA = new Rect({ left: 10, top: 20, width: 30, height: 40 }) as unknown as FakeObject;
    rectA.id = 'rect-a';
    const rectB = new Rect({ left: 70, top: 80, width: 20, height: 25 }) as unknown as FakeObject;
    rectB.id = 'rect-b';
    const activeSelection = {
      id: 'selection-1',
      type: 'activeSelection',
      getObjects: () => [rectA, rectB],
    };
    const canvas = createCanvas(activeSelection, [rectA, rectB]);

    expect(groupActiveCanvasSelection(canvas as any)).toBe(true);
    const groupedObject = canvas.activeObject;
    expect(groupedObject?.type).toBe('group');
    canvas.operations = [];

    expect(ungroupActiveCanvasSelection(canvas as any)).toBe(true);
    expect(canvas.operations).toContain('discardActiveObject');
    expect(canvas.operations).toContain('insertAt:0:rect-a,rect-b');
    expect(canvas.operations).toContain('requestRenderAll');
    expect(canvas.operations.some((operation) => operation.startsWith('remove:'))).toBe(true);
    expect(canvas.operations.some((operation) => operation.startsWith('setActiveObject:'))).toBe(true);
    expect(canvas.objects).toHaveLength(2);
    expect(canvas.objects).toEqual([rectA, rectB]);
    expect(String(canvas.activeObject?.type).toLowerCase()).toContain('active');
  });
});
