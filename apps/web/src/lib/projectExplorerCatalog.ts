import {
  createDefaultProjectExplorerState,
  createProjectExplorerProjectMeta,
  mergeProjectExplorerStates,
  normalizeProjectExplorerState,
  type ProjectExplorerFolder,
  type ProjectExplorerState,
} from '@/lib/projectExplorer';

export type StoredProjectOrigin = 'localDraft' | 'cloudCache' | 'legacyUnknown';

export interface ProjectCatalogCloudProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectCatalogLocalProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  storageOrigin: StoredProjectOrigin;
  currentThumbnailVisualSignature: string | null;
}

export interface ProjectExplorerCatalogFolderSummary extends ProjectExplorerFolder {
  projectCount: number;
}

export interface ProjectExplorerCatalogProjectSummary {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  folderId: string;
  trashedAt: number | null;
  thumbnailAssetId: string | null;
  thumbnailStale: boolean;
  thumbnailAssetMissing: boolean;
  thumbnailUrl: string | null;
}

export interface ManagedAssetLocator {
  assetId: string;
  exists: boolean;
  url: string | null;
}

export interface ProjectExplorerCatalogSnapshot {
  folders: ProjectExplorerCatalogFolderSummary[];
  projects: ProjectExplorerCatalogProjectSummary[];
  thumbnailAssetIds: string[];
}

interface BuildProjectExplorerCatalogSnapshotArgs {
  cloudExplorerState: ProjectExplorerState | null;
  cloudProjects: ProjectCatalogCloudProjectSummary[];
  hasCloudSnapshot: boolean;
  localExplorerState: ProjectExplorerState;
  localProjects: ProjectCatalogLocalProjectSummary[];
}

interface BaseCatalogProjectSummary {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  folderId: string;
  trashedAt: number | null;
  thumbnailAssetId: string | null;
  thumbnailStale: boolean;
}

interface BaseProjectExplorerCatalogSnapshot {
  folders: ProjectExplorerCatalogFolderSummary[];
  projects: BaseCatalogProjectSummary[];
  thumbnailAssetIds: string[];
}

function chooseDisplayProject(
  cloudProject: ProjectCatalogCloudProjectSummary | null,
  localProject: ProjectCatalogLocalProjectSummary | null,
): ProjectCatalogCloudProjectSummary | ProjectCatalogLocalProjectSummary | null {
  if (cloudProject && localProject) {
    return localProject.updatedAt > cloudProject.updatedAt ? localProject : cloudProject;
  }

  return cloudProject ?? localProject;
}

export function buildProjectExplorerCatalogSnapshot(
  args: BuildProjectExplorerCatalogSnapshotArgs,
): BaseProjectExplorerCatalogSnapshot {
  const localExplorerState = normalizeProjectExplorerState(args.localExplorerState);
  const cloudExplorerState = args.cloudExplorerState
    ? normalizeProjectExplorerState(args.cloudExplorerState)
    : createDefaultProjectExplorerState(localExplorerState.updatedAt);
  const mergedExplorerState = args.hasCloudSnapshot
    ? mergeProjectExplorerStates(cloudExplorerState, localExplorerState)
    : localExplorerState;

  const cloudProjectsById = new Map(args.cloudProjects.map((project) => [project.id, project]));
  const localProjectsById = new Map(args.localProjects.map((project) => [project.id, project]));
  const projectMetaByProjectId = new Map(mergedExplorerState.projects.map((projectMeta) => [projectMeta.projectId, projectMeta]));
  const visibleProjectIds = new Set(args.cloudProjects.map((project) => project.id));

  for (const localProject of args.localProjects) {
    if (!args.hasCloudSnapshot) {
      visibleProjectIds.add(localProject.id);
      continue;
    }

    if (cloudProjectsById.has(localProject.id) || localProject.storageOrigin === 'localDraft') {
      visibleProjectIds.add(localProject.id);
    }
  }

  const projectCountByFolderId = new Map<string, number>();
  const projects = Array.from(visibleProjectIds)
    .sort()
    .map((projectId) => {
      const cloudProject = cloudProjectsById.get(projectId) ?? null;
      const localProject = localProjectsById.get(projectId) ?? null;
      const displayProject = chooseDisplayProject(cloudProject, localProject);
      if (!displayProject) {
        return null;
      }

      const projectMeta = projectMetaByProjectId.get(projectId)
        ?? createProjectExplorerProjectMeta(projectId, {
          createdAt: displayProject.createdAt,
          updatedAt: displayProject.updatedAt,
        });
      const thumbnailStale = !!localProject?.currentThumbnailVisualSignature
        && (
          localProject.currentThumbnailVisualSignature !== projectMeta.thumbnailVisualSignature
          || !projectMeta.thumbnailAssetId
        );

      if (!projectMeta.trashedAt) {
        projectCountByFolderId.set(projectMeta.folderId, (projectCountByFolderId.get(projectMeta.folderId) ?? 0) + 1);
      }

      return {
        id: projectId,
        name: displayProject.name,
        createdAt: new Date(displayProject.createdAt),
        updatedAt: new Date(displayProject.updatedAt),
        folderId: projectMeta.folderId,
        trashedAt: projectMeta.trashedAt ?? null,
        thumbnailAssetId: projectMeta.thumbnailAssetId ?? null,
        thumbnailStale,
      } satisfies BaseCatalogProjectSummary;
    })
    .filter((project): project is BaseCatalogProjectSummary => project !== null);

  const folders = mergedExplorerState.folders.map((folder) => ({
    ...folder,
    projectCount: projectCountByFolderId.get(folder.id) ?? 0,
  }));
  const thumbnailAssetIds = Array.from(
    new Set(
      projects
        .map((project) => project.thumbnailAssetId)
        .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0),
    ),
  );

  return {
    folders,
    projects,
    thumbnailAssetIds,
  };
}

export function attachManagedAssetLocatorsToCatalog(
  snapshot: BaseProjectExplorerCatalogSnapshot,
  assetLocators: readonly ManagedAssetLocator[],
): ProjectExplorerCatalogSnapshot {
  const locatorByAssetId = new Map(assetLocators.map((locator) => [locator.assetId, locator]));

  return {
    folders: snapshot.folders,
    projects: snapshot.projects.map((project) => {
      const locator = project.thumbnailAssetId ? locatorByAssetId.get(project.thumbnailAssetId) ?? null : null;
      return {
        ...project,
        thumbnailAssetMissing: !!project.thumbnailAssetId && !locator?.exists,
        thumbnailUrl: locator?.url ?? null,
      };
    }),
    thumbnailAssetIds: snapshot.thumbnailAssetIds,
  };
}
