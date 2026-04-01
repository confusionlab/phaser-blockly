import { ensureManagedAssetFromSource, migrateRuntimeProjectDataForTemplate } from '@/db/database';
import type { Sound } from '@/types';
import { createDefaultGameObject, createDefaultScene } from '@/types';
import {
  ensureLibraryAssetsAvailableLocally,
  type LibraryAssetRef,
} from '@/lib/templateLibrary/libraryAssetRefs';
import {
  assertSupportedTemplateSchemaVersion,
  normalizeTemplateLibraryScope,
  type TemplateLibraryScope,
} from '@/lib/templateLibrary/templateSchema';

export interface SoundLibraryListItemData {
  name: string;
  assetId?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
  url: string | null;
  scope: TemplateLibraryScope;
  schemaVersion: number;
}

export interface SoundLibraryCreatePayload {
  name: string;
  assetId: string;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
}

export async function prepareSoundLibraryCreatePayload(sound: Sound): Promise<{
  payload: SoundLibraryCreatePayload;
  assetRefs: Array<LibraryAssetRef & { kind: 'audio' }>;
}> {
  const managed = await ensureManagedAssetFromSource(sound.assetId, 'audio');
  return {
    payload: {
      name: sound.name,
      assetId: managed.assetId,
      duration: sound.duration,
      trimStart: sound.trimStart,
      trimEnd: sound.trimEnd,
    },
    assetRefs: [{ assetId: managed.assetId, kind: 'audio' }],
  };
}

export async function hydrateSoundLibraryItemForInsertion(
  item: SoundLibraryListItemData,
): Promise<{
  name: string;
  dataUrl: string;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
}> {
  const schemaVersion = assertSupportedTemplateSchemaVersion(
    item.schemaVersion,
    `${normalizeTemplateLibraryScope(item.scope)} sound template`,
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
        costumes: [],
        currentCostumeIndex: 0,
        sounds: [{
          id: 'template-sound',
          name: item.name,
          assetId: item.assetId ?? '',
          duration: item.duration,
          trimStart: item.trimStart,
          trimEnd: item.trimEnd,
        }],
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
  const migratedSound = migratedRuntimeProject.scenes[0]?.objects[0]?.sounds[0];
  if (!migratedSound) {
    throw new Error(`Sound library item "${item.name}" is unavailable`);
  }

  if (migratedSound.assetId && item.url) {
    await ensureLibraryAssetsAvailableLocally([{ assetId: migratedSound.assetId, kind: 'audio', url: item.url }]);
  }

  if (!item.url) {
    throw new Error(`Sound library item "${migratedSound.name}" is unavailable`);
  }

  return {
    name: migratedSound.name,
    dataUrl: item.url,
    duration: migratedSound.duration,
    trimStart: migratedSound.trimStart,
    trimEnd: migratedSound.trimEnd,
  };
}
