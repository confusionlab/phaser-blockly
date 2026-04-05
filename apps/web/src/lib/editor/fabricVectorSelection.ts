import type { Canvas as FabricCanvas } from 'fabric';

type FabricObjectLike = {
  getObjects?: () => FabricObjectLike[];
  group?: unknown;
  interactive?: boolean;
  parent?: unknown;
  set?: (properties: Record<string, unknown>) => unknown;
  setCoords?: () => void;
  subTargetCheck?: boolean;
  type?: unknown;
};

export interface VectorGroupingAvailability {
  canGroup: boolean;
  canUngroup: boolean;
}

export function getFabricObjectType(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const maybe = obj as { type?: unknown };
  return typeof maybe.type === 'string' ? maybe.type.trim().toLowerCase() : '';
}

export function isActiveSelectionObject(obj: unknown): boolean {
  const type = getFabricObjectType(obj);
  return type === 'activeselection' || type === 'active_selection';
}

export function isFabricGroupObject(obj: unknown): boolean {
  return getFabricObjectType(obj) === 'group';
}

export function getFabricChildObjects(obj: unknown): FabricObjectLike[] {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  const getObjects = (obj as FabricObjectLike).getObjects;
  return typeof getObjects === 'function' ? getObjects.call(obj).filter(Boolean) : [];
}

export function forEachFabricObjectDeep(
  root: FabricCanvas | FabricObjectLike | FabricObjectLike[] | null | undefined,
  visit: (object: FabricObjectLike) => void,
): void {
  if (!root) {
    return;
  }

  const pending: FabricObjectLike[] = Array.isArray(root)
    ? [...root]
    : typeof (root as FabricCanvas).getObjects === 'function'
      ? ((root as FabricCanvas).getObjects() as FabricObjectLike[])
      : [root as FabricObjectLike];

  while (pending.length > 0) {
    const object = pending.shift();
    if (!object) {
      continue;
    }
    visit(object);
    const children = getFabricChildObjects(object);
    if (children.length > 0) {
      pending.unshift(...children);
    }
  }
}

export function fabricCanvasContainsObject(
  fabricCanvas: Pick<FabricCanvas, 'getObjects'> | null | undefined,
  target: unknown,
): boolean {
  if (!fabricCanvas || !target) {
    return false;
  }

  let found = false;
  forEachFabricObjectDeep(fabricCanvas.getObjects() as FabricObjectLike[], (object) => {
    if (object === target) {
      found = true;
    }
  });
  return found;
}

export function getFabricObjectDirectParentGroup(target: unknown): FabricObjectLike | null {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const candidate = target as FabricObjectLike;
  if (isFabricGroupObject(candidate.parent)) {
    return candidate.parent as FabricObjectLike;
  }
  if (isFabricGroupObject(candidate.group)) {
    return candidate.group as FabricObjectLike;
  }
  return null;
}

export function getFabricAncestorGroups(target: unknown): FabricObjectLike[] {
  const ancestors: FabricObjectLike[] = [];
  let current = getFabricObjectDirectParentGroup(target);
  while (current) {
    ancestors.unshift(current);
    current = getFabricObjectDirectParentGroup(current);
  }
  return ancestors;
}

export function getVectorGroupEditingPathForTarget(target: unknown): FabricObjectLike[] {
  if (isActiveSelectionObject(target)) {
    const [firstSelectedObject] = getFabricChildObjects(target);
    return firstSelectedObject ? getFabricAncestorGroups(firstSelectedObject) : [];
  }
  return getFabricAncestorGroups(target);
}

export function sanitizeVectorGroupEditingPath(
  fabricCanvas: Pick<FabricCanvas, 'getObjects'> | null | undefined,
  path: unknown[],
): FabricObjectLike[] {
  if (!fabricCanvas) {
    return [];
  }

  const nextPath: FabricObjectLike[] = [];
  let expectedParent: FabricObjectLike | null = null;

  for (const candidate of path) {
    if (!isFabricGroupObject(candidate)) {
      break;
    }
    const group = candidate as FabricObjectLike;
    if (!fabricCanvasContainsObject(fabricCanvas, group)) {
      break;
    }
    if (getFabricObjectDirectParentGroup(group) !== expectedParent) {
      break;
    }
    nextPath.push(group);
    expectedParent = group;
  }

  return nextPath;
}

export function syncVectorGroupInteractivity(
  fabricCanvas: Pick<FabricCanvas, 'getObjects'> | null | undefined,
  editingPath: unknown[],
): void {
  if (!fabricCanvas) {
    return;
  }

  const interactiveGroups = new Set(editingPath.filter((candidate) => isFabricGroupObject(candidate)));
  forEachFabricObjectDeep(fabricCanvas.getObjects() as FabricObjectLike[], (object) => {
    if (!isFabricGroupObject(object)) {
      return;
    }

    const nextInteractive = interactiveGroups.has(object);
    if (object.subTargetCheck !== true) {
      object.set?.({ subTargetCheck: true });
    }
    if (object.interactive !== nextInteractive) {
      object.set?.({ interactive: nextInteractive });
    }
    object.setCoords?.();
  });
}

export function getSelectionSharedParentGroup(objects: unknown[]): FabricObjectLike | null | undefined {
  if (objects.length === 0) {
    return undefined;
  }

  const [firstObject] = objects;
  const firstParent = getFabricObjectDirectParentGroup(firstObject);
  const sharedParent = objects.every((object) => getFabricObjectDirectParentGroup(object) === firstParent)
    ? firstParent
    : undefined;
  return sharedParent;
}

export function getVectorGroupingAvailability(activeObject: unknown): VectorGroupingAvailability {
  if (!activeObject) {
    return { canGroup: false, canUngroup: false };
  }

  if (isActiveSelectionObject(activeObject)) {
    const selectedObjects = getFabricChildObjects(activeObject);
    const canGroup = selectedObjects.length >= 2 && typeof getSelectionSharedParentGroup(selectedObjects) !== 'undefined';
    return {
      canGroup,
      canUngroup: false,
    };
  }

  return {
    canGroup: false,
    canUngroup: isFabricGroupObject(activeObject),
  };
}

export function resolveVectorHoverTarget(
  fabricCanvas: (Pick<FabricCanvas, 'findTarget'> & Partial<Pick<FabricCanvas, 'getActiveObject'>>) | null | undefined,
  event: MouseEvent | PointerEvent | WheelEvent,
): unknown {
  if (!fabricCanvas || typeof fabricCanvas.findTarget !== 'function') {
    return null;
  }

  const targetInfo = (fabricCanvas.findTarget as (event: MouseEvent | PointerEvent | WheelEvent) => { target?: unknown } | undefined)(event);
  const target = targetInfo?.target ?? null;
  return isActiveSelectionObject(target) ? null : target;
}
