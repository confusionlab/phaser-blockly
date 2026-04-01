import type { Id } from '@convex-generated/dataModel';
import {
  ensureManagedAssetFromSource,
  getManagedAssetBlob,
  getManagedAssetLocators,
  getManagedAssetMetadata,
  hasManagedAsset,
  storeManagedAsset,
  type ManagedAssetKind,
} from '@/db/database';
import {
  cloneCostumeDocument,
  ensureCostumeDocument,
  getActiveCostumeLayer,
  isBitmapCostumeLayer,
} from '@/lib/costume/costumeDocument';
import { renderCostumeDocumentPreview } from '@/lib/costume/costumeDocumentRender';
import type {
  ColliderConfig,
  Costume,
  CostumeBounds,
  CostumeDocument,
  GameObject,
  PhysicsConfig,
  Sound,
  Variable,
} from '@/types';
import { assetSourceToBlob, generateThumbnail, urlToDataUrl } from '@/utils/convexHelpers';

export interface ObjectLibraryAssetRef {
  assetId: string;
  kind: Extract<ManagedAssetKind, 'image' | 'audio'>;
}

export interface ObjectLibraryStoredCostume {
  id: string;
  name: string;
  bounds?: CostumeBounds;
  document: CostumeDocument;
  previewUrl?: string | null;
}

export interface ObjectLibraryStoredSound {
  id: string;
  name: string;
  assetId?: string;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
  url?: string | null;
}

export interface ObjectLibraryListItemData {
  name: string;
  thumbnail: string;
  assetRefs: Array<ObjectLibraryAssetRef & { url: string | null }>;
  costumes: ObjectLibraryStoredCostume[];
  sounds: ObjectLibraryStoredSound[];
  blocklyXml: string;
  currentCostumeIndex?: number;
  physics?: PhysicsConfig;
  collider?: ColliderConfig;
  localVariables?: Variable[];
}

export interface ObjectLibraryCreatePayload {
  name: string;
  thumbnail: string;
  costumes: Array<{
    id: string;
    name: string;
    bounds?: CostumeBounds;
    document: CostumeDocument;
  }>;
  sounds: Array<{
    id: string;
    name: string;
    assetId: string;
    duration?: number;
    trimStart?: number;
    trimEnd?: number;
  }>;
  blocklyXml: string;
  currentCostumeIndex: number;
  physics: PhysicsConfig | null;
  collider: ColliderConfig | null;
  localVariables: Variable[];
}

export interface RuntimeLibraryObjectData {
  name: string;
  costumes: Costume[];
  sounds: Sound[];
  blocklyXml: string;
  currentCostumeIndex: number;
  physics: PhysicsConfig | null;
  collider: ColliderConfig | null;
  localVariables: Variable[];
}

interface CloudAssetApi {
  listMissingAssetIds: (assetIds: string[]) => Promise<string[]>;
  generateUploadUrl: () => Promise<string>;
  upsertAsset: (args: {
    assetId: string;
    kind: ObjectLibraryAssetRef['kind'];
    mimeType: string;
    size: number;
    storageId: Id<'_storage'>;
  }) => Promise<unknown>;
}

function createTransparentThumbnailDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  return canvas.toDataURL('image/png');
}

async function uploadManagedAssetToCloud(
  assetId: string,
  kind: ObjectLibraryAssetRef['kind'],
  generateUploadUrl: () => Promise<string>,
): Promise<{ storageId: string; mimeType: string; size: number }> {
  const blob = await getManagedAssetBlob(assetId);
  const metadata = await getManagedAssetMetadata(assetId);
  if (!blob || !metadata) {
    throw new Error(`Missing managed asset ${assetId}`);
  }

  const uploadUrl = await generateUploadUrl();
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': metadata.mimeType },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(`Asset upload failed (${response.status})`);
  }

  const result = (await response.json()) as { storageId: string };
  return {
    storageId: result.storageId,
    mimeType: metadata.mimeType,
    size: metadata.size,
  };
}

