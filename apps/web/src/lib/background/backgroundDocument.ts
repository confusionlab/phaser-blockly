import type {
  BackgroundBitmapContentRef,
  BackgroundBitmapLayer,
  BackgroundConfig,
  BackgroundDocument,
  BackgroundLayer,
  BackgroundLayerBase,
  BackgroundLayerKind,
  BackgroundVectorDocument,
  BackgroundVectorLayer,
} from '@/types';
import {
  DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT,
  DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT,
  normalizeChunkDataMap,
} from './chunkStore';
import { DEFAULT_BACKGROUND_CHUNK_SIZE } from './chunkMath';
import {
  duplicateDocumentLayer,
  getActiveDocumentLayer,
  getDocumentLayerById,
  getDocumentLayerIndex,
  insertDocumentLayerAfterActive,
  moveDocumentLayer,
  reorderDocumentLayer,
  removeDocumentLayer,
  setActiveDocumentLayer,
} from '@/lib/layers/layerDocument';

export const MAX_BACKGROUND_LAYERS = 8;
export const EMPTY_BACKGROUND_VECTOR_FABRIC_JSON = '{"version":"7.0.0","objects":[]}';

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

function sanitizeChunkSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_BACKGROUND_CHUNK_SIZE;
  }
  return Math.max(32, Math.floor(value));
}

function sanitizeChunkLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function sanitizeBitmapContentRef(value: unknown): BackgroundBitmapContentRef {
  if (!value || typeof value !== 'object') {
    return { chunks: {} };
  }
  const maybe = value as { chunks?: unknown };
  return {
    chunks: normalizeChunkDataMap(
      maybe.chunks && typeof maybe.chunks === 'object'
        ? maybe.chunks as Record<string, string>
        : undefined,
    ),
  };
}

