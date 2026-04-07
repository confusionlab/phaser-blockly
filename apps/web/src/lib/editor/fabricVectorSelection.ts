import type { Canvas as FabricCanvas, FabricObject } from 'fabric';

type FabricObjectLike = FabricObject & {
  add?: (...objects: FabricObjectLike[]) => unknown;
  getObjects?: () => FabricObjectLike[];
  group?: unknown;
  insertAt?: (index: number, ...objects: FabricObjectLike[]) => unknown;
  interactive?: boolean;
  parent?: unknown;
  remove?: (...objects: FabricObjectLike[]) => unknown;
  set?: (properties: Record<string, unknown>) => unknown;
  setCoords?: () => void;
  subTargetCheck?: boolean;
  type?: unknown;
};

type FabricObjectContainerLike = Pick<FabricCanvas, 'getObjects'> & {
  add?: (...objects: FabricObjectLike[]) => unknown;
  insertAt?: (index: number, ...objects: FabricObjectLike[]) => unknown;
  remove?: (...objects: FabricObjectLike[]) => unknown;
};

type FabricSelectionMarqueeBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type FabricSelectionMarqueeState = {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
};

type FabricCanvasSelectionPreviewLike = Pick<FabricCanvas, 'getObjects'> & {
  _groupSelector?: FabricSelectionMarqueeState | null;
  collectObjects?: (
    bounds: FabricSelectionMarqueeBounds,
    options?: { includeIntersecting?: boolean },
  ) => FabricObjectLike[];
  selection?: boolean;
  selectionFullyContained?: boolean;
  upperCanvasEl?: HTMLCanvasElement | null;
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

export function resolveVectorGroupEntrySelectionTarget(
  group: unknown,
  target: unknown,
  subTargets: unknown[] | null | undefined,
): FabricObjectLike | null {
  if (!isFabricGroupObject(group)) {
    return null;
  }

  const parentGroup = group as FabricObjectLike;
  const candidates = [
    target,
    ...(Array.isArray(subTargets) ? subTargets : []),
  ];
  const seen = new Set<unknown>();

  for (const candidate of candidates) {
    if (!candidate || candidate === parentGroup || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (getFabricObjectDirectParentGroup(candidate) === parentGroup) {
      return candidate as FabricObjectLike;
    }
  }

  return null;
}

export function resolveVectorGroupEditingRootTarget(
  fabricCanvas: Pick<FabricCanvas, 'getObjects'> | null | undefined,
  editingPath: unknown[],
): FabricObjectLike | null {
  const [rootGroup] = sanitizeVectorGroupEditingPath(fabricCanvas, editingPath);
  return rootGroup ?? null;
}

export function resolveVectorSelectionDirectTarget(
  target: unknown,
  editingPath: unknown[],
): FabricObjectLike | null {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const interactiveParentGroups = new Set(
    editingPath.filter((candidate) => isFabricGroupObject(candidate)) as FabricObjectLike[],
  );

  let current: FabricObjectLike | null = target as FabricObjectLike;
  while (current) {
    const parentGroup = getFabricObjectDirectParentGroup(current);
    if (!parentGroup || interactiveParentGroups.has(parentGroup)) {
      return current;
    }
    current = parentGroup;
  }

  return null;
}

export function isVectorSelectionDirectTarget(
  target: unknown,
  editingPath: unknown[],
): boolean {
  return resolveVectorSelectionDirectTarget(target, editingPath) === target;
}

export function replaceFabricObjectInParentContainer(
  fabricCanvas: FabricObjectContainerLike | null | undefined,
  target: FabricObjectLike,
  replacement: FabricObjectLike,
): boolean {
  if (!fabricCanvas) {
    return false;
  }

  const parentGroup = getFabricObjectDirectParentGroup(target) as FabricObjectContainerLike | null;
  const container = parentGroup ?? fabricCanvas;
  const stack = container.getObjects();
  const index = stack.indexOf(target);
  if (index < 0) {
    return false;
  }

  if (typeof container.remove !== 'function') {
    return false;
  }

  const canInsert = typeof container.insertAt === 'function' || typeof container.add === 'function';
  if (!canInsert) {
    return false;
  }

  container.remove(target);
  if (typeof container.insertAt === 'function') {
    container.insertAt(index, replacement);
  } else {
    container.add?.(replacement);
  }
  replacement.setCoords?.();
  if (parentGroup) {
    (parentGroup as FabricObjectLike).setCoords?.();
  }
  return true;
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
  editingPath: unknown[] = [],
): unknown {
  if (!fabricCanvas || typeof fabricCanvas.findTarget !== 'function') {
    return null;
  }

  const targetInfo = (fabricCanvas.findTarget as (event: MouseEvent | PointerEvent | WheelEvent) => { target?: unknown } | undefined)(event);
  const target = targetInfo?.target ?? null;
  if (isActiveSelectionObject(target)) {
    return null;
  }
  return resolveVectorSelectionDirectTarget(target, editingPath);
}

export function getVectorSelectionMarqueeBounds(
  fabricCanvas: FabricCanvasSelectionPreviewLike | null | undefined,
): FabricSelectionMarqueeBounds | null {
  if (!fabricCanvas?.selection || !fabricCanvas._groupSelector) {
    return null;
  }

  const { x, y, deltaX, deltaY } = fabricCanvas._groupSelector;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return null;
  }

  const left = deltaX >= 0 ? x : x + deltaX;
  const top = deltaY >= 0 ? y : y + deltaY;
  const width = Math.abs(deltaX);
  const height = Math.abs(deltaY);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    left,
    top,
    width,
    height,
  };
}

export function isVectorSelectionMarqueeVisibleOnFabricTopLayer(
  fabricCanvas: Pick<FabricCanvasSelectionPreviewLike, 'upperCanvasEl'> | null | undefined,
): boolean {
  const upperCanvas = fabricCanvas?.upperCanvasEl;
  if (!(upperCanvas instanceof HTMLCanvasElement)) {
    return false;
  }

  const computedStyle = typeof window !== 'undefined'
    ? window.getComputedStyle(upperCanvas)
    : null;
  const opacityValue = Number.parseFloat(computedStyle?.opacity ?? upperCanvas.style.opacity ?? '1');
  return (
    (computedStyle?.display ?? upperCanvas.style.display ?? '') !== 'none' &&
    (computedStyle?.visibility ?? upperCanvas.style.visibility ?? '') !== 'hidden' &&
    Number.isFinite(opacityValue) &&
    opacityValue > 0
  );
}

export function getVectorSelectionMarqueePreviewTargets(
  fabricCanvas: FabricCanvasSelectionPreviewLike | null | undefined,
): FabricObjectLike[] {
  const marqueeBounds = getVectorSelectionMarqueeBounds(fabricCanvas);
  if (!fabricCanvas || !marqueeBounds || typeof fabricCanvas.collectObjects !== 'function') {
    return [];
  }

  return fabricCanvas.collectObjects(marqueeBounds, {
    includeIntersecting: !fabricCanvas.selectionFullyContained,
  });
}
