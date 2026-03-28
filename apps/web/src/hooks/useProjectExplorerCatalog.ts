import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';

import { api } from '@convex-generated/api';
import {
  getLocalProjectCatalogSnapshot,
  getManagedAssetLocators,
  pruneLocalProjectsNotInCloud,
  reconcileStoredProjectOriginsWithCloud,
  type LocalProjectCatalogSnapshot,
} from '@/db/database';
import {
  attachManagedAssetLocatorsToCatalog,
  buildProjectExplorerCatalogSnapshot,
  type ManagedAssetLocator,
  type ProjectCatalogCloudProjectSummary,
  type ProjectExplorerCatalogSnapshot,
} from '@/lib/projectExplorerCatalog';
import { createDefaultProjectExplorerState, normalizeProjectExplorerState } from '@/lib/projectExplorer';
import { useProjectStore } from '@/store/projectStore';

type CloudProjectExplorerCatalogRecord = {
  updatedAt: number;
  folders: unknown[];
  projects: unknown[];
  assetIds: string[];
} | null;

export function useProjectExplorerCatalog(): {
  data: ProjectExplorerCatalogSnapshot;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
} {
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const cloudProjects = useQuery(api.projects.list, isConvexAuthenticated ? {} : 'skip');
  const cloudExplorerCatalog = useQuery(api.projectExplorer.getCatalog, isConvexAuthenticated ? {} : 'skip');
  const currentProjectId = useProjectStore((state) => state.project?.id ?? null);
  const [localSnapshot, setLocalSnapshot] = useState<LocalProjectCatalogSnapshot | null>(null);
  const [assetLocators, setAssetLocators] = useState<ManagedAssetLocator[]>([]);
  const [isReconcilingLocalCache, setIsReconcilingLocalCache] = useState(false);

  const refresh = useCallback(async () => {
    const snapshot = await getLocalProjectCatalogSnapshot();
    setLocalSnapshot(snapshot);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasLoadedCloudCatalog = !isConvexAuthenticated
    || (cloudProjects !== undefined && cloudExplorerCatalog !== undefined);

  useEffect(() => {
    if (!isConvexAuthenticated || !hasLoadedCloudCatalog || cloudProjects === undefined) {
      return;
    }

    let cancelled = false;
    setIsReconcilingLocalCache(true);
    void (async () => {
      const cloudProjectIds = cloudProjects.map((project) => project.localId);
      const changed = await reconcileStoredProjectOriginsWithCloud(
        cloudProjectIds,
      );
      const pruneResult = await pruneLocalProjectsNotInCloud(cloudProjectIds, {
        excludeIds: currentProjectId ? [currentProjectId] : [],
      });
      if (changed || pruneResult.deleted > 0) {
        await refresh();
      }
      if (!cancelled) {
        setIsReconcilingLocalCache(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cloudProjects, currentProjectId, hasLoadedCloudCatalog, isConvexAuthenticated, refresh]);

  const baseCatalog = useMemo(() => {
    const local = localSnapshot ?? {
      explorerState: createDefaultProjectExplorerState(),
      projects: [],
    };
    const cloudProjectSummaries: ProjectCatalogCloudProjectSummary[] = (cloudProjects ?? []).map((project) => ({
      id: project.localId,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
    const cloudExplorerSnapshot = cloudExplorerCatalog as CloudProjectExplorerCatalogRecord;
    const cloudExplorerState = cloudExplorerSnapshot
      ? normalizeProjectExplorerState({
          updatedAt: cloudExplorerSnapshot.updatedAt,
          folders: cloudExplorerSnapshot.folders,
          projects: cloudExplorerSnapshot.projects,
        })
      : null;

    return buildProjectExplorerCatalogSnapshot({
      cloudExplorerState,
      cloudProjects: cloudProjectSummaries,
      hasCloudSnapshot: isConvexAuthenticated && hasLoadedCloudCatalog,
      localExplorerState: local.explorerState,
      localProjects: local.projects,
    });
  }, [cloudExplorerCatalog, cloudProjects, hasLoadedCloudCatalog, isConvexAuthenticated, localSnapshot]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextLocators = await getManagedAssetLocators(baseCatalog.thumbnailAssetIds);
      if (!cancelled) {
        setAssetLocators(nextLocators);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseCatalog, localSnapshot]);

  const data = useMemo(
    () => attachManagedAssetLocatorsToCatalog(baseCatalog, assetLocators),
    [assetLocators, baseCatalog],
  );

  const isInitialLoading = localSnapshot === null;
  const isRefreshing = localSnapshot !== null && (!hasLoadedCloudCatalog || isReconcilingLocalCache);

  return {
    data,
    isInitialLoading,
    isRefreshing,
    refresh,
  };
}
