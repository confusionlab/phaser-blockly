import { useCallback, useEffect, useRef } from 'react';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { Id } from '@convex-generated/dataModel';
import { api } from '@convex-generated/api';
import {
  collectPersistedAssetRefsFromSerializedProjectData,
  createProjectSyncPayload,
  getProjectExplorerSyncPayload,
  getAllProjectsForSync,
  getManagedAssetBlob,
  getManagedAssetMetadata,
  getProjectForSync,
  getProjectRevisionSyncMetadata,
  getProjectRevisionSyncState,
  getProjectRevisionsForSync,
  getProjectSyncMetadata,
  hasManagedAsset,
  pruneLocalProjectsNotInCloud,
  storeManagedAsset,
  syncProjectExplorerStateFromCloud,
  syncProjectFromCloud,
  syncProjectRevisionsFromCloud,
  type ManagedAssetKind,
  type ProjectExplorerSyncPayload,
  type ProjectRevisionSyncMetadata,
  type ProjectRevisionSyncPayload,
  type ProjectRevisionSyncState,
  type ProjectSyncMetadata,
  type ProjectSyncPayload,
} from '@/db/database';
import type { Project } from '@/types';

interface CloudSyncOptions {
  // Whether cloud writes are allowed from this editor.
  enabled?: boolean;
  // Sync cloud data down when mounted
  syncOnMount?: boolean;
  // Current project id fallback (used when full project object is unavailable)
  currentProjectId?: string | null;
  // Current in-memory project for reliable unload beacon payload
  currentProject?: Project | null;
  // Whether current project has unsaved/dirty local state.
  isDirty?: boolean;
  // Sync current project on hook unmount (navigation)
  syncOnUnmount?: boolean;
  // Periodic checkpoint interval while dirty.
  checkpointIntervalMs?: number;
  // Whether to keep a reactive full cloud project list in memory.
  enableCloudProjectListQuery?: boolean;
  // Debounce background sync after the latest project edit timestamp changes.
  backgroundSyncDebounceMs?: number;
  // Whether the hook should automatically sync the current project on debounce/lifecycle events.
  autoSyncCurrentProject?: boolean;
  // Optional upload telemetry hook for caller-side save metrics.
  onProjectPayloadUploaded?: (event: CloudProjectUploadEvent) => void;
  // Optional phase timing hook for caller-side save diagnostics.
  onProjectSyncMeasured?: (event: CloudProjectSyncTimingEvent) => void;
}

interface CloudProjectRecord {
  localId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
  contentHash?: string;
  storageId?: Id<'_storage'>;
  dataSizeBytes?: number;
  assetIds?: string[];
  revisionCount?: number;
  latestRevisionId?: string | null;
  latestRevisionCreatedAt?: number | null;
  latestRevisionContentHash?: string | null;
  revisionsUpdatedAt?: number | null;
  data?: string;
  dataUrl: string | null;
}

interface CloudProjectExplorerRecord {
  stateJson: string;
  updatedAt: number;
  contentHash: string;
  assetIds?: string[];
}

interface CloudRevisionRecord {
  projectLocalId: string;
  revisionId: string;
  parentRevisionId?: string;
  kind: 'snapshot' | 'delta';
  baseRevisionId: string;
  storageId?: Id<'_storage'>;
  dataSizeBytes?: number;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
  reason: 'manual_checkpoint' | 'auto_checkpoint' | 'import' | 'restore' | 'edit_revision';
  checkpointName?: string;
  isCheckpoint: boolean;
  restoredFromRevisionId?: string;
  assetIds?: string[];
  data?: string;
  dataUrl: string | null;
}

type StorageSyncPayload = Omit<ProjectSyncPayload, 'data'> & {
  storageId: Id<'_storage'>;
  dataSizeBytes: number;
};

type StorageRevisionSyncPayload = Omit<ProjectRevisionSyncPayload, 'data'> & {
  storageId: Id<'_storage'>;
  dataSizeBytes: number;
};

type PersistedAssetRef = {
  assetId: string;
  kind: ManagedAssetKind;
};

interface CloudManagedAssetRecord {
  assetId: string;
  kind: ManagedAssetKind;
  mimeType: string;
  size: number;
  storageId: Id<'_storage'>;
  url: string | null;
}

interface CloudRevisionSyncState {
  revisionCount: number;
  latestRevisionId: string | null;
  latestRevisionCreatedAt: number | null;
  latestRevisionContentHash: string | null;
  revisionsUpdatedAt: number | null;
}

interface CloudProjectSyncPlan {
  project: {
    action: 'upload' | 'skip' | 'pull';
    reason: string;
    missingAssetIds?: string[];
  };
  revisions: Array<{
    revisionId: string;
    action: 'upload' | 'skip';
    reason: string;
    missingAssetIds?: string[];
  }>;
  cloudRevisionState: CloudRevisionSyncState;
}

interface CloudProjectSyncMutationResult {
  action: 'created' | 'updated' | 'skipped';
  id: Id<'projects'>;
  reason?: string;
  cloudRevisionState: CloudRevisionSyncState;
}

interface CloudProjectSyncBatchMutationResult {
  localId: string;
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
  cloudRevisionState: CloudRevisionSyncState;
}

export type CloudProjectSyncStatus = 'saved' | 'pulled' | 'skipped' | 'error';
export type CloudProjectUploadEvent = {
  projectId: string;
  updatedAt: number;
  sizeBytes: number;
};
export type CloudProjectSyncTimingPhase =
  | 'preparePayload'
  | 'loadLocalRevisionState'
  | 'planProject'
  | 'ensureProjectAssets'
  | 'uploadProjectPayload'
  | 'commitProjectMetadata'
  | 'planRevisions'
  | 'uploadRevisions'
  | 'pullRevisions'
  | 'refreshLocalCache';
export type CloudProjectSyncPhaseDurations = Partial<Record<CloudProjectSyncTimingPhase, number>>;
export type CloudProjectSyncTimingEvent = {
  projectId: string;
  updatedAt: number;
  status: CloudProjectSyncStatus;
  phaseDurationsMs: CloudProjectSyncPhaseDurations;
};

function formatUploadSizeMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(3)} MB`;
}

async function measureCloudSyncPhase<T>(
  phaseDurationsMs: CloudProjectSyncPhaseDurations | undefined,
  phase: CloudProjectSyncTimingPhase,
  task: () => Promise<T>,
): Promise<T> {
  if (!phaseDurationsMs) {
    return await task();
  }

  const startedAtMs = performance.now();
  try {
    return await task();
  } finally {
    phaseDurationsMs[phase] = (phaseDurationsMs[phase] ?? 0) + (performance.now() - startedAtMs);
  }
}

async function loadProjectDataFromCloud(cloudProject: CloudProjectRecord): Promise<string> {
  if (typeof cloudProject.data === 'string') {
    return cloudProject.data;
  }

  if (cloudProject.dataUrl) {
    const response = await fetch(cloudProject.dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch project data (${response.status})`);
    }
    return await response.text();
  }

  throw new Error(`Cloud project "${cloudProject.localId}" has no sync data`);
}