function sanitizeVectorDocument(value: unknown): BackgroundVectorDocument | null {
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

function sanitizeLayerEffects(value: unknown): never[] {
  return Array.isArray(value) ? [] : [];
}

function sanitizeCommonLayerFields(
  layer: Record<string, unknown>,
  fallbackName: string,
): BackgroundLayerBase {
  return {
    id: typeof layer.id === 'string' && layer.id.trim().length > 0 ? layer.id : crypto.randomUUID(),
    name: sanitizeLayerName(layer.name, fallbackName),
    visible: layer.visible !== false,
    locked: layer.locked === true,
    opacity: sanitizeLayerOpacity(layer.opacity),
    blendMode: 'normal',
    mask: null,
    effects: sanitizeLayerEffects(layer.effects),
  };
}

export function isBitmapBackgroundLayer(
  layer: BackgroundLayer | null | undefined,
): layer is BackgroundBitmapLayer {
  return !!layer && layer.kind === 'bitmap';
}

export function isVectorBackgroundLayer(
  layer: BackgroundLayer | null | undefined,
): layer is BackgroundVectorLayer {
  return !!layer && layer.kind === 'vector';
}

export function cloneBackgroundLayer(layer: BackgroundLayer): BackgroundLayer {
  if (layer.kind === 'bitmap') {
    return {
      ...layer,
      bitmap: {
        chunks: { ...layer.bitmap.chunks },
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

export function cloneBackgroundDocument(document: BackgroundDocument): BackgroundDocument {
  return {
    version: 1,
    activeLayerId: document.activeLayerId,
    chunkSize: sanitizeChunkSize(document.chunkSize),
    softChunkLimit: sanitizeChunkLimit(document.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT),
    hardChunkLimit: Math.max(
      sanitizeChunkLimit(document.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT),
      sanitizeChunkLimit(document.hardChunkLimit, DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT),
    ),
    layers: document.layers.map((layer) => cloneBackgroundLayer(layer)),
  };
}

function parseBackgroundVectorObjectCount(fabricJson: string): number {
  try {
    const parsed = JSON.parse(fabricJson) as { objects?: unknown[] };
    return Array.isArray(parsed.objects) ? parsed.objects.length : 0;
  } catch {
    return 0;
  }
}

export function hasBackgroundLayerContent(layer: BackgroundLayer | null | undefined): boolean {
  if (!layer) {
    return false;
  }

  if (isBitmapBackgroundLayer(layer)) {
    return Object.keys(layer.bitmap.chunks).length > 0;
  }

  if (isVectorBackgroundLayer(layer)) {
    return parseBackgroundVectorObjectCount(layer.vector.fabricJson) > 0;
  }

  return false;
}

export function hasBackgroundDocumentContent(document: BackgroundDocument | null | undefined): boolean {
  return !!document && document.layers.some((layer) => hasBackgroundLayerContent(layer));
}

export function createBitmapBackgroundLayer(options: {
  id?: string;
  name?: string;
  chunks?: Record<string, string>;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
} = {}): BackgroundBitmapLayer {
  return {
    id: options.id ?? crypto.randomUUID(),
    name: sanitizeLayerName(options.name, 'Bitmap Layer'),
    kind: 'bitmap',
    visible: options.visible !== false,
    locked: options.locked === true,
    opacity: sanitizeLayerOpacity(options.opacity),
    blendMode: 'normal',
    mask: null,
    effects: [],
    bitmap: {
      chunks: normalizeChunkDataMap(options.chunks),
    },
  };
}

export function createVectorBackgroundLayer(options: {
  id?: string;
  name?: string;
  fabricJson?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
} = {}): BackgroundVectorLayer {
  return {
    id: options.id ?? crypto.randomUUID(),
    name: sanitizeLayerName(options.name, 'Vector Layer'),
    kind: 'vector',
    visible: options.visible !== false,
    locked: options.locked === true,
    opacity: sanitizeLayerOpacity(options.opacity),
    blendMode: 'normal',
    mask: null,
    effects: [],
    vector: {
      engine: 'fabric',
      version: 1,
      fabricJson: typeof options.fabricJson === 'string' ? options.fabricJson : EMPTY_BACKGROUND_VECTOR_FABRIC_JSON,
    },
  };
}

export function createEmptyBackgroundVectorDocument(): BackgroundVectorDocument {
  return {
    engine: 'fabric',
    version: 1,
    fabricJson: EMPTY_BACKGROUND_VECTOR_FABRIC_JSON,
  };
}

export function createBlankBackgroundDocument(options?: {
  chunkSize?: number;
  softChunkLimit?: number;
  hardChunkLimit?: number;
}): BackgroundDocument {
  const layer = createBitmapBackgroundLayer({ name: 'Layer 1' });
  const chunkSize = sanitizeChunkSize(options?.chunkSize);
  const softChunkLimit = sanitizeChunkLimit(options?.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT);
  const hardChunkLimit = Math.max(
    softChunkLimit,
    sanitizeChunkLimit(options?.hardChunkLimit, DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT),
  );
  return {
    version: 1,
    activeLayerId: layer.id,
    chunkSize,
    softChunkLimit,
    hardChunkLimit,
    layers: [layer],
  };
}

export function createBitmapBackgroundDocument(
  chunks: Record<string, string>,
  options?: {
    chunkSize?: number;
    softChunkLimit?: number;
    hardChunkLimit?: number;
    name?: string;
  },
): BackgroundDocument {
  const layer = createBitmapBackgroundLayer({
    name: options?.name ?? 'Layer 1',
    chunks,
  });
  return {
    version: 1,
    activeLayerId: layer.id,
    chunkSize: sanitizeChunkSize(options?.chunkSize),
    softChunkLimit: sanitizeChunkLimit(options?.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT),
    hardChunkLimit: Math.max(
      sanitizeChunkLimit(options?.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT),
      sanitizeChunkLimit(options?.hardChunkLimit, DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT),
    ),
    layers: [layer],
  };
}

export function getBackgroundLayerById(
  document: BackgroundDocument | null | undefined,
  layerId: string | null | undefined,
): BackgroundLayer | null {
  return getDocumentLayerById(document, layerId);
}

export function getActiveBackgroundLayer(
  document: BackgroundDocument | null | undefined,
): BackgroundLayer | null {
  return getActiveDocumentLayer(document);
}

export function getActiveBackgroundLayerKind(
  document: BackgroundDocument | null | undefined,
): BackgroundLayerKind {
  return getActiveBackgroundLayer(document)?.kind ?? 'bitmap';
}

export function getBackgroundLayerIndex(
  document: BackgroundDocument | null | undefined,
  layerId: string | null | undefined,
): number {
  return getDocumentLayerIndex(document, layerId);
}

export function setActiveBackgroundLayer(document: BackgroundDocument, layerId: string): BackgroundDocument {
  return setActiveDocumentLayer(document, layerId, cloneBackgroundDocument);
}

export function insertBackgroundLayerAfterActive(document: BackgroundDocument, layer: BackgroundLayer): BackgroundDocument {
  return insertDocumentLayerAfterActive(document, layer, {
    cloneDocument: cloneBackgroundDocument,
    cloneLayer: cloneBackgroundLayer,
    maxLayers: MAX_BACKGROUND_LAYERS,
  });
}

export function duplicateBackgroundLayer(document: BackgroundDocument, layerId: string): BackgroundDocument | null {
  return duplicateDocumentLayer(document, layerId, {
    cloneDocument: cloneBackgroundDocument,
    cloneLayer: cloneBackgroundLayer,
    createLayerId: () => crypto.randomUUID(),
    maxLayers: MAX_BACKGROUND_LAYERS,
  });
}

export function removeBackgroundLayer(document: BackgroundDocument, layerId: string): BackgroundDocument | null {
  return removeDocumentLayer(document, layerId, cloneBackgroundDocument);
}

export function reorderBackgroundLayer(
  document: BackgroundDocument,
  layerId: string,
  targetIndex: number,
): BackgroundDocument | null {
  return reorderDocumentLayer(document, layerId, targetIndex, cloneBackgroundDocument);
}

export function moveBackgroundLayer(
  document: BackgroundDocument,
  layerId: string,
  direction: 'up' | 'down',
): BackgroundDocument | null {
  return moveDocumentLayer(document, layerId, direction, cloneBackgroundDocument);
}

export function updateBackgroundLayer(
  document: BackgroundDocument,
  layerId: string,
  updates: Partial<Pick<BackgroundLayerBase, 'name' | 'visible' | 'locked' | 'opacity'>>,
): BackgroundDocument | null {
  const layerIndex = getBackgroundLayerIndex(document, layerId);
  if (layerIndex < 0) {
    return null;
  }

  const nextDocument = cloneBackgroundDocument(document);
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

export function setBackgroundLayerVisibility(
  document: BackgroundDocument,
  layerId: string,
  visible: boolean,
): BackgroundDocument | null {
  return updateBackgroundLayer(document, layerId, { visible });
}

export function updateBackgroundBitmapLayerChunks(
  document: BackgroundDocument,
  layerId: string,
  chunks: Record<string, string>,
): BackgroundDocument | null {
  const layerIndex = getBackgroundLayerIndex(document, layerId);
  if (layerIndex < 0) {
    return null;
  }
  const layer = document.layers[layerIndex];
  if (!isBitmapBackgroundLayer(layer)) {
    return null;
  }

  const nextDocument = cloneBackgroundDocument(document);
  const nextLayer = nextDocument.layers[layerIndex];
  if (!isBitmapBackgroundLayer(nextLayer)) {
    return null;
  }
  nextLayer.bitmap.chunks = normalizeChunkDataMap(chunks);
  return nextDocument;
}

export function updateBackgroundVectorLayerDocument(
  document: BackgroundDocument,
  layerId: string,
  vectorDocument: BackgroundVectorDocument,
): BackgroundDocument | null {
  const layerIndex = getBackgroundLayerIndex(document, layerId);
  if (layerIndex < 0) {
    return null;
  }
  const layer = document.layers[layerIndex];
  if (!isVectorBackgroundLayer(layer)) {
    return null;
  }

  const nextDocument = cloneBackgroundDocument(document);
  const nextLayer = nextDocument.layers[layerIndex];
  if (!isVectorBackgroundLayer(nextLayer)) {
    return null;
  }
  nextLayer.vector = { ...vectorDocument };
  return nextDocument;
}

export function sanitizeBackgroundDocument(value: unknown): BackgroundDocument | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as {
    version?: unknown;
    activeLayerId?: unknown;
    chunkSize?: unknown;
    softChunkLimit?: unknown;
    hardChunkLimit?: unknown;
    layers?: unknown;
  };

  if (maybe.version !== 1 || !Array.isArray(maybe.layers)) {
    return null;
  }

  const layers: BackgroundLayer[] = maybe.layers
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
          bitmap: sanitizeBitmapContentRef(layer.bitmap),
        } satisfies BackgroundBitmapLayer;
      }

      const vector = sanitizeVectorDocument(layer.vector);
      if (!vector) {
        return null;
      }
      return {
        ...common,
        kind,
        vector,
      } satisfies BackgroundVectorLayer;
    })
    .filter((layer): layer is BackgroundLayer => layer !== null)
    .slice(0, MAX_BACKGROUND_LAYERS);

  if (layers.length === 0) {
    return createBlankBackgroundDocument({
      chunkSize: sanitizeChunkSize(maybe.chunkSize),
      softChunkLimit: sanitizeChunkLimit(maybe.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT),
      hardChunkLimit: sanitizeChunkLimit(maybe.hardChunkLimit, DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT),
    });
  }

  const requestedActiveLayerId =
    typeof maybe.activeLayerId === 'string' && maybe.activeLayerId.trim().length > 0
      ? maybe.activeLayerId
      : null;
  const activeLayer = layers.find((layer) => layer.id === requestedActiveLayerId) ?? layers[0];
  const chunkSize = sanitizeChunkSize(maybe.chunkSize);
  const softChunkLimit = sanitizeChunkLimit(maybe.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT);
  const hardChunkLimit = Math.max(
    softChunkLimit,
    sanitizeChunkLimit(maybe.hardChunkLimit, DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT),
  );

  return {
    version: 1,
    activeLayerId: activeLayer.id,
    chunkSize,
    softChunkLimit,
    hardChunkLimit,
    layers,
  };
}

export function ensureBackgroundDocument(background: BackgroundConfig | null | undefined): BackgroundDocument {
  const existingDocument = sanitizeBackgroundDocument(background?.document);
  if (existingDocument) {
    return existingDocument;
  }

  const legacyChunks = background?.type === 'tiled'
    ? normalizeChunkDataMap(background.chunks)
    : {};

  return createBitmapBackgroundDocument(legacyChunks, {
    chunkSize: background?.chunkSize,
    softChunkLimit: background?.softChunkLimit,
    hardChunkLimit: background?.hardChunkLimit,
    name: 'Layer 1',
  });
}
