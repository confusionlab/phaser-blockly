import { useImperativeHandle, type ForwardedRef, type MutableRefObject } from 'react';
import type { ActiveLayerCanvasState } from '@/lib/costume/costumeDocument';
import type { FinishPendingEditsOptions } from '@/lib/editor/interactionSurface';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import type { CostumeAssetFrame, CostumeEditorMode } from '@/types';
import { areHistorySnapshotsEqual } from './costumeCanvasShared';
import type { CostumeCanvasExportState, CostumeCanvasHandle } from './CostumeCanvas';

interface UseCostumeCanvasImperativeHandleOptions {
  alignSelection: (action: any) => boolean;
  bitmapRasterCommitQueueRef: MutableRefObject<Promise<void>>;
  clearSelection: () => boolean;
  configureCanvasForTool: () => void;
  createSnapshot: () => any;
  copySelection: () => Promise<boolean>;
  cutSelection: () => Promise<boolean>;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  exportCostumeState: (sessionKey?: string | null) => CostumeCanvasExportState | null;
  flipSelection: (axis: any) => boolean;
  flushPendingEdits: (options?: FinishPendingEditsOptions) => Promise<boolean>;
  getComposedCanvasElement: () => HTMLCanvasElement;
  hasActiveInteraction: () => boolean;
  isTextEditing: () => boolean;
  loadBitmapLayer: (
    dataUrl: string,
    selectable: boolean,
    requestId?: number,
    options?: { assetFrame?: CostumeAssetFrame | null },
  ) => Promise<boolean>;
  loadDocument: (sessionKey: string, document: any) => Promise<void>;
  loadedSessionKeyRef: MutableRefObject<string | null>;
  markActiveLayerCanvasStatePersisted: (state: ActiveLayerCanvasState | null | undefined, sessionKey?: string | null) => void;
  markCurrentSnapshotPersisted: (sessionKey?: string | null) => void;
  moveSelectionOrder: (action: any) => boolean;
  nudgeSelection: (dx: number, dy: number) => boolean;
  pasteSelection: () => Promise<boolean>;
  persistedSnapshotRef: MutableRefObject<any>;
  ref: ForwardedRef<CostumeCanvasHandle>;
  rebaseHistoryToCurrentSnapshot: (sessionKey?: string | null) => void;
  rotateSelection: () => boolean;
  saveHistory: () => void;
  setEditorMode: (mode: CostumeEditorMode) => void;
  switchEditorMode: (mode: CostumeEditorMode) => Promise<void>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
}

export function useCostumeCanvasImperativeHandle({
  alignSelection,
  bitmapRasterCommitQueueRef,
  clearSelection,
  configureCanvasForTool,
  createSnapshot,
  deleteSelection,
  duplicateSelection,
  exportCostumeState,
  flipSelection,
  flushPendingEdits,
  getComposedCanvasElement,
  hasActiveInteraction,
  isTextEditing,
  loadBitmapLayer,
  loadDocument,
  loadedSessionKeyRef,
  markActiveLayerCanvasStatePersisted,
  markCurrentSnapshotPersisted,
  moveSelectionOrder,
  nudgeSelection,
  copySelection,
  cutSelection,
  pasteSelection,
  persistedSnapshotRef,
  ref,
  rebaseHistoryToCurrentSnapshot,
  rotateSelection,
  setEditorMode,
  switchEditorMode,
  editorModeRef,
}: UseCostumeCanvasImperativeHandleOptions) {
  useImperativeHandle(ref, () => ({
    toDataURL: () => {
      const composed = getComposedCanvasElement();
      return composed.toDataURL('image/webp', 0.85);
    },

    toDataURLWithBounds: () => {
      const composed = getComposedCanvasElement();
      return {
        dataUrl: composed.toDataURL('image/webp', 0.85),
        bounds: calculateBoundsFromCanvas(composed),
      };
    },

    loadFromDataURL: async (dataUrl: string, sessionKey?: string | null) => {
      loadedSessionKeyRef.current = null;
      await loadBitmapLayer(dataUrl, false);
      setEditorMode('bitmap');
      loadedSessionKeyRef.current = sessionKey ?? null;
      rebaseHistoryToCurrentSnapshot(sessionKey ?? null);
    },

    loadDocument,

    flushPendingBitmapCommits: async () => {
      await bitmapRasterCommitQueueRef.current.catch(() => undefined);
    },

    flushPendingEdits,

    hasActiveInteraction,

    exportCostumeState,

    hasUnsavedChanges: (sessionKey?: string | null) => {
      if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
        return false;
      }
      return !areHistorySnapshotsEqual(createSnapshot(), persistedSnapshotRef.current);
    },

    markPersisted: (sessionKey?: string | null, state?: ActiveLayerCanvasState | null) => {
      if (state) {
        markActiveLayerCanvasStatePersisted(state, sessionKey);
        return;
      }
      markCurrentSnapshotPersisted(sessionKey);
    },

    setEditorMode: async (mode: CostumeEditorMode) => {
      await switchEditorMode(mode);
      configureCanvasForTool();
    },

    getEditorMode: () => editorModeRef.current,

    getLoadedSessionKey: () => loadedSessionKeyRef.current,

    deleteSelection,

    duplicateSelection,

    copySelection,

    cutSelection,

    pasteSelection,

    moveSelectionOrder,

    nudgeSelection,

    flipSelection,

    rotateSelection,

    alignSelection,

    isTextEditing,

    clearSelection,

    clear: () => {
      void (async () => {
        loadedSessionKeyRef.current = null;
        await loadBitmapLayer('', false);
        setEditorMode('bitmap');
        rebaseHistoryToCurrentSnapshot(null);
      })();
    },

    undo: () => {
      return;
    },

    redo: () => {
      return;
    },

    canUndo: () => false,
    canRedo: () => false,
  }), [
    alignSelection,
    bitmapRasterCommitQueueRef,
    clearSelection,
    configureCanvasForTool,
    createSnapshot,
    copySelection,
    cutSelection,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    flushPendingEdits,
    getComposedCanvasElement,
    hasActiveInteraction,
    isTextEditing,
    loadBitmapLayer,
    loadDocument,
    loadedSessionKeyRef,
    markActiveLayerCanvasStatePersisted,
    markCurrentSnapshotPersisted,
    moveSelectionOrder,
    nudgeSelection,
    pasteSelection,
    persistedSnapshotRef,
    ref,
    rebaseHistoryToCurrentSnapshot,
    rotateSelection,
    setEditorMode,
    switchEditorMode,
    editorModeRef,
  ]);
}