async function loadRevisionDataFromCloud(cloudRevision: CloudRevisionRecord): Promise<string> {
  if (typeof cloudRevision.data === 'string') {
    return cloudRevision.data;
  }

  if (cloudRevision.dataUrl) {
    const response = await fetch(cloudRevision.dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch revision data (${response.status})`);
    }
    return await response.text();
  }

  throw new Error(`Cloud revision "${cloudRevision.revisionId}" has no sync data`);
}

function normalizeSchemaVersion(version: number | string): number {
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

function normalizeContentHash(hash: string | undefined): string {
  return typeof hash === 'string' ? hash.trim().toLowerCase() : '';
}

const ASSET_UPLOAD_CONCURRENCY = 4;

async function runWithConcurrencyLimit<TItem>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const laneCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: laneCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex]);
      }
    }),
  );
}

function collectPlannedMissingAssetIds(
  plan: CloudProjectSyncPlan,
  options: {
    revisionIds?: readonly string[];
    includeProject?: boolean;
  } = {},
): string[] | undefined {
  const revisionIdSet = options.revisionIds ? new Set(options.revisionIds) : null;
  const assetIds = new Set<string>(options.includeProject === false ? [] : (plan.project.missingAssetIds ?? []));
  let hasPlannedAssetIds = options.includeProject !== false && plan.project.missingAssetIds !== undefined;

  for (const revision of plan.revisions) {
    if (revisionIdSet && !revisionIdSet.has(revision.revisionId)) {
      continue;
    }
    if (revision.missingAssetIds !== undefined) {
      hasPlannedAssetIds = true;
    }
    for (const assetId of revision.missingAssetIds ?? []) {
      assetIds.add(assetId);
    }
  }

  return hasPlannedAssetIds ? Array.from(assetIds) : undefined;
}

function buildProjectSyncSignature(project: Pick<ProjectSyncMetadata, 'updatedAt' | 'schemaVersion' | 'contentHash'>): string {
  return `${project.updatedAt}:${project.schemaVersion}:${normalizeContentHash(project.contentHash)}`;
}

function buildProjectExplorerSyncSignature(explorer: {
  updatedAt: number;
  contentHash: string;
  assetIds: readonly string[];
}): string {
  return [
    explorer.updatedAt,
    normalizeContentHash(explorer.contentHash),
    Array.from(new Set(explorer.assetIds)).sort().join(','),
  ].join(':');
}

function toCloudProjectExplorerPayload(payload: ProjectExplorerSyncPayload): CloudProjectExplorerRecord {
  return {
    stateJson: payload.data,
    updatedAt: payload.updatedAt,
    contentHash: payload.contentHash,
    assetIds: payload.assetIds,
  };
}

function toLocalProjectExplorerSyncPayload(cloudRecord: CloudProjectExplorerRecord): {
  data: string;
  updatedAt: number;
} {
  return {
    data: cloudRecord.stateJson,
    updatedAt: cloudRecord.updatedAt,
  };
}

function buildRevisionSyncSignature(revisionState: Pick<
  ProjectRevisionSyncState | CloudRevisionSyncState,
  'revisionCount' | 'latestRevisionId' | 'latestRevisionCreatedAt' | 'latestRevisionContentHash' | 'revisionsUpdatedAt'
>): string {
  return [
    revisionState.revisionCount,
    revisionState.latestRevisionId ?? '',
    revisionState.latestRevisionCreatedAt ?? '',
    normalizeContentHash(revisionState.latestRevisionContentHash ?? undefined),
    revisionState.revisionsUpdatedAt ?? '',
  ].join(':');
}

function revisionSyncStatesMatch(
  localState: ProjectRevisionSyncState,
  cloudState: CloudRevisionSyncState,
): boolean {
  return buildRevisionSyncSignature(localState) === buildRevisionSyncSignature(cloudState);
}

function isCloudRevisionStateLikelyAhead(
  localState: ProjectRevisionSyncState,
  cloudState: CloudRevisionSyncState,
): boolean {
  const localUpdatedAt = localState.revisionsUpdatedAt ?? Number.NEGATIVE_INFINITY;
  const cloudUpdatedAt = cloudState.revisionsUpdatedAt ?? Number.NEGATIVE_INFINITY;
  if (cloudUpdatedAt > localUpdatedAt) {
    return true;
  }
  if (cloudUpdatedAt < localUpdatedAt) {
    return false;
  }

  return cloudState.revisionCount > localState.revisionCount;
}

function toProjectSyncMetadata(payload: Pick<ProjectSyncPayload, 'localId' | 'updatedAt' | 'schemaVersion' | 'contentHash' | 'assetIds'>): ProjectSyncMetadata {
  return {
    localId: payload.localId,
    updatedAt: payload.updatedAt,
    schemaVersion: payload.schemaVersion,
    contentHash: payload.contentHash,
    assetIds: payload.assetIds,
  };
}

function dedupeCloudProjectsByLocalId(projects: CloudProjectRecord[]): CloudProjectRecord[] {
  const byLocalId = new Map<string, CloudProjectRecord>();

  for (const project of projects) {
    const existing = byLocalId.get(project.localId);
    if (!existing) {
      byLocalId.set(project.localId, project);
      continue;
    }

    const existingSchema = normalizeSchemaVersion(existing.schemaVersion);
    const incomingSchema = normalizeSchemaVersion(project.schemaVersion);
    const existingHash = normalizeContentHash(existing.contentHash);
    const incomingHash = normalizeContentHash(project.contentHash);

    const incomingWins =
      project.updatedAt > existing.updatedAt ||
      (project.updatedAt === existing.updatedAt &&
        (incomingSchema > existingSchema ||
          (incomingSchema === existingSchema && incomingHash > existingHash)));

    if (incomingWins) {
      byLocalId.set(project.localId, project);
    }
  }

  return Array.from(byLocalId.values());
}

export function useCloudSync(options: CloudSyncOptions = {}) {
  const {
    enabled = true,
    syncOnMount = false,
    currentProjectId = null,
    currentProject = null,
    isDirty = false,
    syncOnUnmount = true,
    checkpointIntervalMs = 45_000,
    enableCloudProjectListQuery = false,
    backgroundSyncDebounceMs = 15_000,
    autoSyncCurrentProject = true,
    onProjectPayloadUploaded,
    onProjectSyncMeasured,
  } = options;

  const convex = useConvex();
  const generateUploadUrlMutation = useMutation(api.projects.generateUploadUrl);
  const generateAssetUploadUrlMutation = useMutation(api.projectAssets.generateUploadUrl);
  const syncProjectExplorerMutation = useMutation(api.projectExplorer.sync);
  const syncMutation = useMutation(api.projects.syncBatch);
  const syncSingleMutation = useMutation(api.projects.sync);
  const syncRevisionsMutation = useMutation(api.projects.syncRevisions);
  const upsertProjectAssetMutation = useMutation(api.projectAssets.upsert);
  const removeProjectMutation = useMutation(api.projects.remove);
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const cloudProjects = useQuery(
    api.projects.listFull,
    isConvexAuthenticated && enableCloudProjectListQuery ? {} : 'skip',
  );

  const isSyncingRef = useRef(false);
  const currentProjectIdRef = useRef(currentProjectId);
  const currentProjectRef = useRef<Project | null>(currentProject);
  const inFlightProjectSyncRef = useRef(new Map<string, { signature: string; promise: Promise<CloudProjectSyncStatus> }>());
  const payloadCacheRef = useRef(new Map<string, { updatedAt: number; payload: ProjectSyncPayload }>());

  currentProjectIdRef.current = currentProjectId;
  currentProjectRef.current = currentProject;

  const getCachedProjectSyncPayload = useCallback(async (project: Project): Promise<ProjectSyncPayload> => {
    const cached = payloadCacheRef.current.get(project.id);
    const updatedAt = project.updatedAt.getTime();
    if (cached && cached.updatedAt === updatedAt) {
      return cached.payload;
    }

    const payload = await createProjectSyncPayload(project);
    payloadCacheRef.current.set(project.id, {
      updatedAt,
      payload,
    });
    return payload;
  }, []);

  const getCloudRevisionSyncState = useCallback(async (projectId: string): Promise<CloudRevisionSyncState> => {
    return (await convex.query(api.projects.getRevisionSyncState, {
      localId: projectId,
    })) as CloudRevisionSyncState;
  }, [convex]);

  const runProjectSyncSerially = useCallback(
    async (
      projectId: string,
      signature: string,
      executor: () => Promise<CloudProjectSyncStatus>,
    ): Promise<CloudProjectSyncStatus> => {
      const existing = inFlightProjectSyncRef.current.get(projectId);
      if (existing) {
        if (existing.signature === signature) {
          return await existing.promise;
        }
        try {
          await existing.promise;
        } catch {
          // Let the newer sync attempt continue after the previous one settles.
        }
      }

      const promise = executor().finally(() => {
        const current = inFlightProjectSyncRef.current.get(projectId);
        if (current?.promise === promise) {
          inFlightProjectSyncRef.current.delete(projectId);
        }
      });
      inFlightProjectSyncRef.current.set(projectId, { signature, promise });
      return await promise;
    },
    [],
  );

  const getCloudProjectsFull = useCallback(async (): Promise<CloudProjectRecord[]> => {
    if (cloudProjects) {
      return dedupeCloudProjectsByLocalId(cloudProjects as CloudProjectRecord[]);
    }

    const fetchedProjects = await convex.query(api.projects.listFull, {});
    return dedupeCloudProjectsByLocalId(fetchedProjects as CloudProjectRecord[]);
  }, [cloudProjects, convex]);

  const getCloudRevisions = useCallback(async (localId: string): Promise<CloudRevisionRecord[]> => {
    return (await convex.query(api.projects.listRevisions, {
      localId,
    })) as CloudRevisionRecord[];
  }, [convex]);

  const toStorageSyncPayload = useCallback(
    async (payload: ProjectSyncPayload): Promise<StorageSyncPayload> => {
      const { data, ...metadata } = payload;
      const uploadUrl = await generateUploadUrlMutation();
      const blob = new Blob([data], { type: 'application/json' });

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Project upload failed (${uploadResponse.status})`);
      }

      const uploadResult = (await uploadResponse.json()) as { storageId: string };
      console.log(
        `[CloudSync] Uploaded project "${metadata.localId}" payload (${formatUploadSizeMb(blob.size)}).`,
      );
      onProjectPayloadUploaded?.({
        projectId: metadata.localId,
        updatedAt: metadata.updatedAt,
        sizeBytes: blob.size,
      });
      return {
        ...metadata,
        storageId: uploadResult.storageId as Id<'_storage'>,
        dataSizeBytes: blob.size,
      };
    },
    [generateUploadUrlMutation, onProjectPayloadUploaded],
  );

  const toStorageRevisionPayload = useCallback(
    async (payload: ProjectRevisionSyncPayload): Promise<StorageRevisionSyncPayload> => {
      const { data, ...metadata } = payload;
      const uploadUrl = await generateUploadUrlMutation();
      const blob = new Blob([data], { type: 'application/json' });

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Revision upload failed (${uploadResponse.status})`);
      }

      const uploadResult = (await uploadResponse.json()) as { storageId: string };
      console.log(
        `[CloudSync] Uploaded revision "${metadata.revisionId}" for project "${metadata.localProjectId}" (${formatUploadSizeMb(blob.size)}).`,
      );
      return {
        ...metadata,
        storageId: uploadResult.storageId as Id<'_storage'>,
        dataSizeBytes: blob.size,
      };
    },
    [generateUploadUrlMutation],
  );

  const planSync = useCallback(
    async (
      project: ProjectSyncMetadata,
      revisions: ProjectRevisionSyncMetadata[] = [],
    ): Promise<CloudProjectSyncPlan> => {
      return (await convex.query(api.projects.planSync, {
        project,
        revisions,
      })) as CloudProjectSyncPlan;
    },
    [convex],
  );

  const prepareRevisionSyncPlan = useCallback(
    async (
      projectMetadata: ProjectSyncMetadata,
      localRevisionState: ProjectRevisionSyncState,
      options: {
        cloudRevisionState?: CloudRevisionSyncState;
      } = {},
    ): Promise<{
      revisionIdsToUpload: string[];
      plannedMissingAssetIds?: string[];
      shouldPullFromCloud: boolean;
    }> => {
      const cloudRevisionState = options.cloudRevisionState
        ?? await getCloudRevisionSyncState(projectMetadata.localId);
      if (revisionSyncStatesMatch(localRevisionState, cloudRevisionState)) {
        return { revisionIdsToUpload: [], shouldPullFromCloud: false };
      }

      if (localRevisionState.revisionCount === 0) {
        return {
          revisionIdsToUpload: [],
          shouldPullFromCloud: cloudRevisionState.revisionCount > 0,
        };
      }

      const revisionMetadata = await getProjectRevisionSyncMetadata(projectMetadata.localId);
      if (revisionMetadata.length === 0) {
        return {
          revisionIdsToUpload: [],
          shouldPullFromCloud: cloudRevisionState.revisionCount > 0,
        };
      }

      const fullPlan = await planSync(projectMetadata, revisionMetadata);
      const revisionIdsToUpload = fullPlan.revisions
        .filter((revision) => revision.action === 'upload')
        .map((revision) => revision.revisionId);
      const shouldPullFromCloud =
        isCloudRevisionStateLikelyAhead(localRevisionState, cloudRevisionState)
        || revisionIdsToUpload.length === 0;

      return {
        revisionIdsToUpload,
        plannedMissingAssetIds: collectPlannedMissingAssetIds(fullPlan, {
          revisionIds: revisionIdsToUpload,
          includeProject: false,
        }),
        shouldPullFromCloud,
      };
    },
    [getCloudRevisionSyncState, planSync],
  );

  const ensureAssetRefsInCloud = useCallback(
    async (assetRefs: PersistedAssetRef[], options: { skipRemoteCheck?: boolean } = {}) => {
      const uniqueRefs = Array.from(
        assetRefs.reduce((map, assetRef) => {
          if (!assetRef.assetId) return map;
          map.set(assetRef.assetId, assetRef);
          return map;
        }, new Map<string, PersistedAssetRef>()).values(),
      );

      if (uniqueRefs.length === 0) {
        return;
      }

      const refsById = new Map(uniqueRefs.map((assetRef) => [assetRef.assetId, assetRef]));
      const assetIdsToUpload = options.skipRemoteCheck
        ? uniqueRefs.map((assetRef) => assetRef.assetId)
        : await convex.query(api.projectAssets.listMissing, {
            assetIds: uniqueRefs.map((assetRef) => assetRef.assetId),
          });

      await runWithConcurrencyLimit(assetIdsToUpload as string[], ASSET_UPLOAD_CONCURRENCY, async (assetId) => {
        const assetRef = refsById.get(assetId);
        if (!assetRef) {
          return;
        }

        const blob = await getManagedAssetBlob(assetId);
        const metadata = await getManagedAssetMetadata(assetId);
        if (!blob || !metadata) {
          throw new Error(`Missing local blob for asset ${assetId}`);
        }

        const uploadUrl = await generateAssetUploadUrlMutation();
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': metadata.mimeType },
          body: blob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Asset upload failed (${uploadResponse.status})`);
        }

        const uploadResult = (await uploadResponse.json()) as { storageId: string };
        console.log(
          `[CloudSync] Uploaded asset "${assetId}" (${formatUploadSizeMb(blob.size)}).`,
        );
        await upsertProjectAssetMutation({
          assetId,
          kind: assetRef.kind,
          mimeType: metadata.mimeType,
          size: metadata.size,
          storageId: uploadResult.storageId as Id<'_storage'>,
        });
      });
    },
    [convex, generateAssetUploadUrlMutation, upsertProjectAssetMutation],
  );

  const ensureAssetIdsInCloud = useCallback(
    async (assetIds: readonly string[], options: { skipRemoteCheck?: boolean } = {}) => {
      const refsById = new Map<string, PersistedAssetRef>();
      for (const assetId of assetIds) {
        if (!assetId) continue;
        const metadata = await getManagedAssetMetadata(assetId);
        if (!metadata) {
          throw new Error(`Missing local metadata for asset ${assetId}`);
        }
        refsById.set(assetId, {
          assetId,
          kind: metadata.kind,
        });
      }
      await ensureAssetRefsInCloud(Array.from(refsById.values()), options);
    },
    [ensureAssetRefsInCloud],
  );

  const ensureRevisionAssetsInCloud = useCallback(
    async (assetIds: readonly string[], options: { skipRemoteCheck?: boolean } = {}) => {
      await ensureAssetIdsInCloud(Array.from(new Set(assetIds)), options);
    },
    [ensureAssetIdsInCloud],
  );

  const ensureAssetRefsAvailableLocally = useCallback(
    async (assetRefs: PersistedAssetRef[]) => {
      const missingRefs: PersistedAssetRef[] = [];
      for (const assetRef of assetRefs) {
        if (!(await hasManagedAsset(assetRef.assetId))) {
          missingRefs.push(assetRef);
        }
      }

      if (missingRefs.length === 0) {
        return;
      }

      const cloudAssets = await convex.query(api.projectAssets.getMany, {
        assetIds: missingRefs.map((assetRef) => assetRef.assetId),
      });

      const assetsById = new Map(
        (cloudAssets as CloudManagedAssetRecord[]).map((asset) => [asset.assetId, asset]),
      );

      for (const assetRef of missingRefs) {
        const cloudAsset = assetsById.get(assetRef.assetId);
        if (!cloudAsset?.url) {
          throw new Error(`Cloud asset ${assetRef.assetId} is unavailable`);
        }

        const response = await fetch(cloudAsset.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch cloud asset ${assetRef.assetId} (${response.status})`);
        }

        const blob = await response.blob();
        await storeManagedAsset(assetRef.assetId, blob, assetRef.kind);
      }
    },
    [convex],
  );

  const ensureSerializedAssetsAvailableLocally = useCallback(
    async (serializedProjectPayloads: string[]) => {
      const refsById = new Map<string, PersistedAssetRef>();
      for (const serializedData of serializedProjectPayloads) {
        for (const assetRef of collectPersistedAssetRefsFromSerializedProjectData(serializedData)) {
          refsById.set(assetRef.assetId, assetRef);
        }
      }
      await ensureAssetRefsAvailableLocally(Array.from(refsById.values()));
    },
    [ensureAssetRefsAvailableLocally],
  );

  const ensureAssetIdsAvailableLocally = useCallback(
    async (assetIds: readonly string[]) => {
      const missingIds: string[] = [];
      for (const assetId of assetIds) {
        if (!(await hasManagedAsset(assetId))) {
          missingIds.push(assetId);
        }
      }

      if (missingIds.length === 0) {
        return;
      }

      const cloudAssets = await convex.query(api.projectAssets.getMany, {
        assetIds: missingIds,
      });

      const assetsById = new Map(
        (cloudAssets as CloudManagedAssetRecord[]).map((asset) => [asset.assetId, asset]),
      );

      for (const assetId of missingIds) {
        const cloudAsset = assetsById.get(assetId);
        if (!cloudAsset?.url) {
          throw new Error(`Cloud asset ${assetId} is unavailable`);
        }

        const response = await fetch(cloudAsset.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch cloud asset ${assetId} (${response.status})`);
        }

        const blob = await response.blob();
        await storeManagedAsset(assetId, blob, cloudAsset.kind);
      }
    },
    [convex],
  );

  const getCloudProjectExplorer = useCallback(async (): Promise<CloudProjectExplorerRecord | null> => {
    return (await convex.query(api.projectExplorer.get, {})) as CloudProjectExplorerRecord | null;
  }, [convex]);

  const reconcileProjectExplorerFromCloud = useCallback(async (): Promise<boolean> => {
    const cloudExplorer = await getCloudProjectExplorer();
    if (!cloudExplorer) {
      return false;
    }

    if ((cloudExplorer.assetIds?.length ?? 0) > 0) {
      await ensureAssetIdsAvailableLocally(cloudExplorer.assetIds ?? []);
    }

    const result = await syncProjectExplorerStateFromCloud(toLocalProjectExplorerSyncPayload(cloudExplorer));
    return result.merged;
  }, [ensureAssetIdsAvailableLocally, getCloudProjectExplorer]);

  const syncProjectExplorerToCloud = useCallback(async (): Promise<CloudProjectSyncStatus> => {
    if (!enabled) {
      return 'skipped';
    }

    try {
      const remoteExplorer = await getCloudProjectExplorer();
      if (remoteExplorer) {
        if ((remoteExplorer.assetIds?.length ?? 0) > 0) {
          await ensureAssetIdsAvailableLocally(remoteExplorer.assetIds ?? []);
        }
        await syncProjectExplorerStateFromCloud(toLocalProjectExplorerSyncPayload(remoteExplorer));
      }

      const payload = await getProjectExplorerSyncPayload();
      if (
        remoteExplorer &&
        buildProjectExplorerSyncSignature({
          updatedAt: remoteExplorer.updatedAt,
          contentHash: remoteExplorer.contentHash,
          assetIds: remoteExplorer.assetIds ?? [],
        }) === buildProjectExplorerSyncSignature(payload)
      ) {
        return 'skipped';
      }

      await ensureAssetIdsInCloud(payload.assetIds);
      const result = await syncProjectExplorerMutation(toCloudProjectExplorerPayload(payload));
      if (result.action === 'skipped' && result.reason !== 'already in sync') {
        const nextRemoteExplorer = await getCloudProjectExplorer();
        if (nextRemoteExplorer) {
          if ((nextRemoteExplorer.assetIds?.length ?? 0) > 0) {
            await ensureAssetIdsAvailableLocally(nextRemoteExplorer.assetIds ?? []);
          }
          await syncProjectExplorerStateFromCloud(toLocalProjectExplorerSyncPayload(nextRemoteExplorer));
          return 'pulled';
        }
      }

      return result.action === 'skipped' ? 'skipped' : 'saved';
    } catch (error) {
      console.error('[CloudSync] Failed to sync project explorer:', error);
      return 'error';
    }
  }, [
    enabled,
    ensureAssetIdsAvailableLocally,
    ensureAssetIdsInCloud,
    getCloudProjectExplorer,
    syncProjectExplorerMutation,
  ]);

  const syncPayloadToCloud = useCallback(
    async (
      payload: ProjectSyncPayload,
      phaseDurationsMs?: CloudProjectSyncPhaseDurations,
    ): Promise<{
      outcome: 'uploaded' | 'pull' | 'skipped' | 'error';
      cloudRevisionState?: CloudRevisionSyncState;
    }> => {
      if (!enabled) {
        return {
          outcome: 'skipped',
        };
      }
      try {
        const plan = await measureCloudSyncPhase(phaseDurationsMs, 'planProject', async () => {
          return await planSync(toProjectSyncMetadata(payload));
        });
        if (plan.project.action !== 'upload') {
          return {
            outcome: plan.project.action === 'pull' ? 'pull' : 'skipped',
          };
        }

        await measureCloudSyncPhase(phaseDurationsMs, 'ensureProjectAssets', async () => {
          await ensureAssetIdsInCloud(
            plan.project.missingAssetIds ?? payload.assetIds,
            { skipRemoteCheck: plan.project.missingAssetIds !== undefined },
          );
        });
        const storagePayload = await measureCloudSyncPhase(phaseDurationsMs, 'uploadProjectPayload', async () => {
          return await toStorageSyncPayload(payload);
        });
        const result = await measureCloudSyncPhase(phaseDurationsMs, 'commitProjectMetadata', async () => {
          return await syncSingleMutation(storagePayload) as CloudProjectSyncMutationResult;
        });
        if (result.action === 'skipped' && result.reason !== 'already in sync') {
          return {
            outcome: 'pull',
            cloudRevisionState: result.cloudRevisionState,
          };
        }
        return {
          outcome: 'uploaded',
          cloudRevisionState: result.cloudRevisionState,
        };
      } catch (error) {
        console.error('[CloudSync] Failed to sync payload:', error);
        return {
          outcome: 'error',
        };
      }
    },
    [enabled, ensureAssetIdsInCloud, planSync, syncSingleMutation, toStorageSyncPayload],
  );

  const syncProjectRevisionsToCloud = useCallback(
    async (projectId: string, revisionIds?: readonly string[], plannedMissingAssetIds?: readonly string[]) => {
      if (!enabled) {
        return { created: 0, updated: 0, skipped: 0 };
      }
      if (revisionIds && revisionIds.length === 0) {
        return { created: 0, updated: 0, skipped: 0 };
      }

      const revisions = await getProjectRevisionsForSync(projectId, revisionIds);
      if (revisions.length === 0) {
        return { created: 0, updated: 0, skipped: 0 };
      }

      if (plannedMissingAssetIds !== undefined) {
        await ensureRevisionAssetsInCloud(plannedMissingAssetIds, { skipRemoteCheck: true });
      } else {
        const revisionAssetIds = Array.from(new Set(revisions.flatMap((revision) => revision.assetIds)));
        await ensureRevisionAssetsInCloud(revisionAssetIds);
      }

      const storageRevisions: StorageRevisionSyncPayload[] = [];
      for (const revision of revisions) {
        try {
          const storageRevision = await toStorageRevisionPayload(revision);
          storageRevisions.push(storageRevision);
        } catch (error) {
          console.error(`[CloudSync] Failed to prepare revision "${revision.revisionId}" for upload:`, error);
        }
      }

      if (storageRevisions.length === 0) {
        return { created: 0, updated: 0, skipped: revisions.length };
      }

      return await syncRevisionsMutation({ revisions: storageRevisions });
    },
    [enabled, ensureRevisionAssetsInCloud, syncRevisionsMutation, toStorageRevisionPayload],
  );

  const hydrateCloudRevisions = useCallback(
    async (revisionRecords: CloudRevisionRecord[]): Promise<ProjectRevisionSyncPayload[]> => {
      return await Promise.all(
        revisionRecords.map(async (revision) => {
          const revisionData = await loadRevisionDataFromCloud(revision);
          const assetIds = revision.assetIds
            ?? collectPersistedAssetRefsFromSerializedProjectData(revisionData).map((assetRef) => assetRef.assetId);
          return {
            localProjectId: revision.projectLocalId,
            revisionId: revision.revisionId,
            parentRevisionId: revision.parentRevisionId,
            kind: revision.kind,
            baseRevisionId: revision.baseRevisionId,
            data: revisionData,
            assetIds,
            contentHash: revision.contentHash,
            createdAt: revision.createdAt,
            updatedAt: revision.updatedAt,
            schemaVersion: normalizeSchemaVersion(revision.schemaVersion),
            appVersion: revision.appVersion,
            reason: revision.reason,
            checkpointName: revision.checkpointName,
            isCheckpoint: revision.isCheckpoint,
            restoredFromRevisionId: revision.restoredFromRevisionId,
          } satisfies ProjectRevisionSyncPayload;
        }),
      );
    },
    [],
  );

  const reconcileProjectRevisionsFromCloud = useCallback(async (localId: string) => {
    const revisionRecords = await getCloudRevisions(localId);
    const hydratedRevisions = await hydrateCloudRevisions(revisionRecords);
    const revisionAssetIds = Array.from(new Set(hydratedRevisions.flatMap((revision) => revision.assetIds)));
    await ensureAssetIdsAvailableLocally(revisionAssetIds);
    return await syncProjectRevisionsFromCloud(localId, hydratedRevisions);
  }, [ensureAssetIdsAvailableLocally, getCloudRevisions, hydrateCloudRevisions]);

  const runWithRetry = useCallback(async (fn: () => Promise<void>, attempts = 2) => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await fn();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => window.setTimeout(resolve, 250 * attempt));
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
  }, []);

  const ensureCloudProjectAssetsLocally = useCallback(
    async (projectData: string, revisionPayloads: ProjectRevisionSyncPayload[] = []) => {
      const revisionAssetIds = Array.from(new Set(revisionPayloads.flatMap((revision) => revision.assetIds)));
      await ensureSerializedAssetsAvailableLocally([projectData]);
      await ensureAssetIdsAvailableLocally(revisionAssetIds);
    },
    [ensureAssetIdsAvailableLocally, ensureSerializedAssetsAvailableLocally],
  );

  const reconcileProjectFromCloud = useCallback(async (localId: string): Promise<boolean> => {
    let candidate = cloudProjects
      ? dedupeCloudProjectsByLocalId(cloudProjects as CloudProjectRecord[]).find(
          (project) => project.localId === localId,
        )
      : undefined;

    if (!candidate) {
      try {
        const fullProject = await convex.query(api.projects.getFullProject, { localId });
        if (fullProject) {
          candidate = fullProject as CloudProjectRecord;
        }
      } catch (error) {
        console.error(`[CloudSync] Failed to fetch cloud project "${localId}":`, error);
        return false;
      }
    }

    if (!candidate) {
      return false;
    }

    try {
      const data = await loadProjectDataFromCloud(candidate);
      try {
        const revisionRecords = await getCloudRevisions(localId);
        const hydratedRevisions = await hydrateCloudRevisions(revisionRecords);
        await ensureCloudProjectAssetsLocally(data, hydratedRevisions);
        await syncProjectFromCloud({
          ...candidate,
          data,
        });
        await syncProjectRevisionsFromCloud(localId, hydratedRevisions);
      } catch (error) {
        console.error(`[CloudSync] Failed to sync revisions from cloud for "${localId}":`, error);
        await ensureCloudProjectAssetsLocally(data);
        await syncProjectFromCloud({
          ...candidate,
          data,
        });
      }
      return true;
    } catch (error) {
      console.error(`[CloudSync] Failed to reconcile local project "${localId}" from cloud:`, error);
      return false;
    }
  }, [cloudProjects, convex, ensureCloudProjectAssetsLocally, getCloudRevisions, hydrateCloudRevisions]);

  const syncProjectObjectToCloud = useCallback(
    async (project: Project) => {
      if (!enabled) {
        return 'skipped' as const;
      }
      const phaseDurationsMs: CloudProjectSyncPhaseDurations = {};
      let finalStatus: CloudProjectSyncStatus = 'error';
      try {
        const [payload, localRevisionState] = await Promise.all([
          measureCloudSyncPhase(phaseDurationsMs, 'preparePayload', async () => {
            return await getCachedProjectSyncPayload(project);
          }),
          measureCloudSyncPhase(phaseDurationsMs, 'loadLocalRevisionState', async () => {
            return await getProjectRevisionSyncState(project.id);
          }),
        ]);
        const projectMetadata = toProjectSyncMetadata(payload);
        const signature = `${buildProjectSyncSignature(projectMetadata)}|${buildRevisionSyncSignature(localRevisionState)}`;

        finalStatus = await runProjectSyncSerially(project.id, signature, async () => {
          const { outcome, cloudRevisionState } = await syncPayloadToCloud(payload, phaseDurationsMs);
          if (outcome === 'pull') {
            await reconcileProjectFromCloud(project.id);
            console.warn(`[CloudSync] Skipped pushing in-memory project "${project.id}" because cloud has a newer copy.`);
            return 'pulled' as const;
          }
          if (outcome === 'error') {
            return 'error' as const;
          }

          const {
            revisionIdsToUpload,
            plannedMissingAssetIds,
            shouldPullFromCloud,
          } = await measureCloudSyncPhase(phaseDurationsMs, 'planRevisions', async () => {
            return await prepareRevisionSyncPlan(
              projectMetadata,
              localRevisionState,
              { cloudRevisionState },
            );
          });
          if (revisionIdsToUpload.length > 0) {
            await measureCloudSyncPhase(phaseDurationsMs, 'uploadRevisions', async () => {
              await syncProjectRevisionsToCloud(project.id, revisionIdsToUpload, plannedMissingAssetIds);
            });
          }
          if (shouldPullFromCloud) {
            await measureCloudSyncPhase(phaseDurationsMs, 'pullRevisions', async () => {
              await reconcileProjectRevisionsFromCloud(project.id);
            });
          }

          return 'saved' as const;
        });
        return finalStatus;
      } catch (error) {
        console.error('[CloudSync] Failed to sync in-memory project:', error);
        finalStatus = 'error';
        return 'error' as const;
      } finally {
        onProjectSyncMeasured?.({
          projectId: project.id,
          updatedAt: project.updatedAt.getTime(),
          status: finalStatus,
          phaseDurationsMs,
        });
      }
    },
    [
      enabled,
      getCachedProjectSyncPayload,
      onProjectSyncMeasured,
      prepareRevisionSyncPlan,
      reconcileProjectFromCloud,
      reconcileProjectRevisionsFromCloud,
      runProjectSyncSerially,
      syncPayloadToCloud,
      syncProjectRevisionsToCloud,
    ],
  );

  // Sync all local projects to cloud
  const syncAllToCloud = useCallback(async () => {
    if (!enabled) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      const localProjects = await getAllProjectsForSync();
      if (localProjects.length > 0) {
        console.log(`[CloudSync] Syncing ${localProjects.length} projects to cloud...`);
        const storageProjects: StorageSyncPayload[] = [];
        const syncedCloudRevisionStatesByProject = new Map<string, CloudRevisionSyncState>();
        const revisionUploadIdsByProject = new Map<string, string[]>();
        const revisionAssetIdsByProject = new Map<string, string[] | undefined>();
        const revisionPullsByProject = new Map<string, boolean>();

        for (const localProject of localProjects) {
          try {
            const projectMetadata = toProjectSyncMetadata(localProject);
            const localRevisionState = await getProjectRevisionSyncState(localProject.localId);

            const plan = await planSync(projectMetadata, []);
            if (plan.project.action === 'pull') {
              console.warn(
                `[CloudSync] Skipping "${localProject.localId}" because cloud has a newer copy (${plan.project.reason}).`,
              );
              continue;
            }

            const { revisionIdsToUpload, plannedMissingAssetIds, shouldPullFromCloud } = await prepareRevisionSyncPlan(
              projectMetadata,
              localRevisionState,
            );
            revisionUploadIdsByProject.set(localProject.localId, revisionIdsToUpload);
            revisionAssetIdsByProject.set(localProject.localId, plannedMissingAssetIds);
            revisionPullsByProject.set(localProject.localId, shouldPullFromCloud);

            if (plan.project.action !== 'upload') {
              continue;
            }

            await ensureAssetIdsInCloud(
              plan.project.missingAssetIds ?? localProject.assetIds,
              { skipRemoteCheck: plan.project.missingAssetIds !== undefined },
            );
            const storageProject = await toStorageSyncPayload(localProject);
            storageProjects.push(storageProject);
          } catch (error) {
            console.error(`[CloudSync] Failed to prepare "${localProject.localId}" for upload:`, error);
          }
        }

        if (storageProjects.length > 0) {
          const results = await syncMutation({ projects: storageProjects }) as CloudProjectSyncBatchMutationResult[];
          console.log('[CloudSync] Sync results:', results);
          for (const result of results) {
            syncedCloudRevisionStatesByProject.set(result.localId, result.cloudRevisionState);
          }
        }

        for (const localProject of localProjects) {
          if (!revisionUploadIdsByProject.has(localProject.localId)) {
            continue;
          }
          if (syncedCloudRevisionStatesByProject.has(localProject.localId)) {
            const { revisionIdsToUpload, plannedMissingAssetIds, shouldPullFromCloud } = await prepareRevisionSyncPlan(
              toProjectSyncMetadata(localProject),
              await getProjectRevisionSyncState(localProject.localId),
              { cloudRevisionState: syncedCloudRevisionStatesByProject.get(localProject.localId) },
            );
            revisionUploadIdsByProject.set(localProject.localId, revisionIdsToUpload);
            revisionAssetIdsByProject.set(localProject.localId, plannedMissingAssetIds);
            revisionPullsByProject.set(localProject.localId, shouldPullFromCloud);
          }
        }

        for (const localProject of localProjects) {
          try {
            if (!revisionUploadIdsByProject.has(localProject.localId)) {
              continue;
            }
            const revisionIds = revisionUploadIdsByProject.get(localProject.localId);
            await syncProjectRevisionsToCloud(
              localProject.localId,
              revisionIds,
              revisionAssetIdsByProject.get(localProject.localId),
            );
            if (revisionPullsByProject.get(localProject.localId)) {
              await reconcileProjectRevisionsFromCloud(localProject.localId);
            }
          } catch (error) {
            console.error(`[CloudSync] Failed to sync revisions for "${localProject.localId}":`, error);
          }
        }
      }

      await syncProjectExplorerToCloud();
    } catch (error) {
      console.error('[CloudSync] Failed to sync to cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [
    enabled,
    ensureAssetIdsInCloud,
    planSync,
    prepareRevisionSyncPlan,
    reconcileProjectRevisionsFromCloud,
    syncMutation,
    syncProjectExplorerToCloud,
    syncProjectRevisionsToCloud,
    toStorageSyncPayload,
  ]);

  // Sync a single project to cloud by local project id
  const syncProjectToCloud = useCallback(
    async (projectId: string) => {
      if (!enabled) return 'skipped' as const;
      try {
        const [projectMetadata, localRevisionState] = await Promise.all([
          getProjectSyncMetadata(projectId),
          getProjectRevisionSyncState(projectId),
        ]);
        if (!projectMetadata) return 'skipped' as const;
        const signature = `${buildProjectSyncSignature(projectMetadata)}|${buildRevisionSyncSignature(localRevisionState)}`;

        return await runProjectSyncSerially(projectId, signature, async () => {
          const projectPlanResult = await planSync(projectMetadata, []);
          if (projectPlanResult.project.action === 'pull') {
            await reconcileProjectFromCloud(projectId);
            return 'pulled' as const;
          }

          if (projectPlanResult.project.action === 'upload') {
            const project = await getProjectForSync(projectId);
            if (!project) return 'skipped' as const;

            console.log(`[CloudSync] Syncing project "${project.name}" to cloud...`);
            await ensureAssetIdsInCloud(
              projectPlanResult.project.missingAssetIds ?? project.assetIds,
              { skipRemoteCheck: projectPlanResult.project.missingAssetIds !== undefined },
            );
            const storagePayload = await toStorageSyncPayload(project);
            const result = await syncSingleMutation(storagePayload) as CloudProjectSyncMutationResult;
            console.log('[CloudSync] Single sync result:', result);

            if (result.action === 'skipped' && result.reason !== 'already in sync') {
              await reconcileProjectFromCloud(projectId);
              return 'pulled' as const;
            }
            const { revisionIdsToUpload, plannedMissingAssetIds, shouldPullFromCloud } = await prepareRevisionSyncPlan(
              projectMetadata,
              localRevisionState,
              { cloudRevisionState: result.cloudRevisionState },
            );
            if (revisionIdsToUpload.length > 0) {
              await syncProjectRevisionsToCloud(projectId, revisionIdsToUpload, plannedMissingAssetIds);
            }
            if (shouldPullFromCloud) {
              await reconcileProjectRevisionsFromCloud(projectId);
            }
            return 'saved' as const;
          }

          const { revisionIdsToUpload, plannedMissingAssetIds, shouldPullFromCloud } = await prepareRevisionSyncPlan(
            projectMetadata,
            localRevisionState,
          );
          if (revisionIdsToUpload.length > 0) {
            await syncProjectRevisionsToCloud(projectId, revisionIdsToUpload, plannedMissingAssetIds);
          }
          if (shouldPullFromCloud) {
            await reconcileProjectRevisionsFromCloud(projectId);
          }

          return 'saved' as const;
        });
      } catch (error) {
        console.error('[CloudSync] Failed to sync project:', error);
        return 'error' as const;
      }
    },
    [
      enabled,
      ensureAssetIdsInCloud,
      planSync,
      prepareRevisionSyncPlan,
      reconcileProjectFromCloud,
      reconcileProjectRevisionsFromCloud,
      runProjectSyncSerially,
      syncProjectRevisionsToCloud,
      syncSingleMutation,
      toStorageSyncPayload,
    ],
  );

  const deleteProjectFromCloud = useCallback(
    async (localId: string) => {
      if (!enabled) return false;
      try {
        const result = await removeProjectMutation({ localId });
        return result.deleted;
      } catch (error) {
        console.error('[CloudSync] Failed to delete project from cloud:', error);
        return false;
      }
    },
    [enabled, removeProjectMutation],
  );

  // Sync all cloud projects to local
  const syncAllFromCloud = useCallback(async (options: { pruneLocal?: boolean } = {}) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      const { pruneLocal = false } = options;
      const normalizedCloudProjects = await getCloudProjectsFull();
      console.log(`[CloudSync] Syncing ${normalizedCloudProjects.length} projects from cloud...`);

      const results = await Promise.all(
        normalizedCloudProjects.map(async (cloudProject) => {
          try {
            const data = await loadProjectDataFromCloud(cloudProject);
            try {
              const revisionRecords = await getCloudRevisions(cloudProject.localId);
              const hydratedRevisions = await hydrateCloudRevisions(revisionRecords);
              await ensureCloudProjectAssetsLocally(data, hydratedRevisions);
              const result = await syncProjectFromCloud({
                ...cloudProject,
                data,
              });
              const revisionSyncResult = await syncProjectRevisionsFromCloud(cloudProject.localId, hydratedRevisions);
              if (result.migrated || revisionSyncResult.migrated > 0) {
                await syncProjectToCloud(cloudProject.localId);
              }
              return { localId: cloudProject.localId, ...result };
            } catch (revisionError) {
              console.error(`[CloudSync] Failed to sync revisions for "${cloudProject.localId}":`, revisionError);
              await ensureCloudProjectAssetsLocally(data);
              const result = await syncProjectFromCloud({
                ...cloudProject,
                data,
              });
              if (result.migrated) {
                await syncProjectToCloud(cloudProject.localId);
              }
              return { localId: cloudProject.localId, ...result };
            }
          } catch (error) {
            console.error(`[CloudSync] Failed cloud->local sync for "${cloudProject.localId}":`, error);
            return {
              localId: cloudProject.localId,
              action: 'skipped' as const,
              reason: error instanceof Error ? error.message : 'sync from cloud failed',
            };
          }
        }),
      );
      console.log('[CloudSync] Sync from cloud results:', results);

      if (pruneLocal) {
        const pruneResult = await pruneLocalProjectsNotInCloud(
          normalizedCloudProjects.map((project) => project.localId),
        );
        if (pruneResult.deleted > 0) {
          console.log(`[CloudSync] Pruned ${pruneResult.deleted} local-only projects`);
        }
      }

      await reconcileProjectExplorerFromCloud();
    } catch (error) {
      console.error('[CloudSync] Failed to sync from cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [
    ensureCloudProjectAssetsLocally,
    getCloudProjectsFull,
    getCloudRevisions,
    hydrateCloudRevisions,
    reconcileProjectExplorerFromCloud,
    syncProjectToCloud,
  ]);

  // Run a full two-way reconciliation:
  // 1) push all local projects up, then 2) pull cloud projects down.
  const syncAllBidirectional = useCallback(async () => {
    if (!enabled) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      await runWithRetry(async () => {
        const localProjects = await getAllProjectsForSync();
        if (localProjects.length === 0) return;

        const storageProjects: StorageSyncPayload[] = [];
        const syncedCloudRevisionStatesByProject = new Map<string, CloudRevisionSyncState>();
        const revisionUploadIdsByProject = new Map<string, string[]>();
        const revisionAssetIdsByProject = new Map<string, string[] | undefined>();
        const revisionPullsByProject = new Map<string, boolean>();
        for (const localProject of localProjects) {
          try {
            const projectMetadata = toProjectSyncMetadata(localProject);
            const localRevisionState = await getProjectRevisionSyncState(localProject.localId);

            const plan = await planSync(projectMetadata, []);

            if (plan.project.action === 'pull') {
              continue;
            }

            if (plan.project.action !== 'upload') {
              const { revisionIdsToUpload, plannedMissingAssetIds, shouldPullFromCloud } = await prepareRevisionSyncPlan(
                projectMetadata,
                localRevisionState,
              );
              revisionUploadIdsByProject.set(localProject.localId, revisionIdsToUpload);
              revisionAssetIdsByProject.set(localProject.localId, plannedMissingAssetIds);
              revisionPullsByProject.set(localProject.localId, shouldPullFromCloud);
              continue;
            }

            const { revisionIdsToUpload, plannedMissingAssetIds, shouldPullFromCloud } = await prepareRevisionSyncPlan(
              projectMetadata,
              localRevisionState,
            );
            revisionUploadIdsByProject.set(localProject.localId, revisionIdsToUpload);
            revisionAssetIdsByProject.set(localProject.localId, plannedMissingAssetIds);
            revisionPullsByProject.set(localProject.localId, shouldPullFromCloud);

            await ensureAssetIdsInCloud(
              plan.project.missingAssetIds ?? localProject.assetIds,
              { skipRemoteCheck: plan.project.missingAssetIds !== undefined },
            );
            const storageProject = await toStorageSyncPayload(localProject);
            storageProjects.push(storageProject);
          } catch (error) {
            console.error(`[CloudSync] Failed to prepare "${localProject.localId}" for bidirectional sync:`, error);
          }
        }

        if (storageProjects.length > 0) {
          const results = await syncMutation({ projects: storageProjects }) as CloudProjectSyncBatchMutationResult[];
          for (const result of results) {
            syncedCloudRevisionStatesByProject.set(result.localId, result.cloudRevisionState);
          }
        }

        for (const localProject of localProjects) {
          if (!syncedCloudRevisionStatesByProject.has(localProject.localId)) {
            continue;
          }
          const { revisionIdsToUpload, plannedMissingAssetIds, shouldPullFromCloud } = await prepareRevisionSyncPlan(
            toProjectSyncMetadata(localProject),
            await getProjectRevisionSyncState(localProject.localId),
            { cloudRevisionState: syncedCloudRevisionStatesByProject.get(localProject.localId) },
          );
          revisionUploadIdsByProject.set(localProject.localId, revisionIdsToUpload);
          revisionAssetIdsByProject.set(localProject.localId, plannedMissingAssetIds);
          revisionPullsByProject.set(localProject.localId, shouldPullFromCloud);
        }

        for (const localProject of localProjects) {
          if (!revisionUploadIdsByProject.has(localProject.localId)) {
            continue;
          }
          const revisionIds = revisionUploadIdsByProject.get(localProject.localId);
          await syncProjectRevisionsToCloud(
            localProject.localId,
            revisionIds,
            revisionAssetIdsByProject.get(localProject.localId),
          );
          if (revisionPullsByProject.get(localProject.localId)) {
            await reconcileProjectRevisionsFromCloud(localProject.localId);
          }
        }
      });

      {
        const normalizedCloudProjects = await getCloudProjectsFull();
        await runWithRetry(async () => {
          await Promise.all(normalizedCloudProjects.map(async (cloudProject) => {
            try {
              const data = await loadProjectDataFromCloud(cloudProject);
              const revisionRecords = await getCloudRevisions(cloudProject.localId);
              const hydratedRevisions = await hydrateCloudRevisions(revisionRecords);
              await ensureCloudProjectAssetsLocally(data, hydratedRevisions);
              await syncProjectFromCloud({
                ...cloudProject,
                data,
              });
              await syncProjectRevisionsFromCloud(cloudProject.localId, hydratedRevisions);
            } catch (error) {
              console.error(`[CloudSync] Failed to reconcile "${cloudProject.localId}" in bidirectional sync:`, error);
            }
          }));
        });
      }

      await syncProjectExplorerToCloud();
      await reconcileProjectExplorerFromCloud();
    } catch (error) {
      console.error('[CloudSync] Bidirectional sync failed:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [
    enabled,
    ensureAssetIdsInCloud,
    ensureCloudProjectAssetsLocally,
    getCloudProjectsFull,
    getCloudRevisions,
    hydrateCloudRevisions,
    planSync,
    prepareRevisionSyncPlan,
    reconcileProjectExplorerFromCloud,
    reconcileProjectRevisionsFromCloud,
    runWithRetry,
    syncMutation,
    syncProjectExplorerToCloud,
    syncProjectRevisionsToCloud,
    toStorageSyncPayload,
  ]);

  // Sync on mount if requested
  useEffect(() => {
    if (enabled && syncOnMount) {
      void syncAllFromCloud();
    }
  }, [enabled, syncOnMount, syncAllFromCloud]);

  // Debounced background sync from the latest in-memory edit timestamp.
  useEffect(() => {
    if (!autoSyncCurrentProject || !enabled || !isDirty || backgroundSyncDebounceMs <= 0) {
      return;
    }

    const project = currentProjectRef.current;
    const projectId = currentProjectIdRef.current;
    if (!project && !projectId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const latestProject = currentProjectRef.current;
      if (latestProject) {
        void syncProjectObjectToCloud(latestProject);
        return;
      }

      const latestProjectId = currentProjectIdRef.current;
      if (latestProjectId) {
        void syncProjectToCloud(latestProjectId);
      }
    }, backgroundSyncDebounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    autoSyncCurrentProject,
    backgroundSyncDebounceMs,
    currentProject?.id,
    currentProject?.updatedAt,
    currentProjectId,
    enabled,
    isDirty,
    syncProjectObjectToCloud,
    syncProjectToCloud,
  ]);

  // Sync current project on unmount (in-app navigation)
  useEffect(() => {
    if (!autoSyncCurrentProject || !enabled || !syncOnUnmount) {
      return;
    }

    return () => {
      const project = currentProjectRef.current;
      if (project) {
        void syncProjectObjectToCloud(project);
        return;
      }

      const projectId = currentProjectIdRef.current;
      if (projectId) {
        void syncProjectToCloud(projectId);
      }
    };
  }, [autoSyncCurrentProject, enabled, syncOnUnmount, syncProjectObjectToCloud, syncProjectToCloud]);

  // Periodic authenticated checkpoints while local state is dirty.
  useEffect(() => {
    if (!autoSyncCurrentProject || !enabled || !isDirty || checkpointIntervalMs <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const project = currentProjectRef.current;
      if (project) {
        void syncProjectObjectToCloud(project);
        return;
      }

      const projectId = currentProjectIdRef.current;
      if (projectId) {
        void syncProjectToCloud(projectId);
      }
    }, checkpointIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [autoSyncCurrentProject, checkpointIntervalMs, enabled, isDirty, syncProjectObjectToCloud, syncProjectToCloud]);

  // Fire-and-forget flush for page lifecycle changes without anonymous beacon route.
  useEffect(() => {
    if (!autoSyncCurrentProject || !enabled || !isDirty) {
      return;
    }

    const flushCurrentProject = () => {
      const project = currentProjectRef.current;
      if (project) {
        void syncProjectObjectToCloud(project);
        return;
      }

      const projectId = currentProjectIdRef.current;
      if (projectId) {
        void syncProjectToCloud(projectId);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushCurrentProject();
      }
    };

    window.addEventListener('pagehide', flushCurrentProject);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushCurrentProject);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoSyncCurrentProject, enabled, isDirty, syncProjectObjectToCloud, syncProjectToCloud]);

  const isProjectInCloud = useCallback(
    (projectId: string) => {
      if (!cloudProjects) return false;
      const normalized = dedupeCloudProjectsByLocalId(cloudProjects as CloudProjectRecord[]);
      return normalized.some((project) => project.localId === projectId);
    },
    [cloudProjects],
  );

  return {
    syncAllToCloud,
    syncAllFromCloud,
    syncAllBidirectional,
    syncProjectExplorerToCloud,
    syncProjectExplorerFromCloud: reconcileProjectExplorerFromCloud,
    syncProjectDraftToCloud: syncProjectObjectToCloud,
    syncProjectToCloud,
    syncProjectFromCloud: reconcileProjectFromCloud,
    deleteProjectFromCloud,
    syncProjectRevisionsToCloud,
    isProjectInCloud,
    cloudProjects,
    isSyncing: isSyncingRef.current,
  };
}
