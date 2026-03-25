import type { MutableRefObject, RefObject } from 'react';
import { CanvasViewportOverlay } from '@/components/editors/shared/CanvasViewportOverlay';
import type { CostumeEditorMode, CostumeLayer } from '@/types';
import type { DrawingTool } from './CostumeToolbar';
import { CostumeActiveLayerHost } from './CostumeActiveLayerHost';
import { CostumeLayerSurface } from './CostumeLayerSurface';
import { CANVAS_SIZE, DEFAULT_COSTUME_PREVIEW_SCALE } from './costumeCanvasShared';

interface CostumeCanvasStageProps {
  activeLayerLocked: boolean;
  activeLayerOpacity: number;
  activeLayerVisible: boolean;
  activeTool: DrawingTool;
  bitmapSelectionCanvasRef: RefObject<HTMLCanvasElement | null>;
  brushCursorOverlayRef: RefObject<HTMLDivElement | null>;
  cameraCenter: { x: number; y: number };
  canRedo: boolean;
  canUndo: boolean;
  canZoomToSelection: boolean;
  colliderCanvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  editorModeState: CostumeEditorMode;
  fabricCanvasHostRef: RefObject<HTMLDivElement | null>;
  hasBitmapFloatingSelection: boolean;
  inactiveLayerSurfaceRefs: MutableRefObject<Map<string, HTMLCanvasElement>>;
  inactiveLayersAboveActive: CostumeLayer[];
  inactiveLayersBelowActive: CostumeLayer[];
  isViewportPanning: boolean;
  maxZoom: number;
  minZoom: number;
  onRedo: () => void;
  onUndo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToActualSize: () => void;
  onZoomToFit: () => void;
  onZoomToSelection: () => void;
  textEditingHostRef: RefObject<HTMLDivElement | null>;
  vectorGuideCanvasRef: RefObject<HTMLCanvasElement | null>;
  vectorStrokeCanvasRef: RefObject<HTMLCanvasElement | null>;
  viewportSize: { width: number; height: number };
  zoom: number;
}

export function CostumeCanvasStage({
  activeLayerLocked,
  activeLayerOpacity,
  activeLayerVisible,
  activeTool,
  bitmapSelectionCanvasRef,
  brushCursorOverlayRef,
  cameraCenter,
  canRedo,
  canUndo,
  canZoomToSelection,
  colliderCanvasRef,
  containerRef,
  editorModeState,
  fabricCanvasHostRef,
  hasBitmapFloatingSelection,
  inactiveLayerSurfaceRefs,
  inactiveLayersAboveActive,
  inactiveLayersBelowActive,
  isViewportPanning,
  maxZoom,
  minZoom,
  onRedo,
  onUndo,
  onZoomIn,
  onZoomOut,
  onZoomToActualSize,
  onZoomToFit,
  onZoomToSelection,
  textEditingHostRef,
  vectorGuideCanvasRef,
  vectorStrokeCanvasRef,
  viewportSize,
  zoom,
}: CostumeCanvasStageProps) {
  const canvasPreviewScale = zoom * DEFAULT_COSTUME_PREVIEW_SCALE;
  const canvasLeft = viewportSize.width / 2 - cameraCenter.x * canvasPreviewScale;
  const canvasTop = viewportSize.height / 2 - cameraCenter.y * canvasPreviewScale;

  const setInactiveLayerSurfaceRef = (layerId: string, node: HTMLCanvasElement | null) => {
    if (node) {
      inactiveLayerSurfaceRefs.current.set(layerId, node);
      return;
    }
    inactiveLayerSurfaceRefs.current.delete(layerId);
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-muted/50">
      <CanvasViewportOverlay
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        zoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
        onZoomToActualSize={onZoomToActualSize}
        onZoomToFit={onZoomToFit}
        onZoomToSelection={onZoomToSelection}
        canZoomToSelection={canZoomToSelection}
      />

      <div
        ref={containerRef}
        tabIndex={-1}
        className="size-full overflow-hidden relative outline-none"
        style={{
          cursor: isViewportPanning ? 'grabbing' : undefined,
          overscrollBehavior: 'contain',
        }}
      >
        <div
          ref={textEditingHostRef}
          aria-hidden="true"
          className="fixed inset-0 overflow-hidden pointer-events-none"
        />

        <div
          className="border shadow-sm absolute top-0 left-0 overflow-hidden checkerboard-bg"
          style={{
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            transform: `translate(${canvasLeft}px, ${canvasTop}px) scale(${canvasPreviewScale})`,
            transformOrigin: 'top left',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
            }}
          >
            {inactiveLayersBelowActive.map((layer) => (
              <CostumeLayerSurface
                key={layer.id}
                ref={(node) => setInactiveLayerSurfaceRef(layer.id, node)}
                layer={layer}
                opacity={layer.visible ? layer.opacity : 0}
              />
            ))}
          </div>

          <CostumeActiveLayerHost
            activeLayerLocked={activeLayerLocked}
            activeLayerOpacity={activeLayerOpacity}
            activeLayerVisible={activeLayerVisible}
            activeTool={activeTool}
            bitmapSelectionCanvasRef={bitmapSelectionCanvasRef}
            colliderCanvasRef={colliderCanvasRef}
            editorModeState={editorModeState}
            fabricCanvasHostRef={fabricCanvasHostRef}
            hasBitmapFloatingSelection={hasBitmapFloatingSelection}
            vectorGuideCanvasRef={vectorGuideCanvasRef}
            vectorStrokeCanvasRef={vectorStrokeCanvasRef}
          />

          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
            }}
          >
            {inactiveLayersAboveActive.map((layer) => (
              <CostumeLayerSurface
                key={layer.id}
                ref={(node) => setInactiveLayerSurfaceRef(layer.id, node)}
                layer={layer}
                opacity={layer.visible ? layer.opacity : 0}
              />
            ))}
          </div>

        </div>

        <div
          ref={brushCursorOverlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 12,
            height: 12,
            borderRadius: '9999px',
            border: '1.5px solid #111111',
            background: 'rgba(255,255,255,0.1)',
            boxShadow: 'none',
            transform: 'translate(-9999px, -9999px)',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 40,
          }}
        />
      </div>
    </div>
  );
}
