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
import type { Costume, CostumeBounds, CostumeDocument } from '@/types';
import { createDefaultGameObject, createDefaultScene } from '@/types';
import { generateThumbnail } from '@/utils/convexHelpers';
import {
  collectUniqueLibraryAssetRefs,
  ensureLibraryAssetsAvailableLocally,
  type LibraryAssetRef,
} from '@/lib/templateLibrary/libraryAssetRefs';
import {
  assertSupportedTemplateSchemaVersion,
  normalizeTemplateLibraryScope,
  type TemplateLibraryScope,
} from '@/lib/templateLibrary/templateSchema';

export interface CostumeLibraryAssetRef extends LibraryAssetRef {
  kind: Extract<ManagedAssetKind, 'image'>;
}

export interface CostumeLibraryListItemData {
  name: string;
  thumbnail: string;
  bounds?: CostumeBounds;
  document: CostumeDocument;
  assetRefs: Array<CostumeLibraryAssetRef & { url: string | null }>;
  imageUrl: string | null;
  scope: TemplateLibraryScope;
  schemaVersion: number;
}

export interface CostumeLibraryCreatePayload {
  name: string;
  thumbnail: string;
  bounds?: CostumeBounds;
  document: CostumeDocument;
}

export async function prepareCostumeLibraryCreatePayload(costume: Costume): Promise<{
  payload: CostumeLibraryCreatePayload;
  assetRefs: CostumeLibraryAssetRef[];
}> {
  const normalizedDocument = cloneCostumeDocument(ensureCostumeDocument(costume));
  const assetRefs: CostumeLibraryAssetRef[] = [];

  for (const layer of normalizedDocument.layers) {
    if (!isBitmapCostumeLayer(layer) || !layer.bitmap.assetId) {
      continue;
    }
    const managed = await ensureManagedAssetFromSource(layer.bitmap.assetId, 'image');
    assetRefs.push({ assetId: managed.assetId, kind: 'image' });
    layer.bitmap.assetId = managed.assetId;
    delete (layer.bitmap as { persistedAssetId?: string }).persistedAssetId;
  }

  const rendered = await renderCostumeDocumentPreview(costume.document).catch(() => null);
  const thumbnailSource = rendered?.dataUrl ?? costume.assetId;
  if (!thumbnailSource) {
    throw new Error(`Costume "${costume.name}" is missing a preview source`);
  }

  return {
    payload: {
      name: costume.name,
      thumbnail: await generateThumbnail(thumbnailSource, 128),
      bounds: rendered?.bounds ?? costume.bounds,
      document: normalizedDocument,
    },
    assetRefs: collectUniqueLibraryAssetRefs(assetRefs),
  };
}

export async function hydrateCostumeLibraryItemForInsertion(
  item: CostumeLibraryListItemData,
): Promise<{
  name: string;
  dataUrl: string;
  bounds?: CostumeBounds;
  document: CostumeDocument;
}> {
  const schemaVersion = assertSupportedTemplateSchemaVersion(
    item.schemaVersion,
    `${normalizeTemplateLibraryScope(item.scope)} costume template`,
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
        costumes: [{
          id: 'template-costume',
          name: item.name,
          assetId: '',
          bounds: item.bounds,
          document: cloneCostumeDocument(ensureCostumeDocument(item.document)),
        }],
        currentCostumeIndex: 0,
        sounds: [],
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
  const migratedCostume = migratedRuntimeProject.scenes[0]?.objects[0]?.costumes[0];
  if (!migratedCostume) {
    throw new Error(`Costume library item "${item.name}" is unavailable`);
  }

  const migratedItem: CostumeLibraryListItemData = {
    ...item,
    name: migratedCostume.name,
    bounds: migratedCostume.bounds,
    document: cloneCostumeDocument(ensureCostumeDocument(migratedCostume)),
  };

  await ensureLibraryAssetsAvailableLocally(migratedItem.assetRefs);

  const assetLocators = await getManagedAssetLocators(migratedItem.assetRefs.map((asset) => asset.assetId));
  const assetUrlById = new Map(
    assetLocators
      .filter((locator) => locator.url)
      .map((locator) => [locator.assetId, locator.url as string]),
  );

  const document = cloneCostumeDocument(ensureCostumeDocument(migratedItem.document));
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

  const activeLayer = getActiveCostumeLayer(document);
  if (isBitmapCostumeLayer(activeLayer) && !activeLayer.bitmap.assetId && migratedItem.imageUrl) {
    activeLayer.bitmap.assetId = migratedItem.imageUrl;
  }

  const rendered = await renderCostumeDocumentPreview(document).catch(() => null);
  const dataUrl = rendered?.dataUrl ?? migratedItem.imageUrl;
  if (!dataUrl) {
    throw new Error(`Costume library item "${migratedItem.name}" is unavailable`);
  }

  return {
    name: migratedItem.name,
    dataUrl,
    bounds: rendered?.bounds ?? migratedItem.bounds,
    document,
  };
}
