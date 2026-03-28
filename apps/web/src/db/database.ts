import Dexie, { type EntityTable } from 'dexie';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type {
  BackgroundConfig,
  CostumeAssetFrame,
  MessageDefinition,
  Project,
  ReusableObject,
} from '../types';
import {
  COMPONENT_ANY_PREFIX,
  MESSAGE_REFERENCE_BLOCKS,
  OBJECT_REFERENCE_BLOCKS,
  PICK_FROM_STAGE,
  SCENE_REFERENCE_BLOCKS,
  SOUND_REFERENCE_BLOCKS,
  TYPE_REFERENCE_BLOCKS,
  VALID_OBJECT_SPECIAL_VALUES,
  VARIABLE_REFERENCE_BLOCKS,
} from '@/lib/blocklyReferenceMaps';
import { normalizeVariableDefinition } from '@/lib/variableUtils';
import { normalizeProjectLayering } from '@/utils/layerTree';
import {
  cloneCostumeDocument,
  ensureCostumeDocument,
  isBitmapCostumeLayer,
} from '@/lib/costume/costumeDocument';
import {
  cloneBackgroundDocument,
  ensureBackgroundDocument,
  isBitmapBackgroundLayer,
} from '@/lib/background/backgroundDocument';
import { cloneCostumeAssetFrame } from '@/lib/costume/costumeAssetFrame';
import {
  optimizeCostumeBitmapAssetSource,
} from '@/lib/costume/costumeAssetOptimization';
import {
  PROJECT_EXPLORER_RECORD_ID,
  PROJECT_EXPLORER_ROOT_FOLDER_ID,
  collectProjectExplorerAssetIds,
  collectProjectExplorerFolderSubtreeIds,
  createDefaultProjectExplorerState,
  createProjectExplorerFolder,
  createProjectExplorerProjectMeta,
  isProjectExplorerDescendantFolder,
  mergeProjectExplorerStates,
  normalizeProjectExplorerState,
  type ProjectExplorerFolder,
  type ProjectExplorerProjectMeta,
  type ProjectExplorerState,
} from '@/lib/projectExplorer';
import type {
  ManagedAssetLocator,
  ProjectCatalogLocalProjectSummary,
} from '@/lib/projectExplorerCatalog';
import {
  computeProjectThumbnailVisualSignature,
  renderProjectThumbnail,
} from '@/lib/projectThumbnail';
import {
  getCostumeDocumentPreviewSignature,
  renderCostumeDocument,
} from '@/lib/costume/costumeDocumentRender';
import { invalidateImageSource } from '@/lib/assets/imageSourceCache';

// Current schema version - increment when project structure changes (see CLAUDE.md)
export const CURRENT_SCHEMA_VERSION = 10;

// App version comes from Vite define (derived from package.json)
export const APP_VERSION = __APP_VERSION__;

// Database schema
interface ProjectRecordV1 {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  data: string; // JSON stringified Project (scenes, settings, etc.)
}

interface ProjectRecord extends ProjectRecordV1 {
  schemaVersion: number;
  appVersion?: string;
  cloudBacked?: boolean;
  contentHash?: string;
  assetIds?: string[];
  revisionCount?: number;
  latestRevisionId?: string | null;
  latestRevisionCreatedAt?: number | null;
  latestRevisionContentHash?: string | null;
  revisionsUpdatedAt?: number | null;
}

export type ProjectRevisionReason =
  | 'manual_checkpoint'
  | 'auto_checkpoint'
  | 'import'
  | 'restore'
  | 'edit_revision';

export type ProjectRevisionKind = 'snapshot' | 'delta';

interface ProjectRevisionRecord {
  id: string;
  projectId: string;
  parentRevisionId?: string;
  kind: ProjectRevisionKind;
  baseRevisionId: string;
  snapshotData?: string;
  patch?: string;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
  appVersion?: string;
  reason: ProjectRevisionReason;
  checkpointName?: string;
  isCheckpoint: boolean;
  restoredFromRevisionId?: string;
  assetIds?: string[];
}

export interface ProjectRevision {
  id: string;
  projectId: string;
  parentRevisionId: string | null;
  kind: ProjectRevisionKind;
  baseRevisionId: string;
  contentHash: string;
  createdAt: Date;
  schemaVersion: number;
  appVersion?: string;
  reason: ProjectRevisionReason;
  checkpointName: string | null;
  isCheckpoint: boolean;
  restoredFromRevisionId: string | null;
}

export type ManagedAssetKind = 'image' | 'audio' | 'background';

interface AssetRecord {
  id: string;
  hash: string;
  kind: ManagedAssetKind;
  mimeType: string;
  size: number;
  blob: Blob;
  createdAt: Date;
  updatedAt: Date;
  orphanedAt?: Date;
}

interface PersistedProjectAssetRef {
  assetId: string;
  kind: ManagedAssetKind;
}

interface ReusableRecord {
  id: string;
  name: string;
  thumbnail: string;
  data: string; // JSON stringified ReusableObject data
  createdAt: Date;
  tags: string[];
}

interface ProjectExplorerStateRecord {
  id: string;
  data: string;
  updatedAt: Date;
}

export interface ProjectExplorerSyncPayload {
  data: string;
  updatedAt: number;
  contentHash: string;
  assetIds: string[];
}

export interface ProjectExplorerFolderSummary extends ProjectExplorerFolder {
  projectCount: number;
}

export interface ProjectExplorerProjectSummary {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  folderId: string;
  trashedAt: number | null;
  thumbnailAssetId: string | null;
  thumbnailStale: boolean;
  thumbnailUrl: string | null;
}

export interface LocalProjectCatalogSnapshot {
  explorerState: ProjectExplorerState;
  projects: ProjectCatalogLocalProjectSummary[];
}

function normalizeSchemaVersion(version: unknown): number {
  if (typeof version === 'number' && Number.isFinite(version) && version >= 1) {
    return Math.floor(version);
  }

  if (typeof version === 'string') {
    const parsed = Number.parseFloat(version);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }

  return 1;
}

function normalizeCostumeDocumentsInProject(project: Project): Project {
  const normalizeCostume = (costume: any) => ({
    ...costume,
    document: cloneCostumeDocument(ensureCostumeDocument(costume)),
  });

  return {
    ...project,
    scenes: (project.scenes || []).map((scene) => ({
      ...scene,
      objects: (scene.objects || []).map((obj) => ({
        ...obj,
        costumes: (obj.costumes || []).map(normalizeCostume),
      })),
    })),
    components: (project.components || []).map((component) => ({
      ...component,
      costumes: (component.costumes || []).map(normalizeCostume),
    })),
  };
}

function normalizeBackgroundDocumentsInProject(project: Project): Project {
  return {
    ...project,
    scenes: (project.scenes || []).map((scene) => ({
      ...scene,
      background: scene.background
        ? {
            ...scene.background,
            document: cloneBackgroundDocument(ensureBackgroundDocument(scene.background)),
          }
        : null,
    })),
  };
}

function normalizeMessagesInProject(project: Project): Project {
  const normalizedMessages: MessageDefinition[] = Array.isArray(project.messages)
    ? project.messages
        .filter((message): message is MessageDefinition => {
          return (
            typeof message?.id === 'string' &&
            message.id.trim().length > 0 &&
            typeof message?.name === 'string' &&
            message.name.trim().length > 0
          );
        })
        .map((message) => ({
          id: message.id.trim(),
          name: message.name.trim(),
        }))
    : [];

  return {
    ...project,
    messages: normalizedMessages,
  };
}

const MANAGED_ASSET_PREFIX = 'asset:';
const MANAGED_ASSET_ID_PATTERN = /^asset:([0-9a-f]{64})$/i;
const MANAGED_ASSET_GC_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const objectUrlCache = new Map<string, string>();
const objectUrlToAssetId = new Map<string, string>();
const sourceToManagedAssetIdCache = new Map<string, string>();

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isManagedAssetId(value: unknown): value is string {
  return typeof value === 'string' && MANAGED_ASSET_ID_PATTERN.test(value.trim());
}

