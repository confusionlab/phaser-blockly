import { publishCostumeRuntimePreview } from '@/store/costumeRuntimePreviewStore';
import type { CostumeBounds } from '@/types';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import type { ActiveLayerCanvasState } from '@/lib/costume/costumeDocument';
import type { CostumeEditorPreviewSyncMode, CostumeEditorSession } from './costumeEditorSession';

export interface CostumeRuntimePreviewCanvasSource {
  getDirectBitmapPreviewCanvas: (sessionKey?: string | null) => HTMLCanvasElement | null;
  getComposedPreviewCanvas: (sessionKey?: string | null) => HTMLCanvasElement | null;
}

interface PublishCostumeRuntimePreviewFromCanvasOptions {
  canvasSource: CostumeRuntimePreviewCanvasSource | null | undefined;
  liveCanvasState: ActiveLayerCanvasState;
  resolveComposedBounds?: (canvas: HTMLCanvasElement) => CostumeBounds | null;
  revision: number;
  session: CostumeEditorSession;
  syncMode: CostumeEditorPreviewSyncMode;
}

export function publishCostumeRuntimePreviewFromCanvas({
  canvasSource,
  liveCanvasState,
  resolveComposedBounds = calculateBoundsFromCanvas,
  revision,
  session,
  syncMode,
}: PublishCostumeRuntimePreviewFromCanvasOptions): boolean {
  // Keep the preview publication rules centralized so render/stateOnly behavior
  // matches the architecture contract and stage/shelf consumers stay in sync.
  if (!canvasSource) {
    return false;
  }

  const sourceCanvas = syncMode === 'stateOnly'
    ? canvasSource.getDirectBitmapPreviewCanvas(session.key)
    : canvasSource.getComposedPreviewCanvas(session.key);
  if (!sourceCanvas) {
    return false;
  }

  publishCostumeRuntimePreview({
    sceneId: session.sceneId,
    objectId: session.objectId,
    costumeId: session.costumeId,
    revision,
    sourceCanvas,
    assetFrame: syncMode === 'stateOnly'
      ? liveCanvasState.bitmapAssetFrame ?? null
      : null,
    bounds: syncMode === 'stateOnly'
      ? liveCanvasState.bitmapBounds ?? null
      : resolveComposedBounds(sourceCanvas),
  });
  return true;
}
