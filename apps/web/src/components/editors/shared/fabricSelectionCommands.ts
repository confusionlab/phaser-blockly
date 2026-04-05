import { ActiveSelection, Group } from 'fabric';
import {
  getVectorClipboard,
  markVectorClipboardPaste,
  setVectorClipboard,
  type VectorClipboardEntry,
} from '@/lib/editor/vectorClipboard';
import {
  getSelectionSharedParentGroup,
  getVectorGroupingAvailability,
  isFabricGroupObject,
  type VectorGroupingAvailability,
} from '@/lib/editor/fabricVectorSelection';

type FabricSelectionObject = {
  type?: string;
  isEditing?: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  group?: unknown;
  parent?: unknown;
  getObjects?: () => FabricSelectionObject[];
  clone?: (() => Promise<FabricSelectionObject>) | ((callback: (cloned: FabricSelectionObject) => void) => void);
  getBoundingRect?: () => { left?: number; top?: number; width?: number; height?: number };
  set?: (properties: Record<string, unknown>) => unknown;
  setCoords?: () => void;
};

type FabricSelectionContainer<T extends FabricSelectionObject> = {
  add?: (...objects: T[]) => unknown;
  getObjects: () => T[];
  insertAt?: (index: number, ...objects: T[]) => unknown;
  remove?: (...objects: T[]) => unknown;
};

type FabricDeleteSelectionCanvas<T extends FabricSelectionObject> = {
  getActiveObject: () => T | null | undefined;
  discardActiveObject: () => void;
  getObjects: () => T[];
  remove: (...objects: T[]) => unknown;
  requestRenderAll: () => void;
};

type FabricDuplicateSelectionCanvas<T extends FabricSelectionObject> = {
  getActiveObject: () => T | null | undefined;
  add: (object: T) => unknown;
  getObjects: () => T[];
  insertAt?: (index: number, ...objects: T[]) => unknown;
  setActiveObject: (object: T) => unknown;
  requestRenderAll: () => void;
};

type FabricNudgeSelectionCanvas<T extends FabricSelectionObject> = {
  getActiveObject: () => T | null | undefined;
  discardActiveObject: () => void;
  getObjects: () => T[];
  setActiveObject: (object: T) => unknown;
  requestRenderAll: () => void;
};

type CloneableFabricSelectionObject = FabricSelectionObject & {
  clone?: (() => Promise<CloneableFabricSelectionObject>) | ((callback: (cloned: CloneableFabricSelectionObject) => void) => void);
  setCoords?: () => void;
};

type FabricGroupingCanvas<T extends FabricSelectionObject> =
  & FabricDeleteSelectionCanvas<T>
  & FabricDuplicateSelectionCanvas<T>;

function getObjectBounds(object: CloneableFabricSelectionObject): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const boundingRect = typeof object.getBoundingRect === 'function'
    ? object.getBoundingRect()
    : null;
  return {
    left: typeof boundingRect?.left === 'number' ? boundingRect.left : (typeof object.left === 'number' ? object.left : 0),
    top: typeof boundingRect?.top === 'number' ? boundingRect.top : (typeof object.top === 'number' ? object.top : 0),
    width: typeof boundingRect?.width === 'number' ? boundingRect.width : (typeof object.width === 'number' ? object.width : 0),
    height: typeof boundingRect?.height === 'number' ? boundingRect.height : (typeof object.height === 'number' ? object.height : 0),
  };
}

function getSelectionCenter(objects: CloneableFabricSelectionObject[]): { x: number; y: number } | null {
  if (objects.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  objects.forEach((object) => {
    const bounds = getObjectBounds(object);
    left = Math.min(left, bounds.left);
    top = Math.min(top, bounds.top);
    right = Math.max(right, bounds.left + bounds.width);
    bottom = Math.max(bottom, bounds.top + bounds.height);
  });

  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null;
  }

  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
}

function getFabricObjectType(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const maybe = obj as { type?: unknown };
  return typeof maybe.type === 'string' ? maybe.type.trim().toLowerCase() : '';
}

function isTextEditingObject(obj: FabricSelectionObject | null | undefined): boolean {
  if (!obj) return false;
  const type = getFabricObjectType(obj);
  return (type === 'itext' || type === 'i-text' || type === 'textbox' || type === 'text') && obj.isEditing === true;
}