function isLikelyAssetSource(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toManagedAssetId(hash: string): string {
  return `${MANAGED_ASSET_PREFIX}${hash}`;
}

async function computeSha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const view = new Uint8Array(digest);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchBlobFromSource(source: string): Promise<Blob> {
  if (isManagedAssetId(source)) {
    const record = await db.assets.get(source);
    if (!record) {
      throw new Error(`Missing managed asset ${source}`);
    }
    return record.blob;
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to load asset source (${response.status})`);
  }
  return await response.blob();
}

function defaultMimeTypeForKind(kind: ManagedAssetKind): string {
  switch (kind) {
    case 'audio':
      return 'audio/webm';
    case 'background':
      return 'image/webp';
    case 'image':
    default:
      return 'image/webp';
  }
}

async function ensureAssetRecordFromBlob(
  blob: Blob,
  kind: ManagedAssetKind,
  source?: string,
): Promise<AssetRecord> {
  const hash = await computeSha256Hex(blob);
  const id = toManagedAssetId(hash);
  const existing = await db.assets.get(id);
  if (existing) {
    if (source) {
      sourceToManagedAssetIdCache.set(source, existing.id);
    }
    return existing;
  }

  const now = new Date();
  const record: AssetRecord = {
    id,
    hash,
    kind,
    mimeType: blob.type || defaultMimeTypeForKind(kind),
    size: blob.size,
    blob,
    createdAt: now,
    updatedAt: now,
  };

  await db.assets.put(record);
  if (source) {
    sourceToManagedAssetIdCache.set(source, id);
  }
  return record;
}

async function ensureAssetRecordFromSource(
  source: string,
  kind: ManagedAssetKind,
): Promise<AssetRecord> {
  if (isManagedAssetId(source)) {
    const existing = await db.assets.get(source);
    if (!existing) {
      throw new Error(`Missing managed asset ${source}`);
    }
    return existing;
  }

  const cachedId = sourceToManagedAssetIdCache.get(source);
  if (cachedId) {
    const existing = await db.assets.get(cachedId);
    if (existing) {
      return existing;
    }
  }

  const blob = await fetchBlobFromSource(source);
  return await ensureAssetRecordFromBlob(blob, kind, source);
}

function cacheObjectUrl(assetId: string, objectUrl: string): string {
  objectUrlCache.set(assetId, objectUrl);
  objectUrlToAssetId.set(objectUrl, assetId);
  sourceToManagedAssetIdCache.set(objectUrl, assetId);
  return objectUrl;
}

function clearManagedAssetObjectUrl(assetId: string): void {
  const objectUrl = objectUrlCache.get(assetId);
  if (objectUrl) {
    invalidateImageSource(objectUrl);
    URL.revokeObjectURL(objectUrl);
    objectUrlCache.delete(assetId);
    objectUrlToAssetId.delete(objectUrl);
    sourceToManagedAssetIdCache.delete(objectUrl);
  }
}

async function resolveManagedAssetUrl(assetId: string): Promise<string | null> {
  const cached = objectUrlCache.get(assetId);
  if (cached) {
    return cached;
  }

  const record = await db.assets.get(assetId);
  if (!record) {
    return null;
  }

  return cacheObjectUrl(assetId, URL.createObjectURL(record.blob));
}

async function storeManagedAssetBlob(
  assetId: string,
  blob: Blob,
  kind: ManagedAssetKind,
): Promise<AssetRecord> {
  const hashMatch = assetId.match(MANAGED_ASSET_ID_PATTERN);
  if (!hashMatch) {
    throw new Error(`Invalid managed asset id: ${assetId}`);
  }

  const computedHash = await computeSha256Hex(blob);
  if (computedHash !== hashMatch[1].toLowerCase()) {
    throw new Error(`Asset hash mismatch for ${assetId}`);
  }

  const existing = await db.assets.get(assetId);
  if (existing) {
    return existing;
  }

  const now = new Date();
  const record: AssetRecord = {
    id: assetId,
    hash: computedHash,
    kind,
    mimeType: blob.type || defaultMimeTypeForKind(kind),
    size: blob.size,
    blob,
    createdAt: now,
    updatedAt: now,
  };
  await db.assets.put(record);
  return record;
}

export async function hasManagedAsset(assetId: string): Promise<boolean> {
  return (await db.assets.get(assetId)) !== undefined;
}

export async function getManagedAssetBlob(assetId: string): Promise<Blob | null> {
  const record = await db.assets.get(assetId);
  return record?.blob ?? null;
}

export async function getManagedAssetMetadata(assetId: string): Promise<{
  assetId: string;
  kind: ManagedAssetKind;
  mimeType: string;
  size: number;
} | null> {
  const record = await db.assets.get(assetId);
  if (!record) {
    return null;
  }
  return {
    assetId: record.id,
    kind: record.kind,
    mimeType: record.mimeType,
    size: record.size,
  };
}

export async function storeManagedAsset(
  assetId: string,
  blob: Blob,
  kind: ManagedAssetKind,
): Promise<void> {
  await storeManagedAssetBlob(assetId, blob, kind);
}

function serializeProjectExplorerState(state: ProjectExplorerState): string {
  return JSON.stringify(state);
}

function parseProjectExplorerStateRecord(record: ProjectExplorerStateRecord | undefined): ProjectExplorerState {
  if (!record) {
    return createDefaultProjectExplorerState();
  }

  try {
    return normalizeProjectExplorerState(JSON.parse(record.data));
  } catch {
    return createDefaultProjectExplorerState(record.updatedAt.getTime());
  }
}

function normalizeProjectExplorerStateAgainstProjectRecords(
  state: ProjectExplorerState,
  projectRecords: ProjectRecord[],
): { changed: boolean; state: ProjectExplorerState; touchedThumbnailAssetIds: string[] } {
  const normalized = normalizeProjectExplorerState(state);
  const metadataByProjectId = new Map(normalized.projects.map((projectMeta) => [projectMeta.projectId, projectMeta]));
  const nextProjects: ProjectExplorerProjectMeta[] = [];
  const touchedThumbnailAssetIds = new Set<string>();
  let changed = false;

  for (const record of projectRecords) {
    const existing = metadataByProjectId.get(record.id);
    if (existing) {
      nextProjects.push({
        ...existing,
        createdAt: existing.createdAt || record.createdAt.getTime(),
      });
      metadataByProjectId.delete(record.id);
      continue;
    }

    changed = true;
    nextProjects.push(createProjectExplorerProjectMeta(record.id, {
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    }));
  }

  for (const orphanedMeta of metadataByProjectId.values()) {
    changed = true;
    if (orphanedMeta.thumbnailAssetId) {
      touchedThumbnailAssetIds.add(orphanedMeta.thumbnailAssetId);
    }
  }

  const nextState = normalizeProjectExplorerState({
    ...normalized,
    updatedAt: changed ? Date.now() : normalized.updatedAt,
    projects: nextProjects,
  });

  if (!changed && nextState.projects.length !== normalized.projects.length) {
    changed = true;
  }

  return {
    changed,
    state: nextState,
    touchedThumbnailAssetIds: Array.from(touchedThumbnailAssetIds),
  };
}

async function saveProjectExplorerStateInternal(
  state: ProjectExplorerState,
): Promise<ProjectExplorerState> {
  const normalizedState = normalizeProjectExplorerState(state);
  const nextRecord: ProjectExplorerStateRecord = {
    id: PROJECT_EXPLORER_RECORD_ID,
    data: serializeProjectExplorerState(normalizedState),
    updatedAt: new Date(normalizedState.updatedAt),
  };
  await db.projectExplorerState.put(nextRecord);
  return normalizedState;
}

async function loadProjectExplorerStateInternal(): Promise<ProjectExplorerState> {
  const [record, projectRecords] = await Promise.all([
    db.projectExplorerState.get(PROJECT_EXPLORER_RECORD_ID),
    db.projects.toArray(),
  ]);
  const parsedState = parseProjectExplorerStateRecord(record);
  const { changed, state, touchedThumbnailAssetIds } = normalizeProjectExplorerStateAgainstProjectRecords(
    parsedState,
    projectRecords,
  );

  if (changed || !record) {
    await saveProjectExplorerStateInternal(state);
    if (touchedThumbnailAssetIds.length > 0) {
      await garbageCollectManagedAssets(touchedThumbnailAssetIds);
    }
  }

  return state;
}

async function updateProjectExplorerState(
  updater: (state: ProjectExplorerState) => ProjectExplorerState,
): Promise<ProjectExplorerState> {
  const currentState = await loadProjectExplorerStateInternal();
  const nextState = normalizeProjectExplorerState(updater(currentState));
  const previousAssetIds = collectProjectExplorerAssetIds(currentState);
  const nextAssetIds = collectProjectExplorerAssetIds(nextState);
  await saveProjectExplorerStateInternal(nextState);
  await garbageCollectManagedAssets(new Set([...previousAssetIds, ...nextAssetIds]));
  return nextState;
}

async function collectProjectExplorerReferencedAssetIds(): Promise<string[]> {
  const record = await db.projectExplorerState.get(PROJECT_EXPLORER_RECORD_ID);
  return collectProjectExplorerAssetIds(parseProjectExplorerStateRecord(record));
}

async function ensureStoredProjectExplorerProjectMeta(
  projectId: string,
  options: {
    createdAt?: number;
    updatedAt?: number;
  } = {},
): Promise<void> {
  await updateProjectExplorerState((state) => {
    if (state.projects.some((projectMeta) => projectMeta.projectId === projectId)) {
      return state;
    }

    return {
      ...state,
      updatedAt: Date.now(),
      projects: [
        ...state.projects,
        createProjectExplorerProjectMeta(projectId, {
          createdAt: options.createdAt,
          updatedAt: options.updatedAt,
        }),
      ],
    };
  });
}

function getPersistedAssetIdsFromRecord(record: { assetIds?: string[] }, fallbackData?: string): string[] {
  if (Array.isArray(record.assetIds)) {
    return record.assetIds.filter((assetId): assetId is string => isManagedAssetId(assetId));
  }
  if (typeof fallbackData === 'string') {
    try {
      return collectPersistedAssetRefsFromSerializedProjectData(fallbackData).map((assetRef) => assetRef.assetId);
    } catch {
      return [];
    }
  }
  return [];
}

async function collectReferencedManagedAssetIdsForCandidates(
  candidateIds: Set<string>,
): Promise<Set<string>> {
  if (candidateIds.size === 0) {
    return new Set();
  }

  const referencedIds = new Set<string>();
  const projectRecords = await db.projects.toArray();
  for (const record of projectRecords) {
    for (const assetId of getPersistedAssetIdsFromRecord(record, record.data)) {
      if (candidateIds.has(assetId)) {
        referencedIds.add(assetId);
      }
    }
  }

  const revisionRecords = await db.projectRevisions.toArray();
  for (const record of revisionRecords) {
    const data = record.snapshotData ?? record.patch;
    for (const assetId of getPersistedAssetIdsFromRecord(record, data)) {
      if (candidateIds.has(assetId)) {
        referencedIds.add(assetId);
      }
    }
  }

  for (const assetId of await collectProjectExplorerReferencedAssetIds()) {
    if (candidateIds.has(assetId)) {
      referencedIds.add(assetId);
    }
  }

  return referencedIds;
}

async function garbageCollectManagedAssets(
  touchedAssetIds: Iterable<string> = [],
): Promise<{ deleted: number; markedOrphaned: number; restored: number }> {
  const assetRecords = await db.assets.toArray();
  const candidateIds = new Set<string>();

  for (const assetId of touchedAssetIds) {
    if (isManagedAssetId(assetId)) {
      candidateIds.add(assetId);
    }
  }

  for (const record of assetRecords) {
    if (record.orphanedAt) {
      candidateIds.add(record.id);
    }
  }

  if (candidateIds.size === 0) {
    return { deleted: 0, markedOrphaned: 0, restored: 0 };
  }

  const referencedIds = await collectReferencedManagedAssetIdsForCandidates(candidateIds);
  const assetRecordById = new Map(assetRecords.map((record) => [record.id, record]));
  const now = new Date();

  let deleted = 0;
  let markedOrphaned = 0;
  let restored = 0;

  await db.transaction('rw', db.assets, async () => {
    for (const assetId of candidateIds) {
      const record = assetRecordById.get(assetId);
      if (!record) {
        continue;
      }

      if (referencedIds.has(assetId)) {
        if (record.orphanedAt) {
          const { orphanedAt: _orphanedAt, ...nextRecord } = record;
          await db.assets.put(nextRecord);
          restored += 1;
        }
        continue;
      }

      if (!record.orphanedAt) {
        await db.assets.put({
          ...record,
          orphanedAt: now,
        });
        markedOrphaned += 1;
        continue;
      }

      if (now.getTime() - record.orphanedAt.getTime() < MANAGED_ASSET_GC_GRACE_PERIOD_MS) {
        continue;
      }

      clearManagedAssetObjectUrl(assetId);
      await db.assets.delete(assetId);
      deleted += 1;
    }
  });

  return { deleted, markedOrphaned, restored };
}

function rememberResolvedManagedAsset(assetId: string, source: string): void {
  if (!source) return;
  objectUrlToAssetId.set(source, assetId);
  sourceToManagedAssetIdCache.set(source, assetId);
}

function getManagedAssetIdForSource(source: unknown): string | null {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return null;
  }

  if (isManagedAssetId(source)) {
    return source;
  }

  const cachedId = sourceToManagedAssetIdCache.get(source) ?? objectUrlToAssetId.get(source);
  return cachedId && isManagedAssetId(cachedId) ? cachedId : null;
}

function getManagedAssetHash(assetId: unknown): string | null {
  if (!isManagedAssetId(assetId)) {
    return null;
  }

  const match = assetId.match(MANAGED_ASSET_ID_PATTERN);
  return match?.[1]?.toLowerCase() ?? null;
}

async function sourceMatchesManagedAssetId(source: string, assetId: string | undefined): Promise<boolean> {
  const expectedHash = getManagedAssetHash(assetId);
  if (!expectedHash) {
    return false;
  }

  try {
    const blob = await fetchBlobFromSource(source);
    const actualHash = await computeSha256Hex(blob);
    return actualHash === expectedHash;
  } catch {
    return false;
  }
}

function applyPersistedBitmapAssetRefs(
  document: ReturnType<typeof cloneCostumeDocument>,
  refs: Map<string, { assetId: string; assetFrame?: CostumeAssetFrame }>,
): ReturnType<typeof cloneCostumeDocument> {
  for (const layer of document.layers) {
    if (!isBitmapCostumeLayer(layer)) {
      continue;
    }
    const persistedRef = refs.get(layer.id);
    if (!persistedRef) {
      continue;
    }
    layer.bitmap.assetId = persistedRef.assetId;
    layer.bitmap.assetFrame = cloneCostumeAssetFrame(persistedRef.assetFrame);
    layer.bitmap.persistedAssetId = persistedRef.assetId;
  }

  return document;
}

function addPersistedAssetRef(
  refsById: Map<string, PersistedProjectAssetRef>,
  assetId: string,
  kind: ManagedAssetKind,
): void {
  if (!isManagedAssetId(assetId) || refsById.has(assetId)) {
    return;
  }
  refsById.set(assetId, { assetId, kind });
}

async function normalizeCostumeAssetsForStorage(
  costume: { assetId: string; assetFrame?: unknown; document?: unknown; persistedAssetId?: unknown; renderSignature?: unknown },
  refsById: Map<string, PersistedProjectAssetRef>,
): Promise<void> {
  const document = ensureCostumeDocument(costume);
  const persistedBitmapLayerRefs = new Map<string, { assetId: string; assetFrame?: CostumeAssetFrame }>();

  for (const layer of document.layers) {
    if (!isBitmapCostumeLayer(layer) || !isLikelyAssetSource(layer.bitmap.assetId)) {
      continue;
    }
    const existingManagedAssetId = getManagedAssetIdForSource(layer.bitmap.assetId);
    if (existingManagedAssetId) {
      addPersistedAssetRef(refsById, existingManagedAssetId, 'image');
      persistedBitmapLayerRefs.set(layer.id, {
        assetId: existingManagedAssetId,
        assetFrame: cloneCostumeAssetFrame(layer.bitmap.assetFrame),
      });
      layer.bitmap.persistedAssetId = existingManagedAssetId;
      continue;
    }

    if (
      typeof layer.bitmap.persistedAssetId === 'string' &&
      await sourceMatchesManagedAssetId(layer.bitmap.assetId, layer.bitmap.persistedAssetId)
    ) {
      addPersistedAssetRef(refsById, layer.bitmap.persistedAssetId, 'image');
      persistedBitmapLayerRefs.set(layer.id, {
        assetId: layer.bitmap.persistedAssetId,
        assetFrame: cloneCostumeAssetFrame(layer.bitmap.assetFrame),
      });
      continue;
    }

    const optimizedLayerAsset = await optimizeCostumeBitmapAssetSource(
      layer.bitmap.assetId,
      layer.bitmap.assetFrame,
    );
    if (!optimizedLayerAsset) {
      continue;
    }
    const record = await ensureAssetRecordFromSource(optimizedLayerAsset.dataUrl, 'image');
    addPersistedAssetRef(refsById, record.id, 'image');
    layer.bitmap.assetId = optimizedLayerAsset.dataUrl;
    layer.bitmap.assetFrame = cloneCostumeAssetFrame(optimizedLayerAsset.assetFrame);
    layer.bitmap.persistedAssetId = record.id;
    persistedBitmapLayerRefs.set(layer.id, {
      assetId: record.id,
      assetFrame: cloneCostumeAssetFrame(optimizedLayerAsset.assetFrame),
    });
  }

  const canonicalDocument = applyPersistedBitmapAssetRefs(
    cloneCostumeDocument(document),
    persistedBitmapLayerRefs,
  );
  const renderSignature = getCostumeDocumentPreviewSignature(canonicalDocument);
  const existingFlattenedAssetId = getManagedAssetIdForSource(costume.assetId)
    ?? (typeof costume.persistedAssetId === 'string' && isManagedAssetId(costume.persistedAssetId)
      ? costume.persistedAssetId
      : null);

  if (
    existingFlattenedAssetId &&
    typeof costume.renderSignature === 'string' &&
    costume.renderSignature === renderSignature
  ) {
    addPersistedAssetRef(refsById, existingFlattenedAssetId, 'image');
    costume.assetId = existingFlattenedAssetId;
    costume.persistedAssetId = existingFlattenedAssetId;
    costume.renderSignature = renderSignature;
  } else {
    const renderedCostume = await renderCostumeDocument(document);
    const runtimeAssetRecord = await ensureAssetRecordFromSource(renderedCostume.dataUrl, 'image');
    addPersistedAssetRef(refsById, runtimeAssetRecord.id, 'image');
    costume.assetId = runtimeAssetRecord.id;
    costume.persistedAssetId = runtimeAssetRecord.id;
    costume.renderSignature = renderSignature;
    (costume as { assetFrame?: unknown }).assetFrame = cloneCostumeAssetFrame(renderedCostume.assetFrame);
  }

  applyPersistedBitmapAssetRefs(document, persistedBitmapLayerRefs);
  (costume as { document: unknown }).document = cloneCostumeDocument(document);
}

async function hydrateCostumeAssetsFromStorage(costume: { assetId: string; document?: unknown }): Promise<void> {
  if (isManagedAssetId(costume.assetId)) {
    const objectUrl = await resolveManagedAssetUrl(costume.assetId);
    if (objectUrl) {
      rememberResolvedManagedAsset(costume.assetId, objectUrl);
      costume.assetId = objectUrl;
    }
  }

  const document = ensureCostumeDocument(costume);
  for (const layer of document.layers) {
    if (!isBitmapCostumeLayer(layer) || !isManagedAssetId(layer.bitmap.assetId)) {
      continue;
    }
    const objectUrl = await resolveManagedAssetUrl(layer.bitmap.assetId);
    if (!objectUrl) {
      continue;
    }
    rememberResolvedManagedAsset(layer.bitmap.assetId, objectUrl);
    layer.bitmap.assetId = objectUrl;
  }
  (costume as { document: unknown }).document = cloneCostumeDocument(document);
}

function collectCostumePersistedAssetRefs(
  costume: { assetId: string; document?: unknown },
  refsById: Map<string, PersistedProjectAssetRef>,
): void {
  addPersistedAssetRef(refsById, costume.assetId, 'image');
  const document = ensureCostumeDocument(costume);
  for (const layer of document.layers) {
    if (isBitmapCostumeLayer(layer) && layer.bitmap.assetId) {
      addPersistedAssetRef(refsById, layer.bitmap.assetId, 'image');
    }
  }
}

async function normalizeProjectAssetsForStorage(
  projectData: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
): Promise<{
  projectData: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  assetRefs: PersistedProjectAssetRef[];
}> {
  const nextProject = cloneValue(projectData);
  const refsById = new Map<string, PersistedProjectAssetRef>();

  const normalizeSoundAsset = async (sound: { assetId: string }) => {
    if (!isLikelyAssetSource(sound.assetId)) return;
    const record = await ensureAssetRecordFromSource(sound.assetId, 'audio');
    addPersistedAssetRef(refsById, record.id, 'audio');
    sound.assetId = record.id;
  };

  const normalizeBackground = async (background: BackgroundConfig | null | undefined) => {
    if (!background) return;
    if (background.type === 'image' && isLikelyAssetSource(background.value)) {
      const record = await ensureAssetRecordFromSource(background.value, 'background');
      addPersistedAssetRef(refsById, record.id, 'background');
      background.value = record.id;
    }

    if (background.type === 'tiled' && background.chunks) {
      const nextChunks: Record<string, string> = {};
      for (const [chunkKey, source] of Object.entries(background.chunks)) {
        if (!isLikelyAssetSource(source)) continue;
        const record = await ensureAssetRecordFromSource(source, 'background');
        addPersistedAssetRef(refsById, record.id, 'background');
        nextChunks[chunkKey] = record.id;
      }
      background.chunks = nextChunks;
    }

    const document = background.document ? cloneBackgroundDocument(ensureBackgroundDocument(background)) : null;
    if (!document) {
      return;
    }

    for (const layer of document.layers) {
      if (!isBitmapBackgroundLayer(layer)) {
        continue;
      }
      const nextChunks: Record<string, string> = {};
      for (const [chunkKey, source] of Object.entries(layer.bitmap.chunks)) {
        if (!isLikelyAssetSource(source)) continue;
        const record = await ensureAssetRecordFromSource(source, 'background');
        addPersistedAssetRef(refsById, record.id, 'background');
        nextChunks[chunkKey] = record.id;
      }
      layer.bitmap.chunks = nextChunks;
    }

    background.document = document;
  };

  for (const scene of nextProject.scenes || []) {
    await normalizeBackground(scene.background);
    for (const object of scene.objects || []) {
      for (const costume of object.costumes || []) {
        await normalizeCostumeAssetsForStorage(costume, refsById);
      }
      for (const sound of object.sounds || []) {
        await normalizeSoundAsset(sound);
      }
    }
  }

  for (const component of nextProject.components || []) {
    for (const costume of component.costumes || []) {
      await normalizeCostumeAssetsForStorage(costume, refsById);
    }
    for (const sound of component.sounds || []) {
      await normalizeSoundAsset(sound);
    }
  }

  return {
    projectData: nextProject,
    assetRefs: Array.from(refsById.values()),
  };
}

async function hydrateProjectAssetsFromStorage(
  projectData: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
): Promise<Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>> {
  const nextProject = cloneValue(projectData);

  const hydrateSoundAsset = async (sound: { assetId: string }) => {
    if (!isManagedAssetId(sound.assetId)) {
      return;
    }
    const objectUrl = await resolveManagedAssetUrl(sound.assetId);
    if (objectUrl) {
      rememberResolvedManagedAsset(sound.assetId, objectUrl);
      sound.assetId = objectUrl;
    }
  };

  const hydrateBackground = async (background: BackgroundConfig | null | undefined) => {
    if (!background) return;
    if (background.type === 'image' && isManagedAssetId(background.value)) {
      const objectUrl = await resolveManagedAssetUrl(background.value);
      if (objectUrl) {
        rememberResolvedManagedAsset(background.value, objectUrl);
        background.value = objectUrl;
      }
    }

    if (background.type === 'tiled' && background.chunks) {
      const nextChunks: Record<string, string> = {};
      for (const [chunkKey, value] of Object.entries(background.chunks)) {
        if (!isManagedAssetId(value)) {
          nextChunks[chunkKey] = value;
          continue;
        }
        const objectUrl = await resolveManagedAssetUrl(value);
        if (objectUrl) {
          rememberResolvedManagedAsset(value, objectUrl);
          nextChunks[chunkKey] = objectUrl;
        }
      }
      background.chunks = nextChunks;
    }

    const document = background.document ? cloneBackgroundDocument(ensureBackgroundDocument(background)) : null;
    if (!document) {
      return;
    }

    for (const layer of document.layers) {
      if (!isBitmapBackgroundLayer(layer)) {
        continue;
      }
      const nextChunks: Record<string, string> = {};
      for (const [chunkKey, value] of Object.entries(layer.bitmap.chunks)) {
        if (!isManagedAssetId(value)) {
          nextChunks[chunkKey] = value;
          continue;
        }
        const objectUrl = await resolveManagedAssetUrl(value);
        if (objectUrl) {
          rememberResolvedManagedAsset(value, objectUrl);
          nextChunks[chunkKey] = objectUrl;
        }
      }
      layer.bitmap.chunks = nextChunks;
    }

    background.document = document;
  };

  for (const scene of nextProject.scenes || []) {
    await hydrateBackground(scene.background);
    for (const object of scene.objects || []) {
      for (const costume of object.costumes || []) {
        await hydrateCostumeAssetsFromStorage(costume);
      }
      for (const sound of object.sounds || []) {
        await hydrateSoundAsset(sound);
      }
    }
  }

  for (const component of nextProject.components || []) {
    for (const costume of component.costumes || []) {
      await hydrateCostumeAssetsFromStorage(costume);
    }
    for (const sound of component.sounds || []) {
      await hydrateSoundAsset(sound);
    }
  }

  return nextProject;
}

function collectPersistedAssetRefsFromProjectData(
  projectData: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
): PersistedProjectAssetRef[] {
  const refsById = new Map<string, PersistedProjectAssetRef>();

  const collectBackground = (background: BackgroundConfig | null | undefined) => {
    if (!background) return;
    if (background.type === 'image') {
      addPersistedAssetRef(refsById, background.value, 'background');
    }
    if (background.type === 'tiled' && background.chunks) {
      Object.values(background.chunks).forEach((assetId) => addPersistedAssetRef(refsById, assetId, 'background'));
    }
    if (!background.document) return;
    const document = ensureBackgroundDocument(background);
    for (const layer of document.layers) {
      if (!isBitmapBackgroundLayer(layer)) continue;
      Object.values(layer.bitmap.chunks).forEach((assetId) => addPersistedAssetRef(refsById, assetId, 'background'));
    }
  };

  for (const scene of projectData.scenes || []) {
    collectBackground(scene.background);
    for (const object of scene.objects || []) {
      for (const costume of object.costumes || []) {
        collectCostumePersistedAssetRefs(costume, refsById);
      }
      for (const sound of object.sounds || []) {
        addPersistedAssetRef(refsById, sound.assetId, 'audio');
      }
    }
  }

  for (const component of projectData.components || []) {
    for (const costume of component.costumes || []) {
      collectCostumePersistedAssetRefs(costume, refsById);
    }
    for (const sound of component.sounds || []) {
      addPersistedAssetRef(refsById, sound.assetId, 'audio');
    }
  }

  return Array.from(refsById.values());
}

export function collectPersistedAssetRefsFromSerializedProjectData(serializedData: string): PersistedProjectAssetRef[] {
  const parsed = JSON.parse(serializedData) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  return collectPersistedAssetRefsFromProjectData(parsed);
}

async function serializeProjectData(project: Project): Promise<string> {
  const { id: _id, name: _name, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = project;
  const { projectData } = await normalizeProjectAssetsForStorage(rest);
  return JSON.stringify(projectData);
}

async function deserializeProjectFromRecord(record: ProjectRecord): Promise<{
  project: Project;
  sourceSchemaVersion: number;
  migrated: boolean;
}> {
  const parsedData = JSON.parse(record.data) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  const sourceSchemaVersion = normalizeSchemaVersion(record.schemaVersion);

  if (sourceSchemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project "${record.name}" requires schema v${sourceSchemaVersion} but this app supports up to v${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  let project: Project = {
    id: record.id,
    name: record.name,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    ...(await hydrateProjectAssetsFromStorage(parsedData)),
  };

  let migrated = false;
  if (sourceSchemaVersion < CURRENT_SCHEMA_VERSION) {
    project = migrateProject(project, sourceSchemaVersion);
    project.updatedAt = new Date();
    migrated = true;
  }

  project = normalizeMessagesInProject(project);
  project = normalizeCostumeDocumentsInProject(project);
  project = normalizeBackgroundDocumentsInProject(project);
  project = normalizeProjectLayering(project);

  return {
    project,
    sourceSchemaVersion,
    migrated,
  };
}

function createEmptyProjectRevisionSyncState(): ProjectRevisionSyncState {
  return {
    revisionCount: 0,
    latestRevisionId: null,
    latestRevisionCreatedAt: null,
    latestRevisionContentHash: null,
    revisionsUpdatedAt: null,
  };
}

function getProjectRevisionSyncStateFromRecord(record: Partial<ProjectRecord> | undefined | null): ProjectRevisionSyncState {
  if (!record) {
    return createEmptyProjectRevisionSyncState();
  }

  const revisionCount = typeof record.revisionCount === 'number' && Number.isFinite(record.revisionCount)
    ? Math.max(0, Math.floor(record.revisionCount))
    : 0;
  const latestRevisionCreatedAt = typeof record.latestRevisionCreatedAt === 'number' && Number.isFinite(record.latestRevisionCreatedAt)
    ? record.latestRevisionCreatedAt
    : null;
  const revisionsUpdatedAt = typeof record.revisionsUpdatedAt === 'number' && Number.isFinite(record.revisionsUpdatedAt)
    ? record.revisionsUpdatedAt
    : null;

  return {
    revisionCount,
    latestRevisionId: typeof record.latestRevisionId === 'string' ? record.latestRevisionId : null,
    latestRevisionCreatedAt,
    latestRevisionContentHash: normalizeContentHash(record.latestRevisionContentHash) ?? null,
    revisionsUpdatedAt,
  };
}

function applyProjectRevisionSyncStateToRecord(
  record: ProjectRecord,
  revisionState: ProjectRevisionSyncState,
): ProjectRecord {
  return {
    ...record,
    revisionCount: revisionState.revisionCount,
    latestRevisionId: revisionState.latestRevisionId,
    latestRevisionCreatedAt: revisionState.latestRevisionCreatedAt,
    latestRevisionContentHash: revisionState.latestRevisionContentHash,
    revisionsUpdatedAt: revisionState.revisionsUpdatedAt,
  };
}

async function toProjectRecord(
  project: Project,
  updatedAt: Date = new Date(),
  existingRecord: ProjectRecord | null = null,
  options: {
    cloudBacked?: boolean;
  } = {},
): Promise<ProjectRecord> {
  const { id: _id, name: _name, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = project;
  const { projectData, assetRefs } = await normalizeProjectAssetsForStorage(rest);
  const data = JSON.stringify(projectData);
  return applyProjectRevisionSyncStateToRecord({
    id: project.id,
    name: project.name,
    createdAt: new Date(project.createdAt),
    updatedAt,
    data,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    cloudBacked: options.cloudBacked ?? existingRecord?.cloudBacked ?? false,
    contentHash: computeContentHash(data),
    assetIds: assetRefs.map((assetRef) => assetRef.assetId),
  }, getProjectRevisionSyncStateFromRecord(existingRecord));
}

class GameMakerDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>;
  projectRevisions!: EntityTable<ProjectRevisionRecord, 'id'>;
  assets!: EntityTable<AssetRecord, 'id'>;
  reusables!: EntityTable<ReusableRecord, 'id'>;
  projectExplorerState!: EntityTable<ProjectExplorerStateRecord, 'id'>;

  constructor() {
    super('PochaCodingDB');

    this.version(1).stores({
      projects: 'id, name, createdAt, updatedAt',
      assets: 'id, name, type',
      reusables: 'id, name, createdAt, *tags',
    });

    this.version(2)
      .stores({
        projects: 'id, name, createdAt, updatedAt, schemaVersion',
        assets: 'id, name, type',
        reusables: 'id, name, createdAt, *tags',
      })
      .upgrade(async (tx) => {
        await tx
          .table('projects')
          .toCollection()
          .modify((record: ProjectRecordV1 & Partial<ProjectRecord>) => {
            record.schemaVersion = normalizeSchemaVersion(record.schemaVersion);
            if (typeof record.appVersion !== 'string') {
              delete record.appVersion;
            }
          });
      });

    this.version(3).stores({
      projects: 'id, name, createdAt, updatedAt, schemaVersion',
      projectRevisions:
        'id, projectId, createdAt, [projectId+createdAt], [projectId+isCheckpoint+createdAt], [projectId+reason+createdAt], [projectId+contentHash]',
      assets: 'id, name, type',
      reusables: 'id, name, createdAt, *tags',
    });

    this.version(4).stores({
      projects: 'id, name, createdAt, updatedAt, schemaVersion',
      projectRevisions:
        'id, projectId, createdAt, [projectId+createdAt], [projectId+isCheckpoint+createdAt], [projectId+reason+createdAt], [projectId+contentHash]',
      assets: 'id, hash, kind, mimeType, size, createdAt, updatedAt',
      reusables: 'id, name, createdAt, *tags',
    });

    this.version(5).stores({
      projects: 'id, name, createdAt, updatedAt, schemaVersion',
      projectRevisions:
        'id, projectId, createdAt, [projectId+createdAt], [projectId+isCheckpoint+createdAt], [projectId+reason+createdAt], [projectId+contentHash]',
      assets: 'id, hash, kind, mimeType, size, createdAt, updatedAt',
      reusables: 'id, name, createdAt, *tags',
      projectExplorerState: 'id, updatedAt',
    });
  }
}

function syncDexieIndexedDbDependenciesFromGlobals(): void {
  const globals = globalThis as typeof globalThis & {
    IDBKeyRange?: typeof IDBKeyRange;
    indexedDB?: IDBFactory;
  };

  if (globals.indexedDB) {
    Dexie.dependencies.indexedDB = globals.indexedDB;
  }

  if (globals.IDBKeyRange) {
    Dexie.dependencies.IDBKeyRange = globals.IDBKeyRange;
  }
}

let activeDatabaseInstance: GameMakerDatabase | null = null;
let activeIndexedDbDependency: IDBFactory | null = null;
let activeIdbKeyRangeDependency: typeof IDBKeyRange | null = null;

function getActiveDatabase(): GameMakerDatabase {
  syncDexieIndexedDbDependenciesFromGlobals();

  const currentIndexedDbDependency = Dexie.dependencies.indexedDB ?? null;
  const currentIdbKeyRangeDependency = Dexie.dependencies.IDBKeyRange ?? null;
  const shouldRecreateDatabase =
    activeDatabaseInstance === null
    || activeIndexedDbDependency !== currentIndexedDbDependency
    || activeIdbKeyRangeDependency !== currentIdbKeyRangeDependency;

  if (shouldRecreateDatabase) {
    activeDatabaseInstance?.close();
    activeDatabaseInstance = new GameMakerDatabase();
    activeIndexedDbDependency = currentIndexedDbDependency;
    activeIdbKeyRangeDependency = currentIdbKeyRangeDependency;
  }

  return activeDatabaseInstance!;
}

const dbProxyTarget = Object.create(GameMakerDatabase.prototype) as GameMakerDatabase;

export const db = new Proxy(dbProxyTarget, {
  get(_target, property, receiver) {
    const database = getActiveDatabase();
    const value = Reflect.get(database, property, receiver);
    return typeof value === 'function' ? value.bind(database) : value;
  },
  set(_target, property, value, receiver) {
    return Reflect.set(getActiveDatabase(), property, value, receiver);
  },
  has(_target, property) {
    return property in getActiveDatabase();
  },
  ownKeys() {
    return Reflect.ownKeys(getActiveDatabase());
  },
  getOwnPropertyDescriptor(_target, property) {
    const database = getActiveDatabase();
    return Reflect.getOwnPropertyDescriptor(database, property)
      ?? Reflect.getOwnPropertyDescriptor(GameMakerDatabase.prototype, property);
  },
  getPrototypeOf() {
    return GameMakerDatabase.prototype;
  },
}) as GameMakerDatabase;

// Project Repository

export async function saveProject(project: Project): Promise<Project> {
  return await saveProjectWithOptions(project);
}

export async function saveProjectWithOptions(
  project: Project,
  options: {
    cloudBacked?: boolean;
  } = {},
): Promise<Project> {
  const existing = await db.projects.get(project.id);
  const record = await toProjectRecord(project, new Date(project.updatedAt), existing ?? null, options);
  await db.projects.put(record);
  await ensureStoredProjectExplorerProjectMeta(project.id, {
    createdAt: project.createdAt.getTime(),
    updatedAt: project.updatedAt.getTime(),
  });
  const touchedAssetIds = new Set<string>([
    ...getPersistedAssetIdsFromRecord(record, record.data),
    ...getPersistedAssetIdsFromRecord(existing ?? {}, existing?.data),
  ]);
  await garbageCollectManagedAssets(touchedAssetIds);
  const { project: hydratedProject } = await deserializeProjectFromRecord(record);
  return hydratedProject;
}

export async function markStoredProjectAsCloudBacked(projectId: string, cloudBacked: boolean = true): Promise<boolean> {
  const existing = await db.projects.get(projectId);
  if (!existing || existing.cloudBacked === cloudBacked) {
    return false;
  }

  await db.projects.update(projectId, { cloudBacked });
  return true;
}

export async function createProjectConflictCopy(project: Project): Promise<Project> {
  const conflictSuffix = project.updatedAt.getTime().toString(16).padStart(8, '0').slice(-8);
  const conflictId = `${project.id}-conflict-${conflictSuffix}`;
  const existingConflict = await loadProject(conflictId);
  if (existingConflict) {
    return existingConflict;
  }

  const timestampLabel = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const conflictProject = structuredClone(project);
  conflictProject.id = conflictId;
  conflictProject.name = `${project.name} (Conflict ${timestampLabel})`;
  conflictProject.updatedAt = new Date();

  return await saveProject(conflictProject);
}

export async function loadProject(id: string): Promise<Project | null> {
  const record = await db.projects.get(id);
  if (!record) return null;

  const normalizedRecord: ProjectRecord = {
    ...record,
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
  };

  const { project, migrated } = await deserializeProjectFromRecord(normalizedRecord);

  if (migrated) {
    await db.projects.put(await toProjectRecord(project, project.updatedAt, normalizedRecord));
  }

  return project;
}

export async function listProjects(): Promise<Array<{ id: string; name: string; updatedAt: Date }>> {
  const records = await db.projects.orderBy('updatedAt').reverse().toArray();
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
  }));
}

export async function deleteProject(id: string): Promise<void> {
  if (!isNonEmptyStringKey(id)) {
    return;
  }

  const explorerState = await loadProjectExplorerStateInternal();
  const projectMeta = explorerState.projects.find((entry) => entry.projectId === id) ?? null;
  const project = await db.projects.get(id);
  await db.projects.delete(id);
  const revisions = await db.projectRevisions.where('projectId').equals(id).toArray();
  await db.transaction('rw', db.projectRevisions, async () => {
    await Promise.all(revisions.map((revision) => db.projectRevisions.delete(revision.id)));
  });

  if (projectMeta) {
    await updateProjectExplorerState((state) => ({
      ...state,
      updatedAt: Date.now(),
      projects: state.projects.filter((entry) => entry.projectId !== id),
    }));
  }

  const touchedAssetIds = new Set<string>([
    ...getPersistedAssetIdsFromRecord(project ?? {}, project?.data),
    ...revisions.flatMap((revision) =>
      getPersistedAssetIdsFromRecord(revision, revision.snapshotData ?? revision.patch),
    ),
    ...(projectMeta?.thumbnailAssetId ? [projectMeta.thumbnailAssetId] : []),
  ]);
  await garbageCollectManagedAssets(touchedAssetIds);
}

export async function loadProjectExplorerState(): Promise<ProjectExplorerState> {
  return await loadProjectExplorerStateInternal();
}

export async function loadStoredProjectExplorerStateSnapshot(): Promise<ProjectExplorerState> {
  const record = await db.projectExplorerState.get(PROJECT_EXPLORER_RECORD_ID);
  return parseProjectExplorerStateRecord(record);
}

export async function getLocalProjectCatalogSnapshot(): Promise<LocalProjectCatalogSnapshot> {
  const [explorerState, projectRecords] = await Promise.all([
    loadStoredProjectExplorerStateSnapshot(),
    db.projects.toArray(),
  ]);

  const projects = projectRecords.map((record) => {
    let currentThumbnailVisualSignature: string | null = null;
    try {
      const parsedData = JSON.parse(record.data) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
      currentThumbnailVisualSignature = computeProjectThumbnailVisualSignature(parsedData);
    } catch {
      currentThumbnailVisualSignature = null;
    }

    return {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
      cloudBacked: record.cloudBacked ?? false,
      currentThumbnailVisualSignature,
    } satisfies ProjectCatalogLocalProjectSummary;
  });

  return {
    explorerState,
    projects,
  };
}

export async function getManagedAssetLocators(assetIds: readonly string[]): Promise<ManagedAssetLocator[]> {
  const uniqueAssetIds = Array.from(new Set(assetIds.filter((assetId) => assetId.trim().length > 0)));
  return await Promise.all(uniqueAssetIds.map(async (assetId) => {
    const exists = await hasManagedAsset(assetId);
    return {
      assetId,
      exists,
      url: exists ? await resolveManagedAssetUrl(assetId) : null,
    };
  }));
}

export async function getStoredProjectCacheInfo(projectId: string): Promise<{ exists: boolean; cloudBacked: boolean }> {
  const record = await db.projects.get(projectId);
  return {
    exists: !!record,
    cloudBacked: record?.cloudBacked ?? false,
  };
}

export async function listProjectExplorerData(): Promise<{
  folders: ProjectExplorerFolderSummary[];
  projects: ProjectExplorerProjectSummary[];
}> {
  const [state, projectRecords] = await Promise.all([
    loadProjectExplorerStateInternal(),
    db.projects.toArray(),
  ]);

  const metaByProjectId = new Map(state.projects.map((projectMeta) => [projectMeta.projectId, projectMeta]));
  const projectCountByFolderId = new Map<string, number>();

  for (const projectMeta of state.projects) {
    if (projectMeta.trashedAt) {
      continue;
    }
    projectCountByFolderId.set(projectMeta.folderId, (projectCountByFolderId.get(projectMeta.folderId) ?? 0) + 1);
  }

  const folders = state.folders.map((folder) => ({
    ...folder,
    projectCount: projectCountByFolderId.get(folder.id) ?? 0,
  }));

  const projects = await Promise.all(projectRecords.map(async (record) => {
    const meta = metaByProjectId.get(record.id)
      ?? createProjectExplorerProjectMeta(record.id, {
        createdAt: record.createdAt.getTime(),
        updatedAt: record.updatedAt.getTime(),
      });
    let currentThumbnailVisualSignature: string | null = null;
    try {
      const parsedData = JSON.parse(record.data) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
      currentThumbnailVisualSignature = computeProjectThumbnailVisualSignature(parsedData);
    } catch {
      currentThumbnailVisualSignature = null;
    }
    const thumbnailExists = meta.thumbnailAssetId ? await hasManagedAsset(meta.thumbnailAssetId) : false;

    return {
      id: record.id,
      name: record.name,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      folderId: meta.folderId,
      trashedAt: meta.trashedAt ?? null,
      thumbnailAssetId: meta.thumbnailAssetId ?? null,
      thumbnailStale:
        currentThumbnailVisualSignature !== null
          && (
            !thumbnailExists
            || meta.thumbnailVisualSignature !== currentThumbnailVisualSignature
          ),
      thumbnailUrl: meta.thumbnailAssetId ? await resolveManagedAssetUrl(meta.thumbnailAssetId) : null,
    } satisfies ProjectExplorerProjectSummary;
  }));

  return {
    folders,
    projects,
  };
}

export async function createProjectFolder(
  name: string,
  parentId: string = PROJECT_EXPLORER_ROOT_FOLDER_ID,
): Promise<string> {
  const folderId = crypto.randomUUID();
  await updateProjectExplorerState((state) => {
    const validParentId = state.folders.some((folder) => folder.id === parentId && !folder.trashedAt)
      ? parentId
      : PROJECT_EXPLORER_ROOT_FOLDER_ID;
    const now = Date.now();
    return {
      ...state,
      updatedAt: now,
      folders: [
        ...state.folders,
        createProjectExplorerFolder(folderId, name, validParentId, now),
      ],
    };
  });
  return folderId;
}

export async function renameProjectFolder(folderId: string, name: string): Promise<boolean> {
  if (folderId === PROJECT_EXPLORER_ROOT_FOLDER_ID) {
    return false;
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return false;
  }

  let changed = false;
  await updateProjectExplorerState((state) => {
    const now = Date.now();
    const folders = state.folders.map((folder) => {
      if (folder.id !== folderId || folder.name === trimmedName) {
        return folder;
      }
      changed = true;
      return {
        ...folder,
        name: trimmedName,
        updatedAt: now,
      };
    });

    if (!changed) {
      return state;
    }

    return {
      ...state,
      updatedAt: now,
      folders,
    };
  });

  return changed;
}

export async function renameStoredProject(projectId: string, name: string): Promise<boolean> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return false;
  }

  const existing = await db.projects.get(projectId);
  if (!existing || existing.name === trimmedName) {
    return false;
  }

  await db.projects.update(projectId, {
    name: trimmedName,
    updatedAt: new Date(),
    appVersion: APP_VERSION,
  });
  return true;
}

export async function moveProjectToFolder(projectId: string, folderId: string): Promise<boolean> {
  let changed = false;
  await updateProjectExplorerState((state) => {
    const folderExists = state.folders.some((folder) => folder.id === folderId && !folder.trashedAt);
    const targetFolderId = folderExists ? folderId : PROJECT_EXPLORER_ROOT_FOLDER_ID;
    const now = Date.now();
    const hasProjectMeta = state.projects.some((projectMeta) => projectMeta.projectId === projectId);
    const updatedProjects = state.projects.map((projectMeta) => {
      if (projectMeta.projectId !== projectId || projectMeta.folderId === targetFolderId) {
        return projectMeta;
      }
      changed = true;
      return {
        ...projectMeta,
        folderId: targetFolderId,
        updatedAt: now,
      };
    });

    const projects = hasProjectMeta
      ? updatedProjects
      : [
          ...updatedProjects,
          {
            ...createProjectExplorerProjectMeta(projectId, { updatedAt: now }),
            folderId: targetFolderId,
          },
        ];
    if (!hasProjectMeta) {
      changed = true;
    }

    if (!changed) {
      return state;
    }

    return {
      ...state,
      updatedAt: now,
      projects,
    };
  });

  return changed;
}

export async function moveProjectFolder(
  folderId: string,
  targetFolderId: string,
): Promise<boolean> {
  if (folderId === PROJECT_EXPLORER_ROOT_FOLDER_ID || folderId === targetFolderId) {
    return false;
  }

  let changed = false;
  await updateProjectExplorerState((state) => {
    const folder = state.folders.find((entry) => entry.id === folderId);
    const targetFolder = state.folders.find((entry) => entry.id === targetFolderId && !entry.trashedAt);
    if (!folder || !targetFolder) {
      return state;
    }
    if (isProjectExplorerDescendantFolder(state.folders, targetFolderId, folderId)) {
      return state;
    }

    const now = Date.now();
    const folders = state.folders.map((entry) => {
      if (entry.id !== folderId || entry.parentId === targetFolderId) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        parentId: targetFolderId,
        updatedAt: now,
      };
    });

    if (!changed) {
      return state;
    }

    return {
      ...state,
      updatedAt: now,
      folders,
    };
  });

  return changed;
}

export async function trashProjectFromExplorer(projectId: string): Promise<boolean> {
  let changed = false;
  await updateProjectExplorerState((state) => {
    const now = Date.now();
    const projects = state.projects.map((projectMeta) => {
      if (projectMeta.projectId !== projectId || projectMeta.trashedAt) {
        return projectMeta;
      }
      changed = true;
      return {
        ...projectMeta,
        trashedAt: now,
        updatedAt: now,
      };
    });

    if (!changed) {
      return state;
    }

    return {
      ...state,
      updatedAt: now,
      projects,
    };
  });

  return changed;
}

export async function trashProjectFolder(folderId: string): Promise<boolean> {
  if (folderId === PROJECT_EXPLORER_ROOT_FOLDER_ID) {
    return false;
  }

  let changed = false;
  await updateProjectExplorerState((state) => {
    const folder = state.folders.find((entry) => entry.id === folderId);
    if (!folder || folder.trashedAt) {
      return state;
    }

    const now = Date.now();
    const subtreeIds = collectProjectExplorerFolderSubtreeIds(state.folders, folderId);
    const folders = state.folders.map((entry) => {
      if (!subtreeIds.has(entry.id)) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        trashedAt: now,
        updatedAt: now,
      };
    });
    const projects = state.projects.map((projectMeta) => {
      if (!subtreeIds.has(projectMeta.folderId) || projectMeta.trashedAt) {
        return projectMeta;
      }
      return {
        ...projectMeta,
        trashedAt: now,
        updatedAt: now,
      };
    });

    return {
      ...state,
      updatedAt: now,
      folders,
      projects,
    };
  });

  return changed;
}

export async function restoreProjectFromExplorer(projectId: string): Promise<boolean> {
  let changed = false;
  await updateProjectExplorerState((state) => {
    const now = Date.now();
    const activeFolderIds = new Set(state.folders.filter((folder) => !folder.trashedAt).map((folder) => folder.id));
    const projects = state.projects.map((projectMeta) => {
      if (projectMeta.projectId !== projectId || !projectMeta.trashedAt) {
        return projectMeta;
      }
      changed = true;
      return {
        ...projectMeta,
        folderId: activeFolderIds.has(projectMeta.folderId) ? projectMeta.folderId : PROJECT_EXPLORER_ROOT_FOLDER_ID,
        trashedAt: undefined,
        updatedAt: now,
      };
    });

    if (!changed) {
      return state;
    }

    return {
      ...state,
      updatedAt: now,
      projects,
    };
  });

  return changed;
}

export async function restoreProjectFolder(folderId: string): Promise<boolean> {
  if (folderId === PROJECT_EXPLORER_ROOT_FOLDER_ID) {
    return false;
  }

  let changed = false;
  await updateProjectExplorerState((state) => {
    const folder = state.folders.find((entry) => entry.id === folderId);
    if (!folder || !folder.trashedAt) {
      return state;
    }

    const activeFolderIds = new Set(state.folders.filter((entry) => !entry.trashedAt).map((entry) => entry.id));
    const subtreeIds = collectProjectExplorerFolderSubtreeIds(state.folders, folderId);
    const now = Date.now();
    const folders = state.folders.map((entry) => {
      if (!subtreeIds.has(entry.id)) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        parentId:
          entry.id === folderId && (!entry.parentId || !activeFolderIds.has(entry.parentId))
            ? PROJECT_EXPLORER_ROOT_FOLDER_ID
            : entry.parentId,
        trashedAt: undefined,
        updatedAt: now,
      };
    });
    const projects = state.projects.map((projectMeta) => {
      if (!subtreeIds.has(projectMeta.folderId)) {
        return projectMeta;
      }
      return {
        ...projectMeta,
        trashedAt: undefined,
        updatedAt: now,
      };
    });

    return {
      ...state,
      updatedAt: now,
      folders,
      projects,
    };
  });

  return changed;
}

export async function ensureProjectThumbnail(projectId: string): Promise<string | null> {
  const [project, state] = await Promise.all([
    loadProject(projectId),
    loadProjectExplorerStateInternal(),
  ]);
  if (!project) {
    return null;
  }

  const projectRecord = await db.projects.get(projectId);
  if (!projectRecord) {
    return null;
  }
  let thumbnailVisualSignature: string | null = null;
  try {
    const parsedData = JSON.parse(projectRecord.data) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
    thumbnailVisualSignature = computeProjectThumbnailVisualSignature(parsedData);
  } catch {
    thumbnailVisualSignature = null;
  }
  if (!thumbnailVisualSignature) {
    return null;
  }

  const projectMeta = state.projects.find((entry) => entry.projectId === projectId)
    ?? createProjectExplorerProjectMeta(projectId, {
      createdAt: project.createdAt.getTime(),
      updatedAt: project.updatedAt.getTime(),
    });

  if (
    projectMeta.thumbnailAssetId &&
    projectMeta.thumbnailVisualSignature === thumbnailVisualSignature &&
    await hasManagedAsset(projectMeta.thumbnailAssetId)
  ) {
    return projectMeta.thumbnailAssetId;
  }

  const thumbnailBlob = await renderProjectThumbnail(project);
  if (!thumbnailBlob) {
    return null;
  }

  const thumbnailRecord = await ensureAssetRecordFromBlob(thumbnailBlob, 'image');
  await updateProjectExplorerState((currentState) => {
    const now = Date.now();
    const hasProjectMeta = currentState.projects.some((entry) => entry.projectId === projectId);
    const projects = hasProjectMeta
      ? currentState.projects.map((entry) => {
          if (entry.projectId !== projectId) {
            return entry;
          }
          return {
            ...entry,
            thumbnailAssetId: thumbnailRecord.id,
            thumbnailVisualSignature,
            thumbnailProjectUpdatedAt: undefined,
            updatedAt: now,
          };
        })
      : [
          ...currentState.projects,
          {
            ...createProjectExplorerProjectMeta(projectId, {
              createdAt: project.createdAt.getTime(),
              updatedAt: now,
            }),
            thumbnailAssetId: thumbnailRecord.id,
            thumbnailVisualSignature,
          },
        ];

    return {
      ...currentState,
      updatedAt: now,
      projects,
    };
  });

  return thumbnailRecord.id;
}

export async function getProjectExplorerSyncPayload(): Promise<ProjectExplorerSyncPayload> {
  const state = await loadProjectExplorerStateInternal();
  const data = serializeProjectExplorerState(state);
  return {
    data,
    updatedAt: state.updatedAt,
    contentHash: computeContentHash(data),
    assetIds: collectProjectExplorerAssetIds(state),
  };
}

export async function syncProjectExplorerStateFromCloud(cloudState: {
  data: string;
  updatedAt: number;
}): Promise<{ action: 'created' | 'updated' | 'skipped'; merged: boolean }> {
  const currentState = await loadProjectExplorerStateInternal();
  let incomingState: ProjectExplorerState;
  try {
    incomingState = normalizeProjectExplorerState(JSON.parse(cloudState.data));
  } catch {
    return { action: 'skipped', merged: false };
  }

  const mergedState = mergeProjectExplorerStates(currentState, {
    ...incomingState,
    updatedAt: cloudState.updatedAt,
  });
  const previousPayload = await getProjectExplorerSyncPayload();
  const mergedData = serializeProjectExplorerState(mergedState);
  const mergedHash = computeContentHash(mergedData);

  if (previousPayload.contentHash === mergedHash && previousPayload.updatedAt === mergedState.updatedAt) {
    return { action: 'skipped', merged: false };
  }

  const previousAssetIds = collectProjectExplorerAssetIds(currentState);
  const nextAssetIds = collectProjectExplorerAssetIds(mergedState);
  await saveProjectExplorerStateInternal(mergedState);
  await garbageCollectManagedAssets(new Set([...previousAssetIds, ...nextAssetIds]));
  return {
    action: currentState.projects.length === 0 && currentState.folders.length <= 1 ? 'created' : 'updated',
    merged: true,
  };
}

const MAX_CHECKPOINT_NAME_LENGTH = 80;
const REVISION_DELTA_FORMAT = 'pocha-project-delta-v1';
const MAX_AUTO_CHECKPOINT_DELTA_CHAIN_LENGTH = 6;
const MAX_AUTO_CHECKPOINT_DELTA_SIZE_RATIO = 0.75;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type RevisionDeltaPathSegment = string | number;

type RevisionDeltaOperation =
  | { op: 'set'; path: RevisionDeltaPathSegment[]; value: JsonValue }
  | { op: 'delete'; path: RevisionDeltaPathSegment[] };

type SerializedProjectDelta = {
  format: typeof REVISION_DELTA_FORMAT;
  parentContentHash: string;
  resultContentHash: string;
  ops: RevisionDeltaOperation[];
};

type RevisionCreateOptions = {
  isCheckpoint?: boolean;
  checkpointName?: string;
  restoredFromRevisionId?: string;
};

function normalizeCheckpointName(name: string): string {
  return name.trim().slice(0, MAX_CHECKPOINT_NAME_LENGTH);
}

function isNonEmptyStringKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const MIN_INDEXED_DB_DATE = new Date(-8_640_000_000_000_000);
const MAX_INDEXED_DB_DATE = new Date(8_640_000_000_000_000);

function getProjectRevisionCreatedAtRange(projectId: string): [lower: [string, Date], upper: [string, Date]] {
  return [[projectId, MIN_INDEXED_DB_DATE], [projectId, MAX_INDEXED_DB_DATE]];
}

function toPublicRevision(record: ProjectRevisionRecord): ProjectRevision {
  return {
    id: record.id,
    projectId: record.projectId,
    parentRevisionId: record.parentRevisionId ?? null,
    kind: record.kind,
    baseRevisionId: record.baseRevisionId,
    contentHash: record.contentHash,
    createdAt: new Date(record.createdAt),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    appVersion: record.appVersion,
    reason: record.reason,
    checkpointName: record.checkpointName ?? null,
    isCheckpoint: record.isCheckpoint,
    restoredFromRevisionId: record.restoredFromRevisionId ?? null,
  };
}

async function getProjectRevisionsAscending(projectId: string): Promise<ProjectRevisionRecord[]> {
  if (!isNonEmptyStringKey(projectId)) {
    return [];
  }

  const [lowerBound, upperBound] = getProjectRevisionCreatedAtRange(projectId);
  return await db.projectRevisions
    .where('[projectId+createdAt]')
    .between(lowerBound, upperBound)
    .sortBy('createdAt');
}

async function getLatestRevision(projectId: string): Promise<ProjectRevisionRecord | null> {
  if (!isNonEmptyStringKey(projectId)) {
    return null;
  }

  const [lowerBound, upperBound] = getProjectRevisionCreatedAtRange(projectId);
  const latest = await db.projectRevisions
    .where('[projectId+createdAt]')
    .between(lowerBound, upperBound)
    .reverse()
    .first();
  return latest ?? null;
}

async function getLatestCheckpointRevision(projectId: string): Promise<ProjectRevisionRecord | null> {
  if (!isNonEmptyStringKey(projectId)) {
    return null;
  }

  const revisions = await getProjectRevisionsAscending(projectId);
  for (let index = revisions.length - 1; index >= 0; index -= 1) {
    const revision = revisions[index];
    if (revision?.isCheckpoint) {
      return revision;
    }
  }
  return null;
}

function getRevisionUpdatedAtTime(revision: Pick<ProjectRevisionRecord, 'createdAt'> & Partial<Pick<ProjectRevisionRecord, 'updatedAt'>>): number {
  const candidate = revision.updatedAt instanceof Date
    ? revision.updatedAt.getTime()
    : revision.createdAt.getTime();
  return Number.isFinite(candidate) ? candidate : revision.createdAt.getTime();
}

function summarizeProjectRevisionSyncState(revisions: readonly ProjectRevisionRecord[]): ProjectRevisionSyncState {
  if (revisions.length === 0) {
    return createEmptyProjectRevisionSyncState();
  }

  let latestRevision = revisions[0];
  let revisionsUpdatedAt = getRevisionUpdatedAtTime(revisions[0]);
  for (const revision of revisions) {
    if (revision.createdAt.getTime() > latestRevision.createdAt.getTime()) {
      latestRevision = revision;
    }
    const candidateUpdatedAt = getRevisionUpdatedAtTime(revision);
    if (candidateUpdatedAt > revisionsUpdatedAt) {
      revisionsUpdatedAt = candidateUpdatedAt;
    }
  }

  return {
    revisionCount: revisions.length,
    latestRevisionId: latestRevision.id,
    latestRevisionCreatedAt: latestRevision.createdAt.getTime(),
    latestRevisionContentHash: latestRevision.contentHash,
    revisionsUpdatedAt,
  };
}

async function refreshStoredProjectRevisionSyncState(projectId: string): Promise<ProjectRevisionSyncState> {
  if (!isNonEmptyStringKey(projectId)) {
    return createEmptyProjectRevisionSyncState();
  }

  const [projectRecord, revisions] = await Promise.all([
    db.projects.get(projectId),
    getProjectRevisionsAscending(projectId),
  ]);
  const revisionState = summarizeProjectRevisionSyncState(revisions);
  if (projectRecord) {
    await db.projects.put(applyProjectRevisionSyncStateToRecord(projectRecord, revisionState));
  }
  return revisionState;
}

async function buildRevisionData(project: Project): Promise<{ serializedData: string; contentHash: string; assetIds: string[] }> {
  const serializedData = await serializeProjectData(project);
  return {
    serializedData,
    contentHash: computeContentHash(serializedData),
    assetIds: collectPersistedAssetRefsFromSerializedProjectData(serializedData).map((assetRef) => assetRef.assetId),
  };
}

function parseRevisionProjectData(serializedData: string): Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'> {
  return JSON.parse(serializedData) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
}

function isPlainJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function diffJsonValue(
  current: JsonValue,
  next: JsonValue,
  path: RevisionDeltaPathSegment[],
  operations: RevisionDeltaOperation[],
): void {
  if (Object.is(current, next)) {
    return;
  }

  if (Array.isArray(current) && Array.isArray(next)) {
    if (current.length !== next.length) {
      operations.push({ op: 'set', path, value: cloneJsonValue(next) });
      return;
    }

    for (let index = 0; index < current.length; index += 1) {
      diffJsonValue(current[index] as JsonValue, next[index] as JsonValue, [...path, index], operations);
    }
    return;
  }

  if (isPlainJsonObject(current) && isPlainJsonObject(next)) {
    const keySet = new Set([...Object.keys(current), ...Object.keys(next)]);
    for (const key of keySet) {
      const currentHasKey = Object.prototype.hasOwnProperty.call(current, key);
      const nextHasKey = Object.prototype.hasOwnProperty.call(next, key);
      if (!nextHasKey) {
        operations.push({ op: 'delete', path: [...path, key] });
        continue;
      }
      if (!currentHasKey) {
        operations.push({ op: 'set', path: [...path, key], value: cloneJsonValue(next[key] as JsonValue) });
        continue;
      }
      diffJsonValue(current[key] as JsonValue, next[key] as JsonValue, [...path, key], operations);
    }
    return;
  }

  operations.push({ op: 'set', path, value: cloneJsonValue(next) });
}

function createSerializedProjectDelta(
  baseSerializedData: string,
  nextSerializedData: string,
  parentContentHash: string,
  resultContentHash: string,
): SerializedProjectDelta {
  const current = JSON.parse(baseSerializedData) as JsonValue;
  const next = JSON.parse(nextSerializedData) as JsonValue;
  const ops: RevisionDeltaOperation[] = [];
  diffJsonValue(current, next, [], ops);
  return {
    format: REVISION_DELTA_FORMAT,
    parentContentHash,
    resultContentHash,
    ops,
  };
}

function parseSerializedProjectDelta(value: string | undefined): SerializedProjectDelta | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SerializedProjectDelta>;
    if (parsed?.format !== REVISION_DELTA_FORMAT || !Array.isArray(parsed.ops)) {
      return null;
    }
    return parsed as SerializedProjectDelta;
  } catch {
    return null;
  }
}

function applySetOperation(root: JsonValue, path: RevisionDeltaPathSegment[], value: JsonValue): JsonValue {
  if (path.length === 0) {
    return cloneJsonValue(value);
  }

  let cursor: JsonValue = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];

    if (typeof segment === 'number') {
      if (!Array.isArray(cursor)) {
        throw new Error('Invalid delta path: expected array parent.');
      }
      if (cursor[segment] === undefined) {
        cursor[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      cursor = cursor[segment] as JsonValue;
      continue;
    }

    if (!isPlainJsonObject(cursor)) {
      throw new Error('Invalid delta path: expected object parent.');
    }
    if (cursor[segment] === undefined) {
      cursor[segment] = typeof nextSegment === 'number' ? [] : {};
    }
    cursor = cursor[segment] as JsonValue;
  }

  const lastSegment = path[path.length - 1];
  if (typeof lastSegment === 'number') {
    if (!Array.isArray(cursor)) {
      throw new Error('Invalid delta path: expected array for terminal set.');
    }
    cursor[lastSegment] = cloneJsonValue(value);
    return root;
  }

  if (!isPlainJsonObject(cursor)) {
    throw new Error('Invalid delta path: expected object for terminal set.');
  }
  cursor[lastSegment] = cloneJsonValue(value);
  return root;
}

function applyDeleteOperation(root: JsonValue, path: RevisionDeltaPathSegment[]): JsonValue {
  if (path.length === 0) {
    throw new Error('Invalid delta path: cannot delete root.');
  }

  let cursor: JsonValue = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (typeof segment === 'number') {
      if (!Array.isArray(cursor)) {
        throw new Error('Invalid delta path: expected array parent.');
      }
      cursor = cursor[segment] as JsonValue;
      continue;
    }

    if (!isPlainJsonObject(cursor)) {
      throw new Error('Invalid delta path: expected object parent.');
    }
    cursor = cursor[segment] as JsonValue;
  }

  const lastSegment = path[path.length - 1];
  if (typeof lastSegment === 'number') {
    if (!Array.isArray(cursor)) {
      throw new Error('Invalid delta path: expected array for terminal delete.');
    }
    cursor.splice(lastSegment, 1);
    return root;
  }

  if (!isPlainJsonObject(cursor)) {
    throw new Error('Invalid delta path: expected object for terminal delete.');
  }
  delete cursor[lastSegment];
  return root;
}

function applySerializedProjectDelta(baseSerializedData: string, delta: SerializedProjectDelta): string {
  const base = JSON.parse(baseSerializedData) as JsonValue;
  let next = cloneJsonValue(base);

  for (const operation of delta.ops) {
    if (operation.op === 'set') {
      next = applySetOperation(next, operation.path, operation.value);
      continue;
    }
    next = applyDeleteOperation(next, operation.path);
  }

  return JSON.stringify(next);
}

type MaterializedRevisionData = {
  serializedData: string;
  schemaVersion: number;
  assetIds: string[];
};

function getRevisionDeltaDepth(
  record: ProjectRevisionRecord | null,
  revisionsById: Map<string, ProjectRevisionRecord>,
): number {
  let depth = 0;
  let current = record;
  while (current?.kind === 'delta' && current.parentRevisionId) {
    depth += 1;
    current = revisionsById.get(current.parentRevisionId) ?? null;
  }
  return depth;
}

function materializeRevisionRecord(
  record: ProjectRevisionRecord,
  revisionsById: Map<string, ProjectRevisionRecord>,
  memo: Map<string, MaterializedRevisionData>,
): MaterializedRevisionData {
  const cached = memo.get(record.id);
  if (cached) {
    return cached;
  }

  if (record.snapshotData) {
    const materialized = {
      serializedData: record.snapshotData,
      schemaVersion: normalizeSchemaVersion(record.schemaVersion),
      assetIds: getPersistedAssetIdsFromRecord(record, record.snapshotData),
    } satisfies MaterializedRevisionData;
    memo.set(record.id, materialized);
    return materialized;
  }

  if (!record.patch) {
    throw new Error(`Revision "${record.id}" is missing serialized revision data.`);
  }

  const parsedDelta = parseSerializedProjectDelta(record.patch);
  if (!parsedDelta) {
    const materialized = {
      serializedData: record.patch,
      schemaVersion: normalizeSchemaVersion(record.schemaVersion),
      assetIds: getPersistedAssetIdsFromRecord(record, record.patch),
    } satisfies MaterializedRevisionData;
    memo.set(record.id, materialized);
    return materialized;
  }

  if (!record.parentRevisionId) {
    throw new Error(`Delta revision "${record.id}" is missing a parent revision.`);
  }

  const parentRecord = revisionsById.get(record.parentRevisionId);
  if (!parentRecord) {
    throw new Error(`Parent revision "${record.parentRevisionId}" was not found for delta revision "${record.id}".`);
  }

  const parentMaterialized = materializeRevisionRecord(parentRecord, revisionsById, memo);
  const parentHash = computeContentHash(parentMaterialized.serializedData);
  if (parsedDelta.parentContentHash !== parentHash) {
    throw new Error(`Delta revision "${record.id}" has an unexpected parent content hash.`);
  }

  const serializedData = applySerializedProjectDelta(parentMaterialized.serializedData, parsedDelta);
  const nextHash = computeContentHash(serializedData);
  if (parsedDelta.resultContentHash !== nextHash || record.contentHash !== nextHash) {
    throw new Error(`Delta revision "${record.id}" failed integrity verification.`);
  }

  const materialized = {
    serializedData,
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    assetIds: getPersistedAssetIdsFromRecord(record, serializedData),
  } satisfies MaterializedRevisionData;
  memo.set(record.id, materialized);
  return materialized;
}

function migrateSerializedProjectDataToCurrentSchema(
  serializedData: string,
  sourceSchemaVersion: number,
  meta: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  },
): {
  serializedData: string;
  schemaVersion: number;
  migrated: boolean;
} {
  const parsedData = JSON.parse(serializedData) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  let project: Project = {
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    ...parsedData,
  };

  let migrated = false;
  if (sourceSchemaVersion < CURRENT_SCHEMA_VERSION) {
    project = migrateProject(project, sourceSchemaVersion);
    migrated = true;
  }

  project = normalizeMessagesInProject(project);
  project = normalizeCostumeDocumentsInProject(project);
  project = normalizeBackgroundDocumentsInProject(project);
  project = normalizeProjectLayering(project);

  const { id: _id, name: _name, createdAt: _createdAt, updatedAt: _updatedAt, ...projectData } = project;
  return {
    serializedData: JSON.stringify(projectData),
    schemaVersion: migrated ? CURRENT_SCHEMA_VERSION : sourceSchemaVersion,
    migrated,
  };
}

function formatRestoreTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

async function ensureUniqueProjectName(baseName: string): Promise<string> {
  const existing = await listProjects();
  const names = new Set(existing.map((project) => project.name));
  if (!names.has(baseName)) return baseName;

  let index = 2;
  while (names.has(`${baseName} (${index})`)) {
    index += 1;
  }
  return `${baseName} (${index})`;
}

export async function createRevision(
  project: Project,
  reason: ProjectRevisionReason,
  options: RevisionCreateOptions = {},
): Promise<ProjectRevision | null> {
  if (!isNonEmptyStringKey(project.id)) {
    throw new Error('Invalid project revision key: project.id must be a non-empty string.');
  }

  const { serializedData, contentHash, assetIds } = await buildRevisionData(project);
  const latestRevision = await getLatestRevision(project.id);
  if (reason !== 'manual_checkpoint' && reason !== 'restore' && latestRevision?.contentHash === contentHash) {
    return null;
  }

  const checkpointName = options.checkpointName ? normalizeCheckpointName(options.checkpointName) : undefined;
  const isCheckpoint = options.isCheckpoint ?? false;
  if (isCheckpoint && !checkpointName && reason === 'manual_checkpoint') {
    throw new Error('Checkpoint name is required for manual checkpoints.');
  }

  const revisionId = crypto.randomUUID();
  const revisions = await getProjectRevisionsAscending(project.id);
  const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
  const revisionTimestamp = new Date();

  let record: ProjectRevisionRecord | null = null;
  if (reason === 'auto_checkpoint' && latestRevision) {
    try {
      const latestMaterialized = materializeRevisionRecord(latestRevision, revisionsById, new Map());
      const delta = createSerializedProjectDelta(
        latestMaterialized.serializedData,
        serializedData,
        latestRevision.contentHash,
        contentHash,
      );
      const serializedDelta = JSON.stringify(delta);
      const roundTripSerializedData = applySerializedProjectDelta(latestMaterialized.serializedData, delta);
      const nextDeltaDepth = getRevisionDeltaDepth(latestRevision, revisionsById) + 1;
      const shouldStoreAsDelta =
        roundTripSerializedData === serializedData &&
        serializedDelta.length < Math.floor(serializedData.length * MAX_AUTO_CHECKPOINT_DELTA_SIZE_RATIO) &&
        nextDeltaDepth <= MAX_AUTO_CHECKPOINT_DELTA_CHAIN_LENGTH;

      if (shouldStoreAsDelta) {
        record = {
          id: revisionId,
          projectId: project.id,
          parentRevisionId: latestRevision.id,
          kind: 'delta',
          baseRevisionId: latestRevision.kind === 'snapshot' ? latestRevision.id : latestRevision.baseRevisionId,
          snapshotData: undefined,
          patch: serializedDelta,
          contentHash,
          createdAt: revisionTimestamp,
          updatedAt: revisionTimestamp,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          appVersion: APP_VERSION,
          reason,
          checkpointName,
          isCheckpoint,
          restoredFromRevisionId: options.restoredFromRevisionId,
          assetIds,
        };
      }
    } catch (error) {
      console.warn('[Revisions] Falling back to snapshot auto-checkpoint:', error);
    }
  }

  if (!record) {
    record = {
      id: revisionId,
      projectId: project.id,
      parentRevisionId: latestRevision?.id,
      kind: 'snapshot',
      baseRevisionId: revisionId,
      snapshotData: serializedData,
      patch: undefined,
      contentHash,
      createdAt: revisionTimestamp,
      updatedAt: revisionTimestamp,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      reason,
      checkpointName,
      isCheckpoint,
      restoredFromRevisionId: options.restoredFromRevisionId,
      assetIds,
    };
  }

  await db.projectRevisions.put(record);
  await refreshStoredProjectRevisionSyncState(project.id);
  return toPublicRevision(record);
}

export async function createManualCheckpoint(project: Project, checkpointName: string): Promise<ProjectRevision | null> {
  const normalizedName = normalizeCheckpointName(checkpointName);
  if (!normalizedName) {
    throw new Error('Checkpoint name cannot be empty.');
  }
  return await createRevision(project, 'manual_checkpoint', {
    isCheckpoint: true,
    checkpointName: normalizedName,
  });
}

export async function createAutoCheckpoint(project: Project): Promise<ProjectRevision | null> {
  const latestCheckpoint = await getLatestCheckpointRevision(project.id);
  const { contentHash } = await buildRevisionData(project);
  if (latestCheckpoint?.contentHash === contentHash) {
    return null;
  }
  return await createRevision(project, 'auto_checkpoint', {
    isCheckpoint: true,
  });
}

export type ListProjectRevisionFilters = {
  manualCheckpointsOnly?: boolean;
};

export async function listProjectRevisions(
  projectId: string,
  filters: ListProjectRevisionFilters = {},
): Promise<ProjectRevision[]> {
  if (!isNonEmptyStringKey(projectId)) {
    return [];
  }

  const revisions = await getProjectRevisionsAscending(projectId);
  const filtered = filters.manualCheckpointsOnly
    ? revisions.filter((revision) => revision.reason === 'manual_checkpoint')
    : revisions;
  return filtered
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toPublicRevision);
}

export async function renameCheckpoint(
  projectId: string,
  revisionId: string,
  checkpointName: string,
): Promise<ProjectRevision> {
  const normalizedName = normalizeCheckpointName(checkpointName);
  if (!normalizedName) {
    throw new Error('Checkpoint name cannot be empty.');
  }

  const revision = await db.projectRevisions.get(revisionId);
  if (!revision || revision.projectId !== projectId) {
    throw new Error('Checkpoint not found.');
  }
  if (!revision.isCheckpoint) {
    throw new Error('Revision is not a checkpoint.');
  }

  const updated: ProjectRevisionRecord = {
    ...revision,
    checkpointName: normalizedName,
    updatedAt: new Date(),
  };
  await db.projectRevisions.put(updated);
  await refreshStoredProjectRevisionSyncState(projectId);
  return toPublicRevision(updated);
}

export async function restoreAsNewProject(projectId: string, revisionId: string): Promise<Project> {
  const sourceProject = await loadProject(projectId);
  if (!sourceProject) {
    throw new Error('Source project not found.');
  }

  const revisions = await getProjectRevisionsAscending(projectId);
  const targetIndex = revisions.findIndex((revision) => revision.id === revisionId);
  if (targetIndex < 0) {
    throw new Error('Revision not found.');
  }

  const targetRevision = revisions[targetIndex];
  const materializedTarget = materializeRevisionRecord(
    targetRevision,
    new Map(revisions.map((revision) => [revision.id, revision])),
    new Map(),
  );
  const migratedTarget = migrateSerializedProjectDataToCurrentSchema(
    materializedTarget.serializedData,
    materializedTarget.schemaVersion,
    {
      id: projectId,
      name: sourceProject.name,
      createdAt: new Date(targetRevision.createdAt),
      updatedAt: new Date(targetRevision.createdAt),
    },
  );
  const parsedData = await hydrateProjectAssetsFromStorage(parseRevisionProjectData(migratedTarget.serializedData));
  const restoreLabel = targetRevision.checkpointName
    ? targetRevision.checkpointName
    : formatRestoreTimestamp(new Date(targetRevision.createdAt));
  const desiredName = `${sourceProject.name} (Restored: ${restoreLabel})`;
  const uniqueName = await ensureUniqueProjectName(desiredName);
  const newProjectId = crypto.randomUUID();
  const now = new Date();

  const restoredProject: Project = {
    ...parsedData,
    id: newProjectId,
    name: uniqueName,
    createdAt: now,
    updatedAt: now,
  };

  await saveProject(restoredProject);

  const copiedRevisions = revisions.slice(0, targetIndex + 1);
  const revisionIdMap = new Map<string, string>();
  const newRevisionRecords: ProjectRevisionRecord[] = [];

  for (const revision of copiedRevisions) {
    const newRevisionId = crypto.randomUUID();
    revisionIdMap.set(revision.id, newRevisionId);
  }

  for (const revision of copiedRevisions) {
    const mappedId = revisionIdMap.get(revision.id);
    if (!mappedId) continue;
    const mappedParentId = revision.parentRevisionId ? revisionIdMap.get(revision.parentRevisionId) : undefined;
    const mappedBaseRevisionId = revisionIdMap.get(revision.baseRevisionId) ?? mappedId;
    const mappedRestoredFrom = revision.restoredFromRevisionId
      ? revisionIdMap.get(revision.restoredFromRevisionId)
      : undefined;

    newRevisionRecords.push({
      ...revision,
      id: mappedId,
      projectId: newProjectId,
      parentRevisionId: mappedParentId,
      baseRevisionId: mappedBaseRevisionId,
      restoredFromRevisionId: mappedRestoredFrom,
      createdAt: new Date(revision.createdAt),
      updatedAt: new Date(getRevisionUpdatedAtTime(revision)),
    });
  }

  if (newRevisionRecords.length > 0) {
    await db.projectRevisions.bulkPut(newRevisionRecords);
  }

  await createRevision(restoredProject, 'restore', {
    restoredFromRevisionId: revisionIdMap.get(targetRevision.id) ?? undefined,
  });

  return restoredProject;
}

// Reusable Object Repository

export async function saveReusable(reusable: ReusableObject): Promise<void> {
  const { id, name, thumbnail, createdAt, tags, ...rest } = reusable;
  await db.reusables.put({
    id,
    name,
    thumbnail,
    createdAt,
    tags,
    data: JSON.stringify(rest),
  });
}

export async function loadReusable(id: string): Promise<ReusableObject | null> {
  const record = await db.reusables.get(id);
  if (!record) return null;

  const data = JSON.parse(record.data);
  return {
    id: record.id,
    name: record.name,
    thumbnail: record.thumbnail,
    createdAt: record.createdAt,
    tags: record.tags,
    ...data,
  };
}

export async function listReusables(): Promise<ReusableObject[]> {
  const records = await db.reusables.orderBy('createdAt').reverse().toArray();
  return records.map((record) => {
    const data = JSON.parse(record.data);
    return {
      id: record.id,
      name: record.name,
      thumbnail: record.thumbnail,
      createdAt: record.createdAt,
      tags: record.tags,
      ...data,
    };
  });
}

export async function deleteReusable(id: string): Promise<void> {
  await db.reusables.delete(id);
}

// === Cloud Sync Functions ===

export interface ProjectSyncPayload {
  localId: string;
  name: string;
  data: string;
  assetIds: string[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  appVersion: string;
  contentHash: string;
}

export interface ProjectSyncMetadata {
  localId: string;
  updatedAt: number;
  schemaVersion: number;
  contentHash: string;
  assetIds: string[];
}

export interface ProjectRevisionSyncPayload {
  localProjectId: string;
  revisionId: string;
  parentRevisionId?: string;
  kind: ProjectRevisionKind;
  baseRevisionId: string;
  data: string;
  assetIds: string[];
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  appVersion?: string;
  reason: ProjectRevisionReason;
  checkpointName?: string;
  isCheckpoint: boolean;
  restoredFromRevisionId?: string;
}

export interface ProjectRevisionSyncMetadata {
  revisionId: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  contentHash: string;
  assetIds: string[];
  reason: ProjectRevisionReason;
  checkpointName?: string;
  isCheckpoint: boolean;
}

export interface ProjectRevisionSyncState {
  revisionCount: number;
  latestRevisionId: string | null;
  latestRevisionCreatedAt: number | null;
  latestRevisionContentHash: string | null;
  revisionsUpdatedAt: number | null;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

function computeContentHash(data: string): string {
  let hash = FNV64_OFFSET;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= BigInt(data.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function normalizeContentHash(hash: unknown): string | null {
  if (typeof hash !== 'string') {
    return null;
  }

  const normalized = hash.trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(normalized) ? normalized : null;
}

function chooseIncomingByTieBreak(incomingHash: string | null, existingHash: string | null): boolean {
  if (!incomingHash || !existingHash) {
    return false;
  }

  return incomingHash > existingHash;
}

async function preserveLocalConflictCopy(existing: ProjectRecord, existingHash: string): Promise<void> {
  const suffix = existingHash.slice(0, 8);
  const conflictId = `${existing.id}-conflict-${suffix}`;
  const alreadyExists = await db.projects.get(conflictId);
  if (alreadyExists) {
    return;
  }

  const timestampLabel = new Date().toISOString().replace('T', ' ').slice(0, 16);
  await db.projects.put({
    ...existing,
    id: conflictId,
    name: `${existing.name} (Conflict ${timestampLabel})`,
    createdAt: new Date(existing.createdAt),
    updatedAt: new Date(),
    contentHash: existingHash,
  });
}

export async function createProjectSyncPayload(project: Project): Promise<ProjectSyncPayload> {
  const data = await serializeProjectData(project);
  return {
    localId: project.id,
    name: project.name,
    data,
    assetIds: collectPersistedAssetRefsFromSerializedProjectData(data).map((assetRef) => assetRef.assetId),
    createdAt: project.createdAt.getTime(),
    updatedAt: project.updatedAt.getTime(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    contentHash: computeContentHash(data),
  };
}

function recordToSyncPayload(record: ProjectRecord): ProjectSyncPayload {
  const contentHash = normalizeContentHash(record.contentHash) ?? computeContentHash(record.data);
  return {
    localId: record.id,
    name: record.name,
    data: record.data,
    assetIds: getPersistedAssetIdsFromRecord(record, record.data),
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    appVersion: record.appVersion ?? APP_VERSION,
    contentHash,
  };
}

function recordToSyncMetadata(record: ProjectRecord): ProjectSyncMetadata {
  return {
    localId: record.id,
    updatedAt: record.updatedAt.getTime(),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    contentHash: normalizeContentHash(record.contentHash) ?? computeContentHash(record.data),
    assetIds: getPersistedAssetIdsFromRecord(record, record.data),
  };
}

function revisionRecordToSyncPayload(record: ProjectRevisionRecord): ProjectRevisionSyncPayload {
  const data = record.snapshotData ?? record.patch ?? '';
  return {
    localProjectId: record.projectId,
    revisionId: record.id,
    parentRevisionId: record.parentRevisionId,
    kind: record.kind,
    baseRevisionId: record.baseRevisionId,
    data,
    assetIds: getPersistedAssetIdsFromRecord(record, data),
    contentHash: normalizeContentHash(record.contentHash) ?? computeContentHash(data),
    createdAt: record.createdAt.getTime(),
    updatedAt: getRevisionUpdatedAtTime(record),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    appVersion: record.appVersion ?? APP_VERSION,
    reason: record.reason,
    checkpointName: record.checkpointName,
    isCheckpoint: record.isCheckpoint,
    restoredFromRevisionId: record.restoredFromRevisionId,
  };
}

function revisionRecordToSyncMetadata(record: ProjectRevisionRecord): ProjectRevisionSyncMetadata {
  const data = record.snapshotData ?? record.patch ?? '';
  return {
    revisionId: record.id,
    createdAt: record.createdAt.getTime(),
    updatedAt: getRevisionUpdatedAtTime(record),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    contentHash: normalizeContentHash(record.contentHash) ?? computeContentHash(data),
    assetIds: getPersistedAssetIdsFromRecord(record, data),
    reason: record.reason,
    checkpointName: record.checkpointName,
    isCheckpoint: record.isCheckpoint,
  };
}

function buildRevisionSyncFingerprint(
  revision: Pick<ProjectRevisionSyncMetadata, 'contentHash' | 'checkpointName' | 'reason' | 'isCheckpoint' | 'assetIds'>,
): string {
  return [
    normalizeContentHash(revision.contentHash) ?? '',
    revision.checkpointName ?? '',
    revision.reason,
    revision.isCheckpoint ? '1' : '0',
    Array.from(new Set(revision.assetIds)).sort().join(','),
  ].join('|');
}

function shouldReplaceRevisionRecord(
  existing: Pick<ProjectRevisionRecord, 'createdAt' | 'contentHash' | 'checkpointName' | 'reason' | 'isCheckpoint' | 'assetIds'> & Partial<Pick<ProjectRevisionRecord, 'updatedAt'>>,
  incoming: ProjectRevisionSyncMetadata,
): boolean {
  const existingUpdatedAt = getRevisionUpdatedAtTime(existing);
  if (incoming.updatedAt > existingUpdatedAt) {
    return true;
  }
  if (incoming.updatedAt < existingUpdatedAt) {
    return false;
  }

  const existingFingerprint = buildRevisionSyncFingerprint({
    contentHash: existing.contentHash,
    checkpointName: existing.checkpointName,
    reason: existing.reason,
    isCheckpoint: existing.isCheckpoint,
    assetIds: existing.assetIds ?? [],
  });
  const incomingFingerprint = buildRevisionSyncFingerprint(incoming);
  if (incomingFingerprint === existingFingerprint) {
    return false;
  }

  return incomingFingerprint > existingFingerprint;
}

// Get all local projects for batch sync
export async function getAllProjectsForSync(): Promise<ProjectSyncPayload[]> {
  const records = await db.projects.toArray();
  return records.map((record) => recordToSyncPayload({
    ...record,
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
  }));
}

export async function getProjectSyncMetadata(id: string): Promise<ProjectSyncMetadata | null> {
  const record = await db.projects.get(id);
  if (!record) {
    return null;
  }

  return recordToSyncMetadata({
    ...record,
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
  });
}

export async function getProjectRevisionSyncMetadata(projectId: string): Promise<ProjectRevisionSyncMetadata[]> {
  const revisions = await getProjectRevisionsAscending(projectId);
  return revisions.map(revisionRecordToSyncMetadata);
}

export async function getProjectRevisionSyncState(projectId: string): Promise<ProjectRevisionSyncState> {
  if (!isNonEmptyStringKey(projectId)) {
    return createEmptyProjectRevisionSyncState();
  }

  const projectRecord = await db.projects.get(projectId);
  const storedState = getProjectRevisionSyncStateFromRecord(projectRecord);
  const hasStoredRevisionState = projectRecord
    && (
      typeof projectRecord.revisionCount === 'number'
      || typeof projectRecord.revisionsUpdatedAt === 'number'
      || typeof projectRecord.latestRevisionId === 'string'
    );
  if (hasStoredRevisionState) {
    return storedState;
  }

  return await refreshStoredProjectRevisionSyncState(projectId);
}

export async function getProjectRevisionsForSync(
  projectId: string,
  revisionIds?: readonly string[],
): Promise<ProjectRevisionSyncPayload[]> {
  const revisions = await getProjectRevisionsAscending(projectId);
  const revisionIdSet = revisionIds ? new Set(revisionIds) : null;
  return revisions
    .filter((revision) => !revisionIdSet || revisionIdSet.has(revision.id))
    .map(revisionRecordToSyncPayload);
}

export async function pruneLocalProjectsNotInCloud(cloudLocalIds: string[]): Promise<{ deleted: number }> {
  const cloudIdSet = new Set(cloudLocalIds);
  const localRecords = await db.projects.toArray();
  const explorerState = await loadProjectExplorerStateInternal();
  const isConflictCopyId = (id: string) => /-conflict-[0-9a-f]{8}$/i.test(id);
  const localOnlyRecords = localRecords.filter((record) => !cloudIdSet.has(record.id) && !isConflictCopyId(record.id));
  const localOnlyIds = localOnlyRecords.map((record) => record.id);

  if (localOnlyIds.length === 0) {
    return { deleted: 0 };
  }

  const revisions = await db.projectRevisions
    .where('projectId')
    .anyOf(localOnlyIds)
    .toArray();

  await db.transaction('rw', db.projects, async () => {
    await Promise.all(localOnlyIds.map((localId) => db.projects.delete(localId)));
  });

  await db.transaction('rw', db.projectRevisions, async () => {
    await Promise.all(revisions.map((revision) => db.projectRevisions.delete(revision.id)));
  });

  const prunedProjectMeta = explorerState.projects.filter((entry) => localOnlyIds.includes(entry.projectId));
  if (prunedProjectMeta.length > 0) {
    await updateProjectExplorerState((state) => ({
      ...state,
      updatedAt: Date.now(),
      projects: state.projects.filter((entry) => !localOnlyIds.includes(entry.projectId)),
    }));
  }

  const touchedAssetIds = new Set<string>([
    ...localOnlyRecords.flatMap((record) => getPersistedAssetIdsFromRecord(record, record.data)),
    ...revisions.flatMap((revision) =>
      getPersistedAssetIdsFromRecord(revision, revision.snapshotData ?? revision.patch),
    ),
    ...prunedProjectMeta
      .map((entry) => entry.thumbnailAssetId)
      .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0),
  ]);
  await garbageCollectManagedAssets(touchedAssetIds);

  return { deleted: localOnlyIds.length };
}

// Sync a single project from cloud to local
export async function syncProjectFromCloud(cloudProject: {
  localId: string;
  name: string;
  data: string;
  assetIds?: string[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
  contentHash?: string;
  revisionCount?: number | null;
  latestRevisionId?: string | null;
  latestRevisionCreatedAt?: number | null;
  latestRevisionContentHash?: string | null;
  revisionsUpdatedAt?: number | null;
}): Promise<{ action: 'created' | 'updated' | 'skipped'; reason?: string; migrated?: boolean }> {
  const cloudSchemaVersion = normalizeSchemaVersion(cloudProject.schemaVersion);

  if (cloudSchemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      action: 'skipped',
      reason: `cloud schema v${cloudSchemaVersion} is newer than supported v${CURRENT_SCHEMA_VERSION}`,
    };
  }

  let cloudData: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  try {
    cloudData = JSON.parse(cloudProject.data) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  } catch {
    return {
      action: 'skipped',
      reason: 'cloud project data is invalid JSON',
    };
  }

  let incomingProject: Project = {
    id: cloudProject.localId,
    name: cloudProject.name,
    createdAt: new Date(cloudProject.createdAt),
    updatedAt: new Date(cloudProject.updatedAt),
    ...cloudData,
  };

  let migrated = false;
  if (cloudSchemaVersion < CURRENT_SCHEMA_VERSION) {
    incomingProject = migrateProject(incomingProject, cloudSchemaVersion);
    incomingProject.updatedAt = new Date(Math.max(Date.now(), cloudProject.updatedAt));
    migrated = true;
  }

  incomingProject = normalizeMessagesInProject(incomingProject);
  incomingProject = normalizeCostumeDocumentsInProject(incomingProject);
  incomingProject = normalizeBackgroundDocumentsInProject(incomingProject);

  const {
    id: _incomingId,
    name: _incomingName,
    createdAt: _incomingCreatedAt,
    updatedAt: _incomingUpdatedAt,
    ...incomingDataForStorage
  } = incomingProject;
  const serializedIncomingData = JSON.stringify(incomingDataForStorage);
  const incomingRecord: ProjectRecord = {
    id: incomingProject.id,
    name: incomingProject.name,
    data: serializedIncomingData,
    createdAt: new Date(cloudProject.createdAt),
    updatedAt: new Date(incomingProject.updatedAt),
    schemaVersion: migrated ? CURRENT_SCHEMA_VERSION : cloudSchemaVersion,
    appVersion: cloudProject.appVersion,
    cloudBacked: true,
    contentHash: normalizeContentHash(cloudProject.contentHash) ?? computeContentHash(serializedIncomingData),
    assetIds: Array.from(
      new Set(
        (cloudProject.assetIds ?? collectPersistedAssetRefsFromSerializedProjectData(serializedIncomingData)
          .map((assetRef) => assetRef.assetId))
          .filter((assetId): assetId is string => isManagedAssetId(assetId)),
      ),
    ),
    revisionCount: typeof cloudProject.revisionCount === 'number' ? cloudProject.revisionCount : undefined,
    latestRevisionId: typeof cloudProject.latestRevisionId === 'string' ? cloudProject.latestRevisionId : undefined,
    latestRevisionCreatedAt:
      typeof cloudProject.latestRevisionCreatedAt === 'number' ? cloudProject.latestRevisionCreatedAt : undefined,
    latestRevisionContentHash: normalizeContentHash(cloudProject.latestRevisionContentHash) ?? undefined,
    revisionsUpdatedAt:
      typeof cloudProject.revisionsUpdatedAt === 'number' ? cloudProject.revisionsUpdatedAt : undefined,
  };

  const existing = await db.projects.get(cloudProject.localId);

  if (!existing) {
    await db.projects.put(incomingRecord);
    await garbageCollectManagedAssets(incomingRecord.assetIds ?? []);
    return { action: 'created', migrated };
  }

  const existingSchemaVersion = normalizeSchemaVersion(existing.schemaVersion);
  if (incomingRecord.schemaVersion < existingSchemaVersion) {
    return {
      action: 'skipped',
      reason: `schema downgrade blocked (incoming v${incomingRecord.schemaVersion}, local v${existingSchemaVersion})`,
    };
  }

  const incomingUpdatedAtMs = incomingRecord.updatedAt.getTime();
  const existingUpdatedAtMs = existing.updatedAt.getTime();
  let shouldUpdate = false;
  let reason: string | undefined;

  if (incomingRecord.schemaVersion > existingSchemaVersion) {
    shouldUpdate = true;
    reason = 'incoming schema is newer';
  } else if (incomingUpdatedAtMs > existingUpdatedAtMs) {
    shouldUpdate = true;
    reason = 'incoming project is newer';
  } else if (incomingUpdatedAtMs < existingUpdatedAtMs) {
    shouldUpdate = false;
    reason = 'local project is newer';
  } else {
    const incomingHash =
      normalizeContentHash(incomingRecord.contentHash) ?? computeContentHash(incomingRecord.data);
    const existingHash =
      normalizeContentHash(existing.contentHash) ?? computeContentHash(existing.data);

    if (incomingHash === existingHash) {
      shouldUpdate = false;
      reason = 'same timestamp and identical content';
    } else {
      const incomingWins = chooseIncomingByTieBreak(incomingHash, existingHash);
      shouldUpdate = incomingWins;
      reason = incomingWins
        ? 'same timestamp conflict resolved in favor of incoming hash'
        : 'same timestamp conflict resolved in favor of local hash';

      if (incomingWins) {
        await preserveLocalConflictCopy(existing, existingHash);
      }
    }
  }

  if (!shouldUpdate) {
    return { action: 'skipped', reason };
  }

  const finalIncomingRecord =
    incomingRecord.revisionCount === undefined
      ? applyProjectRevisionSyncStateToRecord(incomingRecord, getProjectRevisionSyncStateFromRecord(existing))
      : incomingRecord;
  await db.projects.put(finalIncomingRecord);
  await garbageCollectManagedAssets(new Set<string>([
    ...getPersistedAssetIdsFromRecord(existing, existing.data),
    ...getPersistedAssetIdsFromRecord(finalIncomingRecord, finalIncomingRecord.data),
  ]));
  return { action: 'updated', migrated, reason };
}

export async function syncProjectRevisionsFromCloud(
  projectId: string,
  cloudRevisions: ProjectRevisionSyncPayload[],
): Promise<{ created: number; updated: number; skipped: number; migrated: number }> {
  const projectExists = await db.projects.get(projectId);
  if (!projectExists) {
    return { created: 0, updated: 0, skipped: cloudRevisions.length, migrated: 0 };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const migrated = 0;

  for (const payload of cloudRevisions) {
    if (payload.localProjectId !== projectId) {
      skipped += 1;
      continue;
    }

    const incomingSchemaVersion = normalizeSchemaVersion(payload.schemaVersion);
    const incomingKind: ProjectRevisionKind = payload.kind === 'delta' ? 'delta' : 'snapshot';
    const incomingReason: ProjectRevisionReason = (
      ['manual_checkpoint', 'auto_checkpoint', 'import', 'restore', 'edit_revision'] as ProjectRevisionReason[]
    ).includes(payload.reason)
      ? payload.reason
      : 'edit_revision';

    const incomingAssetIds = Array.from(
      new Set(
        (
          payload.assetIds
          ?? (incomingKind === 'snapshot'
            ? collectPersistedAssetRefsFromSerializedProjectData(payload.data).map((assetRef) => assetRef.assetId)
            : (parseSerializedProjectDelta(payload.data) === null
              ? collectPersistedAssetRefsFromSerializedProjectData(payload.data).map((assetRef) => assetRef.assetId)
              : []))
        ).filter((assetId): assetId is string => isManagedAssetId(assetId)),
      ),
    );

    const incomingRecord: ProjectRevisionRecord = {
      id: payload.revisionId,
      projectId: payload.localProjectId,
      parentRevisionId: payload.parentRevisionId,
      kind: incomingKind,
      baseRevisionId: payload.baseRevisionId,
      snapshotData: incomingKind === 'snapshot' ? payload.data : undefined,
      patch: incomingKind === 'delta' ? payload.data : undefined,
      contentHash: normalizeContentHash(payload.contentHash) ?? computeContentHash(payload.data),
      createdAt: new Date(payload.createdAt),
      updatedAt: new Date(payload.updatedAt ?? payload.createdAt),
      schemaVersion: incomingSchemaVersion,
      appVersion: payload.appVersion,
      reason: incomingReason,
      checkpointName: payload.checkpointName ? normalizeCheckpointName(payload.checkpointName) : undefined,
      isCheckpoint: Boolean(payload.isCheckpoint),
      restoredFromRevisionId: payload.restoredFromRevisionId,
      assetIds: incomingAssetIds,
    };

    const existing = await db.projectRevisions.get(incomingRecord.id);
    if (!existing) {
      await db.projectRevisions.put(incomingRecord);
      await garbageCollectManagedAssets(incomingRecord.assetIds ?? []);
      created += 1;
      continue;
    }

    if (existing.projectId !== projectId) {
      skipped += 1;
      continue;
    }

    const shouldUpdate = shouldReplaceRevisionRecord(existing, revisionRecordToSyncMetadata(incomingRecord));

    if (!shouldUpdate) {
      skipped += 1;
      continue;
    }

    await db.projectRevisions.put(incomingRecord);
    await garbageCollectManagedAssets(new Set<string>([
      ...getPersistedAssetIdsFromRecord(existing, existing.snapshotData ?? existing.patch),
      ...getPersistedAssetIdsFromRecord(incomingRecord, incomingRecord.snapshotData ?? incomingRecord.patch),
    ]));
    updated += 1;
  }

  if (created > 0 || updated > 0) {
    await refreshStoredProjectRevisionSyncState(projectId);
  }

  return { created, updated, skipped, migrated };
}

// Get single project record for sync
export async function getProjectForSync(id: string): Promise<ProjectSyncPayload | null> {
  return await getProjectForSyncFromRecord(id);
}

export async function getProjectForSyncFromRecord(id: string): Promise<ProjectSyncPayload | null> {
  const record = await db.projects.get(id);
  if (!record) return null;
  return recordToSyncPayload({
    ...record,
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
  });
}

export async function migrateAllLocalProjects(): Promise<{
  migrated: number;
  skipped: number;
  failed: number;
}> {
  const records = await db.projects.toArray();
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const originalSchemaVersion = normalizeSchemaVersion(record.schemaVersion);
      await loadProject(record.id);
      if (originalSchemaVersion < CURRENT_SCHEMA_VERSION) {
        migrated += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`[Migration] Failed to migrate project ${record.id}:`, error);
    }
  }

  return { migrated, skipped, failed };
}

// Export / Import

const PROJECT_BUNDLE_TYPE = 'pochacoding-project-bundle';
const PROJECT_BUNDLE_FORMAT_VERSION = 1;
const PROJECT_BUNDLE_MANIFEST_PATH = 'manifest.json';

// Supported file types for backwards compatibility
const SUPPORTED_FILE_TYPES = ['pochacoding-project', 'phaserblockly-project'] as const;

export interface ExportedProject {
  schemaVersion: number; // Schema version for migrations
  type: 'pochacoding-project';
  exportedAt: string;
  appVersion?: string; // Optional: app version that created this file
  project: Project;
}

interface ExportedProjectBundleManifest {
  formatVersion: number;
  type: typeof PROJECT_BUNDLE_TYPE;
  exportedAt: string;
  schemaVersion: number;
  appVersion?: string;
  project: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    data: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  };
  assets: Array<{
    assetId: string;
    kind: ManagedAssetKind;
    mimeType: string;
    size: number;
    path: string;
  }>;
}

// Schema migration functions - add new migrations here as schema evolves
type MigrationFn = (project: Project) => Project;

function remapLegacySceneNameRefsInBlocklyXml(
  blocklyXml: string,
  sceneNameToId: Map<string, string>,
  sceneIds: Set<string>
): string {
  if (!blocklyXml.trim()) return blocklyXml;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return blocklyXml;
  }

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(blocklyXml, 'text/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      return blocklyXml;
    }

    let changed = false;
    const blocks = Array.from(xmlDoc.getElementsByTagName('block'));
    for (const block of blocks) {
      if ((block.getAttribute('type') || '') !== 'control_switch_scene') continue;

      const fields = Array.from(block.children).filter(
        (child): child is Element =>
          child.tagName.toLowerCase() === 'field' &&
          child.getAttribute('name') === 'SCENE'
      );

      for (const field of fields) {
        const currentValue = (field.textContent || '').trim();
        if (!currentValue || sceneIds.has(currentValue)) {
          continue;
        }

        const remappedId = sceneNameToId.get(currentValue);
        if (remappedId && remappedId !== currentValue) {
          field.textContent = remappedId;
          changed = true;
        }
      }
    }

    if (!changed || !xmlDoc.documentElement) {
      return blocklyXml;
    }

    return new XMLSerializer().serializeToString(xmlDoc.documentElement);
  } catch {
    return blocklyXml;
  }
}

function normalizeMessageName(name: unknown): string {
  return typeof name === 'string' ? name.trim() : '';
}

function remapLegacyMessageRefsInBlocklyXml(
  blocklyXml: string,
  messageIdSet: Set<string>,
  messageNameToId: Map<string, string>,
  ensureMessageIdForName: (name: string) => string,
): string {
  if (!blocklyXml.trim()) return blocklyXml;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return blocklyXml;
  }

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(blocklyXml, 'text/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      return blocklyXml;
    }

    let changed = false;
    const blocks = Array.from(xmlDoc.getElementsByTagName('block'));
    for (const block of blocks) {
      const blockType = block.getAttribute('type') || '';
      const messageFieldName = MESSAGE_REFERENCE_BLOCKS[blockType];
      if (!messageFieldName) continue;

      const fields = Array.from(block.children).filter(
        (child): child is Element =>
          child.tagName.toLowerCase() === 'field' &&
          child.getAttribute('name') === messageFieldName,
      );

      for (const field of fields) {
        const currentValue = (field.textContent || '').trim();
        if (!currentValue || messageIdSet.has(currentValue)) {
          continue;
        }

        const messageId = messageNameToId.get(currentValue) || ensureMessageIdForName(currentValue);
        if (messageId && messageId !== currentValue) {
          field.textContent = messageId;
          changed = true;
        }
      }
    }

    if (!changed || !xmlDoc.documentElement) {
      return blocklyXml;
    }

    return new XMLSerializer().serializeToString(xmlDoc.documentElement);
  } catch {
    return blocklyXml;
  }
}

const migrations: Record<number, MigrationFn> = {
  // v2: Ensure basic scene defaults for older files.
  2: (project) => {
    const scenes = Array.isArray(project.scenes) ? project.scenes : [];
    return {
      ...project,
      scenes: scenes.map((scene) => ({
        ...scene,
        objectFolders: Array.isArray(scene.objectFolders) ? scene.objectFolders : [],
        cameraConfig: scene.cameraConfig ?? {
          followTarget: null,
          bounds: null,
          zoom: 1,
        },
      })),
      components: Array.isArray(project.components) ? project.components : [],
      globalVariables: Array.isArray(project.globalVariables) ? project.globalVariables : [],
      messages: Array.isArray(project.messages) ? project.messages : [],
      schemaVersion: 2,
    };
  },
  // v3: Normalize robust layer tree structure (parentId/order).
  3: (project) => ({
    ...normalizeProjectLayering(project),
    schemaVersion: 3,
  }),
  // v4: Add costume editor metadata defaults.
  4: (project) => ({
    ...project,
    schemaVersion: 4,
  }),
  // v5: Migrate legacy scene-name references in Blockly "switch scene" blocks to scene IDs.
  5: (project) => {
    const scenes = Array.isArray(project.scenes) ? project.scenes : [];
    const countsByName = new Map<string, number>();
    for (const scene of scenes) {
      const name = typeof scene.name === 'string' ? scene.name.trim() : '';
      if (!name) continue;
      countsByName.set(name, (countsByName.get(name) || 0) + 1);
    }

    const sceneNameToId = new Map<string, string>();
    for (const scene of scenes) {
      const name = typeof scene.name === 'string' ? scene.name.trim() : '';
      if (!name) continue;
      if ((countsByName.get(name) || 0) !== 1) continue;
      sceneNameToId.set(name, scene.id);
    }
    const sceneIds = new Set(scenes.map((scene) => scene.id));

    return {
      ...project,
      scenes: scenes.map((scene) => ({
        ...scene,
        objects: (scene.objects || []).map((obj) => ({
          ...obj,
          blocklyXml: remapLegacySceneNameRefsInBlocklyXml(
            obj.blocklyXml || '',
            sceneNameToId,
            sceneIds,
          ),
        })),
      })),
      components: (project.components || []).map((component) => ({
        ...component,
        blocklyXml: remapLegacySceneNameRefsInBlocklyXml(
          component.blocklyXml || '',
          sceneNameToId,
          sceneIds,
        ),
      })),
      schemaVersion: 5,
    };
  },
  // v6: Migrate message fields from free-text names to stable message IDs.
  6: (project) => {
    const scenes = Array.isArray(project.scenes) ? project.scenes : [];
    const components = Array.isArray(project.components) ? project.components : [];
    const existingMessages = Array.isArray(project.messages) ? project.messages : [];

    const messages: MessageDefinition[] = [];
    const messageIdSet = new Set<string>();
    const messageNameToId = new Map<string, string>();

    for (const maybeMessage of existingMessages) {
      const name = normalizeMessageName(maybeMessage?.name);
      if (!name) continue;

      let id = readValidId(maybeMessage?.id) || crypto.randomUUID();
      while (messageIdSet.has(id)) {
        id = crypto.randomUUID();
      }

      messages.push({ id, name });
      messageIdSet.add(id);
      if (!messageNameToId.has(name)) {
        messageNameToId.set(name, id);
      }
    }

    const ensureMessageIdForName = (rawName: string): string => {
      const normalizedName = normalizeMessageName(rawName);
      if (!normalizedName) {
        return '';
      }
      const existingId = messageNameToId.get(normalizedName);
      if (existingId) {
        return existingId;
      }

      let id = crypto.randomUUID();
      while (messageIdSet.has(id)) {
        id = crypto.randomUUID();
      }

      messages.push({ id, name: normalizedName });
      messageIdSet.add(id);
      messageNameToId.set(normalizedName, id);
      return id;
    };

    return {
      ...project,
      scenes: scenes.map((scene) => ({
        ...scene,
        objects: (scene.objects || []).map((obj) => ({
          ...obj,
          blocklyXml: remapLegacyMessageRefsInBlocklyXml(
            obj.blocklyXml || '',
            messageIdSet,
            messageNameToId,
            ensureMessageIdForName,
          ),
        })),
      })),
      components: components.map((component) => ({
        ...component,
        blocklyXml: remapLegacyMessageRefsInBlocklyXml(
          component.blocklyXml || '',
          messageIdSet,
          messageNameToId,
          ensureMessageIdForName,
        ),
      })),
      messages,
      schemaVersion: 6,
    };
  },
  // v8: Add world boundary scene defaults.
  8: (project) => ({
    ...project,
    scenes: (project.scenes || []).map((scene) => ({
      ...scene,
      worldBoundary: scene.worldBoundary
        ? {
            enabled: !!scene.worldBoundary.enabled,
            points: Array.isArray(scene.worldBoundary.points)
              ? scene.worldBoundary.points
                  .filter(
                    (point): point is { x: number; y: number } =>
                      !!point && Number.isFinite(point.x) && Number.isFinite(point.y),
                  )
                  .map((point) => ({ x: point.x, y: point.y }))
              : [],
          }
        : {
            enabled: false,
            points: [],
          },
    })),
    schemaVersion: 8,
  }),
  // v9: Migrate legacy costume artwork to layered costume documents.
  9: (project) => ({
    ...normalizeCostumeDocumentsInProject(project),
    schemaVersion: 9,
  }),
  // v10: Add layered background editor documents alongside flattened runtime chunks.
  10: (project) => ({
    ...normalizeBackgroundDocumentsInProject(project),
    schemaVersion: 10,
  }),
};

function migrateProject(project: Project, fromVersion: number): Project {
  let currentProject = { ...project };

  for (let version = fromVersion + 1; version <= CURRENT_SCHEMA_VERSION; version++) {
    const migrateFn = migrations[version];
    if (migrateFn) {
      console.log(`Migrating project from schema v${version - 1} to v${version}`);
      currentProject = migrateFn(currentProject);
    }
  }

  return currentProject;
}

function getAssetArchiveExtension(mimeType: string): string {
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('jpeg')) return '.jpg';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('svg')) return '.svg';
  if (mimeType.includes('wav')) return '.wav';
  if (mimeType.includes('mpeg')) return '.mp3';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('webm')) return '.webm';
  return '';
}

function getAssetArchivePath(assetId: string, mimeType: string): string {
  const safeAssetId = assetId.replace(/[^a-z0-9:_-]/gi, '_').replace(/:/g, '_');
  return `assets/${safeAssetId}${getAssetArchiveExtension(mimeType)}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function exportProject(project: Project): Promise<Blob> {
  const record = await toProjectRecord(project, new Date(project.updatedAt));
  const projectData = JSON.parse(record.data) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  const assetRefs = collectPersistedAssetRefsFromProjectData(projectData);
  const archiveEntries: Record<string, Uint8Array> = {};
  const manifestAssets: ExportedProjectBundleManifest['assets'] = [];

  for (const assetRef of assetRefs) {
    const blob = await getManagedAssetBlob(assetRef.assetId);
    const metadata = await getManagedAssetMetadata(assetRef.assetId);
    if (!blob || !metadata) {
      throw new Error(`Missing export asset ${assetRef.assetId}`);
    }

    const path = getAssetArchivePath(assetRef.assetId, metadata.mimeType);
    archiveEntries[path] = new Uint8Array(await blob.arrayBuffer());
    manifestAssets.push({
      assetId: assetRef.assetId,
      kind: assetRef.kind,
      mimeType: metadata.mimeType,
      size: metadata.size,
      path,
    });
  }

  const manifest: ExportedProjectBundleManifest = {
    formatVersion: PROJECT_BUNDLE_FORMAT_VERSION,
    type: PROJECT_BUNDLE_TYPE,
    exportedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      data: projectData,
    },
    assets: manifestAssets,
  };

  archiveEntries[PROJECT_BUNDLE_MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 2));
  const zipBytes = zipSync(archiveEntries, { level: 6 });
  return new Blob([toArrayBuffer(zipBytes)], {
    type: 'application/zip',
  });
}

export async function downloadProject(project: Project): Promise<void> {
  const blob = await exportProject(project);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}.pochacoding.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ImportReferenceMaps {
  objectIds: Map<string, string>;
  variableIds: Map<string, string>;
  soundIds: Map<string, string>;
  messageIds: Map<string, string>;
  componentIds: Map<string, string>;
  sceneIds: Map<string, string>;
}

interface ImportReferenceFallbacks {
  objectNameToId?: Map<string, string>;
  variableNameToId?: Map<string, string>;
  soundNameToId?: Map<string, string>;
  messageNameToId?: Map<string, string>;
  sceneNameToId?: Map<string, string>;
}

function cloneProjectForImport(project: Project): Project {
  if (typeof structuredClone === 'function') {
    return structuredClone(project);
  }
  return JSON.parse(JSON.stringify(project)) as Project;
}

function readValidId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed ? trimmed : null;
}

