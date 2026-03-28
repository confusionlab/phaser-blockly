export const PROJECT_EXPLORER_STATE_VERSION = 1;
export const PROJECT_EXPLORER_RECORD_ID = 'primary';
export const PROJECT_EXPLORER_ROOT_FOLDER_ID = 'root';
export const PROJECT_EXPLORER_ROOT_FOLDER_NAME = 'Home';

export interface ProjectExplorerFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  trashedAt?: number;
}

export interface ProjectExplorerProjectMeta {
  projectId: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
  trashedAt?: number;
  thumbnailAssetId?: string;
  thumbnailVisualSignature?: string;
  thumbnailProjectUpdatedAt?: number;
}

export interface ProjectExplorerState {
  version: number;
  updatedAt: number;
  folders: ProjectExplorerFolder[];
  projects: ProjectExplorerProjectMeta[];
}

type PartialProjectExplorerFolder = Partial<ProjectExplorerFolder> & Pick<ProjectExplorerFolder, 'id'>;
type PartialProjectExplorerProjectMeta = Partial<ProjectExplorerProjectMeta> & Pick<ProjectExplorerProjectMeta, 'projectId'>;

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return undefined;
}

function normalizeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isProjectExplorerFolder(value: unknown): value is PartialProjectExplorerFolder {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';
}

function isProjectExplorerProjectMeta(value: unknown): value is PartialProjectExplorerProjectMeta {
  return !!value && typeof value === 'object' && typeof (value as { projectId?: unknown }).projectId === 'string';
}

