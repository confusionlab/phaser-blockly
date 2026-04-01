import type { Canvas as FabricCanvas } from 'fabric';
import type { CostumeEditorMode } from '@/types';
import { isActiveSelectionObject, isTextObject } from './costumeCanvasVectorRuntime';

export type CostumeCanvasSelectionKind = 'none' | 'bitmap-floating' | 'fabric';

export interface CostumeCanvasResolvedSelection {
  kind: CostumeCanvasSelectionKind;
  activeObject: any | null;
  selectionObject: any | null;
  selectedObjects: any[];
}

interface ResolveBitmapFloatingSelectionObjectOptions {
  fabricCanvas: FabricCanvas | null;
  registeredBitmapFloatingObject: any | null;
}

interface ResolveCostumeCanvasSelectionOptions extends ResolveBitmapFloatingSelectionObjectOptions {
  editorMode: CostumeEditorMode;
}

export function isBitmapFloatingSelectionObject(object: any): boolean {
  return !!object && (object as any).__bitmapFloatingSelection === true;
}

export function resolveBitmapFloatingSelectionObject({
  fabricCanvas,
  registeredBitmapFloatingObject,
}: ResolveBitmapFloatingSelectionObjectOptions): any | null {
  if (registeredBitmapFloatingObject && fabricCanvas?.getObjects().includes(registeredBitmapFloatingObject)) {
    return registeredBitmapFloatingObject;
  }

  const activeObject = fabricCanvas?.getActiveObject() as any;
  return isBitmapFloatingSelectionObject(activeObject) ? activeObject : null;
}

export function resolveCostumeCanvasSelection({
  editorMode,
  fabricCanvas,
  registeredBitmapFloatingObject,
}: ResolveCostumeCanvasSelectionOptions): CostumeCanvasResolvedSelection {
  const activeObject = fabricCanvas?.getActiveObject() as any;
  const bitmapFloatingObject = resolveBitmapFloatingSelectionObject({
    fabricCanvas,
    registeredBitmapFloatingObject,
  });
  const selectionObject = editorMode === 'bitmap'
    ? bitmapFloatingObject
    : activeObject;

  if (!selectionObject) {
    return {
      kind: 'none',
      activeObject,
      selectionObject: null,
      selectedObjects: [],
    };
  }

  if (isTextObject(selectionObject) && (selectionObject as any).isEditing) {
    return {
      kind: 'none',
      activeObject,
      selectionObject: null,
      selectedObjects: [],
    };
  }

  const selectedObjects = isActiveSelectionObject(selectionObject) && typeof selectionObject.getObjects === 'function'
    ? (selectionObject.getObjects() as any[]).filter(Boolean)
    : [selectionObject];

  if (selectedObjects.length === 0) {
    return {
      kind: 'none',
      activeObject,
      selectionObject: null,
      selectedObjects: [],
    };
  }

  return {
    kind: bitmapFloatingObject && selectionObject === bitmapFloatingObject ? 'bitmap-floating' : 'fabric',
    activeObject,
    selectionObject,
    selectedObjects,
  };
}
