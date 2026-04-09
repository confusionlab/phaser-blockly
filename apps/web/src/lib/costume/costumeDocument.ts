import type {
  AnimatedCostume,
  AnimatedCostumeBitmapCel,
  AnimatedCostumeBitmapTrack,
  AnimatedCostumeCel,
  AnimatedCostumeClip,
  AnimatedCostumePlayback,
  AnimatedCostumeTrackBase,
  AnimatedCostumeTrack,
  AnimatedCostumeVectorCel,
  AnimatedCostumeVectorTrack,
  Costume,
  CostumeAssetFrame,
  CostumeBounds,
  CostumeBitmapContentRef,
  CostumeBitmapLayer,
  CostumeDocument,
  CostumeLayer,
  CostumeLayerBase,
  CostumeLayerBlendMode,
  CostumeLayerEffect,
  CostumeLayerKind,
  StaticCostume,
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
  reorderDocumentLayer,
  removeDocumentLayer,
  setActiveDocumentLayer,
} from '@/lib/layers/layerDocument';

export const COSTUME_CANVAS_SIZE = 1024;
export const MAX_COSTUME_LAYERS = 8;
export const DEFAULT_ANIMATED_COSTUME_TOTAL_FRAMES = 16;
export const DEFAULT_ANIMATED_COSTUME_FPS = 8;
export const MAX_ANIMATED_COSTUME_FPS = 24;
export const DEFAULT_ANIMATED_COSTUME_PLAYBACK: AnimatedCostumePlayback = 'loop';
const DEFAULT_BLEND_MODE: CostumeLayerBlendMode = 'normal';
export const EMPTY_COSTUME_VECTOR_FABRIC_JSON = '{"version":"7.0.0","objects":[]}';

type LegacyCostumeShape = {
  kind?: unknown;
  assetId?: unknown;
  bounds?: unknown;
  assetFrame?: unknown;
  clip?: unknown;
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
  const maybe = value as { assetId?: unknown; assetFrame?: unknown; persistedAssetId?: unknown };
  const persistedAssetId = typeof maybe.persistedAssetId === 'string' && maybe.persistedAssetId.trim().length > 0
    ? maybe.persistedAssetId
    : undefined;
  return {
    assetId: typeof maybe.assetId === 'string' && maybe.assetId.trim().length > 0
      ? maybe.assetId
      : null,
    assetFrame: sanitizeCostumeAssetFrame(maybe.assetFrame),
    persistedAssetId,
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

function ensureUniqueId(id: string, seen: Set<string>): string {
  let nextId = id;
  while (seen.has(nextId)) {
    nextId = crypto.randomUUID();
  }
  seen.add(nextId);
  return nextId;
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

function sanitizeAnimatedTrackCommonFields(
  track: Record<string, unknown>,
  fallbackName: string,
): AnimatedCostumeTrackBase {
  return {
    id: typeof track.id === 'string' && track.id.trim().length > 0 ? track.id : crypto.randomUUID(),
    name: sanitizeLayerName(track.name, fallbackName),
    visible: track.visible !== false,
    locked: track.locked === true,
    opacity: sanitizeLayerOpacity(track.opacity),
    blendMode: DEFAULT_BLEND_MODE,
    mask: null,
    effects: sanitizeLayerEffects(track.effects),
  };
}

function sanitizeAnimatedBitmapCel(value: unknown, fallbackStartFrame: number): AnimatedCostumeBitmapCel | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as Record<string, unknown>;
  return {
    id: typeof maybe.id === 'string' && maybe.id.trim().length > 0 ? maybe.id : crypto.randomUUID(),
    kind: 'bitmap',
    startFrame: typeof maybe.startFrame === 'number' && Number.isFinite(maybe.startFrame)
      ? Math.max(0, Math.floor(maybe.startFrame))
      : fallbackStartFrame,
    durationFrames: typeof maybe.durationFrames === 'number' && Number.isFinite(maybe.durationFrames)
      ? Math.max(1, Math.floor(maybe.durationFrames))
      : 1,
    bitmap: sanitizeBitmapContentRef(maybe.bitmap),
  };
}

function sanitizeAnimatedVectorCel(value: unknown, fallbackStartFrame: number): AnimatedCostumeVectorCel | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as Record<string, unknown>;
  const vector = sanitizeVectorDocument(maybe.vector);
  if (!vector) {
    return null;
  }

  return {
    id: typeof maybe.id === 'string' && maybe.id.trim().length > 0 ? maybe.id : crypto.randomUUID(),
    kind: 'vector',
    startFrame: typeof maybe.startFrame === 'number' && Number.isFinite(maybe.startFrame)
      ? Math.max(0, Math.floor(maybe.startFrame))
      : fallbackStartFrame,
    durationFrames: typeof maybe.durationFrames === 'number' && Number.isFinite(maybe.durationFrames)
      ? Math.max(1, Math.floor(maybe.durationFrames))
      : 1,
    vector,
  };
}

function sanitizeAnimatedTrack(value: unknown, fallbackIndex: number, totalFrames: number): AnimatedCostumeTrack | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as Record<string, unknown>;
  const common = sanitizeAnimatedTrackCommonFields(maybe, `Layer ${fallbackIndex + 1}`);
  const kind = maybe.kind === 'bitmap' ? 'bitmap' : maybe.kind === 'vector' ? 'vector' : null;
  if (!kind) {
    return null;
  }

  const seenCelIds = new Set<string>();
  const rawCels = Array.isArray(maybe.cels) ? maybe.cels : [];
  const cels = rawCels
    .map((entry, index) => (
      kind === 'bitmap'
        ? sanitizeAnimatedBitmapCel(entry, index)
        : sanitizeAnimatedVectorCel(entry, index)
    ))
    .filter((cel): cel is AnimatedCostumeCel => cel !== null)
    .map((cel) => ({
      ...cel,
      id: ensureUniqueId(cel.id, seenCelIds),
      startFrame: sanitizeFrameIndex(cel.startFrame, totalFrames),
      durationFrames: Math.min(Math.max(1, cel.durationFrames), totalFrames),
    }))
    .sort((a, b) => a.startFrame - b.startFrame);

  if (kind === 'bitmap') {
    return {
      ...common,
      kind,
      width: COSTUME_CANVAS_SIZE,
      height: COSTUME_CANVAS_SIZE,
      cels: cels.filter((cel): cel is AnimatedCostumeBitmapCel => cel.kind === 'bitmap'),
    };
  }

  return {
    ...common,
    kind,
    cels: cels.filter((cel): cel is AnimatedCostumeVectorCel => cel.kind === 'vector'),
  };
}