export function createProjectExplorerRootFolder(now: number = Date.now()): ProjectExplorerFolder {
  return {
    id: PROJECT_EXPLORER_ROOT_FOLDER_ID,
    name: PROJECT_EXPLORER_ROOT_FOLDER_NAME,
    parentId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultProjectExplorerState(now: number = Date.now()): ProjectExplorerState {
  return {
    version: PROJECT_EXPLORER_STATE_VERSION,
    updatedAt: now,
    folders: [createProjectExplorerRootFolder(now)],
    projects: [],
  };
}

export function createProjectExplorerFolder(
  id: string,
  name: string,
  parentId: string | null,
  now: number = Date.now(),
): ProjectExplorerFolder {
  return {
    id,
    name: normalizeName(name, 'New folder'),
    parentId,
    createdAt: now,
    updatedAt: now,
  };
}

export function createProjectExplorerProjectMeta(
  projectId: string,
  options: {
    createdAt?: number;
    folderId?: string;
    updatedAt?: number;
  } = {},
): ProjectExplorerProjectMeta {
  const now = normalizeTimestamp(options.updatedAt, Date.now());
  return {
    projectId: normalizeId(projectId, crypto.randomUUID()),
    folderId: normalizeId(options.folderId, PROJECT_EXPLORER_ROOT_FOLDER_ID),
    createdAt: normalizeTimestamp(options.createdAt, now),
    updatedAt: now,
  };
}

export function normalizeProjectExplorerState(value: unknown): ProjectExplorerState {
  const now = Date.now();
  const maybe = value && typeof value === 'object' ? (value as Partial<ProjectExplorerState>) : undefined;
  const foldersById = new Map<string, ProjectExplorerFolder>();

  const rawFolders = Array.isArray(maybe?.folders) ? maybe?.folders : [];
  for (const rawFolder of rawFolders) {
    if (!isProjectExplorerFolder(rawFolder)) {
      continue;
    }
    const createdAt = normalizeTimestamp(rawFolder.createdAt, now);
    const updatedAt = normalizeTimestamp(rawFolder.updatedAt, createdAt);
    const folder: ProjectExplorerFolder = {
      id: normalizeId(rawFolder.id, crypto.randomUUID()),
      name: normalizeName(rawFolder.name, 'Untitled folder'),
      parentId:
        normalizeId(rawFolder.id, '') === PROJECT_EXPLORER_ROOT_FOLDER_ID
          ? null
          : rawFolder.parentId === null
            ? PROJECT_EXPLORER_ROOT_FOLDER_ID
            : typeof rawFolder.parentId === 'string'
              ? rawFolder.parentId
              : PROJECT_EXPLORER_ROOT_FOLDER_ID,
      createdAt,
      updatedAt,
      trashedAt: normalizeOptionalTimestamp(rawFolder.trashedAt),
    };
    foldersById.set(folder.id, folder);
  }

  const existingRoot = foldersById.get(PROJECT_EXPLORER_ROOT_FOLDER_ID);
  foldersById.set(PROJECT_EXPLORER_ROOT_FOLDER_ID, {
    ...(existingRoot ?? createProjectExplorerRootFolder(now)),
    id: PROJECT_EXPLORER_ROOT_FOLDER_ID,
    name: PROJECT_EXPLORER_ROOT_FOLDER_NAME,
    parentId: null,
    trashedAt: undefined,
  });

  const folders = Array.from(foldersById.values()).map((folder) => {
    if (folder.id === PROJECT_EXPLORER_ROOT_FOLDER_ID) {
      return {
        ...folder,
        parentId: null,
        trashedAt: undefined,
      };
    }

    if (!folder.parentId || !foldersById.has(folder.parentId) || folder.parentId === folder.id) {
      return {
        ...folder,
        parentId: PROJECT_EXPLORER_ROOT_FOLDER_ID,
      };
    }

    return folder;
  });

  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const projectsById = new Map<string, ProjectExplorerProjectMeta>();
  const rawProjects = Array.isArray(maybe?.projects) ? maybe?.projects : [];
  for (const rawProject of rawProjects) {
    if (!isProjectExplorerProjectMeta(rawProject)) {
      continue;
    }
    const createdAt = normalizeTimestamp(rawProject.createdAt, now);
    const updatedAt = normalizeTimestamp(rawProject.updatedAt, createdAt);
    const nextProject: ProjectExplorerProjectMeta = {
      projectId: normalizeId(rawProject.projectId, crypto.randomUUID()),
      folderId:
        typeof rawProject.folderId === 'string' && validFolderIds.has(rawProject.folderId)
          ? rawProject.folderId
          : PROJECT_EXPLORER_ROOT_FOLDER_ID,
      createdAt,
      updatedAt,
      trashedAt: normalizeOptionalTimestamp(rawProject.trashedAt),
      thumbnailAssetId: normalizeOptionalNonEmptyString(rawProject.thumbnailAssetId),
      thumbnailVisualSignature: normalizeOptionalNonEmptyString(rawProject.thumbnailVisualSignature),
      thumbnailProjectUpdatedAt: normalizeOptionalTimestamp(rawProject.thumbnailProjectUpdatedAt),
    };
    projectsById.set(nextProject.projectId, nextProject);
  }

  return {
    version: normalizeTimestamp(maybe?.version, PROJECT_EXPLORER_STATE_VERSION),
    updatedAt: normalizeTimestamp(maybe?.updatedAt, now),
    folders: folders.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    projects: Array.from(projectsById.values()).sort(
      (left, right) => left.createdAt - right.createdAt || left.projectId.localeCompare(right.projectId),
    ),
  };
}

export function collectProjectExplorerAssetIds(state: ProjectExplorerState): string[] {
  return Array.from(
    new Set(
      state.projects
        .map((project) => project.thumbnailAssetId)
        .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0),
    ),
  );
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  const normalizedLeft = left ?? Number.NEGATIVE_INFINITY;
  const normalizedRight = right ?? Number.NEGATIVE_INFINITY;
  return normalizedLeft - normalizedRight;
}

function compareOptionalString(left: string | undefined, right: string | undefined): number {
  return (left ?? '').localeCompare(right ?? '');
}

function pickNewerFolder(left: ProjectExplorerFolder, right: ProjectExplorerFolder): ProjectExplorerFolder {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right;
  }
  if (compareOptionalNumber(left.trashedAt, right.trashedAt) !== 0) {
    return compareOptionalNumber(left.trashedAt, right.trashedAt) > 0 ? left : right;
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name) > 0 ? left : right;
  }
  return left.id.localeCompare(right.id) >= 0 ? left : right;
}

