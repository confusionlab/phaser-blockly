import { useCallback, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { renderVectorTextureOverlayForFabricCanvas } from '@/lib/costume/costumeVectorTextureRenderer';

interface UseFabricVectorTextureOverlayOptions {
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  resolveAdditionalObjects?: () => readonly any[];
}

export function useFabricVectorTextureOverlay({
  fabricCanvasRef,
  resolveAdditionalObjects,
}: UseFabricVectorTextureOverlayOptions) {
  const renderVectorTextureOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    options: {
      canvasSize?: number;
      canvasWidth?: number;
      canvasHeight?: number;
      clear?: boolean;
    } = {},
  ) => {
    const fabricCanvas = fabricCanvasRef.current;
    const canvasWidth = options.canvasWidth ?? options.canvasSize ?? ctx.canvas.width;
    const canvasHeight = options.canvasHeight ?? options.canvasSize ?? ctx.canvas.height;
    if (options.clear !== false) {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    }
    if (!fabricCanvas) {
      return;
    }

    renderVectorTextureOverlayForFabricCanvas(ctx, fabricCanvas, {
      ...options,
      clear: false,
      additionalObjects: resolveAdditionalObjects?.() ?? [],
      onTextureSourceReady: () => {
        fabricCanvasRef.current?.requestRenderAll();
      },
    });
  }, [fabricCanvasRef, resolveAdditionalObjects]);

  return {
    renderVectorTextureOverlay,
  };
}