export function sanitizeAnimatedCostumeClip(value: unknown): AnimatedCostumeClip | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as {
    version?: unknown;
    totalFrames?: unknown;
    fps?: unknown;
    playback?: unknown;
    activeTrackId?: unknown;
    tracks?: unknown;
  };
  if (maybe.version !== 1 || !Array.isArray(maybe.tracks)) {
    return null;
  }

  const totalFrames = sanitizeTotalFrames(maybe.totalFrames);
  const seenTrackIds = new Set<string>();
  const tracks = maybe.tracks
    .map((entry, index) => sanitizeAnimatedTrack(entry, index, totalFrames))
    .filter((track): track is AnimatedCostumeTrack => track !== null)
    .map((track) => ({
      ...track,
      id: ensureUniqueId(track.id, seenTrackIds),
    }))
    .slice(0, MAX_COSTUME_LAYERS);

  if (tracks.length === 0) {
    return createAnimatedCostumeClipFromDocument(createBlankCostumeDocument(), {
      totalFrames,
      fps: sanitizeAnimatedFps(maybe.fps),
      playback: sanitizeAnimatedPlayback(maybe.playback),
    });
  }

  const requestedActiveTrackId = typeof maybe.activeTrackId === 'string' && maybe.activeTrackId.trim().length > 0
    ? maybe.activeTrackId
    : null;
  const activeTrackId = tracks.find((track) => track.id === requestedActiveTrackId)?.id ?? tracks[0].id;

  return {
    version: 1,
    totalFrames,
    fps: sanitizeAnimatedFps(maybe.fps),
    playback: sanitizeAnimatedPlayback(maybe.playback),
    activeTrackId,
    tracks,
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
        persistedAssetId: layer.bitmap.persistedAssetId,
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

function cloneAnimatedBitmapCel(cel: AnimatedCostumeBitmapCel): AnimatedCostumeBitmapCel {
  return {
    ...cel,
    bitmap: {
      ...cel.bitmap,
      assetFrame: cloneCostumeAssetFrame(cel.bitmap.assetFrame),
      persistedAssetId: cel.bitmap.persistedAssetId,
    },
  };
}

function cloneAnimatedVectorCel(cel: AnimatedCostumeVectorCel): AnimatedCostumeVectorCel {
  return {
    ...cel,
    vector: { ...cel.vector },
  };
}

export function cloneAnimatedCostumeCel(cel: AnimatedCostumeCel): AnimatedCostumeCel {
  return cel.kind === 'bitmap'
    ? cloneAnimatedBitmapCel(cel)
    : cloneAnimatedVectorCel(cel);
}

export function cloneAnimatedCostumeTrack(track: AnimatedCostumeTrack): AnimatedCostumeTrack {
  if (track.kind === 'bitmap') {
    return {
      ...track,
      cels: track.cels.map((cel) => cloneAnimatedBitmapCel(cel)),
      effects: [...track.effects],
    };
  }

  return {
    ...track,
    cels: track.cels.map((cel) => cloneAnimatedVectorCel(cel)),
    effects: [...track.effects],
  };
}

export function cloneAnimatedCostumeClip(clip: AnimatedCostumeClip): AnimatedCostumeClip {
  return {
    ...clip,
    tracks: clip.tracks.map((track) => cloneAnimatedCostumeTrack(track)),
  };
}

export function cloneCostumeDocument(document: CostumeDocument): CostumeDocument {
  return {
    version: 1,
    activeLayerId: document.activeLayerId,
    layers: document.layers.map((layer) => cloneCostumeLayer(layer)),
  };
}

function sanitizeFrameIndex(frameIndex: number, totalFrames: number): number {
  if (!Number.isFinite(frameIndex)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(frameIndex)), Math.max(0, totalFrames - 1));
}