function pickNewerProjectMeta(
  left: ProjectExplorerProjectMeta,
  right: ProjectExplorerProjectMeta,
): ProjectExplorerProjectMeta {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right;
  }
  if (compareOptionalNumber(left.trashedAt, right.trashedAt) !== 0) {
    return compareOptionalNumber(left.trashedAt, right.trashedAt) > 0 ? left : right;
  }
  if (compareOptionalString(left.thumbnailVisualSignature, right.thumbnailVisualSignature) !== 0) {
    return compareOptionalString(left.thumbnailVisualSignature, right.thumbnailVisualSignature) > 0 ? left : right;
  }
  if (compareOptionalNumber(left.thumbnailProjectUpdatedAt, right.thumbnailProjectUpdatedAt) !== 0) {
    return compareOptionalNumber(left.thumbnailProjectUpdatedAt, right.thumbnailProjectUpdatedAt) > 0 ? left : right;
  }
  if ((left.thumbnailAssetId ?? '') !== (right.thumbnailAssetId ?? '')) {
    return (left.thumbnailAssetId ?? '').localeCompare(right.thumbnailAssetId ?? '') > 0 ? left : right;
  }
  return left.projectId.localeCompare(right.projectId) >= 0 ? left : right;
}

export function mergeProjectExplorerStates(
  leftInput: unknown,
  rightInput: unknown,
): ProjectExplorerState {
  const left = normalizeProjectExplorerState(leftInput);
  const right = normalizeProjectExplorerState(rightInput);

  const foldersById = new Map<string, ProjectExplorerFolder>();
  for (const folder of [...left.folders, ...right.folders]) {
    const existing = foldersById.get(folder.id);
    foldersById.set(folder.id, existing ? pickNewerFolder(existing, folder) : folder);
  }

  const projectsById = new Map<string, ProjectExplorerProjectMeta>();
  for (const project of [...left.projects, ...right.projects]) {
    const existing = projectsById.get(project.projectId);
    projectsById.set(project.projectId, existing ? pickNewerProjectMeta(existing, project) : project);
  }

  return normalizeProjectExplorerState({
    version: Math.max(left.version, right.version, PROJECT_EXPLORER_STATE_VERSION),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    folders: Array.from(foldersById.values()),
    projects: Array.from(projectsById.values()),
  });
}

export function collectProjectExplorerFolderSubtreeIds(
  folders: readonly ProjectExplorerFolder[],
  rootFolderId: string,
): Set<string> {
  const childFolderIdsByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) {
      continue;
    }
    const childIds = childFolderIdsByParent.get(folder.parentId) ?? [];
    childIds.push(folder.id);
    childFolderIdsByParent.set(folder.parentId, childIds);
  }

  const visited = new Set<string>();
  const queue = [rootFolderId];
  while (queue.length > 0) {
    const folderId = queue.shift();
    if (!folderId || visited.has(folderId)) {
      continue;
    }
    visited.add(folderId);
    for (const childFolderId of childFolderIdsByParent.get(folderId) ?? []) {
      if (!visited.has(childFolderId)) {
        queue.push(childFolderId);
      }
    }
  }

  return visited;
}

export function isProjectExplorerDescendantFolder(
  folders: readonly ProjectExplorerFolder[],
  folderId: string,
  candidateAncestorId: string,
): boolean {
  if (folderId === candidateAncestorId) {
    return true;
  }

  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  let cursor = foldersById.get(folderId) ?? null;
  const visited = new Set<string>();
  while (cursor && cursor.parentId && !visited.has(cursor.id)) {
    if (cursor.parentId === candidateAncestorId) {
      return true;
    }
    visited.add(cursor.id);
    cursor = foldersById.get(cursor.parentId) ?? null;
  }
  return false;
}
