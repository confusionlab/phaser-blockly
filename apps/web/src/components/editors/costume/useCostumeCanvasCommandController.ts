import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import { applyBitmapBucketFill } from '@/lib/background/bitmapFillCore';
import { useFabricVectorClipboardCommands } from '@/components/editors/shared/useFabricVectorClipboardCommands';
import { getCanvas2dContext } from '@/utils/canvas2d';
import {
  createEmptyCostumeVectorDocument,
  resolveActiveCostumeLayerEditorLoadState,
} from '@/lib/costume/costumeDocument';
import { optimizeCostumeRasterCanvas } from '@/lib/costume/costumeAssetOptimization';
import type {
  AlignAction,
  BitmapFillStyle,
  MoveOrderAction,
  SelectionFlipAxis,
  TextToolStyle,
  VectorStyleCapabilities,
  VectorToolStyleSelectionSnapshot,
  VectorToolStyle,
} from './CostumeToolbar';
import type {
  CostumeAssetFrame,
  CostumeDocument,
  CostumeEditorMode,
  CostumeVectorDocument,
} from '@/types';
import { CANVAS_SIZE, type CanvasSelectionBoundsSnapshot } from './costumeCanvasShared';
import {
  applyVectorStyleUpdatesToSelection,
  cloneFabricObjectWithVectorStyle,
  getVectorStyleSelectionSnapshot,
  getVectorStyleCapabilitiesForSelection,
  isTextObject,
  VECTOR_JSON_EXTRA_PROPS,
} from './costumeCanvasVectorRuntime';
import { useCostumeCanvasSelectionTransformCommands } from './useCostumeCanvasSelectionTransformCommands';

interface UseCostumeCanvasCommandControllerOptions {
  activeDocumentLayerId?: string;
  activeLayerOpacity: number;
  activeLayerVisible: boolean;
  bitmapFillStyleRef: MutableRefObject<BitmapFillStyle>;
  bitmapMarqueeRectRef: MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
  bitmapSelectionCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  bitmapSelectionBusyRef: MutableRefObject<boolean>;
  bitmapSelectionDragModeRef: MutableRefObject<'none' | 'marquee'>;
  bitmapSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  brushColorRef: MutableRefObject<string>;
  commitHostedLayerSurfaceSnapshot: (layerId: string | null) => void;
  documentLayers: CostumeDocument['layers'];
  drawBitmapSelectionOverlay: () => void;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getActiveLayerCanvasElement: () => HTMLCanvasElement;
  getBitmapFloatingSelectionObject: () => any | null;
  getSelectionBoundsSnapshot: () => CanvasSelectionBoundsSnapshot | null;
  hostedLayerIdRef: MutableRefObject<string | null>;
  isLoadRequestActive: (requestId?: number) => boolean;
  isHostedLayerReadyRef: MutableRefObject<boolean>;
  layerSurfaceRefs: MutableRefObject<Map<string, HTMLCanvasElement>>;
  loadBitmapAsSingleVectorImage: (bitmapCanvas: HTMLCanvasElement, requestId?: number) => Promise<boolean>;
  loadBitmapLayer: (
    dataUrl: string,
    selectable: boolean,
    requestId?: number,
    options?: { assetFrame?: CostumeAssetFrame | null },
  ) => Promise<boolean>;
  loadRequestIdRef: MutableRefObject<number>;
  loadedSessionKeyRef: MutableRefObject<string | null>;
  normalizeCanvasVectorStrokeUniform: () => boolean;
  onTextSelectionChangeRef: MutableRefObject<((hasTextSelection: boolean) => void) | undefined>;
  onTextStyleSyncRef: MutableRefObject<((updates: Partial<TextToolStyle>) => void) | undefined>;
  onVectorStyleCapabilitiesSyncRef: MutableRefObject<((capabilities: VectorStyleCapabilities) => void) | undefined>;
  onVectorStyleSyncRef: MutableRefObject<((snapshot: VectorToolStyleSelectionSnapshot) => boolean) | undefined>;
  rebaseHistoryToCurrentSnapshot: (sessionKey?: string | null) => void;
  resolveBitmapFillTextureSource: (textureId: BitmapFillStyle['textureId']) => CanvasImageSource | null;
  restoreCanvasSelection: (selectedObjects: any[]) => void;
  saveHistory: () => void;
  setEditorMode: (mode: CostumeEditorMode) => void;
  setBitmapFloatingSelectionObject: (nextObject: any | null, options?: { activate?: boolean; syncState?: boolean }) => void;
  setHostedLayerId: (layerId: string | null) => void;
  setHostedLayerReady: (ready: boolean) => void;
  markHostedLayerRenderPending: () => void;
  suppressBitmapSelectionAutoCommitRef: MutableRefObject<boolean>;
  suppressHistoryRef: MutableRefObject<boolean>;
  syncSelectionState: () => void;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  vectorGroupEditingPathRef: MutableRefObject<any[]>;
  waitForFabricCanvas: (requestId?: number) => Promise<FabricCanvas | null>;
}