function isActiveSelectionObject(
  obj: FabricSelectionObject | null | undefined,
): obj is FabricSelectionObject & { getObjects: () => FabricSelectionObject[] } {
  if (!obj || typeof obj.getObjects !== 'function') return false;
  const type = getFabricObjectType(obj);
  return type === 'activeselection' || type === 'active_selection';
}

async function cloneFabricObject<T extends FabricSelectionObject>(obj: T): Promise<T> {
  if (!obj || typeof obj.clone !== 'function') {
    throw new Error('Object is not cloneable');
  }

  const clone = obj.clone as (...args: any[]) => unknown;
  const maybePromise = clone.call(obj);
  if (maybePromise && typeof (maybePromise as PromiseLike<unknown>).then === 'function') {
    return await maybePromise as T;
  }

  return await new Promise<T>((resolve) => {
    clone.call(obj, (cloned: T) => resolve(cloned));
  });
}

function getActiveCanvasSelectionObjects<T extends FabricSelectionObject>(
  canvas: { getActiveObject: () => T | null | undefined },
): T[] {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || isTextEditingObject(activeObject)) {
    return [];
  }

  return (isActiveSelectionObject(activeObject)
    ? activeObject.getObjects().filter(Boolean)
    : [activeObject]) as T[];
}

function restoreActiveCanvasSelection<T extends CloneableFabricSelectionObject>(
  canvas: FabricNudgeSelectionCanvas<T>,
  selectedObjects: T[],
): void {
  const nextObjects = selectedObjects.filter(Boolean);
  if (nextObjects.length === 0) {
    return;
  }

  if (nextObjects.length === 1) {
    nextObjects[0].setCoords?.();
    canvas.setActiveObject(nextObjects[0]);
    return;
  }

  canvas.setActiveObject(new ActiveSelection(nextObjects as any[], { canvas: canvas as any }) as unknown as T);
}

function getSelectionContainer<T extends FabricSelectionObject>(
  canvas: Pick<FabricGroupingCanvas<T>, 'getObjects'>,
  selectedObjects: T[],
  explicitParent?: FabricSelectionContainer<T> | null,
): FabricSelectionContainer<T> {
  if (explicitParent) {
    return explicitParent;
  }
  return (getSelectionSharedParentGroup(selectedObjects) as FabricSelectionContainer<T> | null | undefined) ?? canvas;
}

function addObjectsToContainer<T extends FabricSelectionObject>(
  canvas: FabricDuplicateSelectionCanvas<T>,
  container: FabricSelectionContainer<T>,
  objects: T[],
): void {
  if (objects.length === 0) {
    return;
  }

  if (container === canvas) {
    objects.forEach((object) => {
      canvas.add(object);
    });
    return;
  }

  if (typeof container.add === 'function') {
    container.add(...objects);
    return;
  }

  if (typeof container.insertAt === 'function') {
    container.insertAt(container.getObjects().length, ...objects);
  }
}

export function deleteActiveCanvasSelection<T extends FabricSelectionObject>(canvas: FabricDeleteSelectionCanvas<T>): boolean {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || isTextEditingObject(activeObject)) {
    return false;
  }

  const objectsToRemove = (isActiveSelectionObject(activeObject)
    ? activeObject.getObjects().filter(Boolean)
    : [activeObject]) as T[];

  if (objectsToRemove.length === 0) {
    return false;
  }

  canvas.discardActiveObject();
  const container = getSelectionSharedParentGroup(objectsToRemove) as FabricSelectionContainer<T> | null | undefined;
  if (container && typeof container.remove === 'function') {
    container.remove(...objectsToRemove);
  } else {
    canvas.remove(...objectsToRemove);
  }
  canvas.requestRenderAll();
  return true;
}

export function nudgeActiveCanvasSelection<T extends CloneableFabricSelectionObject>(
  canvas: FabricNudgeSelectionCanvas<T>,
  delta: { x: number; y: number },
): boolean {
  if (delta.x === 0 && delta.y === 0) {
    return false;
  }

  const activeObject = canvas.getActiveObject();
  if (!activeObject || isTextEditingObject(activeObject)) {
    return false;
  }

  const selectedObjects = getActiveCanvasSelectionObjects(canvas);
  if (selectedObjects.length === 0) {
    return false;
  }

  if (isActiveSelectionObject(activeObject)) {
    canvas.discardActiveObject();
  }

  let changed = false;
  for (const obj of selectedObjects) {
    obj.set?.({
      left: (typeof obj.left === 'number' ? obj.left : 0) + delta.x,
      top: (typeof obj.top === 'number' ? obj.top : 0) + delta.y,
    });
    obj.setCoords?.();
    changed = true;
  }

  if (!changed) {
    return false;
  }

  restoreActiveCanvasSelection(canvas, selectedObjects);
  canvas.requestRenderAll();
  return true;
}

