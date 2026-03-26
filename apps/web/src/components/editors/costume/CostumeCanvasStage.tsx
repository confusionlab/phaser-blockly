import type { MutableRefObject, Ref, RefObject } from 'react';
import { CanvasViewportOverlay } from '@/components/editors/shared/CanvasViewportOverlay';
import type { CostumeEditorMode, CostumeLayer } from '@/types';
import type { DrawingTool } from './CostumeToolbar';
import { CostumeActiveLayerOverlays, CostumeActiveLayerVisual } from './CostumeActiveLayerHost';
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
  documentLayers: CostumeLayer[];
  editorModeState: CostumeEditorMode;
  fabricCanvasHostRef: Ref<HTMLDivElement>;
  hasBitmapFloatingSelection: boolean;
  hostedLayerId: string | null;
  hostedLayerReady: boolean;
  isViewportPanning: boolean;
  layerSurfaceRefs: MutableRefObject<Map<string, HTMLCanvasElement>>;
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
  documentLayers,
  editorModeState,
  fabricCanvasHostRef,
  hasBitmapFloatingSelection,
  hostedLayerId,
  hostedLayerReady,
  isViewportPanning,
  layerSurfaceRefs,
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
  const hostedLayerIndex = documentLayers.findIndex((layer) => layer.id === hostedLayerId);
  const hostedLayerVisualZIndex = Math.max(1, hostedLayerIndex >= 0 ? hostedLayerIndex * 2 + 1 : documentLayers.length * 2 + 1);

  const setLayerSurfaceRef = (layerId: string, node: HTMLCanvasElement | null) => {
    if (node) {
      layerSurfaceRefs.current.set(layerId, node);
      return;
    }
    layerSurfaceRefs.current.delete(layerId);
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
          data-testid="costume-canvas-surface"
          className="border shadow-sm absolute top-0 left-0 overflow-hidden checkerboard-bg-soft"
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
            {documentLayers.map((layer, index) => (
              <div
                key={layer.id}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                }}
              >
                <CostumeLayerSurface
                  ref={(node) => setLayerSurfaceRef(layer.id, node)}
                  layer={layer}
                  opacity={hostedLayerReady && layer.id === hostedLayerId
                    ? 0
                    : layer.visible
                      ? layer.opacity
                      : 0}
                  style={{ zIndex: index * 2 }}
                />
              </div>
            ))}
          </div>

          {hostedLayerId ? (
            <CostumeActiveLayerVisual
              activeLayerOpacity={activeLayerOpacity}
              activeLayerVisible={activeLayerVisible}
              fabricCanvasHostRef={fabricCanvasHostRef}
              hostReady={hostedLayerReady}
              layerZIndex={hostedLayerVisualZIndex}
              vectorStrokeCanvasRef={vectorStrokeCanvasRef}
            />
          ) : null}

          <CostumeActiveLayerOverlays
            activeLayerLocked={activeLayerLocked}
            activeLayerVisible={activeLayerVisible}
            activeTool={activeTool}
            bitmapSelectionCanvasRef={bitmapSelectionCanvasRef}
            colliderCanvasRef={colliderCanvasRef}
            editorModeState={editorModeState}
            hasBitmapFloatingSelection={hasBitmapFloatingSelection}
            layerZIndex={Math.max(2, hostedLayerIndex >= 0 ? hostedLayerIndex * 2 + 2 : documentLayers.length * 2 + 2)}
            vectorGuideCanvasRef={vectorGuideCanvasRef}
          />

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
