import type {
  Costume,
  CostumeAssetFrame,
  CostumeBitmapContentRef,
  CostumeBitmapLayer,
  CostumeDocument,
  CostumeLayer,
  CostumeLayerBase,
  CostumeLayerBlendMode,
  CostumeLayerEffect,
  CostumeLayerKind,
  CostumeVectorDocument,
  CostumeVectorLayer,
} from '@/types';
import {
  cloneCostumeAssetFrame,
  sanitizeCostumeAssetFrame,
} from './costumeAssetFrame';
import {
  duplicateDocumentLayer,
  getActiveDocumentLayer,
  getDocumentLayerById,
  getDocumentLayerIndex,
  insertDocumentLayerAfterActive,
  moveDocumentLayer,
  removeDocumentLayer,
  setActiveDocumentLayer,
} from '@/lib/layers/layerDocument';

export const COSTUME_CANVAS_SIZE = 1024;
export const MAX_COSTUME_LAYERS = 8;
const DEFAULT_BLEND_MODE: CostumeLayerBlendMode = 'normal';
export const EMPTY_COSTUME_VECTOR_FABRIC_JSON = '{"version":"7.0.0","objects":[]}';

type LegacyCostumeShape = {
  assetId?: unknown;
  document?: unknown;
  editorMode?: unknown;
  vectorDocument?: unknown;
};

function sanitizeLayerName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') {
    return fallback;
  }
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeLayerOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

function sanitizeBitmapContentRef(value: unknown): CostumeBitmapContentRef {
  if (!value || typeof value !== 'object') {
    return { assetId: null };
  }
  const maybe = value as { assetId?: unknown; assetFrame?: unknown };
  return {
    assetId: typeof maybe.assetId === 'string' && maybe.assetId.trim().length > 0
      ? maybe.assetId
      : null,
    assetFrame: sanitizeCostumeAssetFrame(maybe.assetFrame),
  };
}

function sanitizeVectorDocument(value: unknown): CostumeVectorDocument | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const maybe = value as { version?: unknown; fabricJson?: unknown; engine?: unknown };
  if (maybe.version !== 1 || typeof maybe.fabricJson !== 'string') {
    return null;
  }
  return {
    engine: 'fabric',
    version: 1,
    fabricJson: maybe.fabricJson,
  };
}

function sanitizeLayerEffects(value: unknown): CostumeLayerEffect[] {
  return Array.isArray(value) ? [] : [];
}

function sanitizeCommonLayerFields(
  layer: Record<string, unknown>,
  fallbackName: string,
): Omit<CostumeLayer, 'kind' | 'bitmap' | 'vector' | 'width' | 'height'> {
  return {
    id: typeof layer.id === 'string' && layer.id.trim().length > 0 ? layer.id : crypto.randomUUID(),
    name: sanitizeLayerName(layer.name, fallbackName),
    visible: layer.visible !== false,
    locked: layer.locked === true,
    opacity: sanitizeLayerOpacity(layer.opacity),
    blendMode: DEFAULT_BLEND_MODE,
    mask: null,
    effects: sanitizeLayerEffects(layer.effects),
  };
}

export function isBitmapCostumeLayer(layer: CostumeLayer | null | undefined): layer is CostumeBitmapLayer {
  return !!layer && layer.kind === 'bitmap';
}

export function isVectorCostumeLayer(layer: CostumeLayer | null | undefined): layer is CostumeVectorLayer {
  return !!layer && layer.kind === 'vector';
}

export function cloneCostumeLayer(layer: CostumeLayer): CostumeLayer {
  if (layer.kind === 'bitmap') {
    return {
      ...layer,
      bitmap: {
        ...layer.bitmap,
        assetFrame: cloneCostumeAssetFrame(layer.bitmap.assetFrame),
      },
      effects: [...layer.effects],
    };
  }

  return {
    ...layer,
    vector: { ...layer.vector },
    effects: [...layer.effects],
  };
}

