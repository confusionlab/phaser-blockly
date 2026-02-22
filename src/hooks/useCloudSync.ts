import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { getAllProjectsForSync, syncProjectFromCloud, getProjectForSync } from '@/db/database';

interface CloudSyncOptions {
  syncOnMount?: boolean;
  currentProjectId?: string | null;
}

export function useCloudSync(options: CloudSyncOptions = {}) {
  const { syncOnMount = false, currentProjectId = null } = options;

  const syncMutation = useMutation(api.projects.syncBatch);
  const syncSingleMutation = useMutation(api.projects.sync);
  const removeProjectMutation = useMutation(api.projects.remove);
  const cloudProjects = useQuery(api.projects.listFull);

  const isSyncingRef = useRef(false);
  const currentProjectIdRef = useRef(currentProjectId);
  currentProjectIdRef.current = currentProjectId;

  const syncAllToCloud = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      const localProjects = await getAllProjectsForSync();
      if (localProjects.length > 0) {
        await syncMutation({ projects: localProjects });
      }
    } catch (error) {
      console.error('[CloudSync] Failed to sync to cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [syncMutation]);

  const syncProjectToCloud = useCallback(async (projectId: string) => {
    if (isSyncingRef.current) return;
    try {
      const project = await getProjectForSync(projectId);
      if (project) {
        await syncSingleMutation(project);
      }
    } catch (error) {
      console.error('[CloudSync] Failed to sync project:', error);
    }
  }, [syncSingleMutation]);

  const deleteProjectFromCloud = useCallback(async (projectId: string) => {
    try {
      await removeProjectMutation({ localId: projectId });
    } catch (error) {
      console.error('[CloudSync] Failed to delete project from cloud:', error);
    }
  }, [removeProjectMutation]);

  const syncAllFromCloud = useCallback(async () => {
    if (!cloudProjects || isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      await Promise.all(cloudProjects.map(async (cp) => syncProjectFromCloud(cp)));
    } catch (error) {
      console.error('[CloudSync] Failed to sync from cloud:', error);
    } finally {
      isSyncingRef.current = false;
    }
  }, [cloudProjects]);

  useEffect(() => {
    if (syncOnMount && cloudProjects) {
      void syncAllFromCloud();
    }
  }, [syncOnMount, cloudProjects, syncAllFromCloud]);

  useEffect(() => {
    return () => {
      const projectId = currentProjectIdRef.current;
      if (projectId) {
        void syncProjectToCloud(projectId);
      }
    };
  }, [syncProjectToCloud]);

  useEffect(() => {
    const handleVisibilityOrPageHide = () => {
      const projectId = currentProjectIdRef.current;
      if (projectId && document.visibilityState === 'hidden') {
        void syncProjectToCloud(projectId);
      }
    };

    window.addEventListener('pagehide', handleVisibilityOrPageHide);
    document.addEventListener('visibilitychange', handleVisibilityOrPageHide);

    return () => {
      window.removeEventListener('pagehide', handleVisibilityOrPageHide);
      document.removeEventListener('visibilitychange', handleVisibilityOrPageHide);
    };
  }, [syncProjectToCloud]);

  return {
    syncAllToCloud,
    syncAllFromCloud,
    syncProjectToCloud,
    deleteProjectFromCloud,
    cloudProjects,
    isSyncing: isSyncingRef.current,
  };
}
