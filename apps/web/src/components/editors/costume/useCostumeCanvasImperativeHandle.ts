import { useImperativeHandle, type ForwardedRef, type MutableRefObject } from 'react';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import type { CostumeEditorMode } from '@/types';
import { areHistorySnapshotsEqual } from './costumeCanvasShared';
import type { CostumeCanvasExportState, CostumeCanvasHandle } from './CostumeCanvas';

interface UseCostumeCanvasImperativeHandleOptions {
  alignSelection: (action: any) => boolean;
  configureCanvasForTool: () => void;
  createSnapshot: () => any;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  exportCostumeState: (sessionKey?: string | null) => CostumeCanvasExportState | null;
  flipSelection: (axis: any) => boolean;
  getComposedCanvasElement: () => HTMLCanvasElement;
  isTextEditing: () => boolean;
  lastCommittedSnapshotRef: MutableRefObject<any>;
  loadBitmapLayer: (dataUrl: string, selectable: boolean, requestId?: number) => Promise<boolean>;
  loadDocument: (sessionKey: string, document: any) => Promise<void>;
  loadedSessionKeyRef: MutableRefObject<string | null>;
  markCurrentSnapshotPersisted: (sessionKey?: string | null) => void;
  moveSelectionOrder: (action: any) => boolean;
  persistedSnapshotRef: MutableRefObject<any>;
  ref: ForwardedRef<CostumeCanvasHandle>;
  rotateSelection: () => boolean;
  saveHistory: () => void;
  setEditorMode: (mode: CostumeEditorMode) => void;
  switchEditorMode: (mode: CostumeEditorMode) => Promise<void>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
}

export function useCostumeCanvasImperativeHandle({
  alignSelection,
  configureCanvasForTool,
  createSnapshot,
  deleteSelection,
  duplicateSelection,
  exportCostumeState,
  flipSelection,
  getComposedCanvasElement,
  isTextEditing,
  lastCommittedSnapshotRef,
  loadBitmapLayer,
  loadDocument,
  loadedSessionKeyRef,
  markCurrentSnapshotPersisted,
  moveSelectionOrder,
  persistedSnapshotRef,
  ref,
  rotateSelection,
  saveHistory,
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
      lastCommittedSnapshotRef.current = null;
      saveHistory();
      markCurrentSnapshotPersisted(sessionKey ?? null);
    },

    loadDocument,

    exportCostumeState,

    hasUnsavedChanges: (sessionKey?: string | null) => {
      if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
        return false;
      }
      return !areHistorySnapshotsEqual(createSnapshot(), persistedSnapshotRef.current);
    },

    markPersisted: (sessionKey?: string | null) => {
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

    moveSelectionOrder,

    flipSelection,

    rotateSelection,

    alignSelection,

    isTextEditing,

    clear: () => {
      void (async () => {
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
    alignSelection,
    configureCanvasForTool,
    createSnapshot,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    getComposedCanvasElement,
    isTextEditing,
    lastCommittedSnapshotRef,
    loadBitmapLayer,
    loadDocument,
    loadedSessionKeyRef,
    markCurrentSnapshotPersisted,
    moveSelectionOrder,
    persistedSnapshotRef,
    ref,
    rotateSelection,
    saveHistory,
    setEditorMode,
    switchEditorMode,
    editorModeRef,
  ]);
}