function collectUniqueAssetRefs(refs: Iterable<ObjectLibraryAssetRef>): ObjectLibraryAssetRef[] {
  return Array.from(
    Array.from(refs).reduce((map, ref) => {
      map.set(`${ref.kind}:${ref.assetId}`, ref);
      return map;
    }, new Map<string, ObjectLibraryAssetRef>()).values(),
  );
}

export async function ensureObjectLibraryAssetRefsInCloud(
  refs: Iterable<ObjectLibraryAssetRef>,
  api: CloudAssetApi,
): Promise<void> {
  const uniqueRefs = collectUniqueAssetRefs(refs);
  if (uniqueRefs.length === 0) {
    return;
  }

  const missingAssetIds = new Set(await api.listMissingAssetIds(uniqueRefs.map((ref) => ref.assetId)));
  for (const ref of uniqueRefs) {
    if (!missingAssetIds.has(ref.assetId)) {
      continue;
    }

    const upload = await uploadManagedAssetToCloud(ref.assetId, ref.kind, api.generateUploadUrl);
    await api.upsertAsset({
      assetId: ref.assetId,
      kind: ref.kind,
      mimeType: upload.mimeType,
      size: upload.size,
      storageId: upload.storageId as Id<'_storage'>,
    });
  }
}

export async function prepareObjectLibraryCreatePayload(data: {
  name: string;
  costumes: Costume[];
  sounds: Sound[];
  blocklyXml: string;
  currentCostumeIndex: number;
  physics: PhysicsConfig | null;
  collider: ColliderConfig | null;
  localVariables: Variable[];
}): Promise<{ payload: ObjectLibraryCreatePayload; assetRefs: ObjectLibraryAssetRef[] }> {
  const assetRefs: ObjectLibraryAssetRef[] = [];

  const normalizedCostumes = await Promise.all(
    data.costumes.map(async (costume) => {
      const originalDocument = cloneCostumeDocument(ensureCostumeDocument(costume));
      const normalizedDocument = cloneCostumeDocument(ensureCostumeDocument(costume));

      for (const layer of normalizedDocument.layers) {
        if (!isBitmapCostumeLayer(layer) || !layer.bitmap.assetId) {
          continue;
        }
        const managed = await ensureManagedAssetFromSource(layer.bitmap.assetId, 'image');
        assetRefs.push({ assetId: managed.assetId, kind: 'image' });
        layer.bitmap.assetId = managed.assetId;
        delete (layer.bitmap as { persistedAssetId?: string }).persistedAssetId;
      }

      const rendered = await renderCostumeDocumentPreview(originalDocument).catch(() => null);
      return {
        id: costume.id,
        name: costume.name,
        bounds: rendered?.bounds ?? costume.bounds,
        document: normalizedDocument,
      };
    }),
  );

  const normalizedSounds = await Promise.all(
    data.sounds.map(async (sound) => {
      const managed = await ensureManagedAssetFromSource(sound.assetId, 'audio');
      assetRefs.push({ assetId: managed.assetId, kind: 'audio' });
      return {
        id: sound.id,
        name: sound.name,
        assetId: managed.assetId,
        duration: sound.duration,
        trimStart: sound.trimStart,
        trimEnd: sound.trimEnd,
      };
    }),
  );

  const safeCostumeIndex = normalizedCostumes.length === 0
    ? 0
    : Math.min(Math.max(0, data.currentCostumeIndex), normalizedCostumes.length - 1);
  const selectedCostume = data.costumes[safeCostumeIndex] ?? data.costumes[0] ?? null;
  const selectedPreview = selectedCostume
    ? await renderCostumeDocumentPreview(cloneCostumeDocument(ensureCostumeDocument(selectedCostume))).catch(() => null)
    : null;
  const thumbnail = selectedPreview?.dataUrl
    ? await generateThumbnail(selectedPreview.dataUrl, 128)
    : createTransparentThumbnailDataUrl();

  return {
    payload: {
      name: data.name,
      thumbnail,
      costumes: normalizedCostumes,
      sounds: normalizedSounds,
      blocklyXml: data.blocklyXml,
      currentCostumeIndex: safeCostumeIndex,
      physics: data.physics,
      collider: data.collider,
      localVariables: data.localVariables,
    },
    assetRefs: collectUniqueAssetRefs(assetRefs),
  };
}

