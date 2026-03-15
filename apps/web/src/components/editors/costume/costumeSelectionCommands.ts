type FabricSelectionObject = {
  type?: string;
  isEditing?: boolean;
  getObjects?: () => FabricSelectionObject[];
};

type FabricSelectionCanvas<T extends FabricSelectionObject> = {
  getActiveObject: () => T | null | undefined;
  discardActiveObject: () => void;
  remove: (...objects: T[]) => unknown;
  requestRenderAll: () => void;
};

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

function isActiveSelectionObject(obj: FabricSelectionObject | null | undefined): obj is FabricSelectionObject & { getObjects: () => FabricSelectionObject[] } {
  if (!obj || typeof obj.getObjects !== 'function') return false;
  const type = getFabricObjectType(obj);
  return type === 'activeselection' || type === 'active_selection';
}

export function deleteActiveCanvasSelection<T extends FabricSelectionObject>(canvas: FabricSelectionCanvas<T>): boolean {
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

  // Detach ActiveSelection members back onto the canvas before removing them,
  // otherwise Fabric can reinsert marquee-selected objects during deselection.
  canvas.discardActiveObject();
  canvas.remove(...objectsToRemove);
  canvas.requestRenderAll();
  return true;
}