export async function duplicateActiveCanvasSelection<T extends FabricSelectionObject>(
  canvas: FabricDuplicateSelectionCanvas<T>,
  options?: {
    cloneObject?: (object: T) => Promise<T>;
    moveOffset?: number;
    resolveInsertionParent?: () => FabricSelectionContainer<T> | null;
  },
): Promise<boolean> {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || isTextEditingObject(activeObject)) {
    return false;
  }

  const cloneObject = options?.cloneObject ?? cloneFabricObject<T>;
  const moveOffset = options?.moveOffset ?? 20;
  const sourceObjects = (isActiveSelectionObject(activeObject)
    ? activeObject.getObjects().filter(Boolean)
    : [activeObject]) as T[];

  if (sourceObjects.length === 0) {
    return false;
  }

  const insertionParent = getSelectionContainer(
    canvas,
    sourceObjects,
    options?.resolveInsertionParent?.() ?? null,
  );
  const clones: T[] = [];
  for (const sourceObject of sourceObjects) {
    const cloned = await cloneObject(sourceObject);
    cloned.set?.({
      left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
      top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
    });
    clones.push(cloned);
  }

  if (clones.length === 0) {
    return false;
  }

  addObjectsToContainer(canvas, insertionParent, clones);

  if (clones.length === 1) {
    canvas.setActiveObject(clones[0]);
  } else {
    canvas.setActiveObject(new ActiveSelection(clones as any[], { canvas: canvas as any }) as unknown as T);
  }

  canvas.requestRenderAll();
  return true;
}

export async function copyActiveCanvasSelectionToClipboard<T extends CloneableFabricSelectionObject>(
  canvas: { getActiveObject: () => T | null | undefined },
  options?: {
    cloneObject?: (object: T) => Promise<T>;
  },
): Promise<boolean> {
  const cloneObject = options?.cloneObject ?? cloneFabricObject<T>;
  const sourceObjects = getActiveCanvasSelectionObjects(canvas);
  if (sourceObjects.length === 0) {
    return false;
  }

  const entries: VectorClipboardEntry<T>[] = [];
  for (const sourceObject of sourceObjects) {
    entries.push({
      object: await cloneObject(sourceObject),
    });
  }

  setVectorClipboard<T>({
    entries,
  });
  return true;
}

export async function pasteVectorClipboardIntoCanvas<T extends CloneableFabricSelectionObject>(
  canvas: FabricDuplicateSelectionCanvas<T>,
  options?: {
    cloneObject?: (object: T) => Promise<T>;
    moveOffset?: number;
    resolveInsertionParent?: () => FabricSelectionContainer<T> | null;
    targetCenter?: { x: number; y: number };
  },
): Promise<boolean> {
  const clipboard = getVectorClipboard<T>();
  if (!clipboard) {
    return false;
  }

  const cloneObject = options?.cloneObject ?? cloneFabricObject<T>;
  const moveOffset = (options?.moveOffset ?? 20) * (clipboard.pasteCount + 1);
  const clones: T[] = [];

  for (const entry of clipboard.entries) {
    const cloned = await cloneObject(entry.object);
    cloned.set?.({
      left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
      top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
    });
    cloned.setCoords?.();
    clones.push(cloned);
  }

  if (clones.length === 0) {
    return false;
  }

  if (options?.targetCenter) {
    const selectionCenter = getSelectionCenter(clones);
    if (selectionCenter) {
      const deltaX = options.targetCenter.x - selectionCenter.x;
      const deltaY = options.targetCenter.y - selectionCenter.y;
      clones.forEach((cloned) => {
        cloned.set?.({
          left: (typeof cloned.left === 'number' ? cloned.left : 0) + deltaX,
          top: (typeof cloned.top === 'number' ? cloned.top : 0) + deltaY,
        });
        cloned.setCoords?.();
      });
    }
  }

  const insertionParent = getSelectionContainer(
    canvas,
    clones,
    options?.resolveInsertionParent?.() ?? null,
  );
  addObjectsToContainer(canvas, insertionParent, clones);

  if (clones.length === 1) {
    canvas.setActiveObject(clones[0]);
  } else {
    canvas.setActiveObject(new ActiveSelection(clones as any[], { canvas: canvas as any }) as unknown as T);
  }

  canvas.requestRenderAll();
  markVectorClipboardPaste();
  return true;
}

