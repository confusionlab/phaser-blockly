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
  getProjectRevisionsForSync,
  hasManagedAsset,
  pruneLocalProjectsNotInCloud,
  storeManagedAsset,
  syncProjectFromCloud,
  syncProjectRevisionsFromCloud,
  type ManagedAssetKind,
  type ProjectSyncPayload,
  type ProjectRevisionSyncPayload,
} from '@/db/database';
import type { Project } from '@/types';

interface CloudSyncOptions {
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
    syncOnMount = false,
    currentProjectId = null,
    currentProject = null,
    isDirty = false,
    syncOnUnmount = true,
    checkpointIntervalMs = 45_000,
    enableCloudProjectListQuery = true,
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
      return {
        ...metadata,
        storageId: uploadResult.storageId as Id<'_storage'>,
        dataSizeBytes: blob.size,
      };
    },
    [generateUploadUrlMutation],
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

  const syncPayloadToCloud = useCallback(
    async (payload: ProjectSyncPayload) => {
      try {
        await ensureSerializedAssetsInCloud([payload.data]);
        const storagePayload = await toStorageSyncPayload(payload);
        await syncSingleMutation(storagePayload);
      } catch (error) {
        console.error('[CloudSync] Failed to sync payload:', error);
      }
    },
    [ensureSerializedAssetsInCloud, syncSingleMutation, toStorageSyncPayload],
  );

  const syncProjectObjectToCloud = useCallback(
    async (project: Project) => {
      try {
        const payload = await createProjectSyncPayload(project);
        await syncPayloadToCloud(payload);
      } catch (error) {
        console.error('[CloudSync] Failed to sync in-memory project:', error);
      }
    },
    [syncPayloadToCloud],
  );

  const syncProjectRevisionsToCloud = useCallback(
    async (projectId: string) => {
      const revisions = await getProjectRevisionsForSync(projectId);
      if (revisions.length === 0) {
        return { created: 0, updated: 0, skipped: 0 };
      }

      await ensureSerializedAssetsInCloud(revisions.map((revision) => revision.data));

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
    [ensureSerializedAssetsInCloud, syncRevisionsMutation, toStorageRevisionPayload],
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
      const serializedPayloads = [projectData, ...revisionPayloads.map((revision) => revision.data)];
      await ensureSerializedAssetsAvailableLocally(serializedPayloads);
    },
    [ensureSerializedAssetsAvailableLocally],
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
            return {
              localProjectId: revision.projectLocalId,
              revisionId: revision.revisionId,
              parentRevisionId: revision.parentRevisionId,
              kind: revision.kind,
              baseRevisionId: revision.baseRevisionId,
              data: revisionData,
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

      for (const localProject of localProjects) {
        try {
          await ensureSerializedAssetsInCloud([localProject.data]);
          const storageProject = await toStorageSyncPayload(localProject);
          storageProjects.push(storageProject);
        } catch (error) {
          console.error(`[CloudSync] Failed to prepare "${localProject.localId}" for upload:`, error);
        }
      }

      if (storageProjects.length === 0) {
        return;
      }

      const results = await syncMutation({ projects: storageProjects });
      console.log('[CloudSync] Sync results:', results);

      for (const localProject of localProjects) {
        try {
          await syncProjectRevisionsToCloud(localProject.localId);
        } catch (error) {
          console.error(`[CloudSync] Failed to sync revisions for "${localProject.localId}":`, error);
        }
      }
    } catch (error) {
      console.error('[CloudSync] Failed to sync to cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [ensureSerializedAssetsInCloud, syncMutation, syncProjectRevisionsToCloud, toStorageSyncPayload]);

  // Sync a single project to cloud by local project id
  const syncProjectToCloud = useCallback(
    async (projectId: string) => {
      try {
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

        await syncProjectRevisionsToCloud(projectId);

        return true;
      } catch (error) {
        console.error('[CloudSync] Failed to sync project:', error);
        return false;
      }
    },
    [ensureSerializedAssetsInCloud, reconcileProjectFromCloud, syncProjectRevisionsToCloud, syncSingleMutation, toStorageSyncPayload],
  );

  const deleteProjectFromCloud = useCallback(
    async (localId: string) => {
      try {
        const result = await removeProjectMutation({ localId });
        return result.deleted;
      } catch (error) {
        console.error('[CloudSync] Failed to delete project from cloud:', error);
        return false;
      }
    },
    [removeProjectMutation],
  );

  // Sync all cloud projects to local
  const syncAllFromCloud = useCallback(async (options: { pruneLocal?: boolean } = {}) => {
    if (cloudProjects === undefined || isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      const { pruneLocal = false } = options;
      const normalizedCloudProjects = dedupeCloudProjectsByLocalId(cloudProjects as CloudProjectRecord[]);
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
                  return {
                    localProjectId: revision.projectLocalId,
                    revisionId: revision.revisionId,
                    parentRevisionId: revision.parentRevisionId,
                    kind: revision.kind,
                    baseRevisionId: revision.baseRevisionId,
                    data: revisionData,
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
              await syncProjectRevisionsFromCloud(cloudProject.localId, hydratedRevisions);
              return { localId: cloudProject.localId, ...result };
            } catch (revisionError) {
              console.error(`[CloudSync] Failed to sync revisions for "${cloudProject.localId}":`, revisionError);
              await ensureCloudProjectAssetsLocally(data);
              const result = await syncProjectFromCloud({
                ...cloudProject,
                data,
              });
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
  }, [cloudProjects, ensureCloudProjectAssetsLocally, listRevisionsMutation]);

  // Run a full two-way reconciliation:
  // 1) push all local projects up, then 2) pull cloud projects down.
  const syncAllBidirectional = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      await runWithRetry(async () => {
        const localProjects = await getAllProjectsForSync();
        if (localProjects.length === 0) return;

        const storageProjects: StorageSyncPayload[] = [];
        for (const localProject of localProjects) {
          try {
            await ensureSerializedAssetsInCloud([localProject.data]);
            const storageProject = await toStorageSyncPayload(localProject);
            storageProjects.push(storageProject);
          } catch (error) {
            console.error(`[CloudSync] Failed to prepare "${localProject.localId}" for bidirectional sync:`, error);
          }
        }

        if (storageProjects.length === 0) {
          return;
        }

        await syncMutation({ projects: storageProjects });

        for (const localProject of localProjects) {
          await syncProjectRevisionsToCloud(localProject.localId);
        }
      });

      if (cloudProjects) {
        const normalizedCloudProjects = dedupeCloudProjectsByLocalId(cloudProjects as CloudProjectRecord[]);
        await runWithRetry(async () => {
          await Promise.all(normalizedCloudProjects.map(async (cloudProject) => {
            try {
              const data = await loadProjectDataFromCloud(cloudProject);
              const revisionRecords = await listRevisionsMutation({ localId: cloudProject.localId });
              const hydratedRevisions = await Promise.all(
                (revisionRecords as CloudRevisionRecord[]).map(async (revision) => {
                  const revisionData = await loadRevisionDataFromCloud(revision);
                  return {
                    localProjectId: revision.projectLocalId,
                    revisionId: revision.revisionId,
                    parentRevisionId: revision.parentRevisionId,
                    kind: revision.kind,
                    baseRevisionId: revision.baseRevisionId,
                    data: revisionData,
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
  }, [cloudProjects, ensureCloudProjectAssetsLocally, ensureSerializedAssetsInCloud, listRevisionsMutation, runWithRetry, syncMutation, syncProjectRevisionsToCloud, toStorageSyncPayload]);

  // Sync on mount if requested
  useEffect(() => {
    if (syncOnMount && cloudProjects) {
      void syncAllFromCloud();
    }
  }, [syncOnMount, cloudProjects, syncAllFromCloud]);

  // Sync current project on unmount (in-app navigation)
  useEffect(() => {
    if (!syncOnUnmount) {
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
  }, [syncOnUnmount, syncProjectObjectToCloud, syncProjectToCloud]);

  // Periodic authenticated checkpoints while local state is dirty.
  useEffect(() => {
    if (!isDirty || checkpointIntervalMs <= 0) {
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
  }, [checkpointIntervalMs, isDirty, syncProjectObjectToCloud, syncProjectToCloud]);

  // Fire-and-forget flush for page lifecycle changes without anonymous beacon route.
  useEffect(() => {
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
  }, [syncProjectObjectToCloud, syncProjectToCloud]);

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
