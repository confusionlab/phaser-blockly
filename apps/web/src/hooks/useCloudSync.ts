import { useCallback, useEffect, useRef } from 'react';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { Id } from '@convex-generated/dataModel';
import { api } from '@convex-generated/api';
import {
  collectPersistedAssetRefsFromSerializedProjectData,
  createProjectSyncPayload,
  getAllProjectsForSync,
  getManagedAssetBlob,
  getManagedAssetMetadata,
  getProjectForSync,
  getProjectRevisionSyncMetadata,
  getProjectRevisionsForSync,
  getProjectSyncMetadata,
  hasManagedAsset,
  pruneLocalProjectsNotInCloud,
  storeManagedAsset,
  syncProjectFromCloud,
  syncProjectRevisionsFromCloud,
  type ManagedAssetKind,
  type ProjectRevisionSyncMetadata,
  type ProjectRevisionSyncPayload,
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
  data?: string;
  dataUrl: string | null;
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

interface CloudProjectSyncPlan {
  project: {
    action: 'upload' | 'skip' | 'pull';
    reason: string;
  };
  revisions: Array<{
    revisionId: string;
    action: 'upload' | 'skip';
    reason: string;
  }>;
}

function formatUploadSizeMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(3)} MB`;
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

function toProjectSyncMetadata(payload: Pick<ProjectSyncPayload, 'localId' | 'updatedAt' | 'schemaVersion' | 'contentHash'>): ProjectSyncMetadata {
  return {
    localId: payload.localId,
    updatedAt: payload.updatedAt,
    schemaVersion: payload.schemaVersion,
    contentHash: payload.contentHash,
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
  } = options;

  const convex = useConvex();
  const generateUploadUrlMutation = useMutation(api.projects.generateUploadUrl);
  const generateAssetUploadUrlMutation = useMutation(api.projectAssets.generateUploadUrl);
  const syncMutation = useMutation(api.projects.syncBatch);
  const syncSingleMutation = useMutation(api.projects.sync);
  const syncRevisionsMutation = useMutation(api.projects.syncRevisions);
  const upsertProjectAssetMutation = useMutation(api.projectAssets.upsert);
  const listRevisionsMutation = useMutation(api.projects.listRevisionsForSync);
  const removeProjectMutation = useMutation(api.projects.remove);
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const cloudProjects = useQuery(
    api.projects.listFull,
    isConvexAuthenticated && enableCloudProjectListQuery ? {} : 'skip',
  );

  const isSyncingRef = useRef(false);
  const currentProjectIdRef = useRef(currentProjectId);
  const currentProjectRef = useRef<Project | null>(currentProject);

  currentProjectIdRef.current = currentProjectId;
  currentProjectRef.current = currentProject;

  const getCloudProjectsFull = useCallback(async (): Promise<CloudProjectRecord[]> => {
    if (cloudProjects) {
      return dedupeCloudProjectsByLocalId(cloudProjects as CloudProjectRecord[]);
    }

    const fetchedProjects = await convex.query(api.projects.listFull, {});
    return dedupeCloudProjectsByLocalId(fetchedProjects as CloudProjectRecord[]);
  }, [cloudProjects, convex]);

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
      return {
        ...metadata,
        storageId: uploadResult.storageId as Id<'_storage'>,
        dataSizeBytes: blob.size,
      };
    },
    [generateUploadUrlMutation],
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

  const ensureAssetRefsInCloud = useCallback(
    async (assetRefs: PersistedAssetRef[]) => {
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

      const missingIds = await convex.query(api.projectAssets.listMissing, {
        assetIds: uniqueRefs.map((assetRef) => assetRef.assetId),
      });

      for (const assetId of missingIds as string[]) {
        const assetRef = uniqueRefs.find((ref) => ref.assetId === assetId);
        if (!assetRef) continue;

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
      }
    },
    [convex, generateAssetUploadUrlMutation, upsertProjectAssetMutation],
  );

  const ensureSerializedAssetsInCloud = useCallback(
    async (serializedProjectPayloads: string[]) => {
      const refsById = new Map<string, PersistedAssetRef>();
      for (const serializedData of serializedProjectPayloads) {
        for (const assetRef of collectPersistedAssetRefsFromSerializedProjectData(serializedData)) {
          refsById.set(assetRef.assetId, assetRef);
        }
      }
      await ensureAssetRefsInCloud(Array.from(refsById.values()));
    },
    [ensureAssetRefsInCloud],
  );

  const ensureAssetIdsInCloud = useCallback(
    async (assetIds: readonly string[]) => {
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
      await ensureAssetRefsInCloud(Array.from(refsById.values()));
    },
    [ensureAssetRefsInCloud],
  );

  const ensureRevisionAssetsInCloud = useCallback(
    async (revisions: ProjectRevisionSyncPayload[]) => {
      const assetIds = Array.from(new Set(revisions.flatMap((revision) => revision.assetIds)));
      await ensureAssetIdsInCloud(assetIds);
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

  const syncPayloadToCloud = useCallback(
    async (payload: ProjectSyncPayload) => {
      if (!enabled) {
        return 'skipped' as const;
      }
      try {
        const plan = await planSync(toProjectSyncMetadata(payload));
        if (plan.project.action !== 'upload') {
          return plan.project.action === 'pull' ? 'pull' as const : 'skipped' as const;
        }

        await ensureSerializedAssetsInCloud([payload.data]);
        const storagePayload = await toStorageSyncPayload(payload);
        const result = await syncSingleMutation(storagePayload);
        if (result.action === 'skipped' && result.reason !== 'already in sync') {
          return 'pull' as const;
        }
        return 'uploaded' as const;
      } catch (error) {
        console.error('[CloudSync] Failed to sync payload:', error);
        return 'error' as const;
      }
    },
    [enabled, ensureSerializedAssetsInCloud, planSync, syncSingleMutation, toStorageSyncPayload],
  );

  const syncProjectObjectToCloud = useCallback(
    async (project: Project) => {
      if (!enabled) {
        return;
      }
      try {
        const payload = await createProjectSyncPayload(project);
        const outcome = await syncPayloadToCloud(payload);
        if (outcome === 'pull') {
          console.warn(`[CloudSync] Skipped pushing in-memory project "${project.id}" because cloud has a newer copy.`);
        }
      } catch (error) {
        console.error('[CloudSync] Failed to sync in-memory project:', error);
      }
    },
    [enabled, syncPayloadToCloud],
  );

  const syncProjectRevisionsToCloud = useCallback(
    async (projectId: string, revisionIds?: readonly string[]) => {
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

      await ensureRevisionAssetsInCloud(revisions);

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
        const revisionRecords = await listRevisionsMutation({ localId });
        const hydratedRevisions = await Promise.all(
          (revisionRecords as CloudRevisionRecord[]).map(async (revision) => {
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
              schemaVersion: normalizeSchemaVersion(revision.schemaVersion),
              appVersion: revision.appVersion,
              reason: revision.reason,
              checkpointName: revision.checkpointName,
              isCheckpoint: revision.isCheckpoint,
                restoredFromRevisionId: revision.restoredFromRevisionId,
              } satisfies ProjectRevisionSyncPayload;
            }),
        );
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
  }, [cloudProjects, convex, ensureCloudProjectAssetsLocally, listRevisionsMutation]);

  // Sync all local projects to cloud
  const syncAllToCloud = useCallback(async () => {
    if (!enabled) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      const localProjects = await getAllProjectsForSync();
      if (localProjects.length === 0) {
        isSyncingRef.current = false;
        return;
      }

      console.log(`[CloudSync] Syncing ${localProjects.length} projects to cloud...`);
      const storageProjects: StorageSyncPayload[] = [];
      const revisionUploadIdsByProject = new Map<string, string[]>();

      for (const localProject of localProjects) {
        try {
          const revisionMetadata = await getProjectRevisionSyncMetadata(localProject.localId);
          const plan = await planSync(
            toProjectSyncMetadata(localProject),
            revisionMetadata,
          );

          revisionUploadIdsByProject.set(
            localProject.localId,
            plan.revisions
              .filter((revision) => revision.action === 'upload')
              .map((revision) => revision.revisionId),
          );

          if (plan.project.action === 'pull') {
            console.warn(
              `[CloudSync] Skipping "${localProject.localId}" because cloud has a newer copy (${plan.project.reason}).`,
            );
            continue;
          }

          if (plan.project.action !== 'upload') {
            continue;
          }

          await ensureSerializedAssetsInCloud([localProject.data]);
          const storageProject = await toStorageSyncPayload(localProject);
          storageProjects.push(storageProject);
        } catch (error) {
          console.error(`[CloudSync] Failed to prepare "${localProject.localId}" for upload:`, error);
        }
      }

      if (storageProjects.length > 0) {
        const results = await syncMutation({ projects: storageProjects });
        console.log('[CloudSync] Sync results:', results);
      }

      for (const localProject of localProjects) {
        try {
          await syncProjectRevisionsToCloud(localProject.localId, revisionUploadIdsByProject.get(localProject.localId));
        } catch (error) {
          console.error(`[CloudSync] Failed to sync revisions for "${localProject.localId}":`, error);
        }
      }
    } catch (error) {
      console.error('[CloudSync] Failed to sync to cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [enabled, ensureSerializedAssetsInCloud, planSync, syncMutation, syncProjectRevisionsToCloud, toStorageSyncPayload]);

  // Sync a single project to cloud by local project id
  const syncProjectToCloud = useCallback(
    async (projectId: string) => {
      if (!enabled) return false;
      try {
        const [projectMetadata, revisionMetadata] = await Promise.all([
          getProjectSyncMetadata(projectId),
          getProjectRevisionSyncMetadata(projectId),
        ]);
        if (!projectMetadata) return false;

        const plan = await planSync(projectMetadata, revisionMetadata);
        const revisionIdsToUpload = plan.revisions
          .filter((revision) => revision.action === 'upload')
          .map((revision) => revision.revisionId);

        if (plan.project.action === 'pull') {
          await reconcileProjectFromCloud(projectId);
          return false;
        }

        if (plan.project.action === 'upload') {
          const project = await getProjectForSync(projectId);
          if (!project) return false;

          console.log(`[CloudSync] Syncing project "${project.name}" to cloud...`);
          await ensureSerializedAssetsInCloud([project.data]);
          const storagePayload = await toStorageSyncPayload(project);
          const result = await syncSingleMutation(storagePayload);
          console.log('[CloudSync] Single sync result:', result);

          if (result.action === 'skipped' && result.reason !== 'already in sync') {
            await reconcileProjectFromCloud(projectId);
            return false;
          }
        }

        await syncProjectRevisionsToCloud(projectId, revisionIdsToUpload);

        return true;
      } catch (error) {
        console.error('[CloudSync] Failed to sync project:', error);
        return false;
      }
    },
    [enabled, ensureSerializedAssetsInCloud, planSync, reconcileProjectFromCloud, syncProjectRevisionsToCloud, syncSingleMutation, toStorageSyncPayload],
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
              const revisionRecords = await listRevisionsMutation({ localId: cloudProject.localId });
              const hydratedRevisions = await Promise.all(
                (revisionRecords as CloudRevisionRecord[]).map(async (revision) => {
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
                    schemaVersion: normalizeSchemaVersion(revision.schemaVersion),
                    appVersion: revision.appVersion,
                    reason: revision.reason,
                    checkpointName: revision.checkpointName,
                    isCheckpoint: revision.isCheckpoint,
                    restoredFromRevisionId: revision.restoredFromRevisionId,
                  } satisfies ProjectRevisionSyncPayload;
                }),
              );
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
    } catch (error) {
      console.error('[CloudSync] Failed to sync from cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [ensureCloudProjectAssetsLocally, getCloudProjectsFull, listRevisionsMutation, syncProjectToCloud]);

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
        const revisionUploadIdsByProject = new Map<string, string[]>();
        for (const localProject of localProjects) {
          try {
            const revisionMetadata = await getProjectRevisionSyncMetadata(localProject.localId);
            const plan = await planSync(
              toProjectSyncMetadata(localProject),
              revisionMetadata,
            );

            revisionUploadIdsByProject.set(
              localProject.localId,
              plan.revisions
                .filter((revision) => revision.action === 'upload')
                .map((revision) => revision.revisionId),
            );

            if (plan.project.action !== 'upload') {
              continue;
            }

            await ensureSerializedAssetsInCloud([localProject.data]);
            const storageProject = await toStorageSyncPayload(localProject);
            storageProjects.push(storageProject);
          } catch (error) {
            console.error(`[CloudSync] Failed to prepare "${localProject.localId}" for bidirectional sync:`, error);
          }
        }

        if (storageProjects.length > 0) {
          await syncMutation({ projects: storageProjects });
        }

        for (const localProject of localProjects) {
          await syncProjectRevisionsToCloud(localProject.localId, revisionUploadIdsByProject.get(localProject.localId));
        }
      });

      {
        const normalizedCloudProjects = await getCloudProjectsFull();
        await runWithRetry(async () => {
          await Promise.all(normalizedCloudProjects.map(async (cloudProject) => {
            try {
              const data = await loadProjectDataFromCloud(cloudProject);
              const revisionRecords = await listRevisionsMutation({ localId: cloudProject.localId });
              const hydratedRevisions = await Promise.all(
                (revisionRecords as CloudRevisionRecord[]).map(async (revision) => {
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
                    schemaVersion: normalizeSchemaVersion(revision.schemaVersion),
                    appVersion: revision.appVersion,
                    reason: revision.reason,
                    checkpointName: revision.checkpointName,
                    isCheckpoint: revision.isCheckpoint,
                    restoredFromRevisionId: revision.restoredFromRevisionId,
                  } satisfies ProjectRevisionSyncPayload;
                }),
              );
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
    } catch (error) {
      console.error('[CloudSync] Bidirectional sync failed:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [enabled, ensureCloudProjectAssetsLocally, ensureSerializedAssetsInCloud, getCloudProjectsFull, listRevisionsMutation, planSync, runWithRetry, syncMutation, syncProjectRevisionsToCloud, toStorageSyncPayload]);

  // Sync on mount if requested
  useEffect(() => {
    if (enabled && syncOnMount) {
      void syncAllFromCloud();
    }
  }, [enabled, syncOnMount, syncAllFromCloud]);

  // Debounced background sync from the latest in-memory edit timestamp.
  useEffect(() => {
    if (!enabled || !isDirty || backgroundSyncDebounceMs <= 0) {
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
    if (!enabled || !syncOnUnmount) {
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
  }, [enabled, syncOnUnmount, syncProjectObjectToCloud, syncProjectToCloud]);

  // Periodic authenticated checkpoints while local state is dirty.
  useEffect(() => {
    if (!enabled || !isDirty || checkpointIntervalMs <= 0) {
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
  }, [checkpointIntervalMs, enabled, isDirty, syncProjectObjectToCloud, syncProjectToCloud]);

  // Fire-and-forget flush for page lifecycle changes without anonymous beacon route.
  useEffect(() => {
    if (!enabled || !isDirty) {
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
  }, [enabled, isDirty, syncProjectObjectToCloud, syncProjectToCloud]);

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
    syncProjectToCloud,
    syncProjectFromCloud: reconcileProjectFromCloud,
    deleteProjectFromCloud,
    syncProjectRevisionsToCloud,
    isProjectInCloud,
    cloudProjects,
    isSyncing: isSyncingRef.current,
  };
}
