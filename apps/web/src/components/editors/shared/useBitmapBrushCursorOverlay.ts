import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  getBitmapBrushCursorStyle,
  type BitmapBrushKind,
  type BitmapBrushTool,
} from '@/lib/background/brushCore';

interface BitmapBrushCursorOverlayState {
  brushColor: string;
  brushKind: BitmapBrushKind;
  brushOpacity: number;
  brushSize: number;
  displayScale: number;
  enabled: boolean;
  tool: BitmapBrushTool | null;
}

interface UseBitmapBrushCursorOverlayOptions {
  containerRef: RefObject<HTMLElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  resolveCursorState: () => BitmapBrushCursorOverlayState;
}

export function useBitmapBrushCursorOverlay({
  containerRef,
  overlayRef,
  resolveCursorState,
}: UseBitmapBrushCursorOverlayOptions) {
  const brushCursorEnabledRef = useRef(false);
  const brushCursorPosRef = useRef<{ x: number; y: number } | null>(null);

  const syncBrushCursorOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    const {
      brushColor,
      brushKind,
      brushOpacity,
      brushSize,
      displayScale,
      enabled,
      tool,
    } = resolveCursorState();
    const isEnabled = enabled && (tool === 'brush' || tool === 'eraser');
    brushCursorEnabledRef.current = isEnabled;

    if (!isEnabled || !tool) {
      overlay.style.opacity = '0';
      return;
    }

    const cursorStyle = getBitmapBrushCursorStyle(
      tool,
      brushKind,
      brushColor,
      brushSize,
      displayScale,
      tool === 'brush' ? brushOpacity : 1,
    );
    overlay.style.width = `${cursorStyle.diameter}px`;
    overlay.style.height = `${cursorStyle.diameter}px`;
    overlay.style.border = `${cursorStyle.borderWidth}px solid ${cursorStyle.stroke}`;
    overlay.style.background = cursorStyle.fill;
    overlay.style.boxShadow = cursorStyle.boxShadow ?? 'none';

    const pos = brushCursorPosRef.current;
    if (pos) {
      overlay.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
      overlay.style.opacity = '1';
    } else {
      overlay.style.opacity = '0';
    }
  }, [overlayRef, resolveCursorState]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      brushCursorPosRef.current = { x, y };

      const overlay = overlayRef.current;
      if (!overlay) {
        return;
      }
      overlay.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (brushCursorEnabledRef.current) {
        overlay.style.opacity = '1';
      }
    };

    const onPointerLeave = () => {
      brushCursorPosRef.current = null;
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.style.opacity = '0';
      }
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);
    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [containerRef, overlayRef]);

  return {
    syncBrushCursorOverlay,
  };
}