function sanitizeTotalFrames(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ANIMATED_COSTUME_TOTAL_FRAMES;
  }
  return Math.max(1, Math.floor(value));
}

function sanitizeAnimatedFps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ANIMATED_COSTUME_FPS;
  }
  return Math.min(MAX_ANIMATED_COSTUME_FPS, Math.max(1, Math.floor(value)));
}

function sanitizeAnimatedPlayback(value: unknown): AnimatedCostumePlayback {
  if (value === 'play-once' || value === 'loop' || value === 'ping-pong') {
    return value;
  }
  return DEFAULT_ANIMATED_COSTUME_PLAYBACK;
}

function cloneLayerMetadata(layer: CostumeLayer | AnimatedCostumeTrack): Omit<CostumeLayerBase, 'mask' | 'effects'> & {
  mask: null;
  effects: CostumeLayerEffect[];
} {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    mask: null,
    effects: [...layer.effects],
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
        persistedAssetId: undefined,
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

export function isStaticCostume(costume: Costume | null | undefined): costume is StaticCostume {
  return !!costume && costume.kind === 'static';
}

export function isAnimatedCostume(costume: Costume | null | undefined): costume is AnimatedCostume {
  return !!costume && costume.kind === 'animated';
}

function createAnimatedBitmapTrackFromLayer(
  layer: CostumeBitmapLayer,
  totalFrames: number,
): AnimatedCostumeBitmapTrack {
  return {
    ...cloneLayerMetadata(layer),
    kind: 'bitmap',
    width: layer.width,
    height: layer.height,
    cels: [{
      id: crypto.randomUUID(),
      kind: 'bitmap',
      startFrame: 0,
      durationFrames: totalFrames,
      bitmap: {
        ...layer.bitmap,
        assetFrame: cloneCostumeAssetFrame(layer.bitmap.assetFrame),
        persistedAssetId: layer.bitmap.persistedAssetId,
      },
    }],
  };
}

function createAnimatedVectorTrackFromLayer(
  layer: CostumeVectorLayer,
  totalFrames: number,
): AnimatedCostumeVectorTrack {
  return {
    ...cloneLayerMetadata(layer),
    kind: 'vector',
    cels: [{
      id: crypto.randomUUID(),
      kind: 'vector',
      startFrame: 0,
      durationFrames: totalFrames,
      vector: { ...layer.vector },
    }],
  };
}

export function createAnimatedCostumeClipFromDocument(
  document: CostumeDocument,
  options: {
    totalFrames?: number;
    fps?: number;
    playback?: AnimatedCostumePlayback;
  } = {},
): AnimatedCostumeClip {
  const totalFrames = sanitizeTotalFrames(options.totalFrames);
  const tracks = document.layers.map((layer) => (
    layer.kind === 'bitmap'
      ? createAnimatedBitmapTrackFromLayer(layer, totalFrames)
      : createAnimatedVectorTrackFromLayer(layer, totalFrames)
  ));
  const activeTrackId = tracks.find((track) => track.id === document.activeLayerId)?.id ?? tracks[0]?.id ?? crypto.randomUUID();

  return {
    version: 1,
    totalFrames,
    fps: sanitizeAnimatedFps(options.fps),
    playback: sanitizeAnimatedPlayback(options.playback),
    activeTrackId,
    tracks,
  };
}

function createCostumeLayerFromAnimatedTrack(
  track: AnimatedCostumeTrack,
  cel: AnimatedCostumeCel | null,
): CostumeLayer | null {
  if (track.kind === 'bitmap') {
    return {
      ...cloneLayerMetadata(track),
      kind: 'bitmap',
      width: track.width,
      height: track.height,
      bitmap: cel?.kind === 'bitmap'
        ? {
            ...cel.bitmap,
            assetFrame: cloneCostumeAssetFrame(cel.bitmap.assetFrame),
            persistedAssetId: cel.bitmap.persistedAssetId,
          }
        : {
            assetId: null,
            assetFrame: undefined,
            persistedAssetId: undefined,
          },
    };
  }

  if (track.kind === 'vector') {
    return {
      ...cloneLayerMetadata(track),
      kind: 'vector',
      vector: cel?.kind === 'vector'
        ? { ...cel.vector }
        : createEmptyCostumeVectorDocument(),
    };
  }

  return null;
}

export function getAnimatedCostumeTrackCelAtFrame(
  track: AnimatedCostumeTrack,
  frameIndex: number,
): AnimatedCostumeCel | null {
  const frame = sanitizeFrameIndex(frameIndex, Number.MAX_SAFE_INTEGER);
  const cel = track.cels.find((candidate) => {
    const startFrame = Math.max(0, Math.floor(candidate.startFrame));
    const durationFrames = Math.max(1, Math.floor(candidate.durationFrames));
    return frame >= startFrame && frame < startFrame + durationFrames;
  });
  return cel ? cloneAnimatedCostumeCel(cel) : null;
}

function materializeAnimatedFrameInternal(
  clip: AnimatedCostumeClip,
  frameIndex: number,
  options: {
    includeActiveTrackPlaceholder?: boolean;
  } = {},
): CostumeDocument {
  const sanitizedFrameIndex = sanitizeFrameIndex(frameIndex, clip.totalFrames);
  const layers: CostumeLayer[] = [];

  for (const track of clip.tracks) {
    const cel = getAnimatedCostumeTrackCelAtFrame(track, sanitizedFrameIndex);
    if (!cel && (!options.includeActiveTrackPlaceholder || track.id !== clip.activeTrackId)) {
      continue;
    }
    const layer = createCostumeLayerFromAnimatedTrack(track, cel);
    if (layer) {
      layers.push(layer);
    }
  }

  if (layers.length === 0) {
    return createBlankCostumeDocument();
  }

  const activeLayerId = layers.find((layer) => layer.id === clip.activeTrackId)?.id ?? layers[0].id;
  return {
    version: 1,
    activeLayerId,
    layers,
  };
}

export function materializeAnimatedFrame(
  clip: AnimatedCostumeClip,
  frameIndex: number,
): CostumeDocument {
  return materializeAnimatedFrameInternal(clip, frameIndex);
}

export function materializeAnimatedEditorFrame(
  clip: AnimatedCostumeClip,
  frameIndex: number,
): CostumeDocument {
  return materializeAnimatedFrameInternal(clip, frameIndex, {
    includeActiveTrackPlaceholder: true,
  });
}

export function getCostumePosterDocument(costume: Costume): CostumeDocument {
  return cloneCostumeDocument(costume.document);
}

export function getCostumeFrameCount(costume: Costume): number {
  return isAnimatedCostume(costume) ? costume.clip.totalFrames : 1;
}

export function convertStaticCostumeToAnimated(
  costume: StaticCostume,
  options: {
    totalFrames?: number;
    fps?: number;
    playback?: AnimatedCostumePlayback;
  } = {},
): AnimatedCostume {
  return {
    ...costume,
    kind: 'animated',
    document: cloneCostumeDocument(costume.document),
    clip: createAnimatedCostumeClipFromDocument(costume.document, options),
  };
}

export function createStaticCostumeFromDocument(options: {
  id?: string;
  name: string;
  assetId: string;
  bounds?: CostumeBounds;
  assetFrame?: CostumeAssetFrame | null;
  document: CostumeDocument;
}): StaticCostume {
  return {
    id: options.id ?? crypto.randomUUID(),
    name: options.name,
    kind: 'static',
    assetId: options.assetId,
    bounds: options.bounds ? { ...options.bounds } : undefined,
    assetFrame: cloneCostumeAssetFrame(options.assetFrame),
    document: cloneCostumeDocument(options.document),
  };
}

export function convertAnimatedCostumeToStatic(
  costume: AnimatedCostume,
  frameIndex: number,
): StaticCostume {
  return createStaticCostumeFromDocument({
    id: costume.id,
    name: costume.name,
    assetId: costume.assetId,
    bounds: costume.bounds,
    assetFrame: costume.assetFrame,
    document: materializeAnimatedFrame(costume.clip, frameIndex),
  });
}

export function getAnimatedCostumeTrackIndex(
  clip: AnimatedCostumeClip,
  trackId: string | null | undefined,
): number {
  if (!trackId) {
    return -1;
  }
  return clip.tracks.findIndex((track) => track.id === trackId);
}

export function getAnimatedCostumeTrackById(
  clip: AnimatedCostumeClip | null | undefined,
  trackId: string | null | undefined,
): AnimatedCostumeTrack | null {
  if (!clip || !trackId) {
    return null;
  }
  const track = clip.tracks.find((candidate) => candidate.id === trackId);
  return track ? cloneAnimatedCostumeTrack(track) : null;
}

function createBlankAnimatedBitmapTrack(
  name: string,
  totalFrames: number,
): AnimatedCostumeBitmapTrack {
  const trackId = crypto.randomUUID();
  return {
    id: trackId,
    name: sanitizeLayerName(name, 'Bitmap Layer'),
    kind: 'bitmap',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: DEFAULT_BLEND_MODE,
    mask: null,
    effects: [],
    width: COSTUME_CANVAS_SIZE,
    height: COSTUME_CANVAS_SIZE,
    cels: [{
      id: crypto.randomUUID(),
      kind: 'bitmap',
      startFrame: 0,
      durationFrames: totalFrames,
      bitmap: {
        assetId: null,
        assetFrame: undefined,
        persistedAssetId: undefined,
      },
    }],
  };
}

function createBlankAnimatedVectorTrack(
  name: string,
  totalFrames: number,
): AnimatedCostumeVectorTrack {
  const trackId = crypto.randomUUID();
  return {
    id: trackId,
    name: sanitizeLayerName(name, 'Vector Layer'),
    kind: 'vector',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: DEFAULT_BLEND_MODE,
    mask: null,
    effects: [],
    cels: [{
      id: crypto.randomUUID(),
      kind: 'vector',
      startFrame: 0,
      durationFrames: totalFrames,
      vector: createEmptyCostumeVectorDocument(),
    }],
  };
}

export function createAnimatedCostumeTrack(
  kind: CostumeLayerKind,
  options: {
    name?: string;
    totalFrames: number;
  },
): AnimatedCostumeTrack {
  return kind === 'bitmap'
    ? createBlankAnimatedBitmapTrack(options.name ?? 'Bitmap Layer', options.totalFrames)
    : createBlankAnimatedVectorTrack(options.name ?? 'Vector Layer', options.totalFrames);
}

function replaceAnimatedTrackAtIndex(
  clip: AnimatedCostumeClip,
  trackIndex: number,
  nextTrack: AnimatedCostumeTrack,
): AnimatedCostumeClip {
  const nextClip = cloneAnimatedCostumeClip(clip);
  nextClip.tracks[trackIndex] = nextTrack;
  return nextClip;
}

export function setAnimatedCostumeActiveTrack(
  clip: AnimatedCostumeClip,
  trackId: string,
): AnimatedCostumeClip | null {
  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0 || clip.activeTrackId === trackId) {
    return trackIndex < 0 ? null : cloneAnimatedCostumeClip(clip);
  }

  return {
    ...cloneAnimatedCostumeClip(clip),
    activeTrackId: trackId,
  };
}