export async function hydrateObjectLibraryItemForInsertion(
  item: ObjectLibraryListItemData,
): Promise<RuntimeLibraryObjectData> {
  for (const asset of item.assetRefs) {
    if (await hasManagedAsset(asset.assetId)) {
      continue;
    }
    if (!asset.url) {
      throw new Error(`Object library asset ${asset.assetId} is unavailable`);
    }
    const blob = await assetSourceToBlob(asset.url);
    await storeManagedAsset(asset.assetId, blob, asset.kind);
  }

  const assetLocators = await getManagedAssetLocators(item.assetRefs.map((asset) => asset.assetId));
  const assetUrlById = new Map(
    assetLocators
      .filter((locator) => locator.url)
      .map((locator) => [locator.assetId, locator.url as string]),
  );
  const legacyPreviewCache = new Map<string, string>();

  const costumes = await Promise.all(
    item.costumes.map(async (costume) => {
      const document = cloneCostumeDocument(ensureCostumeDocument(costume));
      for (const layer of document.layers) {
        if (!isBitmapCostumeLayer(layer) || !layer.bitmap.assetId) {
          continue;
        }
        const persistedAssetId = layer.bitmap.assetId;
        const localUrl = assetUrlById.get(persistedAssetId);
        if (!localUrl) {
          continue;
        }
        layer.bitmap.persistedAssetId = persistedAssetId;
        layer.bitmap.assetId = localUrl;
      }

      const rendered = await renderCostumeDocumentPreview(document).catch(() => null);
      let fallbackPreviewUrl: string | null = null;
      if (!rendered?.dataUrl && costume.previewUrl) {
        fallbackPreviewUrl = legacyPreviewCache.get(costume.previewUrl) ?? await urlToDataUrl(costume.previewUrl);
        legacyPreviewCache.set(costume.previewUrl, fallbackPreviewUrl);
        const activeLayer = getActiveCostumeLayer(document);
        if (isBitmapCostumeLayer(activeLayer) && !activeLayer.bitmap.assetId) {
          activeLayer.bitmap.assetId = fallbackPreviewUrl;
        }
      }

      return {
        id: crypto.randomUUID(),
        name: costume.name,
        assetId: rendered?.dataUrl ?? fallbackPreviewUrl ?? '',
        assetFrame: rendered?.assetFrame,
        bounds: rendered?.bounds ?? costume.bounds,
        document,
      } satisfies Costume;
    }),
  );

  const sounds = await Promise.all(
    item.sounds.map(async (sound) => {
      let assetSource = sound.assetId ? assetUrlById.get(sound.assetId) ?? null : null;
      if (!assetSource && sound.url) {
        assetSource = sound.url;
      }
      if (!assetSource) {
        throw new Error(`Object library sound ${sound.name} is unavailable`);
      }

      return {
        id: crypto.randomUUID(),
        name: sound.name,
        assetId: assetSource,
        duration: sound.duration,
        trimStart: sound.trimStart,
        trimEnd: sound.trimEnd,
      } satisfies Sound;
    }),
  );

  return {
    name: item.name,
    costumes,
    sounds,
    blocklyXml: item.blocklyXml,
    currentCostumeIndex: item.currentCostumeIndex ?? 0,
    physics: item.physics ?? null,
    collider: item.collider ?? null,
    localVariables: item.localVariables ?? [],
  };
}