export function cloneCostumeDocument(document: CostumeDocument): CostumeDocument {
  return {
    version: 1,
    activeLayerId: document.activeLayerId,
    layers: document.layers.map((layer) => cloneCostumeLayer(layer)),
  };
}

export function createBitmapLayer(options: {
  id?: string;
  name?: string;
  assetId?: string | null;
  assetFrame?: CostumeAssetFrame | null;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
} = {}): CostumeBitmapLayer {
  return {
    id: options.id ?? crypto.randomUUID(),
    name: sanitizeLayerName(options.name, 'Bitmap Layer'),
    kind: 'bitmap',
    visible: options.visible !== false,
    locked: options.locked === true,
    opacity: sanitizeLayerOpacity(options.opacity),
    blendMode: DEFAULT_BLEND_MODE,
    mask: null,
    effects: [],
    width: COSTUME_CANVAS_SIZE,
    height: COSTUME_CANVAS_SIZE,
    bitmap: {
      assetId: typeof options.assetId === 'string' && options.assetId.trim().length > 0 ? options.assetId : null,
      assetFrame: cloneCostumeAssetFrame(options.assetFrame),
    },
  };
}

export function createVectorLayer(options: {
  id?: string;
  name?: string;
  fabricJson?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
} = {}): CostumeVectorLayer {
  return {
    id: options.id ?? crypto.randomUUID(),
    name: sanitizeLayerName(options.name, 'Vector Layer'),
    kind: 'vector',
    visible: options.visible !== false,
    locked: options.locked === true,
    opacity: sanitizeLayerOpacity(options.opacity),
    blendMode: DEFAULT_BLEND_MODE,
    mask: null,
    effects: [],
    vector: {
      engine: 'fabric',
      version: 1,
      fabricJson: typeof options.fabricJson === 'string' ? options.fabricJson : EMPTY_COSTUME_VECTOR_FABRIC_JSON,
    },
  };
}

export function createEmptyCostumeVectorDocument(): CostumeVectorDocument {
  return {
    engine: 'fabric',
    version: 1,
    fabricJson: EMPTY_COSTUME_VECTOR_FABRIC_JSON,
  };
}

export function createBlankCostumeDocument(): CostumeDocument {
  const layer = createVectorLayer({ name: 'Layer 1' });
  return {
    version: 1,
    activeLayerId: layer.id,
    layers: [layer],
  };
}

export function createBitmapCostumeDocument(assetId: string | null, name = 'Layer 1'): CostumeDocument {
  const layer = createBitmapLayer({ name, assetId });
  return {
    version: 1,
    activeLayerId: layer.id,
    layers: [layer],
  };
}

export function getCostumeLayerById(
  document: CostumeDocument | null | undefined,
  layerId: string | null | undefined,
): CostumeLayer | null {
  return getDocumentLayerById(document, layerId);
}

export function getActiveCostumeLayer(document: CostumeDocument | null | undefined): CostumeLayer | null {
  return getActiveDocumentLayer(document);
}

export function getActiveCostumeLayerKind(document: CostumeDocument | null | undefined): CostumeLayerKind {
  return getActiveCostumeLayer(document)?.kind ?? 'vector';
}

export interface ActiveCostumeLayerEditorLoadState {
  activeLayerId: string | null;
  editorMode: CostumeLayerKind;
  bitmapAssetId: string | null;
  bitmapAssetFrame: CostumeAssetFrame | null;
  vectorDocument: CostumeVectorDocument | null;
}

export function resolveActiveCostumeLayerEditorLoadState(
  document: CostumeDocument | null | undefined,
): ActiveCostumeLayerEditorLoadState {
  const activeLayer = getActiveCostumeLayer(document);
  if (!activeLayer) {
    return {
      activeLayerId: null,
      editorMode: 'vector',
      bitmapAssetId: null,
      bitmapAssetFrame: null,
      vectorDocument: createEmptyCostumeVectorDocument(),
    };
  }

  if (isBitmapCostumeLayer(activeLayer)) {
    return {
      activeLayerId: activeLayer.id,
      editorMode: 'bitmap',
      bitmapAssetId: activeLayer.bitmap.assetId ?? null,
      bitmapAssetFrame: cloneCostumeAssetFrame(activeLayer.bitmap.assetFrame) ?? null,
      vectorDocument: null,
    };
  }

  return {
    activeLayerId: activeLayer.id,
    editorMode: 'vector',
    bitmapAssetId: null,
    bitmapAssetFrame: null,
    vectorDocument: activeLayer.vector,
  };
}