function rememberIdMapping(map: Map<string, string>, previousId: unknown, nextId: string): void {
  const oldId = readValidId(previousId);
  if (oldId) {
    map.set(oldId, nextId);
  }
}

function createUniqueNameIdMap(entries: Array<{ name?: string; id?: string }>): Map<string, string> {
  const countsByName = new Map<string, number>();
  const idByName = new Map<string, string>();

  for (const entry of entries) {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const id = readValidId(entry.id);
    if (!name || !id) continue;
    countsByName.set(name, (countsByName.get(name) || 0) + 1);
    idByName.set(name, id);
  }

  const result = new Map<string, string>();
  for (const [name, count] of countsByName) {
    if (count === 1) {
      const id = idByName.get(name);
      if (id) {
        result.set(name, id);
      }
    }
  }
  return result;
}

function remapObjectReference(
  rawValue: string,
  maps: ImportReferenceMaps,
  objectNameToId?: Map<string, string>
): string {
  const value = rawValue.trim();
  if (!value || value === PICK_FROM_STAGE || VALID_OBJECT_SPECIAL_VALUES.has(value)) {
    return rawValue;
  }

  if (value.startsWith(COMPONENT_ANY_PREFIX)) {
    const componentId = value.slice(COMPONENT_ANY_PREFIX.length);
    const remappedComponentId = maps.componentIds.get(componentId);
    return remappedComponentId ? `${COMPONENT_ANY_PREFIX}${remappedComponentId}` : rawValue;
  }

  return maps.objectIds.get(value) || objectNameToId?.get(value) || rawValue;
}