export function getActiveCanvasGroupingCapabilities<T extends FabricSelectionObject>(
  canvas: { getActiveObject: () => T | null | undefined },
): VectorGroupingAvailability {
  return getVectorGroupingAvailability(canvas.getActiveObject());
}

export function groupActiveCanvasSelection<T extends FabricSelectionObject>(
  canvas: FabricGroupingCanvas<T>,
): boolean {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || isTextEditingObject(activeObject)) {
    return false;
  }

  const selectedObjects = getActiveCanvasSelectionObjects(canvas);
  if (selectedObjects.length < 2) {
    return false;
  }

  const parentGroup = getSelectionSharedParentGroup(selectedObjects) as FabricSelectionContainer<T> | null | undefined;
  if (typeof parentGroup === 'undefined') {
    return false;
  }

  const container = (parentGroup ?? canvas) as FabricSelectionContainer<T>;
  const stack = container.getObjects();
  const indexedSelection = selectedObjects
    .map((object) => ({ object, index: stack.indexOf(object) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);
  if (indexedSelection.length < 2) {
    return false;
  }

  const orderedSelection = indexedSelection.map((entry) => entry.object);
  const insertIndex = indexedSelection[0].index;

  canvas.discardActiveObject();
  if (parentGroup && typeof parentGroup.remove === 'function') {
    parentGroup.remove(...orderedSelection);
  } else {
    canvas.remove(...orderedSelection);
  }

  const nextGroup = new Group(orderedSelection as any[], {
    interactive: false,
    subTargetCheck: true,
  }) as unknown as T;

  if (container === canvas) {
    if (typeof canvas.insertAt === 'function') {
      canvas.insertAt(insertIndex, nextGroup);
    } else {
      canvas.add(nextGroup);
    }
  } else if (typeof container.insertAt === 'function') {
    container.insertAt(insertIndex, nextGroup);
  } else if (typeof container.add === 'function') {
    container.add(nextGroup);
  } else {
    return false;
  }

  nextGroup.setCoords?.();
  canvas.setActiveObject(nextGroup);
  canvas.requestRenderAll();
  return true;
}

export function ungroupActiveCanvasSelection<T extends FabricSelectionObject>(
  canvas: FabricGroupingCanvas<T>,
): boolean {
  const activeObject = canvas.getActiveObject();
  if (!activeObject || isTextEditingObject(activeObject) || !isFabricGroupObject(activeObject)) {
    return false;
  }

  const group = activeObject as unknown as Group & T;
  const parentGroup = getSelectionSharedParentGroup([group]) as FabricSelectionContainer<T> | null | undefined;
  const container = (parentGroup ?? canvas) as FabricSelectionContainer<T>;
  const stack = container.getObjects();
  const insertIndex = stack.indexOf(group);
  if (insertIndex < 0) {
    return false;
  }

  canvas.discardActiveObject();
  const children = group.removeAll() as unknown as T[];
  if (children.length === 0) {
    return false;
  }

  if (parentGroup && typeof parentGroup.remove === 'function') {
    parentGroup.remove(group);
  } else {
    canvas.remove(group);
  }

  if (container === canvas) {
    if (typeof canvas.insertAt === 'function') {
      canvas.insertAt(insertIndex, ...children);
    } else {
      children.forEach((child) => canvas.add(child));
    }
  } else if (typeof container.insertAt === 'function') {
    container.insertAt(insertIndex, ...children);
  } else if (typeof container.add === 'function') {
    container.add(...children);
  } else {
    return false;
  }

  if (children.length === 1) {
    canvas.setActiveObject(children[0]);
  } else {
    canvas.setActiveObject(new ActiveSelection(children as any[], { canvas: canvas as any }) as unknown as T);
  }
  canvas.requestRenderAll();
  return true;
}