export function getCostumeLayerIndex(
  document: CostumeDocument | null | undefined,
  layerId: string | null | undefined,
): number {
  return getDocumentLayerIndex(document, layerId);
}

export function setActiveCostumeLayer(document: CostumeDocument, layerId: string): CostumeDocument {
  return setActiveDocumentLayer(document, layerId, cloneCostumeDocument);
}

export function insertCostumeLayerAfterActive(document: CostumeDocument, layer: CostumeLayer): CostumeDocument {
  return insertDocumentLayerAfterActive(document, layer, {
    cloneDocument: cloneCostumeDocument,
    cloneLayer: cloneCostumeLayer,
    maxLayers: MAX_COSTUME_LAYERS,
  });
}

export function duplicateCostumeLayer(document: CostumeDocument, layerId: string): CostumeDocument | null {
  return duplicateDocumentLayer(document, layerId, {
    cloneDocument: cloneCostumeDocument,
    cloneLayer: cloneCostumeLayer,
    createLayerId: () => crypto.randomUUID(),
    maxLayers: MAX_COSTUME_LAYERS,
  });
}

export function removeCostumeLayer(document: CostumeDocument, layerId: string): CostumeDocument | null {
  return removeDocumentLayer(document, layerId, cloneCostumeDocument);
}

export function moveCostumeLayer(document: CostumeDocument, layerId: string, direction: 'up' | 'down'): CostumeDocument | null {
  return moveDocumentLayer(document, layerId, direction, cloneCostumeDocument);
}

export function updateCostumeLayer(
  document: CostumeDocument,
  layerId: string,
  updates: Partial<Pick<CostumeLayerBase, 'name' | 'visible' | 'locked' | 'opacity'>>,
): CostumeDocument | null {
  const layerIndex = getCostumeLayerIndex(document, layerId);
  if (layerIndex < 0) {
    return null;
  }

  const nextDocument = cloneCostumeDocument(document);
  const layer = nextDocument.layers[layerIndex];
  nextDocument.layers[layerIndex] = {
    ...layer,
    ...(updates.name !== undefined ? { name: sanitizeLayerName(updates.name, layer.name) } : {}),
    ...(updates.visible !== undefined ? { visible: updates.visible } : {}),
    ...(updates.locked !== undefined ? { locked: updates.locked } : {}),
    ...(updates.opacity !== undefined ? { opacity: sanitizeLayerOpacity(updates.opacity) } : {}),
  };
  return nextDocument;
}

export function setCostumeLayerVisibility(
  document: CostumeDocument,
  layerId: string,
  visible: boolean,
): CostumeDocument | null {
  return updateCostumeLayer(document, layerId, { visible });
}

export interface ActiveLayerCanvasState {
  editorMode: CostumeLayerKind;
  dataUrl: string;
  bitmapAssetFrame?: CostumeAssetFrame | null;
  vectorDocument?: CostumeVectorDocument;
}