function remapIdOrNameReference(
  rawValue: string,
  idMap: Map<string, string>,
  nameMap?: Map<string, string>
): string {
  const value = rawValue.trim();
  if (!value) return rawValue;
  return idMap.get(value) || nameMap?.get(value) || rawValue;
}

function remapTypeReference(rawValue: string, maps: ImportReferenceMaps): string {
  const value = rawValue.trim();
  if (!value) return rawValue;
  if (!value.startsWith('component:')) return rawValue;
  const componentId = value.slice('component:'.length);
  const remappedComponentId = maps.componentIds.get(componentId);
  return remappedComponentId ? `component:${remappedComponentId}` : rawValue;
}

function remapBlocklyXmlReferences(
  blocklyXml: string,
  maps: ImportReferenceMaps,
  fallbacks: ImportReferenceFallbacks = {}
): string {
  if (!blocklyXml.trim()) return blocklyXml;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return blocklyXml;
  }

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(blocklyXml, 'text/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      return blocklyXml;
    }

    let changed = false;
    const blocks = Array.from(xmlDoc.getElementsByTagName('block'));
    for (const block of blocks) {
      const blockType = block.getAttribute('type') || '';

      const updateField = (fieldName: string, mapper: (value: string) => string) => {
        const fields = Array.from(block.children).filter(
          (child): child is Element =>
            child.tagName.toLowerCase() === 'field' &&
            child.getAttribute('name') === fieldName
        );

        for (const field of fields) {
          const currentValue = field.textContent || '';
          const remappedValue = mapper(currentValue);
          if (remappedValue !== currentValue) {
            field.textContent = remappedValue;
            changed = true;
          }
        }
      };

      const objectFieldName = OBJECT_REFERENCE_BLOCKS[blockType];
      if (objectFieldName) {
        updateField(objectFieldName, (value) =>
          remapObjectReference(value, maps, fallbacks.objectNameToId)
        );
      }

      const variableFieldName = VARIABLE_REFERENCE_BLOCKS[blockType];
      if (variableFieldName) {
        updateField(variableFieldName, (value) =>
          remapIdOrNameReference(value, maps.variableIds, fallbacks.variableNameToId)
        );
      }

      const soundFieldName = SOUND_REFERENCE_BLOCKS[blockType];
      if (soundFieldName) {
        updateField(soundFieldName, (value) =>
          remapIdOrNameReference(value, maps.soundIds, fallbacks.soundNameToId)
        );
      }

      const messageFieldName = MESSAGE_REFERENCE_BLOCKS[blockType];
      if (messageFieldName) {
        updateField(messageFieldName, (value) =>
          remapIdOrNameReference(value, maps.messageIds, fallbacks.messageNameToId)
        );
      }

      const sceneFieldName = SCENE_REFERENCE_BLOCKS[blockType];
      if (sceneFieldName) {
        updateField(sceneFieldName, (value) =>
          remapIdOrNameReference(value, maps.sceneIds, fallbacks.sceneNameToId)
        );
      }

      const typeFieldName = TYPE_REFERENCE_BLOCKS[blockType];
      if (typeFieldName) {
        updateField(typeFieldName, (value) => remapTypeReference(value, maps));
      }
    }

    if (!changed || !xmlDoc.documentElement) {
      return blocklyXml;
    }

    return new XMLSerializer().serializeToString(xmlDoc.documentElement);
  } catch {
    return blocklyXml;
  }
}

