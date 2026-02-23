import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  createProjectSyncPayload,
  getAllProjectsForSync,
  getProjectForSync,
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
}

type LegacySyncPayload = Pick<
  ProjectSyncPayload,
  'localId' | 'name' | 'data' | 'createdAt' | 'updatedAt'
>;

function toLegacySyncPayload(payload: ProjectSyncPayload): LegacySyncPayload {
  return {
    localId: payload.localId,
    name: payload.name,
    data: payload.data,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
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

export function useCloudSync(options: CloudSyncOptions = {}) {
  const { syncOnMount = false, currentProjectId = null, currentProject = null } = options;

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

  const syncPayloadToCloud = useCallback(
    async (payload: ProjectSyncPayload) => {
      if (isSyncingRef.current) return;
      try {
        await syncSingleMutation(toLegacySyncPayload(payload));
      } catch (error) {
        console.error('[CloudSync] Failed to sync payload:', error);
      }
    },
    [syncSingleMutation],
  );

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
      const results = await syncMutation({ projects: localProjects.map(toLegacySyncPayload) });
      console.log('[CloudSync] Sync results:', results);
    } catch (error) {
      console.error('[CloudSync] Failed to sync to cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [syncMutation]);

  // Sync a single project to cloud by local project id
  const syncProjectToCloud = useCallback(
    async (projectId: string) => {
      if (isSyncingRef.current) return;

      try {
        const project = await getProjectForSync(projectId);
        if (!project) return;

        console.log(`[CloudSync] Syncing project "${project.name}" to cloud...`);
        const result = await syncSingleMutation(toLegacySyncPayload(project));
        console.log('[CloudSync] Single sync result:', result);
      } catch (error) {
        console.error('[CloudSync] Failed to sync project:', error);
      }
    },
    [syncSingleMutation],
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
  const syncAllFromCloud = useCallback(async () => {
    if (!cloudProjects || isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      console.log(`[CloudSync] Syncing ${cloudProjects.length} projects from cloud...`);
      const results = await Promise.all(
        cloudProjects.map(async (cloudProject) => {
          const result = await syncProjectFromCloud(cloudProject);
          return { localId: cloudProject.localId, ...result };
        }),
      );
      console.log('[CloudSync] Sync from cloud results:', results);
    } catch (error) {
      console.error('[CloudSync] Failed to sync from cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [cloudProjects]);

  // Sync on mount if requested
  useEffect(() => {
    if (syncOnMount && cloudProjects) {
      void syncAllFromCloud();
    }
  }, [syncOnMount, cloudProjects, syncAllFromCloud]);

  // Sync current project on unmount (in-app navigation)
  useEffect(() => {
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
  }, [syncPayloadToCloud, syncProjectToCloud]);

  // Fire-and-forget beacon for hard unload (refresh/tab close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      const payload = beaconPayloadRef.current;
      const beaconUrl = getSyncBeaconUrl();

      if (!payload || !beaconUrl || typeof navigator.sendBeacon !== 'function') {
        return;
      }

      navigator.sendBeacon(beaconUrl, JSON.stringify(toLegacySyncPayload(payload)));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return {
    syncAllToCloud,
    syncAllFromCloud,
    syncProjectToCloud,
    deleteProjectFromCloud,
    cloudProjects,
    isSyncing: isSyncingRef.current,
  };
}