export function insertAnimatedCostumeTrackAfterActive(
  clip: AnimatedCostumeClip,
  track: AnimatedCostumeTrack,
): AnimatedCostumeClip | null {
  if (clip.tracks.length >= MAX_COSTUME_LAYERS) {
    return null;
  }

  const nextClip = cloneAnimatedCostumeClip(clip);
  const activeIndex = Math.max(0, getAnimatedCostumeTrackIndex(clip, clip.activeTrackId));
  const insertIndex = Math.min(nextClip.tracks.length, activeIndex + 1);
  nextClip.tracks.splice(insertIndex, 0, cloneAnimatedCostumeTrack(track));
  nextClip.activeTrackId = track.id;
  return nextClip;
}

export function duplicateAnimatedCostumeTrack(
  clip: AnimatedCostumeClip,
  trackId: string,
): AnimatedCostumeClip | null {
  if (clip.tracks.length >= MAX_COSTUME_LAYERS) {
    return null;
  }

  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0) {
    return null;
  }

  const sourceTrack = clip.tracks[trackIndex];
  const duplicatedTrack = cloneAnimatedCostumeTrack({
    ...sourceTrack,
    id: crypto.randomUUID(),
    name: `${sourceTrack.name} Copy`,
    cels: sourceTrack.cels.map((cel) => ({
      ...cloneAnimatedCostumeCel(cel),
      id: crypto.randomUUID(),
    })) as typeof sourceTrack.cels,
  } as AnimatedCostumeTrack);

  const nextClip = cloneAnimatedCostumeClip(clip);
  nextClip.tracks.splice(trackIndex + 1, 0, duplicatedTrack);
  nextClip.activeTrackId = duplicatedTrack.id;
  return nextClip;
}

