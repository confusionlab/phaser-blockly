import { useCallback, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { getBitmapFillTexturePreset, type BitmapFillTextureId } from '@/lib/background/bitmapFillCore';
import {
  renderVectorTextureOverlayForObjects,
  resolveSharedTextureSource,
} from '@/lib/costume/costumeVectorTextureRenderer';
import { useFabricVectorTextureOverlay } from '@/components/editors/shared/useFabricVectorTextureOverlay';
import type { CostumeEditorMode } from '@/types';
import { CANVAS_SIZE } from './costumeCanvasShared';

export interface VectorTextureMotionSnapshot {
  canvas: HTMLCanvasElement;
  originTranslationX: number;
  originTranslationY: number;
  target: any;
}

interface UseCostumeCanvasVectorBrushRendererOptions {
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  resolvePreviewObjects?: () => readonly any[];
  stabilizeTextureMotionRef?: MutableRefObject<boolean>;
  vectorTextureMotionSnapshotRef?: MutableRefObject<VectorTextureMotionSnapshot | null>;
}

function getObjectTranslation(target: any) {
  if (!target || typeof target.calcTransformMatrix !== 'function') {
    return null;
  }
  const transform = target.calcTransformMatrix();
  return {
    x: typeof transform[4] === 'number' ? transform[4] : 0,
    y: typeof transform[5] === 'number' ? transform[5] : 0,
  };
}

function projectSceneDeltaToCanvas(
  deltaX: number,
  deltaY: number,
  viewportTransform?: number[] | null,
) {
  if (!viewportTransform) {
    return { x: deltaX, y: deltaY };
  }
  return {
    x: deltaX * (viewportTransform[0] ?? 1) + deltaY * (viewportTransform[2] ?? 0),
    y: deltaX * (viewportTransform[1] ?? 0) + deltaY * (viewportTransform[3] ?? 1),
  };
}

export function useCostumeCanvasVectorBrushRenderer({
  editorModeRef,
  fabricCanvasRef,
  resolvePreviewObjects,
  stabilizeTextureMotionRef,
  vectorTextureMotionSnapshotRef,
}: UseCostumeCanvasVectorBrushRendererOptions) {
  const { renderVectorTextureOverlay } = useFabricVectorTextureOverlay({
    fabricCanvasRef,
    resolveAdditionalObjects: resolvePreviewObjects,
  });

  const resolveBitmapFillTextureSource = useCallback((textureId: BitmapFillTextureId) => {
    const preset = getBitmapFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveSharedTextureSource(texturePath, () => {
      fabricCanvasRef.current?.requestRenderAll();
    });
  }, [fabricCanvasRef]);

  const captureVectorTextureMotionSnapshot = useCallback((target: any) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') {
      return;
    }
    if (vectorTextureMotionSnapshotRef?.current?.target === target) {
      return;
    }
    const translation = getObjectTranslation(target);
    if (!translation) {
      return;
    }

    const snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = CANVAS_SIZE;
    snapshotCanvas.height = CANVAS_SIZE;
    const snapshotCtx = snapshotCanvas.getContext('2d');
    if (!snapshotCtx) {
      return;
    }

    renderVectorTextureOverlayForObjects(snapshotCtx, [target], {
      canvasSize: CANVAS_SIZE,
      contextTransform: fabricCanvas.viewportTransform,
    });
    if (vectorTextureMotionSnapshotRef) {
      vectorTextureMotionSnapshotRef.current = {
        canvas: snapshotCanvas,
        originTranslationX: translation.x,
        originTranslationY: translation.y,
        target,
      };
    }
  }, [editorModeRef, fabricCanvasRef, vectorTextureMotionSnapshotRef]);

  const clearVectorTextureMotionSnapshot = useCallback(() => {
    if (vectorTextureMotionSnapshotRef) {
      vectorTextureMotionSnapshotRef.current = null;
    }
  }, [vectorTextureMotionSnapshotRef]);

  const renderVectorBrushStrokeOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    options: { clear?: boolean } = {},
  ) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (options.clear !== false) {
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    if (!fabricCanvas || editorModeRef.current !== 'vector') {
      return;
    }

    const motionSnapshot = vectorTextureMotionSnapshotRef?.current;
    if (motionSnapshot) {
      const targetStillPresent = (fabricCanvas.getObjects() as any[]).includes(motionSnapshot.target);
      const currentTranslation = getObjectTranslation(motionSnapshot.target);
      if (targetStillPresent && currentTranslation) {
        renderVectorTextureOverlayForObjects(
          ctx,
          [
            ...(fabricCanvas.getObjects() as any[]).filter((obj) => obj !== motionSnapshot.target),
            ...(resolvePreviewObjects?.() ?? []),
          ],
          {
            canvasSize: CANVAS_SIZE,
            clear: false,
            contextTransform: fabricCanvas.viewportTransform,
            stabilizeMotion: stabilizeTextureMotionRef?.current === true,
          },
        );
        const projectedDelta = projectSceneDeltaToCanvas(
          currentTranslation.x - motionSnapshot.originTranslationX,
          currentTranslation.y - motionSnapshot.originTranslationY,
          fabricCanvas.viewportTransform,
        );
        ctx.drawImage(motionSnapshot.canvas, projectedDelta.x, projectedDelta.y);
        return;
      }
      clearVectorTextureMotionSnapshot();
    }

    renderVectorTextureOverlay(ctx, {
      canvasSize: CANVAS_SIZE,
      clear: false,
      stabilizeMotion: stabilizeTextureMotionRef?.current === true,
    });
  }, [
    clearVectorTextureMotionSnapshot,
    editorModeRef,
    fabricCanvasRef,
    renderVectorTextureOverlay,
    resolvePreviewObjects,
    stabilizeTextureMotionRef,
    vectorTextureMotionSnapshotRef,
  ]);

  return {
    captureVectorTextureMotionSnapshot,
    clearVectorTextureMotionSnapshot,
    renderVectorBrushStrokeOverlay,
    resolveBitmapFillTextureSource,
  };
}
