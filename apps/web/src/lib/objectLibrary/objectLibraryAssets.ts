import type { Id } from '@convex-generated/dataModel';
import {
  ensureManagedAssetFromSource,
  getManagedAssetLocators,
  migrateRuntimeProjectDataForTemplate,
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
import { createDefaultGameObject, createDefaultScene } from '@/types';
import { generateThumbnail, urlToDataUrl } from '@/utils/convexHelpers';
import {
  collectUniqueLibraryAssetRefs,
  ensureLibraryAssetRefsInCloud,
  ensureLibraryAssetsAvailableLocally,
} from '@/lib/templateLibrary/libraryAssetRefs';
import {
  assertSupportedTemplateSchemaVersion,
  normalizeTemplateLibraryScope,
  type TemplateLibraryScope,
} from '@/lib/templateLibrary/templateSchema';

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
  scope: TemplateLibraryScope;
  schemaVersion: number;
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

interface SaveObjectLibraryItemApi extends CloudAssetApi {
  createItem: (payload: {
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
    physics?: PhysicsConfig;
    collider?: ColliderConfig;
    localVariables: Variable[];
  }) => Promise<unknown>;
}

function createTransparentThumbnailDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  return canvas.toDataURL('image/png');
}

export async function ensureObjectLibraryAssetRefsInCloud(
  refs: Iterable<ObjectLibraryAssetRef>,
  api: CloudAssetApi,
): Promise<void> {
  await ensureLibraryAssetRefsInCloud(refs, api);
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
    assetRefs: collectUniqueLibraryAssetRefs(assetRefs),
  };
}

export async function saveRuntimeObjectToLibrary(
  data: RuntimeLibraryObjectData,
  api: SaveObjectLibraryItemApi,
): Promise<void> {
  const prepared = await prepareObjectLibraryCreatePayload(data);

  await ensureObjectLibraryAssetRefsInCloud(prepared.assetRefs, api);

  await api.createItem({
    ...prepared.payload,
    physics: prepared.payload.physics ?? undefined,
    collider: prepared.payload.collider ?? undefined,
    localVariables: prepared.payload.localVariables,
  });
}

export async function hydrateObjectLibraryItemForInsertion(
  item: ObjectLibraryListItemData,
): Promise<RuntimeLibraryObjectData> {
  const schemaVersion = assertSupportedTemplateSchemaVersion(
    item.schemaVersion,
    `${normalizeTemplateLibraryScope(item.scope)} object template`,
  );
  const baseObject = createDefaultGameObject(item.name);
  const migratedRuntimeProject = migrateRuntimeProjectDataForTemplate({
    schemaVersion,
    scenes: [{
      ...createDefaultScene('template-scene', 'Template Scene', 0),
      background: null,
      objects: [{
        ...baseObject,
        id: 'template-object',
        name: item.name,
        blocklyXml: item.blocklyXml,
        costumes: cloneCostumesForMigration(item.costumes),
        currentCostumeIndex: item.currentCostumeIndex ?? 0,
        physics: item.physics ?? null,
        collider: item.collider ?? null,
        sounds: cloneSoundsForMigration(item.sounds),
        localVariables: cloneVariablesForMigration(item.localVariables ?? []),
      }],
      objectFolders: [],
    }],
    sceneFolders: [],
    messages: [],
    globalVariables: [],
    settings: {
      canvasWidth: 800,
      canvasHeight: 600,
      backgroundColor: '#87CEEB',
    },
    components: [],
    componentFolders: [],
  }, schemaVersion);
  const migratedObject = migratedRuntimeProject.scenes[0]?.objects[0];
  if (!migratedObject) {
    throw new Error(`Object library item "${item.name}" is unavailable`);
  }

  const migratedItem: ObjectLibraryListItemData = {
    ...item,
    name: migratedObject.name,
    blocklyXml: migratedObject.blocklyXml,
    currentCostumeIndex: migratedObject.currentCostumeIndex,
    physics: migratedObject.physics ?? undefined,
    collider: migratedObject.collider ?? undefined,
    localVariables: migratedObject.localVariables,
    costumes: migratedObject.costumes.map((costume) => ({
      id: costume.id,
      name: costume.name,
      bounds: costume.bounds,
      document: cloneCostumeDocument(ensureCostumeDocument(costume)),
    })),
    sounds: migratedObject.sounds.map((sound) => ({
      id: sound.id,
      name: sound.name,
      assetId: sound.assetId,
      duration: sound.duration,
      trimStart: sound.trimStart,
      trimEnd: sound.trimEnd,
    })),
  };

  await ensureLibraryAssetsAvailableLocally(migratedItem.assetRefs);

  const assetLocators = await getManagedAssetLocators(migratedItem.assetRefs.map((asset) => asset.assetId));
  const assetUrlById = new Map(
    assetLocators
      .filter((locator) => locator.url)
      .map((locator) => [locator.assetId, locator.url as string]),
  );
  const legacyPreviewCache = new Map<string, string>();

  const costumes = await Promise.all(
    migratedItem.costumes.map(async (costume) => {
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
    migratedItem.sounds.map(async (sound) => {
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
    name: migratedItem.name,
    costumes,
    sounds,
    blocklyXml: migratedItem.blocklyXml,
    currentCostumeIndex: migratedItem.currentCostumeIndex ?? 0,
    physics: migratedItem.physics ?? null,
    collider: migratedItem.collider ?? null,
    localVariables: migratedItem.localVariables ?? [],
  };
}

function cloneCostumesForMigration(costumes: ObjectLibraryStoredCostume[]): Costume[] {
  return costumes.map((costume) => ({
    id: costume.id,
    name: costume.name,
    assetId: '',
    bounds: costume.bounds,
    document: cloneCostumeDocument(ensureCostumeDocument(costume)),
  }));
}

function cloneSoundsForMigration(sounds: ObjectLibraryStoredSound[]): Sound[] {
  return sounds.map((sound) => ({
    id: sound.id,
    name: sound.name,
    assetId: sound.assetId ?? '',
    duration: sound.duration,
    trimStart: sound.trimStart,
    trimEnd: sound.trimEnd,
  }));
}

function cloneVariablesForMigration(variables: Variable[]): Variable[] {
  return variables.map((variable) => ({ ...variable }));
}