export function removeAnimatedCostumeTrack(
  clip: AnimatedCostumeClip,
  trackId: string,
): AnimatedCostumeClip | null {
  if (clip.tracks.length <= 1) {
    return null;
  }

  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0) {
    return null;
  }

  const nextClip = cloneAnimatedCostumeClip(clip);
  nextClip.tracks.splice(trackIndex, 1);
  nextClip.activeTrackId = nextClip.tracks[Math.max(0, Math.min(trackIndex, nextClip.tracks.length - 1))]?.id ?? nextClip.activeTrackId;
  return nextClip;
}

export function reorderAnimatedCostumeTrack(
  clip: AnimatedCostumeClip,
  trackId: string,
  targetIndex: number,
): AnimatedCostumeClip | null {
  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0) {
    return null;
  }

  const boundedTargetIndex = Math.max(0, Math.min(Math.floor(targetIndex), clip.tracks.length - 1));
  if (boundedTargetIndex === trackIndex) {
    return cloneAnimatedCostumeClip(clip);
  }

  const nextClip = cloneAnimatedCostumeClip(clip);
  const [track] = nextClip.tracks.splice(trackIndex, 1);
  if (!track) {
    return null;
  }
  nextClip.tracks.splice(boundedTargetIndex, 0, track);
  return nextClip;
}

