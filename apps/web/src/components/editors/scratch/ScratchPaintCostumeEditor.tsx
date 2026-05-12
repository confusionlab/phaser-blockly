import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CostumeList } from '@/components/editors/costume/CostumeList';
import { Palette, TriangleAlert } from '@/components/ui/icons';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import {
  canRedoHistory,
  canUndoHistory,
  redoHistory,
  undoHistory,
} from '@/store/universalHistory';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import {
  cloneCostume,
  cloneCostumeDocument,
  convertAnimatedCostumeToStatic,
  convertStaticCostumeToAnimated,
  createBitmapCostumeDocument,
  isAnimatedCostume,
} from '@/lib/costume/costumeDocument';
import {
  renderCostumePreview,
} from '@/lib/costume/costumeDocumentRender';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import { getCanvas2dContext } from '@/utils/canvas2d';
import { loadImageSource } from '@/lib/assets/imageSourceCache';
import { createScratchPaintSvgEditorSource } from '@/lib/costume/costumeEditorSource';
import type { Costume, CostumeBounds } from '@/types';
import type {
  CostumeEditorObjectTarget,
  CostumeEditorPersistedState,
  CostumeEditorTarget,
} from '@/lib/editor/costumeEditorSession';
import {
  SCRATCH_PAINT_FRAME_LOAD,
  SCRATCH_PAINT_FRAME_RENAME,
  SCRATCH_PAINT_FRAME_READY,
  SCRATCH_PAINT_FRAME_UPDATE,
  type ScratchPaintFrameLoadMessage,
  type ScratchPaintFrameMessage,
  type ScratchPaintFrameRenameMessage,
  type ScratchPaintFrameUpdateMessage,
  type ScratchPaintImageState,
} from '@pochacoding/scratch-paint-protocol';

const SCRATCH_STAGE_SIZE = 1024;
const SCRATCH_STAGE_CENTER = SCRATCH_STAGE_SIZE / 2;

function createObjectTarget(
  sceneId: string | null,
  objectId: string | null,
  componentId: string | null,
): CostumeEditorObjectTarget | null {
  if (componentId) {
    return { componentId };
  }
  if (sceneId && objectId) {
    return { sceneId, objectId };
  }
  return null;
}

