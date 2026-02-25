import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import {
  createProjectSyncPayload,
  getAllProjectsForSync,
  getProjectForSync,
  pruneLocalProjectsNotInCloud,
  syncProjectFromCloud,
  type ProjectSyncPayload,
} from '@/db/database';
import type { Project } from '@/types';

interface CloudSyncOptions {
  // Sync cloud data down when mounted
  syncOnMount?: boolean;
  // Current project id fallback (used when full project object is unavailable)
  currentProjectId?: string | null;
  // Current in-memory project for reliable unload beacon payload
  currentProject?: Project | null;
  // Sync current project on hook unmount (navigation)
  syncOnUnmount?: boolean;
}

interface CloudProjectRecord {
  localId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
  storageId?: Id<'_storage'>;
  dataSizeBytes?: number;
  data?: string;
  dataUrl: string | null;
}

type StorageSyncPayload = Omit<ProjectSyncPayload, 'data'> & {
  storageId: Id<'_storage'>;
  dataSizeBytes: number;
};

type BeaconSyncPayload = Pick<
  ProjectSyncPayload,
  'localId' | 'name' | 'data' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'appVersion'
>;

function toBeaconSyncPayload(payload: ProjectSyncPayload): BeaconSyncPayload {
  return {
    localId: payload.localId,
    name: payload.name,
    data: payload.data,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    schemaVersion: payload.schemaVersion,
    appVersion: payload.appVersion,
  };
}

function getSyncBeaconUrl(): string | null {
  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
  if (siteUrl) {
    return `${siteUrl.replace(/\/$/, '')}/sync-beacon`;
  }

  const cloudUrl = import.meta.env.VITE_CONVEX_URL;
  if (!cloudUrl) {
    return null;
  }

  return `${cloudUrl.replace('.cloud', '.site')}/sync-beacon`;
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

export function useCloudSync(options: CloudSyncOptions = {}) {
  const {
    syncOnMount = false,
    currentProjectId = null,
    currentProject = null,
    syncOnUnmount = true,
  } = options;

  const generateUploadUrlMutation = useMutation(api.projects.generateUploadUrl);
  const syncMutation = useMutation(api.projects.syncBatch);
  const syncSingleMutation = useMutation(api.projects.sync);
  const removeProjectMutation = useMutation(api.projects.remove);
  const cloudProjects = useQuery(api.projects.listFull);

  const isSyncingRef = useRef(false);
  const currentProjectIdRef = useRef(currentProjectId);
  const beaconPayloadRef = useRef<ProjectSyncPayload | null>(null);

  currentProjectIdRef.current = currentProjectId;

  useEffect(() => {
    beaconPayloadRef.current = currentProject ? createProjectSyncPayload(currentProject) : null;
  }, [currentProject]);

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

  const syncPayloadToCloud = useCallback(
    async (payload: ProjectSyncPayload) => {
      if (isSyncingRef.current) return;
      try {
        const storagePayload = await toStorageSyncPayload(payload);
        await syncSingleMutation(storagePayload);
      } catch (error) {
        console.error('[CloudSync] Failed to sync payload:', error);
      }
    },
    [syncSingleMutation, toStorageSyncPayload],
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
        const storageProject = await toStorageSyncPayload(localProject);
        storageProjects.push(storageProject);
      }

      const results = await syncMutation({ projects: storageProjects });
      console.log('[CloudSync] Sync results:', results);
    } catch (error) {
      console.error('[CloudSync] Failed to sync to cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [syncMutation, toStorageSyncPayload]);

  // Sync a single project to cloud by local project id
  const syncProjectToCloud = useCallback(
    async (projectId: string) => {
      try {
        const project = await getProjectForSync(projectId);
        if (!project) return false;

        console.log(`[CloudSync] Syncing project "${project.name}" to cloud...`);
        const storagePayload = await toStorageSyncPayload(project);
        const result = await syncSingleMutation(storagePayload);
        console.log('[CloudSync] Single sync result:', result);
        return true;
      } catch (error) {
        console.error('[CloudSync] Failed to sync project:', error);
        return false;
      }
    },
    [syncSingleMutation, toStorageSyncPayload],
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
      console.log(`[CloudSync] Syncing ${cloudProjects.length} projects from cloud...`);
      const results = await Promise.all(
        cloudProjects.map(async (cloudProject) => {
          const data = await loadProjectDataFromCloud(cloudProject as CloudProjectRecord);
          const result = await syncProjectFromCloud({
            ...cloudProject,
            data,
          });
          return { localId: cloudProject.localId, ...result };
        }),
      );
      console.log('[CloudSync] Sync from cloud results:', results);

      if (pruneLocal) {
        const pruneResult = await pruneLocalProjectsNotInCloud(
          cloudProjects.map((project) => project.localId),
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
  }, [cloudProjects]);

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
          const storageProject = await toStorageSyncPayload(localProject);
          storageProjects.push(storageProject);
        }

        await syncMutation({ projects: storageProjects });
      });

      if (cloudProjects) {
        await runWithRetry(async () => {
          await Promise.all(
            cloudProjects.map(async (cloudProject) => {
              const data = await loadProjectDataFromCloud(cloudProject as CloudProjectRecord);
              await syncProjectFromCloud({
                ...cloudProject,
                data,
              });
            }),
          );
        });
      }
    } catch (error) {
      console.error('[CloudSync] Bidirectional sync failed:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [cloudProjects, runWithRetry, syncMutation, toStorageSyncPayload]);

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
      const payload = beaconPayloadRef.current;
      if (payload) {
        void syncPayloadToCloud(payload);
        return;
      }

      const projectId = currentProjectIdRef.current;
      if (projectId) {
        void syncProjectToCloud(projectId);
      }
    };
  }, [syncOnUnmount, syncPayloadToCloud, syncProjectToCloud]);

  // Fire-and-forget beacon for hard unload (refresh/tab close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const payload = beaconPayloadRef.current;
      const beaconUrl = getSyncBeaconUrl();

      if (!payload || !beaconUrl || typeof navigator.sendBeacon !== 'function') {
        return;
      }

      navigator.sendBeacon(beaconUrl, JSON.stringify(toBeaconSyncPayload(payload)));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return {
    syncAllToCloud,
    syncAllFromCloud,
    syncAllBidirectional,
    syncProjectToCloud,
    deleteProjectFromCloud,
    cloudProjects,
    isSyncing: isSyncingRef.current,
  };
}
