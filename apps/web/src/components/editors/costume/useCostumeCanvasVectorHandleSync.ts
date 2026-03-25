import { useEffect, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { pathNodeHandleTypeToVectorHandleMode, vectorHandleModeToPathNodeHandleType } from './CostumeToolbar';
import { getEditableVectorHandleMode } from './costumeCanvasShared';
import { getFabricObjectType } from './costumeCanvasVectorRuntime';
import type { VectorHandleMode } from './CostumeToolbar';
import type { CostumeEditorMode } from '@/types';

interface UseCostumeCanvasVectorHandleSyncOptions {
  activePathAnchorRef: MutableRefObject<{ path: any; anchorIndex: number } | null>;
  activeToolRef: MutableRefObject<string>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  enforcePathAnchorHandleType: (pathObj: any, anchorIndex: number, changed: any, dragState?: any) => void;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getPathNodeHandleType: (pathObj: any, anchorIndex: number) => any;
  getSelectedPathAnchorIndices: (pathObj: any) => number[];
  pendingSelectionSyncedVectorHandleModeRef: MutableRefObject<VectorHandleMode | null>;
  saveHistory: () => void;
  setPathNodeHandleType: (pathObj: any, anchorIndex: number, type: any) => void;
  syncPathControlPointVisibility: (pathObj: any) => void;
  vectorHandleMode: VectorHandleMode;
  vectorPointEditingTargetRef: MutableRefObject<any | null>;
}

export function useCostumeCanvasVectorHandleSync({
  activePathAnchorRef,
  activeToolRef,
  editorModeRef,
  enforcePathAnchorHandleType,
  fabricCanvasRef,
  getPathNodeHandleType,
  getSelectedPathAnchorIndices,
  pendingSelectionSyncedVectorHandleModeRef,
  saveHistory,
  setPathNodeHandleType,
  syncPathControlPointVisibility,
  vectorHandleMode,
  vectorPointEditingTargetRef,
}: UseCostumeCanvasVectorHandleSyncOptions) {
  useEffect(() => {
    const activeAnchor = activePathAnchorRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    if (!activeAnchor || !fabricCanvas) return;
    if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'select') return;
    if (!vectorPointEditingTargetRef.current) return;

    const pendingSelectionSyncedMode = pendingSelectionSyncedVectorHandleModeRef.current;
    if (pendingSelectionSyncedMode !== null) {
      pendingSelectionSyncedVectorHandleModeRef.current = null;
      if (pendingSelectionSyncedMode === vectorHandleMode) {
        return;
      }
    }

    if (vectorHandleMode === 'multiple') {
      return;
    }

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || activeObject !== activeAnchor.path) return;
    if (getFabricObjectType(activeObject) !== 'path') return;
    const selectedAnchorIndices = getSelectedPathAnchorIndices(activeObject);
    const targetAnchorIndices = selectedAnchorIndices.length > 0
      ? selectedAnchorIndices
      : [activeAnchor.anchorIndex];

    let changed = false;
    for (const anchorIndex of targetAnchorIndices) {
      const currentHandleMode = pathNodeHandleTypeToVectorHandleMode(
        getPathNodeHandleType(activeObject, anchorIndex) ?? 'linear',
      );
      if (currentHandleMode === vectorHandleMode) continue;

      setPathNodeHandleType(
        activeObject,
        anchorIndex,
        vectorHandleModeToPathNodeHandleType(getEditableVectorHandleMode(vectorHandleMode)),
      );
      enforcePathAnchorHandleType(activeObject, anchorIndex, null);
      changed = true;
    }

    if (!changed) return;

    syncPathControlPointVisibility(activeObject);
    fabricCanvas.requestRenderAll();
    saveHistory();
  }, [
    activePathAnchorRef,
    activeToolRef,
    editorModeRef,
    enforcePathAnchorHandleType,
    fabricCanvasRef,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    pendingSelectionSyncedVectorHandleModeRef,
    saveHistory,
    setPathNodeHandleType,
    syncPathControlPointVisibility,
    vectorHandleMode,
    vectorPointEditingTargetRef,
  ]);
}