export function applyCanvasStateToCostumeDocument(
  document: CostumeDocument,
  state: ActiveLayerCanvasState,
): CostumeDocument {
  const nextDocument = cloneCostumeDocument(document);
  const activeLayerIndex = nextDocument.layers.findIndex((layer) => layer.id === nextDocument.activeLayerId);
  if (activeLayerIndex < 0) {
    return nextDocument;
  }

  const activeLayer = nextDocument.layers[activeLayerIndex];
  if (state.editorMode === 'vector') {
    nextDocument.layers[activeLayerIndex] = {
      id: activeLayer.id,
      name: activeLayer.name,
      visible: activeLayer.visible,
      locked: activeLayer.locked,
      opacity: activeLayer.opacity,
      blendMode: activeLayer.blendMode,
      mask: null,
      effects: [...activeLayer.effects],
      kind: 'vector',
      vector: state.vectorDocument ?? {
        engine: 'fabric',
        version: 1,
        fabricJson: '{"version":"7.0.0","objects":[]}',
      },
    };
    return nextDocument;
  }

  nextDocument.layers[activeLayerIndex] = {
    id: activeLayer.id,
    name: activeLayer.name,
    visible: activeLayer.visible,
    locked: activeLayer.locked,
    opacity: activeLayer.opacity,
    blendMode: activeLayer.blendMode,
    mask: null,
    effects: [...activeLayer.effects],
    kind: 'bitmap',
    width: COSTUME_CANVAS_SIZE,
    height: COSTUME_CANVAS_SIZE,
    bitmap: {
      assetId: state.dataUrl || null,
      assetFrame: cloneCostumeAssetFrame(state.bitmapAssetFrame) ?? undefined,
    },
  };
  return nextDocument;
}

export function sanitizeCostumeDocument(value: unknown): CostumeDocument | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as {
    version?: unknown;
    activeLayerId?: unknown;
    layers?: unknown;
  };

  if (maybe.version !== 1 || !Array.isArray(maybe.layers)) {
    return null;
  }

  const layers: CostumeLayer[] = maybe.layers
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const layer = entry as Record<string, unknown>;
      const fallbackName = `Layer ${index + 1}`;
      const common = sanitizeCommonLayerFields(layer, fallbackName);
      const kind = layer.kind === 'bitmap' ? 'bitmap' : layer.kind === 'vector' ? 'vector' : null;
      if (!kind) {
        return null;
      }

      if (kind === 'bitmap') {
        return {
          ...common,
          kind,
          width: COSTUME_CANVAS_SIZE,
          height: COSTUME_CANVAS_SIZE,
          bitmap: sanitizeBitmapContentRef(layer.bitmap),
        } satisfies CostumeBitmapLayer;
      }

      const vector = sanitizeVectorDocument(layer.vector);
      if (!vector) {
        return null;
      }
      return {
        ...common,
        kind,
        vector,
      } satisfies CostumeVectorLayer;
    })
    .filter((layer): layer is CostumeLayer => layer !== null)
    .slice(0, MAX_COSTUME_LAYERS);

  if (layers.length === 0) {
    return createBlankCostumeDocument();
  }

  const requestedActiveLayerId =
    typeof maybe.activeLayerId === 'string' && maybe.activeLayerId.trim().length > 0
      ? maybe.activeLayerId
      : null;
  const activeLayer = layers.find((layer) => layer.id === requestedActiveLayerId) ?? layers[0];

  return {
    version: 1,
    activeLayerId: activeLayer.id,
    layers,
  };
}

export function migrateLegacyCostumeDocument(costume: LegacyCostumeShape): CostumeDocument {
  const existingDocument = sanitizeCostumeDocument(costume.document);
  if (existingDocument) {
    return existingDocument;
  }

  const assetId = typeof costume.assetId === 'string' ? costume.assetId : null;
  const legacyVectorDocument = sanitizeVectorDocument(costume.vectorDocument);
  if (legacyVectorDocument) {
    const layer = createVectorLayer({
      name: 'Layer 1',
      fabricJson: legacyVectorDocument.fabricJson,
    });
    return {
      version: 1,
      activeLayerId: layer.id,
      layers: [layer],
    };
  }

  return createBitmapCostumeDocument(assetId, 'Layer 1');
}

export function ensureCostumeDocument(costume: LegacyCostumeShape): CostumeDocument {
  return migrateLegacyCostumeDocument(costume);
}

export function cloneCostume(costume: Costume): Costume {
  return {
    ...costume,
    bounds: costume.bounds ? { ...costume.bounds } : undefined,
    assetFrame: cloneCostumeAssetFrame(costume.assetFrame),
    document: cloneCostumeDocument(costume.document),
  };
}