export async function importProject(jsonString: string): Promise<Project> {
  const data = JSON.parse(jsonString);

  // Validate format - support both old and new file types
  const fileType = data.type as string;
  if (!SUPPORTED_FILE_TYPES.includes(fileType as (typeof SUPPORTED_FILE_TYPES)[number])) {
    throw new Error('Invalid file format: not a PochaCoding project');
  }

  if (!data.project) {
    throw new Error('Invalid file format: missing project data');
  }

  // Handle schema version (default to 1 for old files without schemaVersion)
  const schemaVersion = normalizeSchemaVersion(data.schemaVersion ?? data.version ?? 1);
  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This project file uses deprecated schema v${schemaVersion}. Only schema v${CURRENT_SCHEMA_VERSION} imports are supported.`,
    );
  }

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This project was created with a newer version of PochaCoding (schema v${schemaVersion}). ` +
        `Please update the app to open this file.`,
    );
  }

  let project = cloneProjectForImport(data.project as Project);

  // Ensure missing arrays do not break import of older files.
  project.scenes = Array.isArray(project.scenes) ? project.scenes : [];
  project.globalVariables = Array.isArray(project.globalVariables) ? project.globalVariables : [];
  project.components = Array.isArray(project.components) ? project.components : [];
  project.messages = Array.isArray(project.messages) ? project.messages : [];
  project = normalizeCostumeDocumentsInProject(project);
  project = normalizeBackgroundDocumentsInProject(project);

  // Generate new IDs to avoid collisions and keep imported data isolated.
  const objectIdMap = new Map<string, string>();
  const variableIdMap = new Map<string, string>();
  const soundIdMap = new Map<string, string>();
  const messageIdMap = new Map<string, string>();
  const componentIdMap = new Map<string, string>();
  const sceneIdMap = new Map<string, string>();

  for (const message of project.messages) {
    const newMessageId = crypto.randomUUID();
    rememberIdMapping(messageIdMap, message.id, newMessageId);
    message.id = newMessageId;
    const normalizedName = normalizeMessageName(message.name);
    message.name = normalizedName || 'message';
  }

  // Remap component IDs first so object.componentId references can be updated.
  for (const component of project.components) {
    const newComponentId = crypto.randomUUID();
    rememberIdMapping(componentIdMap, component.id, newComponentId);
    component.id = newComponentId;

    component.costumes = Array.isArray(component.costumes) ? component.costumes : [];
    component.sounds = Array.isArray(component.sounds) ? component.sounds : [];
    component.localVariables = Array.isArray(component.localVariables) ? component.localVariables : [];

    for (const costume of component.costumes) {
      costume.id = crypto.randomUUID();
      costume.document = cloneCostumeDocument(ensureCostumeDocument(costume));
    }

    for (const sound of component.sounds) {
      const newSoundId = crypto.randomUUID();
      rememberIdMapping(soundIdMap, sound.id, newSoundId);
      sound.id = newSoundId;
    }

    for (const variable of component.localVariables) {
      const existingVariableId = readValidId(variable.id);
      const remappedVariableId = existingVariableId ? variableIdMap.get(existingVariableId) : undefined;
      const newVariableId = remappedVariableId || crypto.randomUUID();
      if (!remappedVariableId) {
        rememberIdMapping(variableIdMap, variable.id, newVariableId);
      }
      const normalizedVariable = normalizeVariableDefinition(
        { ...variable, id: newVariableId },
        { scope: 'local' },
      );
      Object.assign(variable, normalizedVariable);
      delete variable.objectId;
    }
  }

  // Remap variable IDs (global + local) and wire local ownership.
  for (const variable of project.globalVariables) {
    const newVariableId = crypto.randomUUID();
    rememberIdMapping(variableIdMap, variable.id, newVariableId);
    const normalizedVariable = normalizeVariableDefinition(
      { ...variable, id: newVariableId },
      { scope: 'global' },
    );
    Object.assign(variable, normalizedVariable);
  }

  for (const scene of project.scenes) {
    const newSceneId = crypto.randomUUID();
    rememberIdMapping(sceneIdMap, scene.id, newSceneId);
    scene.id = newSceneId;
    scene.objects = Array.isArray(scene.objects) ? scene.objects : [];
    scene.objectFolders = Array.isArray(scene.objectFolders) ? scene.objectFolders : [];
    if (!scene.cameraConfig) {
      scene.cameraConfig = {
        followTarget: null,
        bounds: null,
        zoom: 1,
      };
    }

    for (const obj of scene.objects) {
      const newObjectId = crypto.randomUUID();
      rememberIdMapping(objectIdMap, obj.id, newObjectId);
      obj.id = newObjectId;

      if (obj.componentId) {
        obj.componentId = componentIdMap.get(obj.componentId) || obj.componentId;
      }

      obj.costumes = Array.isArray(obj.costumes) ? obj.costumes : [];
      obj.sounds = Array.isArray(obj.sounds) ? obj.sounds : [];
      obj.localVariables = Array.isArray(obj.localVariables) ? obj.localVariables : [];
      if (obj.componentId && obj.localVariables.length === 0) {
        const componentLocalVariables = project.components.find((component) => component.id === obj.componentId)?.localVariables || [];
        if (componentLocalVariables.length > 0) {
          obj.localVariables = componentLocalVariables.map((variable) => ({ ...variable }));
        }
      }

      for (const costume of obj.costumes) {
        costume.id = crypto.randomUUID();
        costume.document = cloneCostumeDocument(ensureCostumeDocument(costume));
      }

      for (const sound of obj.sounds) {
        const newSoundId = crypto.randomUUID();
        rememberIdMapping(soundIdMap, sound.id, newSoundId);
        sound.id = newSoundId;
      }

      for (const variable of obj.localVariables) {
        const existingVariableId = readValidId(variable.id);
        const remappedVariableId = existingVariableId ? variableIdMap.get(existingVariableId) : undefined;
        const newVariableId = remappedVariableId || crypto.randomUUID();
        if (!remappedVariableId) {
          rememberIdMapping(variableIdMap, variable.id, newVariableId);
        }
        const normalizedVariable = normalizeVariableDefinition(
          { ...variable, id: newVariableId },
          { scope: 'local', objectId: obj.id },
        );
        Object.assign(variable, normalizedVariable);
      }
    }
  }

  const referenceMaps: ImportReferenceMaps = {
    objectIds: objectIdMap,
    variableIds: variableIdMap,
    soundIds: soundIdMap,
    messageIds: messageIdMap,
    componentIds: componentIdMap,
    sceneIds: sceneIdMap,
  };

  const globalObjectNameToId = createUniqueNameIdMap(
    project.scenes.flatMap((scene) => scene.objects.map((obj) => ({ name: obj.name, id: obj.id })))
  );
  const globalSceneNameToId = createUniqueNameIdMap(
    project.scenes.map((scene) => ({ name: scene.name, id: scene.id }))
  );
  const globalVariableNameToId = createUniqueNameIdMap(
    project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id }))
  );
  const globalMessageNameToId = createUniqueNameIdMap(
    project.messages.map((message) => ({ name: message.name, id: message.id }))
  );

  for (const scene of project.scenes) {
    const sceneObjectNameToId = createUniqueNameIdMap(
      scene.objects.map((obj) => ({ name: obj.name, id: obj.id }))
    );

    scene.cameraConfig.followTarget = scene.cameraConfig.followTarget
      ? remapObjectReference(scene.cameraConfig.followTarget, referenceMaps, sceneObjectNameToId)
      : null;

    for (const obj of scene.objects) {
      const componentLocalVariables = obj.componentId
        ? project.components.find((component) => component.id === obj.componentId)?.localVariables || []
        : [];
      const effectiveLocalVariables = componentLocalVariables.length > 0
        ? componentLocalVariables
        : obj.localVariables;
      const localVariableNameToId = createUniqueNameIdMap(
        effectiveLocalVariables.map((variable) => ({ name: variable.name, id: variable.id }))
      );
      const combinedVariableNameToId = createUniqueNameIdMap([
        ...project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id })),
        ...effectiveLocalVariables.map((variable) => ({ name: variable.name, id: variable.id })),
      ]);

      const effectiveSounds = obj.componentId
        ? (project.components.find((component) => component.id === obj.componentId)?.sounds || [])
        : obj.sounds;
      const soundNameToId = createUniqueNameIdMap(
        effectiveSounds.map((sound) => ({ name: sound.name, id: sound.id }))
      );

      // Keep object code intact while reconnecting IDs for dropdown-backed fields.
      obj.blocklyXml = remapBlocklyXmlReferences(obj.blocklyXml || '', referenceMaps, {
        objectNameToId: sceneObjectNameToId,
        variableNameToId: combinedVariableNameToId.size > 0 ? combinedVariableNameToId : localVariableNameToId,
        soundNameToId,
        messageNameToId: globalMessageNameToId,
        sceneNameToId: globalSceneNameToId,
      });
    }
  }

  for (const component of project.components) {
    const componentVariableNameToId = createUniqueNameIdMap([
      ...project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id })),
      ...(component.localVariables || []).map((variable) => ({ name: variable.name, id: variable.id })),
    ]);
    const componentSoundNameToId = createUniqueNameIdMap(
      component.sounds.map((sound) => ({ name: sound.name, id: sound.id }))
    );

    component.blocklyXml = remapBlocklyXmlReferences(component.blocklyXml || '', referenceMaps, {
      objectNameToId: globalObjectNameToId,
      variableNameToId: componentVariableNameToId.size > 0 ? componentVariableNameToId : globalVariableNameToId,
      soundNameToId: componentSoundNameToId,
      messageNameToId: globalMessageNameToId,
      sceneNameToId: globalSceneNameToId,
    });
  }

  const newProjectId = crypto.randomUUID();

  const importedProject: Project = {
    ...normalizeProjectLayering(project),
    id: newProjectId,
    name: `${project.name} (imported)`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await saveProject(importedProject);
  await createRevision(importedProject, 'import');

  return importedProject;
}

