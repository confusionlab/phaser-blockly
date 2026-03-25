import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { FabricImage, type Canvas as FabricCanvas } from 'fabric';
import { calculateBoundsFromImageData } from '@/utils/imageBounds';
import type { CostumeEditorMode } from '@/types';
import {
  VECTOR_SELECTION_BORDER_OPACITY,
  VECTOR_SELECTION_BORDER_SCALE,
  VECTOR_SELECTION_COLOR,
  VECTOR_SELECTION_CORNER_COLOR,
  VECTOR_SELECTION_CORNER_STROKE,
} from './costumeCanvasShared';
import type { DrawingTool } from './CostumeToolbar';

interface UseCostumeCanvasBitmapSelectionControllerOptions {
  activeTool: DrawingTool;
  bitmapFloatingObjectRef: MutableRefObject<any | null>;
  bitmapMarqueeRectRef: MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
  bitmapSelectionBusyRef: MutableRefObject<boolean>;
  bitmapSelectionCanvasRef: RefObject<HTMLCanvasElement | null>;
  bitmapSelectionDragModeRef: MutableRefObject<'none' | 'marquee'>;
  bitmapSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  commitBitmapSelection: () => Promise<boolean>;
  configureCanvasForTool: () => void;
  drawBitmapSelectionOverlay: () => void;
  editorModeState: CostumeEditorMode;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getSelectionMousePos: (event: MouseEvent) => { x: number; y: number };
  hasBitmapFloatingSelection: boolean;
  loadBitmapLayer: (dataUrl: string, selectable: boolean, requestId?: number) => Promise<boolean>;
  setHasBitmapFloatingSelection: Dispatch<SetStateAction<boolean>>;
  syncSelectionState: () => void;
}

export function useCostumeCanvasBitmapSelectionController({
  activeTool,
  bitmapFloatingObjectRef,
  bitmapMarqueeRectRef,
  bitmapSelectionBusyRef,
  bitmapSelectionCanvasRef,
  bitmapSelectionDragModeRef,
  bitmapSelectionStartRef,
  commitBitmapSelection,
  configureCanvasForTool,
  drawBitmapSelectionOverlay,
  editorModeState,
  fabricCanvasRef,
  getSelectionMousePos,
  hasBitmapFloatingSelection,
  loadBitmapLayer,
  setHasBitmapFloatingSelection,
  syncSelectionState,
}: UseCostumeCanvasBitmapSelectionControllerOptions) {
  useEffect(() => {
    const overlayCanvas = bitmapSelectionCanvasRef.current;
    if (!overlayCanvas) return;
    const isBitmapSelect = editorModeState === 'bitmap' && activeTool === 'select';
    if (!isBitmapSelect || hasBitmapFloatingSelection) {
      drawBitmapSelectionOverlay();
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (bitmapSelectionBusyRef.current) return;
      const pos = getSelectionMousePos(event);
      bitmapSelectionDragModeRef.current = 'marquee';
      bitmapSelectionStartRef.current = pos;
      bitmapMarqueeRectRef.current = {
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
      };
      drawBitmapSelectionOverlay();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (bitmapSelectionBusyRef.current) return;
      const mode = bitmapSelectionDragModeRef.current;
      if (mode === 'none') return;
      const pos = getSelectionMousePos(event);

      const start = bitmapSelectionStartRef.current;
      if (!start) return;
      const x = Math.min(start.x, pos.x);
      const y = Math.min(start.y, pos.y);
      const width = Math.abs(pos.x - start.x);
      const height = Math.abs(pos.y - start.y);
      bitmapMarqueeRectRef.current = { x, y, width, height };
      drawBitmapSelectionOverlay();
    };

    const handleMouseUp = async () => {
      const mode = bitmapSelectionDragModeRef.current;
      if (mode === 'none') return;
      bitmapSelectionDragModeRef.current = 'none';

      const marquee = bitmapMarqueeRectRef.current;
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      drawBitmapSelectionOverlay();

      if (!marquee || marquee.width < 1 || marquee.height < 1) {
        return;
      }

      const width = Math.max(1, Math.floor(marquee.width));
      const height = Math.max(1, Math.floor(marquee.height));
      const x = Math.floor(marquee.x);
      const y = Math.floor(marquee.y);

      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || bitmapSelectionBusyRef.current) return;

      bitmapSelectionBusyRef.current = true;
      try {
        const raster = fabricCanvas.toCanvasElement(1);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) return;

        const selectionImageData = rasterCtx.getImageData(x, y, width, height);
        const visibleSelectionBounds = calculateBoundsFromImageData(selectionImageData, 0);
        if (!visibleSelectionBounds) {
          return;
        }

        rasterCtx.clearRect(x, y, width, height);
        const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
        if (!loaded) return;

        const selectionCanvas = document.createElement('canvas');
        selectionCanvas.width = visibleSelectionBounds.width;
        selectionCanvas.height = visibleSelectionBounds.height;
        const selectionCtx = selectionCanvas.getContext('2d');
        if (!selectionCtx) return;
        selectionCtx.putImageData(
          selectionImageData,
          -visibleSelectionBounds.x,
          -visibleSelectionBounds.y,
        );

        const floatingImage = await FabricImage.fromURL(selectionCanvas.toDataURL('image/png'));
        floatingImage.set({
          left: x + visibleSelectionBounds.x + visibleSelectionBounds.width / 2,
          top: y + visibleSelectionBounds.y + visibleSelectionBounds.height / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockMovementX: false,
          lockMovementY: false,
          lockRotation: false,
          lockScalingX: false,
          lockScalingY: false,
        } as any);
        (floatingImage as any).__bitmapFloatingSelection = true;
        floatingImage.borderColor = VECTOR_SELECTION_COLOR;
        floatingImage.borderScaleFactor = VECTOR_SELECTION_BORDER_SCALE;
        floatingImage.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
        floatingImage.cornerStyle = 'rect';
        floatingImage.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
        floatingImage.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
        floatingImage.cornerSize = 12;
        floatingImage.transparentCorners = false;

        fabricCanvas.add(floatingImage);
        fabricCanvas.setActiveObject(floatingImage);
        bitmapFloatingObjectRef.current = floatingImage;
        setHasBitmapFloatingSelection(true);
        syncSelectionState();
        configureCanvasForTool();
        fabricCanvas.requestRenderAll();
        drawBitmapSelectionOverlay();
      } finally {
        bitmapSelectionBusyRef.current = false;
      }
    };

    overlayCanvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      overlayCanvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    activeTool,
    bitmapFloatingObjectRef,
    bitmapMarqueeRectRef,
    bitmapSelectionBusyRef,
    bitmapSelectionCanvasRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    configureCanvasForTool,
    drawBitmapSelectionOverlay,
    editorModeState,
    fabricCanvasRef,
    getSelectionMousePos,
    hasBitmapFloatingSelection,
    loadBitmapLayer,
    setHasBitmapFloatingSelection,
    syncSelectionState,
  ]);

  useEffect(() => {
    if (editorModeState === 'bitmap' && activeTool === 'select') {
      return;
    }
    if (bitmapFloatingObjectRef.current) {
      void commitBitmapSelection();
      return;
    }
    drawBitmapSelectionOverlay();
  }, [activeTool, bitmapFloatingObjectRef, commitBitmapSelection, drawBitmapSelectionOverlay, editorModeState]);
}
