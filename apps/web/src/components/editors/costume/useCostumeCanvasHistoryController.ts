import { useCallback, useRef, type MutableRefObject } from 'react';
import { FabricImage, type Canvas as FabricCanvas } from 'fabric';
import type { ActiveLayerCanvasState } from '@/lib/costume/costumeDocument';
import type { CostumeEditorMode } from '@/types';
import { optimizeCostumeRasterCanvas } from '@/lib/costume/costumeAssetOptimization';
import {
  areHistorySnapshotsEqual,
  cloneHistorySnapshot,
  createActiveLayerCanvasStateFromSnapshot,
  createHistorySnapshotFromActiveLayerCanvasState,
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

  const getBitmapSnapshotCanvas = useCallback((fabricCanvas: FabricCanvas): HTMLCanvasElement | null => {
    const objects = fabricCanvas.getObjects();
    if (objects.length !== 1) {
      return null;
    }

    const [onlyObject] = objects;
    if (!(onlyObject instanceof FabricImage)) {
      return null;
    }

    const element = onlyObject.getElement();
    return element instanceof HTMLCanvasElement ? element : null;
  }, []);

  const createSnapshot = useCallback((): CanvasHistorySnapshot => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        mode: editorModeRef.current,
        bitmapDataUrl: '',
        bitmapAssetFrame: null,
        vectorJson: null,
      };
    }

    const mode = editorModeRef.current;
    if (mode === 'bitmap') {
      const activeLayerCanvas = getBitmapSnapshotCanvas(fabricCanvas) ?? fabricCanvas.toCanvasElement(1);
      const optimizedBitmap = optimizeCostumeRasterCanvas(activeLayerCanvas, { mimeType: 'image/png' });
      return {
        mode,
        bitmapDataUrl: optimizedBitmap.dataUrl,
        bitmapAssetFrame: optimizedBitmap.assetFrame ?? null,
        vectorJson: null,
      };
    }

    const activeLayerCanvas = fabricCanvas.toCanvasElement(1);
    return {
      mode,
      bitmapDataUrl: activeLayerCanvas.toDataURL('image/png'),
      bitmapAssetFrame: null,
      vectorJson: JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)),
    };
  }, [editorModeRef, fabricCanvasRef, getBitmapSnapshotCanvas]);

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

  const markActiveLayerCanvasStatePersisted = useCallback((
    state: ActiveLayerCanvasState | null | undefined,
    sessionKey?: string | null,
  ) => {
    if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
      return;
    }

    markSnapshotPersisted(state ? createHistorySnapshotFromActiveLayerCanvasState(state) : null);
  }, [loadedSessionKeyRef, markSnapshotPersisted]);

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
    markActiveLayerCanvasStatePersisted,
    markCurrentSnapshotPersisted,
    persistedSnapshotRef,
    saveHistory,
  };
}
