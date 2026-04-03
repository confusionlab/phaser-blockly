import type { Id } from '@convex-generated/dataModel';
import {
  prepareSceneTemplateForStorage,
  hydrateSceneTemplateFromStorage,
  type PersistedSceneTemplateData,
  type ManagedAssetKind,
} from '@/db/database';
import { renderCostumeDocumentPreview } from '@/lib/costume/costumeDocumentRender';
import type {
  ComponentDefinition,
  ComponentFolder,
  Scene,
} from '@/types';
import { generateThumbnail } from '@/utils/convexHelpers';
import {
  ensureLibraryAssetRefsInCloud,
  ensureLibraryAssetsAvailableLocally,
  type LibraryAssetRef,
} from '@/lib/templateLibrary/libraryAssetRefs';
import {
  assertSupportedTemplateSchemaVersion,
  normalizeTemplateLibraryScope,
  type TemplateLibraryScope,
} from '@/lib/templateLibrary/templateSchema';

export interface SceneLibraryAssetRef extends LibraryAssetRef {
  kind: ManagedAssetKind;
}

export interface SceneLibraryListItemData {
  name: string;
  thumbnail: string;
  scope: TemplateLibraryScope;
  schemaVersion: number;
  assetRefs: Array<SceneLibraryAssetRef & { url: string | null }>;
  template: PersistedSceneTemplateData;
}

export interface SceneLibraryCreatePayload {
  name: string;
  thumbnail: string;
  assetRefs: SceneLibraryAssetRef[];
  template: PersistedSceneTemplateData;
}

export interface RuntimeSceneLibraryData {
  name: string;
  scene: Scene;
  components: ComponentDefinition[];
  componentFolders: ComponentFolder[];
}

interface CloudAssetApi {
  listMissingAssetIds: (assetIds: string[]) => Promise<string[]>;
  generateUploadUrl: () => Promise<string>;
  upsertAsset: (args: {
    assetId: string;
    kind: ManagedAssetKind;
    mimeType: string;
    size: number;
    storageId: Id<'_storage'>;
  }) => Promise<unknown>;
}

function createColorThumbnailDataUrl(color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }

  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function createTransparentThumbnailDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  return canvas.toDataURL('image/png');
}

async function buildSceneThumbnail(scene: Scene): Promise<string> {
  const background = scene.background;
  if (background?.type === 'color' && background.value) {
    return createColorThumbnailDataUrl(background.value);
  }

  const firstObjectCostume = scene.objects.find((object) => object.costumes.length > 0)?.costumes[0] ?? null;
  if (firstObjectCostume) {
    const rendered = await renderCostumeDocumentPreview(firstObjectCostume.document).catch(() => null);
    if (rendered?.dataUrl) {
      return await generateThumbnail(rendered.dataUrl, 128);
    }
  }

  return createTransparentThumbnailDataUrl();
}

export async function prepareSceneLibraryCreatePayload(data: {
  name: string;
  scene: Scene;
  components: ComponentDefinition[];
  componentFolders: ComponentFolder[];
}): Promise<SceneLibraryCreatePayload> {
  const prepared = await prepareSceneTemplateForStorage(data.scene, data.components, data.componentFolders);
  return {
    name: data.name,
    thumbnail: await buildSceneThumbnail(data.scene),
    assetRefs: prepared.assetRefs,
    template: prepared.template,
  };
}

export async function ensureSceneLibraryAssetRefsInCloud(
  refs: Iterable<SceneLibraryAssetRef>,
  api: CloudAssetApi,
): Promise<void> {
  await ensureLibraryAssetRefsInCloud(refs, api);
}

export async function hydrateSceneLibraryItemForInsertion(
  item: SceneLibraryListItemData,
): Promise<RuntimeSceneLibraryData> {
  const schemaVersion = assertSupportedTemplateSchemaVersion(
    item.schemaVersion,
    `${normalizeTemplateLibraryScope(item.scope)} scene template`,
  );
  await ensureLibraryAssetsAvailableLocally(item.assetRefs);
  const hydrated = await hydrateSceneTemplateFromStorage(item.template, schemaVersion);
  return {
    name: item.name,
    scene: hydrated.scene,
    components: hydrated.components,
    componentFolders: hydrated.componentFolders,
  };
}
