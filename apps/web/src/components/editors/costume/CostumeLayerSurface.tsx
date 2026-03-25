import { forwardRef, memo, useCallback, useEffect, useRef, type CSSProperties, type ForwardedRef } from 'react';
import type { CostumeLayer } from '@/types';
import { COSTUME_CANVAS_SIZE } from '@/lib/costume/costumeDocument';
import {
  getCostumeLayerRenderSignature,
  renderCostumeLayerIntoCanvas,
} from '@/lib/costume/costumeDocumentRender';

interface CostumeLayerSurfaceProps {
  layer: CostumeLayer;
  opacity: number;
  style?: CSSProperties;
}

function assignCanvasRef(
  ref: ForwardedRef<HTMLCanvasElement>,
  node: HTMLCanvasElement | null,
) {
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  if (ref) {
    ref.current = node;
  }
}

export const CostumeLayerSurface = memo(forwardRef<HTMLCanvasElement, CostumeLayerSurfaceProps>(function CostumeLayerSurface(
  { layer, opacity, style },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    assignCanvasRef(forwardedRef, node);
  }, [forwardedRef]);

  const renderSourceKey = getCostumeLayerRenderSignature(layer) ?? layer.id;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    void renderCostumeLayerIntoCanvas(canvas, layer).then(() => {
      if (cancelled) {
        return;
      }
    }).catch((error) => {
      if (!cancelled) {
        console.warn('Failed to render costume layer surface.', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [layer.id, renderSourceKey]);

  return (
    <canvas
      ref={setCanvasRef}
      width={COSTUME_CANVAS_SIZE}
      height={COSTUME_CANVAS_SIZE}
      aria-hidden="true"
      style={{
        width: COSTUME_CANVAS_SIZE,
        height: COSTUME_CANVAS_SIZE,
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        userSelect: 'none',
        opacity,
        ...style,
      }}
    />
  );
}));

CostumeLayerSurface.displayName = 'CostumeLayerSurface';