export function updateAnimatedCostumeTrack(
  clip: AnimatedCostumeClip,
  trackId: string,
  updates: Partial<Pick<AnimatedCostumeTrackBase, 'name' | 'visible' | 'locked' | 'opacity'>>,
): AnimatedCostumeClip | null {
  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0) {
    return null;
  }

  const track = clip.tracks[trackIndex];
  return replaceAnimatedTrackAtIndex(clip, trackIndex, {
    ...cloneAnimatedCostumeTrack(track),
    ...(updates.name !== undefined ? { name: sanitizeLayerName(updates.name, track.name) } : {}),
    ...(updates.visible !== undefined ? { visible: updates.visible } : {}),
    ...(updates.locked !== undefined ? { locked: updates.locked } : {}),
    ...(updates.opacity !== undefined ? { opacity: sanitizeLayerOpacity(updates.opacity) } : {}),
  });
}

export function setAnimatedCostumeClipFrameCount(
  clip: AnimatedCostumeClip,
  totalFrames: number,
): AnimatedCostumeClip {
  const nextTotalFrames = sanitizeTotalFrames(totalFrames);
  const nextClip = cloneAnimatedCostumeClip(clip);
  nextClip.totalFrames = nextTotalFrames;
  nextClip.tracks = nextClip.tracks.map((track) => {
    if (track.kind === 'bitmap') {
      const nextTrack = cloneAnimatedCostumeTrack(track) as AnimatedCostumeBitmapTrack;
      nextTrack.cels = nextTrack.cels
        .map((cel) => {
          const startFrame = sanitizeFrameIndex(cel.startFrame, nextTotalFrames);
          if (startFrame >= nextTotalFrames) {
            return null;
          }
          const durationFrames = Math.max(1, Math.min(cel.durationFrames, nextTotalFrames - startFrame));
          return {
            ...cel,
            startFrame,
            durationFrames,
          };
        })
        .filter((cel): cel is AnimatedCostumeBitmapCel => cel !== null)
        .sort((a, b) => a.startFrame - b.startFrame);
      return nextTrack;
    }

    const nextTrack = cloneAnimatedCostumeTrack(track) as AnimatedCostumeVectorTrack;
    nextTrack.cels = nextTrack.cels
      .map((cel) => {
        const startFrame = sanitizeFrameIndex(cel.startFrame, nextTotalFrames);
        if (startFrame >= nextTotalFrames) {
          return null;
        }
        const durationFrames = Math.max(1, Math.min(cel.durationFrames, nextTotalFrames - startFrame));
        return {
          ...cel,
          startFrame,
          durationFrames,
        };
      })
      .filter((cel): cel is AnimatedCostumeVectorCel => cel !== null)
      .sort((a, b) => a.startFrame - b.startFrame);
    return nextTrack;
  });
  return nextClip;
}

export function updateAnimatedCostumeClipPlayback(
  clip: AnimatedCostumeClip,
  updates: {
    fps?: number;
    playback?: AnimatedCostumePlayback;
  },
): AnimatedCostumeClip {
  const nextClip = cloneAnimatedCostumeClip(clip);
  if (updates.fps !== undefined) {
    nextClip.fps = sanitizeAnimatedFps(updates.fps);
  }
  if (updates.playback !== undefined) {
    nextClip.playback = sanitizeAnimatedPlayback(updates.playback);
  }
  return nextClip;
}

function createCelFromLayerForFrame(
  layer: CostumeLayer,
  frameIndex: number,
  durationFrames: number,
  celId?: string,
): AnimatedCostumeCel {
  if (layer.kind === 'bitmap') {
    return {
      id: celId ?? crypto.randomUUID(),
      kind: 'bitmap',
      startFrame: frameIndex,
      durationFrames,
      bitmap: {
        ...layer.bitmap,
        assetFrame: cloneCostumeAssetFrame(layer.bitmap.assetFrame),
        persistedAssetId: layer.bitmap.persistedAssetId,
      },
    };
  }

  return {
    id: celId ?? crypto.randomUUID(),
    kind: 'vector',
    startFrame: frameIndex,
    durationFrames,
    vector: { ...layer.vector },
  };
}