function getChangedVectorStyleUpdates(
  previous: VectorToolStyle,
  next: VectorToolStyle,
): Partial<VectorToolStyle> {
  const updates: Partial<VectorToolStyle> = {};

  if (previous.fillColor !== next.fillColor) {
    updates.fillColor = next.fillColor;
  }
  if (previous.fillTextureId !== next.fillTextureId) {
    updates.fillTextureId = next.fillTextureId;
  }
  if (previous.fillOpacity !== next.fillOpacity) {
    updates.fillOpacity = next.fillOpacity;
  }
  if (previous.strokeColor !== next.strokeColor) {
    updates.strokeColor = next.strokeColor;
  }
  if (previous.strokeOpacity !== next.strokeOpacity) {
    updates.strokeOpacity = next.strokeOpacity;
  }
  if (previous.strokeWidth !== next.strokeWidth) {
    updates.strokeWidth = next.strokeWidth;
  }
  if (previous.strokeBrushId !== next.strokeBrushId) {
    updates.strokeBrushId = next.strokeBrushId;
  }

  return updates;
}

export function useCostumeCanvasCommandController({
  activeDocumentLayerId,
  activeLayerOpacity,
  activeLayerVisible,
  bitmapFillStyleRef,
  bitmapMarqueeRectRef,
  bitmapSelectionCanvasRef,
  bitmapSelectionBusyRef,
  bitmapSelectionDragModeRef,
  bitmapSelectionStartRef,
  brushColorRef,
  commitHostedLayerSurfaceSnapshot,
  documentLayers,
  drawBitmapSelectionOverlay,
  editorModeRef,
  fabricCanvasRef,
  getActiveLayerCanvasElement,
  getBitmapFloatingSelectionObject,
  getSelectionBoundsSnapshot,
  hostedLayerIdRef,
  isLoadRequestActive,
  isHostedLayerReadyRef,
  layerSurfaceRefs,
  loadBitmapAsSingleVectorImage,
  loadBitmapLayer,
  loadRequestIdRef,
  loadedSessionKeyRef,
  normalizeCanvasVectorStrokeUniform,
  onTextSelectionChangeRef,
  onTextStyleSyncRef,
  onVectorStyleCapabilitiesSyncRef,
  onVectorStyleSyncRef,
  rebaseHistoryToCurrentSnapshot,
  resolveBitmapFillTextureSource,
  restoreCanvasSelection,
  saveHistory,
  setEditorMode,
  setBitmapFloatingSelectionObject,
  setHostedLayerId,
  setHostedLayerReady,
  markHostedLayerRenderPending,
  suppressBitmapSelectionAutoCommitRef,
  suppressHistoryRef,
  syncSelectionState,
  textStyle,
  vectorStyle,
  vectorGroupEditingPathRef,
  waitForFabricCanvas,
}: UseCostumeCanvasCommandControllerOptions) {
  const pendingVectorStyleHistorySaveRef = useRef<number | null>(null);
  const skipNextSelectionSyncedVectorStyleApplyRef = useRef(false);

  const scheduleVectorStyleHistorySave = useCallback(() => {
    if (typeof window === 'undefined') {
      saveHistory();
      return;
    }

    if (pendingVectorStyleHistorySaveRef.current !== null) {
      window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
    }

    pendingVectorStyleHistorySaveRef.current = window.setTimeout(() => {
      pendingVectorStyleHistorySaveRef.current = null;
      saveHistory();
    }, 120);
  }, [saveHistory]);

  useEffect(() => {
    return () => {
      if (pendingVectorStyleHistorySaveRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
      }
    };
  }, []);

  const getComposedCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    const hostedLayerId = hostedLayerIdRef.current ?? activeDocumentLayerId;
    const canRenderHostedLayer = !!fabricCanvas && isHostedLayerReadyRef.current;
    const baseCanvas = canRenderHostedLayer ? getActiveLayerCanvasElement() : null;
    const composed = document.createElement('canvas');
    composed.width = CANVAS_SIZE;
    composed.height = CANVAS_SIZE;
    const composedCtx = getCanvas2dContext(composed, 'readback');
    if (!composedCtx) {
      return baseCanvas ?? composed;
    }

    for (const layer of documentLayers) {
      if (canRenderHostedLayer && layer.id === hostedLayerId && baseCanvas) {
        composedCtx.save();
        composedCtx.globalAlpha = activeLayerVisible ? activeLayerOpacity : 0;
        composedCtx.drawImage(baseCanvas, 0, 0);
        composedCtx.restore();
        continue;
      }

      if (!layer.visible || layer.opacity <= 0) {
        continue;
      }

      const layerSurface = layerSurfaceRefs.current.get(layer.id);
      if (!layerSurface) {
        continue;
      }

      composedCtx.save();
      composedCtx.globalAlpha = layer.opacity;
      composedCtx.drawImage(layerSurface, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      composedCtx.restore();
    }

    return composed;
  }, [
    activeDocumentLayerId,
    activeLayerOpacity,
    activeLayerVisible,
    documentLayers,
    fabricCanvasRef,
    getActiveLayerCanvasElement,
    hostedLayerIdRef,
    isHostedLayerReadyRef,
    layerSurfaceRefs,
  ]);

  const getSelectionMousePos = useCallback((event: MouseEvent) => {
    const canvas = bitmapSelectionCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: Math.max(0, Math.min(CANVAS_SIZE, (event.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(CANVAS_SIZE, (event.clientY - rect.top) * scaleY)),
    };
  }, [bitmapSelectionCanvasRef]);

  const {
    alignSelection: alignCanvasSelection,
    deleteSelection: deleteCanvasSelection,
    groupSelection: groupCanvasSelection,
    moveSelectionOrder: moveCanvasSelectionOrder,
    nudgeSelection: nudgeCanvasSelection,
    flipSelection: flipCanvasSelection,
    rotateSelection: rotateCanvasSelection,
    ungroupSelection: ungroupCanvasSelection,
  } = useCostumeCanvasSelectionTransformCommands({
    fabricCanvasRef,
    getAlignmentBounds: () => ({
      left: 0,
      top: 0,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
    }),
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    saveHistory,
    syncSelectionState,
  });

  const deleteBitmapFloatingSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = getBitmapFloatingSelectionObject();
    if (!fabricCanvas || !floatingObject) return false;
    if (editorModeRef.current !== 'bitmap') return false;
    if (bitmapSelectionBusyRef.current) return false;

    suppressBitmapSelectionAutoCommitRef.current = true;
    try {
      if (fabricCanvas.getActiveObject() === floatingObject) {
        fabricCanvas.discardActiveObject();
      }

      fabricCanvas.remove(floatingObject);
      setBitmapFloatingSelectionObject(null, { syncState: false });
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      bitmapSelectionDragModeRef.current = 'none';
      drawBitmapSelectionOverlay();
      fabricCanvas.requestRenderAll();
      syncSelectionState();
      saveHistory();
      return true;
    } finally {
      queueMicrotask(() => {
        suppressBitmapSelectionAutoCommitRef.current = false;
      });
    }
  }, [
    bitmapMarqueeRectRef,
    bitmapSelectionBusyRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    editorModeRef,
    fabricCanvasRef,
    getBitmapFloatingSelectionObject,
    saveHistory,
    setBitmapFloatingSelectionObject,
    suppressBitmapSelectionAutoCommitRef,
    syncSelectionState,
  ]);

  const syncTextStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || !isTextObject(activeObject)) return;
    const textObj = activeObject as any;

    onTextStyleSyncRef.current?.({
      fontFamily: typeof textObj.fontFamily === 'string' ? textObj.fontFamily : undefined,
      fontSize: typeof textObj.fontSize === 'number' ? textObj.fontSize : undefined,
      fontWeight: textObj.fontWeight === 'bold' ? 'bold' : 'normal',
      fontStyle: textObj.fontStyle === 'italic' ? 'italic' : 'normal',
      underline: textObj.underline === true,
      textAlign: textObj.textAlign === 'center' || textObj.textAlign === 'right' ? textObj.textAlign : 'left',
      opacity: typeof textObj.opacity === 'number' ? textObj.opacity : undefined,
    });
  }, [fabricCanvasRef, onTextStyleSyncRef]);

  const syncVectorStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onVectorStyleCapabilitiesSyncRef.current?.(getVectorStyleCapabilitiesForSelection(activeObject));
    const snapshot = getVectorStyleSelectionSnapshot(activeObject);
    if (!snapshot) return;

    skipNextSelectionSyncedVectorStyleApplyRef.current = onVectorStyleSyncRef.current?.(snapshot) === true;
  }, [fabricCanvasRef, onVectorStyleCapabilitiesSyncRef, onVectorStyleSyncRef]);

  const syncTextSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onTextSelectionChangeRef.current?.(!!activeObject && isTextObject(activeObject));
  }, [fabricCanvasRef, onTextSelectionChangeRef]);

  const applyFill = useCallback(async (x: number, y: number) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'bitmap') return;

    const raster = fabricCanvas.toCanvasElement(1);
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const didFill = applyBitmapBucketFill(
      imageData,
      Math.floor(x),
      Math.floor(y),
      {
        fillColor: brushColorRef.current,
        textureId: bitmapFillStyleRef.current.textureId,
      },
      {
        textureSource: resolveBitmapFillTextureSource(bitmapFillStyleRef.current.textureId),
      },
    );
    if (!didFill) {
      return;
    }

    ctx.putImageData(imageData, 0, 0);
    const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
    if (!loaded) return;
    saveHistory();
  }, [
    bitmapFillStyleRef,
    brushColorRef,
    editorModeRef,
    fabricCanvasRef,
    loadBitmapLayer,
    resolveBitmapFillTextureSource,
    saveHistory,
  ]);

  const switchEditorMode = useCallback(async (nextMode: CostumeEditorMode) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    if (editorModeRef.current === nextMode) return;

    const rasterizedCanvas = getActiveLayerCanvasElement();
    const rasterized = rasterizedCanvas.toDataURL('image/png');

    if (nextMode === 'bitmap') {
      const loaded = await loadBitmapLayer(rasterized, false);
      if (!loaded) return;
      setEditorMode('bitmap');
    } else {
      const loaded = await loadBitmapAsSingleVectorImage(rasterizedCanvas);
      if (!loaded) return;
      setEditorMode('vector');
    }

    saveHistory();
  }, [
    editorModeRef,
    fabricCanvasRef,
    getActiveLayerCanvasElement,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    saveHistory,
    setEditorMode,
  ]);

  const exportCostumeState = useCallback((sessionKey?: string | null): {
    activeLayerDataUrl: string;
    editorMode: CostumeEditorMode;
    bitmapAssetFrame?: CostumeAssetFrame | null;
    vectorDocument?: CostumeVectorDocument;
  } | null => {
    if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
      return null;
    }

    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        activeLayerDataUrl: '',
        editorMode: editorModeRef.current,
      };
    }

    const activeLayerCanvas = fabricCanvas.toCanvasElement(1);
    const optimizedBitmap = optimizeCostumeRasterCanvas(activeLayerCanvas);
    const activeLayerDataUrl = optimizedBitmap.dataUrl;

    if (editorModeRef.current === 'vector') {
      return {
        activeLayerDataUrl,
        editorMode: 'vector',
        vectorDocument: {
          engine: 'fabric',
          version: 1,
          fabricJson: JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)),
        },
      };
    }

    return {
      activeLayerDataUrl,
      editorMode: editorModeRef.current,
      bitmapAssetFrame: optimizedBitmap.assetFrame ?? null,
    };
  }, [editorModeRef, fabricCanvasRef, loadedSessionKeyRef]);

  const deleteSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current === 'bitmap') {
      return deleteBitmapFloatingSelection();
    }
    if (editorModeRef.current !== 'vector') return false;
    return deleteCanvasSelection();
  }, [deleteBitmapFloatingSelection, deleteCanvasSelection, editorModeRef, fabricCanvasRef]);

  const {
    duplicateSelection,
    copySelection,
    cutSelection,
    pasteSelection,
  } = useFabricVectorClipboardCommands<any>({
    canRun: () => editorModeRef.current === 'vector',
    cloneObject: cloneFabricObjectWithVectorStyle,
    deleteSelection: deleteCanvasSelection,
    fabricCanvasRef,
    normalizeCanvasVectorStrokeUniform,
    pasteMoveOffset: 0,
    pasteTargetCenter: {
      x: CANVAS_SIZE / 2,
      y: CANVAS_SIZE / 2,
    },
    resolveInsertionParent: () => vectorGroupEditingPathRef.current.at(-1) ?? null,
    saveHistory,
    syncSelectionState,
  });

  const moveSelectionOrder = useCallback((action: MoveOrderAction): boolean => {
    if (editorModeRef.current !== 'vector') return false;
    return moveCanvasSelectionOrder(action);
  }, [editorModeRef, moveCanvasSelectionOrder]);

  const nudgeSelection = useCallback((dx: number, dy: number): boolean => {
    const editorMode = editorModeRef.current;
    if (editorMode !== 'vector' && editorMode !== 'bitmap') {
      return false;
    }
    if (editorMode === 'bitmap' && bitmapSelectionBusyRef.current) {
      return false;
    }
    return nudgeCanvasSelection(dx, dy);
  }, [bitmapSelectionBusyRef, editorModeRef, nudgeCanvasSelection]);

  const flipSelection = useCallback((axis: SelectionFlipAxis): boolean => {
    return flipCanvasSelection(axis);
  }, [flipCanvasSelection]);

  const rotateSelection = useCallback((): boolean => {
    return rotateCanvasSelection();
  }, [rotateCanvasSelection]);

  const alignSelection = useCallback((action: AlignAction): boolean => {
    return alignCanvasSelection(action);
  }, [alignCanvasSelection]);

  const groupSelection = useCallback((): boolean => {
    if (editorModeRef.current !== 'vector') return false;
    return groupCanvasSelection();
  }, [editorModeRef, groupCanvasSelection]);

  const ungroupSelection = useCallback((): boolean => {
    if (editorModeRef.current !== 'vector') return false;
    return ungroupCanvasSelection();
  }, [editorModeRef, ungroupCanvasSelection]);

  const isTextEditing = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return false;
    const activeObject = fabricCanvas.getActiveObject() as any;
    return !!activeObject && isTextObject(activeObject) && !!(activeObject as any).isEditing;
  }, [editorModeRef, fabricCanvasRef]);

  const loadDocument = useCallback(async (sessionKey: string, costumeDocument: CostumeDocument) => {
    const requestId = ++loadRequestIdRef.current;
    const fabricCanvas = await waitForFabricCanvas(requestId);
    if (!fabricCanvas) return;
    const previousHostedLayerId = hostedLayerIdRef.current ?? activeDocumentLayerId ?? null;
    commitHostedLayerSurfaceSnapshot(previousHostedLayerId);
    setHostedLayerReady(false);
    loadedSessionKeyRef.current = null;

    const requestedState = resolveActiveCostumeLayerEditorLoadState(costumeDocument);
    const nextHostedLayerId = requestedState.activeLayerId;
    if (requestedState.editorMode === 'vector') {
      const requestedVectorDocument = requestedState.vectorDocument ?? createEmptyCostumeVectorDocument();
      try {
        const parsed = JSON.parse(requestedVectorDocument.fabricJson);
        suppressHistoryRef.current = true;
        fabricCanvas.clear();
        await fabricCanvas.loadFromJSON(parsed);
        normalizeCanvasVectorStrokeUniform();
        if (!isLoadRequestActive(requestId)) return;
        fabricCanvas.requestRenderAll();
        setEditorMode('vector');
      } catch (error) {
        console.warn('Invalid vector document. Loading an empty active vector layer instead.', error);
        suppressHistoryRef.current = true;
        try {
          fabricCanvas.clear();
          if (!isLoadRequestActive(requestId)) return;
          fabricCanvas.requestRenderAll();
          setEditorMode('vector');
        } finally {
          suppressHistoryRef.current = false;
        }
      } finally {
        suppressHistoryRef.current = false;
      }
    } else {
      const loaded = await loadBitmapLayer(requestedState.bitmapAssetId ?? '', false, requestId, {
        assetFrame: requestedState.bitmapAssetFrame,
      });
      if (!loaded || !isLoadRequestActive(requestId)) {
        const resetToBlank = await loadBitmapLayer('', false, requestId);
        if (!resetToBlank || !isLoadRequestActive(requestId)) return;
      }
      setEditorMode('bitmap');
    }

    if (!isLoadRequestActive(requestId)) return;
    setHostedLayerId(nextHostedLayerId);
    markHostedLayerRenderPending();
    fabricCanvas.requestRenderAll();
    loadedSessionKeyRef.current = sessionKey;
    rebaseHistoryToCurrentSnapshot(sessionKey);
  }, [
    activeDocumentLayerId,
    commitHostedLayerSurfaceSnapshot,
    hostedLayerIdRef,
    isLoadRequestActive,
    loadBitmapLayer,
    loadRequestIdRef,
    loadedSessionKeyRef,
    markHostedLayerRenderPending,
    normalizeCanvasVectorStrokeUniform,
    rebaseHistoryToCurrentSnapshot,
    setEditorMode,
    setHostedLayerId,
    setHostedLayerReady,
    suppressHistoryRef,
    waitForFabricCanvas,
  ]);

  const syncActiveVectorStyle = useCallback((
    explicitVectorStyleUpdates?: Partial<VectorToolStyle>,
    previousVectorStyle?: VectorToolStyle,
  ) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return;
    const hasExplicitVectorStyleUpdates = !!explicitVectorStyleUpdates && Object.keys(explicitVectorStyleUpdates).length > 0;
    if (!hasExplicitVectorStyleUpdates && skipNextSelectionSyncedVectorStyleApplyRef.current) {
      skipNextSelectionSyncedVectorStyleApplyRef.current = false;
      return;
    }
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return;

    let changed = false;
    if (isTextObject(activeObject)) {
      const textObject = activeObject as any;
      if (textObject.fill !== brushColorRef.current) changed = true;
      if (textObject.fontFamily !== textStyle.fontFamily) changed = true;
      if (textObject.fontSize !== textStyle.fontSize) changed = true;
      if (textObject.fontWeight !== textStyle.fontWeight) changed = true;
      if (textObject.fontStyle !== textStyle.fontStyle) changed = true;
      if (textObject.underline !== textStyle.underline) changed = true;
      if (textObject.textAlign !== textStyle.textAlign) changed = true;
      if (textObject.opacity !== textStyle.opacity) changed = true;
      textObject.set({
        fill: brushColorRef.current,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        underline: textStyle.underline,
        textAlign: textStyle.textAlign,
        opacity: textStyle.opacity,
      });
    } else {
      const vectorStyleUpdates =
        hasExplicitVectorStyleUpdates
          ? explicitVectorStyleUpdates
          : previousVectorStyle
            ? getChangedVectorStyleUpdates(previousVectorStyle, vectorStyle)
            : vectorStyle;
      if (Object.keys(vectorStyleUpdates).length === 0) {
        return;
      }

      const fillStyleUpdates: Partial<Pick<VectorToolStyle, 'fillColor' | 'fillOpacity' | 'fillTextureId'>> = {};
      const strokeStyleUpdates: Partial<Pick<VectorToolStyle, 'strokeBrushId' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth'>> = {};

      if ('fillColor' in vectorStyleUpdates) {
        fillStyleUpdates.fillColor = vectorStyleUpdates.fillColor;
      }
      if ('fillOpacity' in vectorStyleUpdates) {
        fillStyleUpdates.fillOpacity = vectorStyleUpdates.fillOpacity;
      }
      if ('fillTextureId' in vectorStyleUpdates) {
        fillStyleUpdates.fillTextureId = vectorStyleUpdates.fillTextureId;
      }
      if ('strokeColor' in vectorStyleUpdates) {
        strokeStyleUpdates.strokeColor = vectorStyleUpdates.strokeColor;
      }
      if ('strokeOpacity' in vectorStyleUpdates) {
        strokeStyleUpdates.strokeOpacity = vectorStyleUpdates.strokeOpacity;
      }
      if ('strokeWidth' in vectorStyleUpdates) {
        strokeStyleUpdates.strokeWidth = vectorStyleUpdates.strokeWidth;
      }
      if ('strokeBrushId' in vectorStyleUpdates) {
        strokeStyleUpdates.strokeBrushId = vectorStyleUpdates.strokeBrushId;
      }

      changed = applyVectorStyleUpdatesToSelection(activeObject, {
        fillStyle: fillStyleUpdates,
        strokeStyle: strokeStyleUpdates,
      }) || changed;
    }

    if (!changed) return;

    activeObject.setCoords?.();
    fabricCanvas.requestRenderAll();
    scheduleVectorStyleHistorySave();
  }, [brushColorRef, editorModeRef, fabricCanvasRef, scheduleVectorStyleHistorySave, textStyle, vectorStyle]);

  return {
    alignSelection,
    applyFill,
    copySelection,
    cutSelection,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    getComposedCanvasElement,
    getSelectionMousePos,
    isTextEditing,
    loadDocument,
    moveSelectionOrder,
    nudgeSelection,
    pasteSelection,
    rotateSelection,
    groupSelection,
    switchEditorMode,
    syncActiveVectorStyle,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorStyleFromSelection,
    ungroupSelection,
  };
}
