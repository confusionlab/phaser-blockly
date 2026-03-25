import { useCallback, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { getBitmapFillTexturePreset, type BitmapFillTextureId } from '@/lib/background/bitmapFillCore';
import {
  renderVectorTextureOverlayForFabricCanvas,
  resolveSharedTextureSource,
} from '@/lib/costume/costumeVectorTextureRenderer';
import type { CostumeEditorMode } from '@/types';
import { CANVAS_SIZE } from './costumeCanvasShared';

interface UseCostumeCanvasVectorBrushRendererOptions {
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
}

export function useCostumeCanvasVectorBrushRenderer({
  editorModeRef,
  fabricCanvasRef,
}: UseCostumeCanvasVectorBrushRendererOptions) {
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

    renderVectorTextureOverlayForFabricCanvas(ctx, fabricCanvas, {
      canvasSize: CANVAS_SIZE,
      clear: false,
      onTextureSourceReady: () => {
        fabricCanvasRef.current?.requestRenderAll();
      },
    });
  }, [editorModeRef, fabricCanvasRef]);

  return {
    renderVectorBrushStrokeOverlay,
    resolveBitmapFillTextureSource,
  };
}