function createCostumeTarget(
  sceneId: string | null,
  objectId: string | null,
  componentId: string | null,
  costumeId: string | null,
): CostumeEditorTarget | null {
  if (componentId && costumeId) {
    return { componentId, costumeId };
  }
  if (sceneId && objectId && costumeId) {
    return { sceneId, objectId, costumeId };
  }
  return null;
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, imageData.width);
  canvas.height = Math.max(1, imageData.height);
  const context = getCanvas2dContext(canvas, 'readback');
  if (!context) {
    throw new Error('Failed to prepare Scratch bitmap output.');
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function svgStringToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function composeScratchImageToCostumeSurface(
  source: string,
  rotationCenterX?: number,
  rotationCenterY?: number,
): Promise<{
  dataUrl: string;
  bounds?: CostumeBounds;
}> {
  const image = await loadImageSource(source);
  const imageWidth = Math.max(1, image.naturalWidth || image.width || 1);
  const imageHeight = Math.max(1, image.naturalHeight || image.height || 1);
  const centerX = Number.isFinite(rotationCenterX) ? rotationCenterX! : imageWidth / 2;
  const centerY = Number.isFinite(rotationCenterY) ? rotationCenterY! : imageHeight / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SCRATCH_STAGE_SIZE;
  canvas.height = SCRATCH_STAGE_SIZE;
  const context = getCanvas2dContext(canvas, 'readback');
  if (!context) {
    throw new Error('Failed to prepare Scratch costume surface.');
  }

  context.clearRect(0, 0, SCRATCH_STAGE_SIZE, SCRATCH_STAGE_SIZE);
  context.drawImage(
    image,
    Math.round(SCRATCH_STAGE_CENTER - centerX),
    Math.round(SCRATCH_STAGE_CENTER - centerY),
  );

  return {
    dataUrl: canvas.toDataURL('image/png'),
    bounds: calculateBoundsFromCanvas(canvas) ?? undefined,
  };
}

async function createScratchImageStateFromCostume(costume: Costume): Promise<ScratchPaintImageState> {
  if (costume.kind === 'static' && costume.editorSource?.engine === 'scratch-paint') {
    return {
      image: costume.editorSource.source,
      imageFormat: costume.editorSource.format,
      imageId: costume.id,
      name: costume.name || 'costume',
      rotationCenterX: costume.editorSource.rotationCenterX,
      rotationCenterY: costume.editorSource.rotationCenterY,
    };
  }

  const preview = await renderCostumePreview(costume);
  return {
    image: preview.dataUrl || costume.assetId,
    imageFormat: 'png',
    imageId: costume.id,
    name: costume.name || 'costume',
    rotationCenterX: SCRATCH_STAGE_CENTER,
    rotationCenterY: SCRATCH_STAGE_CENTER,
  };
}

function cloneCostumes(costumes: Costume[]): Costume[] {
  return costumes.map((costume) => cloneCostume(costume));
}

function getScratchPaintFrameSrc(): string {
  const configuredFrameUrl = import.meta.env.VITE_SCRATCH_PAINT_FRAME_URL?.trim();
  if (configuredFrameUrl) {
    return configuredFrameUrl;
  }

  if (typeof window === 'undefined') {
    return '/scratch-paint-frame/';
  }

  if (window.location.protocol === 'file:') {
    return new URL('./scratch-paint-frame/index.html', window.location.href).toString();
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:5175/';
  }

  return new URL('/scratch-paint-frame/', window.location.origin).toString();
}

function getScratchPaintFrameTargetOrigin(frameSrc: string): string {
  if (typeof window === 'undefined' || window.location.origin === 'null') {
    return '*';
  }
  const frameUrl = new URL(frameSrc, window.location.href);
  return frameUrl.origin;
}

function isFrameReadyMessage(data: unknown): data is ScratchPaintFrameMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as ScratchPaintFrameMessage).type === SCRATCH_PAINT_FRAME_READY
  );
}

function isFrameUpdateMessage(data: unknown): data is ScratchPaintFrameUpdateMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as ScratchPaintFrameMessage).type === SCRATCH_PAINT_FRAME_UPDATE &&
    typeof (data as ScratchPaintFrameUpdateMessage).imageId === 'string'
  );
}

function isFrameRenameMessage(data: unknown): data is ScratchPaintFrameRenameMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as ScratchPaintFrameMessage).type === SCRATCH_PAINT_FRAME_RENAME &&
    typeof (data as ScratchPaintFrameRenameMessage).imageId === 'string'
  );
}

