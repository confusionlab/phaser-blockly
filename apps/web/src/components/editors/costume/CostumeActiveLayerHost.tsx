import type { Ref, RefObject } from 'react';
import type { CostumeEditorMode } from '@/types';
import type { DrawingTool } from './CostumeToolbar';
import { CANVAS_SIZE } from './costumeCanvasShared';

interface CostumeActiveLayerVisualProps {
  activeLayerOpacity: number;
  activeLayerVisible: boolean;
  fabricCanvasHostRef: Ref<HTMLDivElement>;
  hostReady: boolean;
  layerZIndex: number;
  vectorStrokeCanvasRef: RefObject<HTMLCanvasElement | null>;
}

interface CostumeActiveLayerOverlaysProps {
  activeLayerLocked: boolean;
  activeLayerVisible: boolean;
  activeTool: DrawingTool;
  bitmapSelectionCanvasRef: RefObject<HTMLCanvasElement | null>;
  colliderCanvasRef: RefObject<HTMLCanvasElement | null>;
  editorModeState: CostumeEditorMode;
  hasBitmapFloatingSelection: boolean;
  layerZIndex: number;
}

export function CostumeActiveLayerVisual({
  activeLayerOpacity,
  activeLayerVisible,
  fabricCanvasHostRef,
  hostReady,
  layerZIndex,
  vectorStrokeCanvasRef,
}: CostumeActiveLayerVisualProps) {
  return (
    <div
      data-testid="costume-active-layer-visual"
      data-host-ready={hostReady ? 'true' : 'false'}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: layerZIndex,
      }}
    >
      <div
        ref={fabricCanvasHostRef}
        data-testid="costume-active-layer-host"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
        }}
      />

      <canvas
        ref={vectorStrokeCanvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          pointerEvents: 'none',
          opacity: hostReady && activeLayerVisible ? activeLayerOpacity : 0,
        }}
      />
    </div>
  );
}

export function CostumeActiveLayerOverlays({
  activeLayerLocked,
  activeLayerVisible,
  activeTool,
  bitmapSelectionCanvasRef,
  colliderCanvasRef,
  editorModeState,
  hasBitmapFloatingSelection,
  layerZIndex,
}: CostumeActiveLayerOverlaysProps) {
  return (
    <>
      <canvas
        ref={bitmapSelectionCanvasRef}
        data-testid="costume-bitmap-selection-overlay"
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          pointerEvents: editorModeState === 'bitmap' &&
            activeTool === 'select' &&
            activeLayerVisible &&
            !hasBitmapFloatingSelection &&
            !activeLayerLocked
            ? 'auto'
            : 'none',
          opacity: activeLayerVisible ? 1 : 0,
          zIndex: layerZIndex + 1,
        }}
      />

      <canvas
        ref={colliderCanvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          pointerEvents: activeTool === 'collider' ? 'auto' : 'none',
          zIndex: layerZIndex + 2,
        }}
      />
    </>
  );
}
