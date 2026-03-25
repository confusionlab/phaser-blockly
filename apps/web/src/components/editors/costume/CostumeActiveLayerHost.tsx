import type { RefObject } from 'react';
import type { CostumeEditorMode } from '@/types';
import type { DrawingTool } from './CostumeToolbar';
import { CANVAS_SIZE } from './costumeCanvasShared';

interface CostumeActiveLayerHostProps {
  activeLayerLocked: boolean;
  activeLayerOpacity: number;
  activeLayerVisible: boolean;
  activeTool: DrawingTool;
  bitmapSelectionCanvasRef: RefObject<HTMLCanvasElement | null>;
  colliderCanvasRef: RefObject<HTMLCanvasElement | null>;
  editorModeState: CostumeEditorMode;
  fabricCanvasHostRef: RefObject<HTMLDivElement | null>;
  hasBitmapFloatingSelection: boolean;
  hostReady: boolean;
  layerZIndex: number;
  vectorGuideCanvasRef: RefObject<HTMLCanvasElement | null>;
  vectorStrokeCanvasRef: RefObject<HTMLCanvasElement | null>;
}

export function CostumeActiveLayerHost({
  activeLayerLocked,
  activeLayerOpacity,
  activeLayerVisible,
  activeTool,
  bitmapSelectionCanvasRef,
  colliderCanvasRef,
  editorModeState,
  fabricCanvasHostRef,
  hasBitmapFloatingSelection,
  hostReady,
  layerZIndex,
  vectorGuideCanvasRef,
  vectorStrokeCanvasRef,
}: CostumeActiveLayerHostProps) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: layerZIndex,
        }}
      >
        <div
          ref={fabricCanvasHostRef}
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

      <canvas
        ref={vectorGuideCanvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          pointerEvents: 'none',
        }}
      />

      <canvas
        ref={bitmapSelectionCanvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          pointerEvents: editorModeState === 'bitmap' && (
            activeTool === 'select' ||
            (activeTool === 'box-select' && activeLayerVisible && !hasBitmapFloatingSelection && !activeLayerLocked)
          ) ? 'auto' : 'none',
          opacity: hostReady && activeLayerVisible ? activeLayerOpacity : 0,
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
        }}
      />
    </>
  );
}