async function importProjectBundle(file: File): Promise<Project> {
  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const archiveEntries = unzipSync(archiveBytes);
  const manifestEntry = archiveEntries[PROJECT_BUNDLE_MANIFEST_PATH];
  if (!manifestEntry) {
    throw new Error('Invalid project bundle: missing manifest');
  }

  const manifest = JSON.parse(strFromU8(manifestEntry)) as ExportedProjectBundleManifest;
  if (manifest.type !== PROJECT_BUNDLE_TYPE) {
    throw new Error('Invalid project bundle type');
  }
  if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This project bundle was created with a newer version of PochaCoding (schema v${manifest.schemaVersion}). ` +
        `Please update the app to open this file.`,
    );
  }

  for (const asset of manifest.assets) {
    const assetEntry = archiveEntries[asset.path];
    if (!assetEntry) {
      throw new Error(`Invalid project bundle: missing asset ${asset.assetId}`);
    }
    const blob = new Blob([toArrayBuffer(assetEntry)], { type: asset.mimeType });
    await storeManagedAsset(asset.assetId, blob, asset.kind);
  }

  const hydratedProjectData = await hydrateProjectAssetsFromStorage(manifest.project.data);
  const runtimeProject: Project = {
    ...hydratedProjectData,
    id: manifest.project.id,
    name: manifest.project.name,
    createdAt: new Date(manifest.project.createdAt),
    updatedAt: new Date(manifest.project.updatedAt),
  };

  return await importProject(JSON.stringify({
    type: 'pochacoding-project',
    exportedAt: new Date().toISOString(),
    schemaVersion: manifest.schemaVersion,
    appVersion: manifest.appVersion,
    project: runtimeProject,
  } satisfies ExportedProject));
}

export async function importProjectFromFile(file: File): Promise<Project> {
  const isBundle = file.name.toLowerCase().endsWith('.zip');
  if (isBundle) {
    return await importProjectBundle(file);
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const jsonString = e.target?.result as string;
        const project = await importProject(jsonString);
        resolve(project);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
