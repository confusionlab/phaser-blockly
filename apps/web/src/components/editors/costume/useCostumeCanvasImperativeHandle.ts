import { useImperativeHandle, type ForwardedRef, type MutableRefObject } from 'react';
import type { ActiveLayerCanvasState } from '@/lib/costume/costumeDocument';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import type { CostumeAssetFrame, CostumeEditorMode } from '@/types';
import { areHistorySnapshotsEqual } from './costumeCanvasShared';
import type { CostumeCanvasExportState, CostumeCanvasHandle } from './CostumeCanvas';

interface UseCostumeCanvasImperativeHandleOptions {
  advanceHistoryGeneration: () => number;
  alignSelection: (action: any) => boolean;
  bitmapRasterCommitQueueRef: MutableRefObject<Promise<void>>;
  configureCanvasForTool: () => void;
  createSnapshot: () => any;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  exportCostumeState: (sessionKey?: string | null) => CostumeCanvasExportState | null;
  flipSelection: (axis: any) => boolean;
  getDirectBitmapPreviewCanvas: () => HTMLCanvasElement | null;
  getComposedCanvasElement: () => HTMLCanvasElement;
  isTextEditing: () => boolean;
  lastCommittedSnapshotRef: MutableRefObject<any>;
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
  persistedSnapshotRef: MutableRefObject<any>;
  ref: ForwardedRef<CostumeCanvasHandle>;
  rotateSelection: () => boolean;
  saveHistory: () => void;
  setEditorMode: (mode: CostumeEditorMode) => void;
  switchEditorMode: (mode: CostumeEditorMode) => Promise<void>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  getHistoryGeneration: () => number;
}

export function useCostumeCanvasImperativeHandle({
  advanceHistoryGeneration,
  alignSelection,
  bitmapRasterCommitQueueRef,
  configureCanvasForTool,
  createSnapshot,
  deleteSelection,
  duplicateSelection,
  exportCostumeState,
  flipSelection,
  getDirectBitmapPreviewCanvas,
  getComposedCanvasElement,
  isTextEditing,
  lastCommittedSnapshotRef,
  loadBitmapLayer,
  loadDocument,
  loadedSessionKeyRef,
  markActiveLayerCanvasStatePersisted,
  markCurrentSnapshotPersisted,
  moveSelectionOrder,
  persistedSnapshotRef,
  ref,
  rotateSelection,
  saveHistory,
  setEditorMode,
  switchEditorMode,
  editorModeRef,
  getHistoryGeneration,
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
      advanceHistoryGeneration();
      loadedSessionKeyRef.current = null;
      await loadBitmapLayer(dataUrl, false);
      setEditorMode('bitmap');
      loadedSessionKeyRef.current = sessionKey ?? null;
      lastCommittedSnapshotRef.current = null;
      saveHistory();
      markCurrentSnapshotPersisted(sessionKey ?? null);
    },

    loadDocument: async (sessionKey: string, document: any) => {
      advanceHistoryGeneration();
      await loadDocument(sessionKey, document);
    },

    flushPendingBitmapCommits: async () => {
      await bitmapRasterCommitQueueRef.current.catch(() => undefined);
    },

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

    getHistoryGeneration,

    getLoadedSessionKey: () => loadedSessionKeyRef.current,

    getDirectBitmapPreviewCanvas: (sessionKey?: string | null) => {
      if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
        return null;
      }
      if (editorModeRef.current !== 'bitmap') {
        return null;
      }
      return getDirectBitmapPreviewCanvas();
    },

    getComposedPreviewCanvas: (sessionKey?: string | null) => {
      if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
        return null;
      }
      return getComposedCanvasElement();
    },

    deleteSelection,

    duplicateSelection,

    moveSelectionOrder,

    flipSelection,

    rotateSelection,

    alignSelection,

    isTextEditing,

    clear: () => {
      void (async () => {
        advanceHistoryGeneration();
        loadedSessionKeyRef.current = null;
        await loadBitmapLayer('', false);
        setEditorMode('bitmap');
        saveHistory();
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
    advanceHistoryGeneration,
    alignSelection,
    bitmapRasterCommitQueueRef,
    configureCanvasForTool,
    createSnapshot,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    getDirectBitmapPreviewCanvas,
    getComposedCanvasElement,
    isTextEditing,
    lastCommittedSnapshotRef,
    loadBitmapLayer,
    loadDocument,
    loadedSessionKeyRef,
    markActiveLayerCanvasStatePersisted,
    markCurrentSnapshotPersisted,
    moveSelectionOrder,
    persistedSnapshotRef,
    ref,
    rotateSelection,
    saveHistory,
    setEditorMode,
    switchEditorMode,
    editorModeRef,
    getHistoryGeneration,
  ]);
}
