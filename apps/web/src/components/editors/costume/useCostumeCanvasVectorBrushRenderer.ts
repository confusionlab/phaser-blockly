import { useCallback, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { getBitmapFillTexturePreset, type BitmapFillTextureId } from '@/lib/background/bitmapFillCore';
import { resolveSharedTextureSource } from '@/lib/costume/costumeVectorTextureRenderer';
import { useFabricVectorTextureOverlay } from '@/components/editors/shared/useFabricVectorTextureOverlay';
import type { CostumeEditorMode } from '@/types';
import { CANVAS_SIZE } from './costumeCanvasShared';

interface UseCostumeCanvasVectorBrushRendererOptions {
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  resolvePreviewObjects?: () => readonly any[];
  stabilizeTextureMotionRef?: MutableRefObject<boolean>;
}

export function useCostumeCanvasVectorBrushRenderer({
  editorModeRef,
  fabricCanvasRef,
  resolvePreviewObjects,
  stabilizeTextureMotionRef,
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

    renderVectorTextureOverlay(ctx, {
      canvasSize: CANVAS_SIZE,
      clear: false,
      stabilizeMotion: stabilizeTextureMotionRef?.current === true,
    });
  }, [editorModeRef, fabricCanvasRef, renderVectorTextureOverlay, stabilizeTextureMotionRef]);

  return {
    renderVectorBrushStrokeOverlay,
    resolveBitmapFillTextureSource,
  };
}
