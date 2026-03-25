import { useCallback, useRef, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import type { ActiveLayerCanvasState } from '@/lib/costume/costumeDocument';
import type { CostumeEditorMode } from '@/types';
import {
  areHistorySnapshotsEqual,
  cloneHistorySnapshot,
  createActiveLayerCanvasStateFromSnapshot,
  type CanvasHistorySnapshot,
} from './costumeCanvasShared';
import { VECTOR_JSON_EXTRA_PROPS } from './costumeCanvasVectorRuntime';

interface UseCostumeCanvasHistoryControllerOptions {
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  loadedSessionKeyRef: MutableRefObject<string | null>;
  onHistoryChangeRef: MutableRefObject<((state: ActiveLayerCanvasState) => void) | undefined>;
  suppressHistoryRef: MutableRefObject<boolean>;
}

export function useCostumeCanvasHistoryController({
  editorModeRef,
  fabricCanvasRef,
  loadedSessionKeyRef,
  onHistoryChangeRef,
  suppressHistoryRef,
}: UseCostumeCanvasHistoryControllerOptions) {
  const lastCommittedSnapshotRef = useRef<CanvasHistorySnapshot | null>(null);
  const persistedSnapshotRef = useRef<CanvasHistorySnapshot | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  const createSnapshot = useCallback((): CanvasHistorySnapshot => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        mode: editorModeRef.current,
        bitmapDataUrl: '',
        vectorJson: null,
      };
    }

    const activeLayerCanvas = fabricCanvas.toCanvasElement(1);
    const bitmapDataUrl = activeLayerCanvas.toDataURL('image/png');
    const mode = editorModeRef.current;
    const vectorJson = mode === 'vector' ? JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)) : null;
    return { mode, bitmapDataUrl, vectorJson };
  }, [editorModeRef, fabricCanvasRef]);

  const updateDirtyStateFromSnapshot = useCallback((snapshot: CanvasHistorySnapshot | null) => {
    hasUnsavedChangesRef.current = !areHistorySnapshotsEqual(snapshot, persistedSnapshotRef.current);
  }, []);

  const markSnapshotPersisted = useCallback((snapshot: CanvasHistorySnapshot | null) => {
    persistedSnapshotRef.current = snapshot ? cloneHistorySnapshot(snapshot) : null;
    hasUnsavedChangesRef.current = false;
  }, []);

  const markCurrentSnapshotPersisted = useCallback((sessionKey?: string | null) => {
    if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
      return;
    }

    markSnapshotPersisted(createSnapshot());
  }, [createSnapshot, loadedSessionKeyRef, markSnapshotPersisted]);

  const saveHistory = useCallback(() => {
    if (suppressHistoryRef.current) return;
    const snapshot = createSnapshot();
    if (areHistorySnapshotsEqual(snapshot, lastCommittedSnapshotRef.current)) {
      return;
    }

    lastCommittedSnapshotRef.current = cloneHistorySnapshot(snapshot);
    updateDirtyStateFromSnapshot(snapshot);
    onHistoryChangeRef.current?.(createActiveLayerCanvasStateFromSnapshot(snapshot));
  }, [createSnapshot, onHistoryChangeRef, suppressHistoryRef, updateDirtyStateFromSnapshot]);

  return {
    createSnapshot,
    lastCommittedSnapshotRef,
    markCurrentSnapshotPersisted,
    persistedSnapshotRef,
    saveHistory,
  };
}