function replaceAnimatedTrackCel(
  track: AnimatedCostumeTrack,
  frameIndex: number,
  layer: CostumeLayer,
): AnimatedCostumeTrack {
  if (track.kind === 'bitmap') {
    const nextTrack = cloneAnimatedCostumeTrack(track) as AnimatedCostumeBitmapTrack;
    const existingCelIndex = nextTrack.cels.findIndex((candidate) => (
      frameIndex >= candidate.startFrame &&
      frameIndex < candidate.startFrame + candidate.durationFrames
    ));

    if (existingCelIndex >= 0) {
      const existingCel = nextTrack.cels[existingCelIndex];
      nextTrack.cels[existingCelIndex] = (
        createCelFromLayerForFrame(
          layer,
          existingCel.startFrame,
          existingCel.durationFrames,
          existingCel.id,
        ) as AnimatedCostumeBitmapCel
      );
      return nextTrack;
    }

    nextTrack.cels.push(createCelFromLayerForFrame(layer, frameIndex, 1) as AnimatedCostumeBitmapCel);
    nextTrack.cels.sort((a, b) => a.startFrame - b.startFrame);
    return nextTrack;
  }

  const nextTrack = cloneAnimatedCostumeTrack(track) as AnimatedCostumeVectorTrack;
  const existingCelIndex = nextTrack.cels.findIndex((candidate) => (
    frameIndex >= candidate.startFrame &&
    frameIndex < candidate.startFrame + candidate.durationFrames
  ));

  if (existingCelIndex >= 0) {
    const existingCel = nextTrack.cels[existingCelIndex];
    nextTrack.cels[existingCelIndex] = (
      createCelFromLayerForFrame(
        layer,
        existingCel.startFrame,
        existingCel.durationFrames,
        existingCel.id,
      ) as AnimatedCostumeVectorCel
    );
    return nextTrack;
  }

  const newCel = createCelFromLayerForFrame(layer, frameIndex, 1);
  nextTrack.cels.push(newCel as AnimatedCostumeVectorCel);
  nextTrack.cels.sort((a, b) => a.startFrame - b.startFrame);
  return nextTrack;
}

export function applyCanvasStateToAnimatedCostumeClip(
  clip: AnimatedCostumeClip,
  frameIndex: number,
  state: ActiveLayerCanvasState,
): AnimatedCostumeClip | null {
  const activeTrackIndex = getAnimatedCostumeTrackIndex(clip, clip.activeTrackId);
  if (activeTrackIndex < 0) {
    return null;
  }

  const track = clip.tracks[activeTrackIndex];
  const activeLayer = createCostumeLayerFromAnimatedTrack(
    track,
    getAnimatedCostumeTrackCelAtFrame(track, frameIndex),
  );
  if (!activeLayer) {
    return null;
  }

  const nextDocument = applyCanvasStateToCostumeDocument({
    version: 1,
    activeLayerId: activeLayer.id,
    layers: [activeLayer],
  }, state);
  const nextActiveLayer = getActiveCostumeLayer(nextDocument);
  if (!nextActiveLayer) {
    return null;
  }

  const nextTrack = replaceAnimatedTrackCel(track, sanitizeFrameIndex(frameIndex, clip.totalFrames), nextActiveLayer);
  return replaceAnimatedTrackAtIndex(clip, activeTrackIndex, nextTrack);
}

export function updateAnimatedCostumeTrackCelDuration(
  clip: AnimatedCostumeClip,
  trackId: string,
  celId: string,
  durationFrames: number,
): AnimatedCostumeClip | null {
  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0) {
    return null;
  }

  const track = clip.tracks[trackIndex];
  const cel = track.cels.find((candidate) => candidate.id === celId);
  if (!cel) {
    return null;
  }

  return updateAnimatedCostumeTrackCelSpan(
    clip,
    trackId,
    celId,
    cel.startFrame,
    durationFrames,
  );
}