export function ScratchPaintCostumeEditor() {
  const {
    project,
    updateObject,
    updateComponent,
    updateCostumeFromEditor,
    applyCostumeEditorOperation,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedObjectId,
    selectedComponentId,
    registerCostumeUndo,
  } = useEditorStore();

  const [selectedCostumeIds, setSelectedCostumeIds] = useState<string[]>([]);
  const [scratchImageState, setScratchImageState] = useState<ScratchPaintImageState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [isFrameReady, setIsFrameReady] = useState(false);
  const commitSequenceRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const latestCommittedImageRef = useRef<string | null>(null);
  const scratchPaintFrameSrc = getScratchPaintFrameSrc();

  const handleFrameRef = useCallback((node: HTMLIFrameElement | null) => {
    if (iframeRef.current === node) {
      return;
    }
    iframeRef.current = node;
    if (node) {
      setIsFrameReady(false);
    }
  }, []);

  const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
  const object = scene?.objects.find((candidate) => candidate.id === selectedObjectId);
  const component = (project?.components || []).find((candidate) => candidate.id === selectedComponentId);
  const costumes = component?.costumes ?? object?.costumes ?? [];
  const currentCostumeIndex = component?.currentCostumeIndex ?? object?.currentCostumeIndex ?? 0;
  const currentCostume = costumes[currentCostumeIndex] ?? costumes[0] ?? null;
  const activeCostumeId = currentCostume?.id ?? null;
  const currentObjectTarget = createObjectTarget(selectedSceneId, selectedObjectId, selectedComponentId);
  const currentCostumeTarget = createCostumeTarget(
    selectedSceneId,
    selectedObjectId,
    selectedComponentId,
    activeCostumeId,
  );

  useEffect(() => {
    if (activeCostumeId) {
      setSelectedCostumeIds((current) => (
        current.includes(activeCostumeId) ? current : [activeCostumeId]
      ));
    } else {
      setSelectedCostumeIds([]);
    }
  }, [activeCostumeId]);

  useEffect(() => {
    if (!currentCostume) {
      setScratchImageState(null);
      setLoadError(null);
      latestCommittedImageRef.current = null;
      return;
    }

    let cancelled = false;
    commitSequenceRef.current += 1;
    setIsPreparingImage(true);
    setLoadError(null);
    void createScratchImageStateFromCostume(currentCostume).then((nextState) => {
      if (cancelled) {
        return;
      }
      latestCommittedImageRef.current = nextState.image;
      setScratchImageState(nextState);
    }).catch((error) => {
      if (!cancelled) {
        console.error('Failed to prepare Scratch paint image.', error);
        setLoadError('Scratch Paint could not load this costume.');
      }
    }).finally(() => {
      if (!cancelled) {
        setIsPreparingImage(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentCostume?.id]);

  const replaceCostumeList = useCallback((
    nextCostumes: Costume[],
    nextActiveCostumeId: string | null,
    nextSelectedCostumeIds: string[],
  ) => {
    const nextIndex = nextActiveCostumeId
      ? Math.max(0, nextCostumes.findIndex((costume) => costume.id === nextActiveCostumeId))
      : 0;

    if (selectedComponentId) {
      updateComponent(selectedComponentId, {
        costumes: cloneCostumes(nextCostumes),
        currentCostumeIndex: nextIndex < 0 ? 0 : nextIndex,
      });
      setSelectedCostumeIds(nextSelectedCostumeIds);
      return;
    }

    if (selectedSceneId && selectedObjectId) {
      updateObject(selectedSceneId, selectedObjectId, {
        costumes: cloneCostumes(nextCostumes),
        currentCostumeIndex: nextIndex < 0 ? 0 : nextIndex,
      });
      setSelectedCostumeIds(nextSelectedCostumeIds);
    }
  }, [selectedComponentId, selectedObjectId, selectedSceneId, updateComponent, updateObject]);

  const applyOperationToCurrentObject = useCallback((
    operation: Parameters<typeof applyCostumeEditorOperation>[1]['operation'],
  ) => {
    if (!currentObjectTarget) {
      return false;
    }
    return applyCostumeEditorOperation(currentObjectTarget, { operation });
  }, [applyCostumeEditorOperation, currentObjectTarget]);

  const handleSelectCostume = useCallback((
    costumeId: string,
    event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  ) => {
    if (event.metaKey || event.ctrlKey) {
      setSelectedCostumeIds((current) => (
        current.includes(costumeId)
          ? current.filter((id) => id !== costumeId)
          : [...current, costumeId]
      ));
      return;
    }

    if (event.shiftKey && selectedCostumeIds.length > 0) {
      const anchorId = selectedCostumeIds[selectedCostumeIds.length - 1];
      const anchorIndex = costumes.findIndex((costume) => costume.id === anchorId);
      const nextIndex = costumes.findIndex((costume) => costume.id === costumeId);
      if (anchorIndex >= 0 && nextIndex >= 0) {
        const [start, end] = anchorIndex < nextIndex ? [anchorIndex, nextIndex] : [nextIndex, anchorIndex];
        setSelectedCostumeIds(costumes.slice(start, end + 1).map((costume) => costume.id));
        applyOperationToCurrentObject({ type: 'select', costumeId });
        return;
      }
    }

    setSelectedCostumeIds([costumeId]);
    applyOperationToCurrentObject({ type: 'select', costumeId });
  }, [applyOperationToCurrentObject, costumes, selectedCostumeIds]);

  const handleDeleteCostumes = useCallback((costumeIds: string[]) => {
    const uniqueIds = Array.from(new Set(costumeIds));
    if (uniqueIds.length === 0) {
      return;
    }
    applyOperationToCurrentObject(
      uniqueIds.length === 1
        ? { type: 'remove', costumeId: uniqueIds[0]! }
        : { type: 'removeMany', costumeIds: uniqueIds },
    );
  }, [applyOperationToCurrentObject]);

  const handleConvertCostumeType = useCallback((costumeId: string, nextKind: 'static' | 'animated') => {
    const nextCostumes = costumes.map((costume) => {
      if (costume.id !== costumeId || costume.kind === nextKind) {
        return costume;
      }
      if (nextKind === 'animated') {
        return convertStaticCostumeToAnimated({
          ...costume,
          kind: 'static',
          document: cloneCostumeDocument(costume.document),
        });
      }
      return isAnimatedCostume(costume)
        ? convertAnimatedCostumeToStatic(costume, 0)
        : costume;
    });
    replaceCostumeList(nextCostumes, costumeId, [costumeId]);
  }, [costumes, replaceCostumeList]);

  const handlePrepareCostumeDrag = useCallback((costumeId: string) => {
    if (selectedCostumeIds.includes(costumeId)) {
      return selectedCostumeIds;
    }
    setSelectedCostumeIds([costumeId]);
    return [costumeId];
  }, [selectedCostumeIds]);

  const commitScratchImage = useCallback(async (
    isVector: boolean,
    image: string | ImageData,
    rotationCenterX?: number,
    rotationCenterY?: number,
  ) => {
    if (!currentCostume || !currentCostumeTarget) {
      return;
    }

    const source = typeof image === 'string'
      ? image
      : imageDataToDataUrl(image);
    if (source === latestCommittedImageRef.current) {
      return;
    }

    const sequence = ++commitSequenceRef.current;
    const sourceForComposition = isVector && typeof image === 'string'
      ? svgStringToDataUrl(image)
      : source;
    const composed = await composeScratchImageToCostumeSurface(sourceForComposition, rotationCenterX, rotationCenterY);
    if (sequence !== commitSequenceRef.current) {
      return;
    }

    // Scratch Paint owns the live Paper.js document while mounted. Feeding its exported image
    // back into props during a drag can interrupt legacy pointer state; persist outward only.
    latestCommittedImageRef.current = source;

    const nextState: CostumeEditorPersistedState = {
      kind: 'static',
      assetId: composed.dataUrl,
      bounds: composed.bounds,
      document: createBitmapCostumeDocument(composed.dataUrl, currentCostume.name || 'Layer 1'),
      editorSource: isVector && typeof image === 'string'
        ? createScratchPaintSvgEditorSource({
            source: image,
            rotationCenterX: rotationCenterX ?? SCRATCH_STAGE_CENTER,
            rotationCenterY: rotationCenterY ?? SCRATCH_STAGE_CENTER,
          })
        : null,
    };

    updateCostumeFromEditor(currentCostumeTarget, nextState, {
      history: { source: 'project:update-scratch-paint-costume', allowMerge: true },
    });
  }, [currentCostume, currentCostumeTarget, updateCostumeFromEditor]);

  useEffect(() => {
    const handleFrameMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      if (isFrameReadyMessage(event.data)) {
        setIsFrameReady(true);
        return;
      }

      if (isFrameUpdateMessage(event.data)) {
        if (event.data.imageId !== activeCostumeId) {
          return;
        }
        void commitScratchImage(
          event.data.isVector,
          event.data.image,
          event.data.rotationCenterX,
          event.data.rotationCenterY,
        );
        return;
      }

      if (isFrameRenameMessage(event.data) && activeCostumeId) {
        if (event.data.imageId !== activeCostumeId) {
          return;
        }
        setScratchImageState((current) => current ? { ...current, name: event.data.name } : current);
        applyOperationToCurrentObject({ type: 'rename', costumeId: activeCostumeId, name: event.data.name });
      }
    };

    window.addEventListener('message', handleFrameMessage);
    return () => window.removeEventListener('message', handleFrameMessage);
  }, [activeCostumeId, applyOperationToCurrentObject, commitScratchImage]);

  useEffect(() => {
    if (!isFrameReady || !scratchImageState) {
      return;
    }

    const message: ScratchPaintFrameLoadMessage = {
      type: SCRATCH_PAINT_FRAME_LOAD,
      payload: scratchImageState,
    };
    try {
      iframeRef.current?.contentWindow?.postMessage(message, getScratchPaintFrameTargetOrigin(scratchPaintFrameSrc));
    } catch (error) {
      console.warn('Scratch Paint frame is not ready to receive the costume payload.', error);
      setLoadError('Scratch Paint could not load. Make sure the Scratch Paint frame app is running.');
    }
  }, [isFrameReady, scratchImageState, scratchPaintFrameSrc]);

  useEffect(() => {
    if (!scratchImageState || isFrameReady || loadError) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLoadError('Scratch Paint could not load. Make sure the Scratch Paint frame app is running.');
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [isFrameReady, loadError, scratchImageState]);

  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => undoHistory(),
      redo: () => redoHistory(),
      canUndo: () => canUndoHistory(),
      canRedo: () => canRedoHistory(),
      prepareForPlay: async () => {},
    };
    registerCostumeUndo(handler);
    return () => registerCostumeUndo(null);
  }, [registerCostumeUndo]);

  if (!object && !component) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {NO_OBJECT_SELECTED_MESSAGE}
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden" data-testid="scratch-paint-costume-editor">
      <CostumeList
        costumes={costumes}
        activeCostumeId={activeCostumeId}
        selectedCostumeIds={selectedCostumeIds}
        onSelectCostume={handleSelectCostume}
        onAddCostume={(costume) => applyOperationToCurrentObject({ type: 'add', costume })}
        onDeleteCostumes={handleDeleteCostumes}
        onRenameCostume={(costumeId, name) => applyOperationToCurrentObject({ type: 'rename', costumeId, name })}
        onReplaceCostumes={replaceCostumeList}
        onPrepareCostumeDrag={handlePrepareCostumeDrag}
        onReorderCostumes={(costumeIds, targetIndex) => applyOperationToCurrentObject({ type: 'reorder', costumeIds, targetIndex })}
        onConvertCostumeType={handleConvertCostumeType}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              <TriangleAlert className="size-8 text-destructive" />
              <p>{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                shape="pill"
                onClick={() => {
                  if (currentCostume) {
                    setScratchImageState(null);
                    setLoadError(null);
                    void createScratchImageStateFromCostume(currentCostume).then(setScratchImageState);
                  }
                }}
              >
                Retry
              </Button>
            </div>
          ) : scratchImageState ? (
            <iframe
              ref={handleFrameRef}
              title="Scratch Paint costume editor"
              src={scratchPaintFrameSrc}
              className="min-h-0 flex-1 border-0 bg-card"
              data-testid="scratch-paint-frame"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <Palette className="size-8 opacity-40" />
              <p>{isPreparingImage ? 'Preparing Scratch Paint...' : 'Select a costume to edit.'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
