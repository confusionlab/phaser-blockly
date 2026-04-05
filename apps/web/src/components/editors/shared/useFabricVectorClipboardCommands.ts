import { useCallback, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import {
  copyActiveCanvasSelectionToClipboard,
  duplicateActiveCanvasSelection,
  pasteVectorClipboardIntoCanvas,
} from './fabricSelectionCommands';

type FabricVectorObject = {
  left?: number;
  top?: number;
  set?: (properties: Record<string, unknown>) => unknown;
  setCoords?: () => void;
};

interface UseFabricVectorClipboardCommandsOptions<T extends FabricVectorObject = FabricVectorObject> {
  beforeDuplicate?: () => void;
  beforePaste?: () => void;
  canRun?: () => boolean;
  cloneObject: (object: T) => Promise<T>;
  deleteSelection: () => boolean;
  duplicateMoveOffset?: number;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  normalizeCanvasVectorStrokeUniform?: () => boolean;
  pasteMoveOffset?: number;
  pasteTargetCenter?: { x: number; y: number };
  resolveInsertionParent?: () => { add?: (...objects: T[]) => unknown; getObjects: () => T[]; insertAt?: (index: number, ...objects: T[]) => unknown; remove?: (...objects: T[]) => unknown } | null;
  saveHistory: () => void;
  syncSelectionState?: () => void;
}

export function useFabricVectorClipboardCommands<T extends FabricVectorObject = FabricVectorObject>({
  beforeDuplicate,
  beforePaste,
  canRun,
  cloneObject,
  deleteSelection,
  duplicateMoveOffset,
  fabricCanvasRef,
  normalizeCanvasVectorStrokeUniform,
  pasteMoveOffset,
  pasteTargetCenter,
  resolveInsertionParent,
  saveHistory,
  syncSelectionState,
}: UseFabricVectorClipboardCommandsOptions<T>) {
  const duplicateSelection = useCallback(async (): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || (canRun && !canRun())) {
      return false;
    }

    beforeDuplicate?.();
    const duplicated = await duplicateActiveCanvasSelection(fabricCanvas as any, {
      cloneObject,
      moveOffset: duplicateMoveOffset,
      resolveInsertionParent,
    } as any);
    if (!duplicated) {
      return false;
    }

    syncSelectionState?.();
    saveHistory();
    return true;
  }, [
    beforeDuplicate,
    canRun,
    cloneObject,
    duplicateMoveOffset,
    fabricCanvasRef,
    resolveInsertionParent,
    saveHistory,
    syncSelectionState,
  ]);

  const copySelection = useCallback(async (): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || (canRun && !canRun())) {
      return false;
    }

    return await copyActiveCanvasSelectionToClipboard(fabricCanvas as any, {
      cloneObject,
    } as any);
  }, [canRun, cloneObject, fabricCanvasRef]);

  const cutSelection = useCallback(async (): Promise<boolean> => {
    if (canRun && !canRun()) {
      return false;
    }

    const copied = await copySelection();
    if (!copied) {
      return false;
    }

    return deleteSelection();
  }, [canRun, copySelection, deleteSelection]);

  const pasteSelection = useCallback(async (): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || (canRun && !canRun())) {
      return false;
    }

    beforePaste?.();
    const pasted = await pasteVectorClipboardIntoCanvas(fabricCanvas as any, {
      cloneObject,
      moveOffset: pasteMoveOffset,
      resolveInsertionParent,
      targetCenter: pasteTargetCenter,
    } as any);
    if (!pasted) {
      return false;
    }

    normalizeCanvasVectorStrokeUniform?.();
    syncSelectionState?.();
    saveHistory();
    return true;
  }, [
    beforePaste,
    canRun,
    cloneObject,
    fabricCanvasRef,
    normalizeCanvasVectorStrokeUniform,
    pasteMoveOffset,
    pasteTargetCenter,
    resolveInsertionParent,
    saveHistory,
    syncSelectionState,
  ]);

  return {
    copySelection,
    cutSelection,
    duplicateSelection,
    pasteSelection,
  };
}