export function updateAnimatedCostumeTrackCelSpan(
  clip: AnimatedCostumeClip,
  trackId: string,
  celId: string,
  startFrame: number,
  durationFrames: number,
): AnimatedCostumeClip | null {
  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0) {
    return null;
  }

  const track = cloneAnimatedCostumeTrack(clip.tracks[trackIndex]);
  const celIndex = track.cels.findIndex((cel) => cel.id === celId);
  if (celIndex < 0) {
    return null;
  }

  const cel = track.cels[celIndex];
  const previousEnd = celIndex > 0
    ? track.cels[celIndex - 1].startFrame + track.cels[celIndex - 1].durationFrames
    : 0;
  const nextStart = track.cels[celIndex + 1]?.startFrame ?? clip.totalFrames;

  let nextDuration = Math.max(1, Math.floor(durationFrames));
  let nextStartFrame = Math.max(0, Math.floor(startFrame));

  if (nextDuration > clip.totalFrames) {
    nextDuration = clip.totalFrames;
  }

  nextStartFrame = Math.max(previousEnd, nextStartFrame);
  if (nextStartFrame + nextDuration > nextStart) {
    nextStartFrame = Math.max(previousEnd, nextStart - nextDuration);
  }

  const maxDuration = Math.max(1, nextStart - nextStartFrame);
  if (nextDuration > maxDuration) {
    nextDuration = maxDuration;
  }

  track.cels[celIndex] = {
    ...cel,
    startFrame: nextStartFrame,
    durationFrames: nextDuration,
  };
  track.cels.sort((left, right) => left.startFrame - right.startFrame);
  return replaceAnimatedTrackAtIndex(clip, trackIndex, track);
}

export function deleteAnimatedCostumeTrackCel(
  clip: AnimatedCostumeClip,
  trackId: string,
  celId: string,
): AnimatedCostumeClip | null {
  const trackIndex = getAnimatedCostumeTrackIndex(clip, trackId);
  if (trackIndex < 0) {
    return null;
  }

  const track = cloneAnimatedCostumeTrack(clip.tracks[trackIndex]);
  if (track.kind === 'bitmap') {
    const nextCels = track.cels.filter((cel) => cel.id !== celId);
    if (nextCels.length === track.cels.length || nextCels.length === 0) {
      return null;
    }
    track.cels = nextCels;
    return replaceAnimatedTrackAtIndex(clip, trackIndex, track);
  }

  const nextCels = track.cels.filter((cel) => cel.id !== celId);
  if (nextCels.length === track.cels.length || nextCels.length === 0) {
    return null;
  }
  track.cels = nextCels;
  return replaceAnimatedTrackAtIndex(clip, trackIndex, track);
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

export function reorderCostumeLayer(document: CostumeDocument, layerId: string, targetIndex: number): CostumeDocument | null {
  return reorderDocumentLayer(document, layerId, targetIndex, cloneCostumeDocument);
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
      persistedAssetId: activeLayer.kind === 'bitmap' ? activeLayer.bitmap.persistedAssetId : undefined,
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

  const seenLayerIds = new Set<string>();
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
          id: ensureUniqueId(common.id, seenLayerIds),
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
        id: ensureUniqueId(common.id, seenLayerIds),
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
  if (costume.kind === 'animated') {
    const existingDocument = sanitizeCostumeDocument(costume.document);
    if (existingDocument) {
      return existingDocument;
    }
    const clip = sanitizeAnimatedCostumeClip(costume.clip);
    if (clip) {
      return materializeAnimatedFrame(clip, 0);
    }
  }
  return migrateLegacyCostumeDocument(costume);
}

export function sanitizeCostume(value: unknown): Costume | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as LegacyCostumeShape & { id?: unknown; name?: unknown };
  const id = typeof maybe.id === 'string' && maybe.id.trim().length > 0 ? maybe.id : crypto.randomUUID();
  const name = typeof maybe.name === 'string' && maybe.name.trim().length > 0 ? maybe.name : 'costume';
  const assetId = typeof maybe.assetId === 'string' ? maybe.assetId : '';
  const bounds = maybe.bounds && typeof maybe.bounds === 'object'
    ? maybe.bounds as Costume['bounds']
    : undefined;
  const assetFrame = sanitizeCostumeAssetFrame(maybe.assetFrame);

  if (maybe.kind === 'animated') {
    const clip = sanitizeAnimatedCostumeClip(maybe.clip);
    if (clip) {
      return {
        id,
        name,
        kind: 'animated',
        assetId,
        bounds,
        assetFrame,
        document: materializeAnimatedFrame(clip, 0),
        clip,
      };
    }
  }

  return {
    id,
    name,
    kind: 'static',
    assetId,
    bounds,
    assetFrame,
    document: migrateLegacyCostumeDocument(maybe),
  };
}

export function cloneCostume(costume: Costume): Costume {
  if (isAnimatedCostume(costume)) {
    return {
      ...costume,
      bounds: costume.bounds ? { ...costume.bounds } : undefined,
      assetFrame: cloneCostumeAssetFrame(costume.assetFrame),
      document: cloneCostumeDocument(costume.document),
      clip: cloneAnimatedCostumeClip(costume.clip),
    };
  }

  return {
    ...costume,
    bounds: costume.bounds ? { ...costume.bounds } : undefined,
    assetFrame: cloneCostumeAssetFrame(costume.assetFrame),
    document: cloneCostumeDocument(costume.document),
  };
}
