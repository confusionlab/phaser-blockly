import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvexAuth, useMutation } from 'convex/react';
import { UserProfile } from '@clerk/clerk-react';
import { api } from '@convex-generated/api';
import {
  ArrowLeft,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  ImageOff,
  Loader2,
  MoreHorizontal,
  Palette,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
  User,
} from '@/components/ui/icons';

import {
  createProjectFolder,
  ensureProjectThumbnail,
  importProjectFromFile,
  moveProjectFolder,
  moveProjectToFolder,
  renameProjectFolder,
  renameStoredProject,
  restoreProjectFolder,
  restoreProjectFromExplorer,
  saveProject,
  trashProjectFolder,
  trashProjectFromExplorer,
} from '@/db/database';
import { useProjectExplorerCatalog } from '@/hooks/useProjectExplorerCatalog';
import { useCloudSync } from '@/hooks/useCloudSync';
import { compareProjectsByLastEdited, type ProjectExplorerCatalogFolderSummary } from '@/lib/projectExplorerCatalog';
import { PROJECT_EXPLORER_ROOT_FOLDER_ID } from '@/lib/projectExplorer';
import { useClerkAppearance } from '@/lib/useClerkAppearance';
import { useEditorStore } from '@/store/editorStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NameInputDialog } from '@/components/dialogs/NameInputDialog';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  CollectionSelectionCheckbox,
  CollectionViewControls,
  collectionCardClassName,
  collectionRowClassName,
} from '@/components/shared/CollectionBrowserChrome';
import { createDefaultProject } from '@/types';

type ExplorerKey = `folder:${string}` | `project:${string}`;

type VisibleItem =
  | {
      id: string;
      key: ExplorerKey;
      kind: 'folder';
      label: string;
      updatedAt: number;
    }
  | {
      id: string;
      key: ExplorerKey;
      kind: 'project';
      label: string;
      updatedAt: number;
      thumbnailAssetMissing: boolean;
      thumbnailUrl: string | null;
      staleThumbnail: boolean;
    };

type PendingTrashConfirmation =
  | {
      folderIds: string[];
      heading: string;
      projectIds: string[];
    }
  | null;

type ExplorerViewMode = 'row' | 'card';
type RenameDialogState = {
  id: string;
  kind: VisibleItem['kind'];
  label: string;
};

type ProjectExplorerPageProps = {
  authBootstrapState?: 'steady' | 'reconnecting';
  onProjectOpen?: (project: { id: string }) => void;
};

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatExplorerTimestamp(date: Date): string {
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return isSameDay ? timeFormatter.format(date) : dateFormatter.format(date);
}

function getSelectionRange(orderedKeys: ExplorerKey[], fromKey: ExplorerKey, toKey: ExplorerKey): ExplorerKey[] {
  const fromIndex = orderedKeys.indexOf(fromKey);
  const toIndex = orderedKeys.indexOf(toKey);

  if (fromIndex < 0 || toIndex < 0) {
    return [toKey];
  }

  const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
  return orderedKeys.slice(start, end + 1);
}

function ExplorerLoadingRows() {
  return (
    <div className="flex h-full min-h-[280px] flex-col">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={`loading-row:${index}`}
          className="flex items-center gap-4 border-b border-border/70 px-4 py-3"
        >
          <div className="h-16 w-28 shrink-0 animate-pulse rounded-2xl bg-muted/80 dark:bg-muted/60" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded-full bg-muted/80 dark:bg-muted/60" />
            <div className="h-3 w-24 animate-pulse rounded-full bg-muted/55 dark:bg-muted/40" />
          </div>
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted/55 dark:bg-muted/40" />
        </div>
      ))}
    </div>
  );
}

function ExplorerLoadingCards() {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={`loading-card:${index}`}
          className="overflow-hidden rounded-[24px] border border-border/70 bg-surface-floating"
        >
          <div className="aspect-[16/10] animate-pulse bg-muted/75 dark:bg-muted/55" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-muted/80 dark:bg-muted/60" />
            <div className="h-3 w-1/3 animate-pulse rounded-full bg-muted/55 dark:bg-muted/40" />
            <div className="h-8 w-full animate-pulse rounded-2xl bg-muted/55 dark:bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProjectExplorerPage({
  authBootstrapState = 'steady',
  onProjectOpen,
}: ProjectExplorerPageProps) {
  const clerkAppearance = useClerkAppearance();
  const isDarkMode = useEditorStore((state) => state.isDarkMode);
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const updateMySettings = useMutation(api.userSettings.updateMySettings);
  const {
    ensureManagedAssetsAvailableLocally,
    syncProjectExplorerToCloud,
    syncProjectToCloud,
  } = useCloudSync({
    syncOnMount: false,
    enableCloudProjectListQuery: false,
  });

  const queueExplorerCloudSync = useCallback(() => {
    if (!isConvexAuthenticated) {
      return;
    }
    void syncProjectExplorerToCloud();
  }, [isConvexAuthenticated, syncProjectExplorerToCloud]);

  const queueProjectCloudSync = useCallback((projectId: string) => {
    if (!isConvexAuthenticated) {
      return;
    }
    void syncProjectToCloud(projectId);
  }, [isConvexAuthenticated, syncProjectToCloud]);

  const handleToggleDarkMode = useCallback(async () => {
    const nextIsDarkMode = !isDarkMode;
    useEditorStore.getState().toggleDarkMode();

    if (!isConvexAuthenticated) {
      return;
    }

    try {
      await updateMySettings({ isDarkMode: nextIsDarkMode });
    } catch (error) {
      console.error('[UserSettings] Failed to persist dark mode setting from home:', error);
    }
  }, [isConvexAuthenticated, isDarkMode, updateMySettings]);

  const {
    data: explorerCatalog,
    isInitialLoading,
    isRefreshing,
    refresh: refreshExplorer,
  } = useProjectExplorerCatalog();
  const isExplorerMutationLocked = authBootstrapState === 'reconnecting' || isRefreshing;
  const isExplorerInteractionBlocked = isInitialLoading;
  const isExplorerReadOnly = isExplorerMutationLocked || isExplorerInteractionBlocked;
  const [isOpeningProjectId, setIsOpeningProjectId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string>(PROJECT_EXPLORER_ROOT_FOLDER_ID);
  const [selectionMode, setSelectionMode] = useState(false);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>('card');
  const [selectedKeys, setSelectedKeys] = useState<ExplorerKey[]>([]);
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<ExplorerKey | null>(null);
  const [renameDialogState, setRenameDialogState] = useState<RenameDialogState | null>(null);
  const [renameDialogValue, setRenameDialogValue] = useState('');
  const [renameDialogError, setRenameDialogError] = useState<string | null>(null);
  const [isEditingCurrentFolder, setIsEditingCurrentFolder] = useState(false);
  const [currentFolderNameDraft, setCurrentFolderNameDraft] = useState('');
  const [dragKeys, setDragKeys] = useState<ExplorerKey[]>([]);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pendingTrashConfirmation, setPendingTrashConfirmation] = useState<PendingTrashConfirmation>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const explorerShellRef = useRef<HTMLElement | null>(null);
  const explorerListRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { folders, projects } = explorerCatalog;

  const activeFolders = useMemo(
    () => folders.filter((folder) => !folder.trashedAt),
    [folders],
  );
  const trashedFolders = useMemo(
    () => folders.filter((folder) => !!folder.trashedAt && folder.id !== PROJECT_EXPLORER_ROOT_FOLDER_ID),
    [folders],
  );
  const activeProjects = useMemo(
    () => projects.filter((project) => !project.trashedAt),
    [projects],
  );
  const trashedProjects = useMemo(
    () => projects.filter((project) => !!project.trashedAt),
    [projects],
  );
  const foldersById = useMemo(
    () => new Map(activeFolders.map((folder) => [folder.id, folder])),
    [activeFolders],
  );

  const currentFolder = foldersById.get(currentFolderId) ?? foldersById.get(PROJECT_EXPLORER_ROOT_FOLDER_ID) ?? null;
  const currentFolderSafeId = currentFolder?.id ?? PROJECT_EXPLORER_ROOT_FOLDER_ID;

  useEffect(() => {
    if (!currentFolder && foldersById.has(PROJECT_EXPLORER_ROOT_FOLDER_ID)) {
      setCurrentFolderId(PROJECT_EXPLORER_ROOT_FOLDER_ID);
    }
  }, [currentFolder, foldersById]);

  const parentFolder = currentFolder?.parentId ? foldersById.get(currentFolder.parentId) ?? null : null;

  const breadcrumbFolders = useMemo(() => {
    if (!currentFolder) {
      return [];
    }

    const path: ProjectExplorerCatalogFolderSummary[] = [];
    const visited = new Set<string>();
    let cursor: ProjectExplorerCatalogFolderSummary | null = currentFolder;
    while (cursor && !visited.has(cursor.id)) {
      path.unshift(cursor);
      visited.add(cursor.id);
      cursor = cursor.parentId ? foldersById.get(cursor.parentId) ?? null : null;
    }
    return path;
  }, [currentFolder, foldersById]);

  const visibleFolders = useMemo(
    () =>
      activeFolders
        .filter((folder) => folder.parentId === currentFolderSafeId && folder.id !== PROJECT_EXPLORER_ROOT_FOLDER_ID)
        .sort((left, right) => getSortLabel(left.name).localeCompare(getSortLabel(right.name))),
    [activeFolders, currentFolderSafeId],
  );

  const visibleProjects = useMemo(
    () =>
      activeProjects
        .filter((project) => project.folderId === currentFolderSafeId)
        .sort(compareProjectsByLastEdited),
    [activeProjects, currentFolderSafeId],
  );

  const visibleItems = useMemo<VisibleItem[]>(
    () => [
      ...visibleFolders.map((folder) => ({
        id: folder.id,
        key: `folder:${folder.id}` as const,
        kind: 'folder' as const,
        label: folder.name,
        updatedAt: folder.updatedAt,
      })),
      ...visibleProjects.map((project) => ({
        id: project.id,
        key: `project:${project.id}` as const,
        kind: 'project' as const,
        label: project.name,
        updatedAt: project.updatedAt.getTime(),
        thumbnailAssetMissing: project.thumbnailAssetMissing,
        thumbnailUrl: project.thumbnailUrl,
        staleThumbnail: project.thumbnailStale,
      })),
    ],
    [visibleFolders, visibleProjects],
  );

  const visibleKeySet = useMemo(
    () => new Set(visibleItems.map((item) => item.key)),
    [visibleItems],
  );

  useEffect(() => {
    setSelectedKeys((current) => current.filter((key) => visibleKeySet.has(key)));
    setSelectionAnchorKey((current) => (current && visibleKeySet.has(current) ? current : null));
  }, [visibleKeySet]);

  useEffect(() => {
    if (currentFolderSafeId === PROJECT_EXPLORER_ROOT_FOLDER_ID) {
      setIsEditingCurrentFolder(false);
      setCurrentFolderNameDraft('');
    }
  }, [currentFolderSafeId]);

  const clearSelection = useCallback(() => {
    setSelectedKeys([]);
    setSelectionAnchorKey(null);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    clearSelection();
  }, [clearSelection]);

  useEffect(() => {
    if (!isExplorerReadOnly) {
      return;
    }

    exitSelectionMode();
    setRenameDialogState(null);
    setRenameDialogValue('');
    setRenameDialogError(null);
    setIsEditingCurrentFolder(false);
    setCurrentFolderNameDraft('');
    setDragKeys([]);
    setDropFolderId(null);
    setAccountOpen(false);
    setTrashOpen(false);
    setPendingTrashConfirmation(null);
  }, [exitSelectionMode, isExplorerReadOnly]);

  const staleVisibleProjects = useMemo(
    () => visibleProjects.filter((project) => project.thumbnailStale),
    [visibleProjects],
  );

  const missingVisibleThumbnailAssetIds = useMemo(
    () => visibleProjects
      .filter((project) => project.thumbnailAssetMissing && !project.thumbnailStale && project.thumbnailAssetId)
      .map((project) => project.thumbnailAssetId as string),
    [visibleProjects],
  );

  useEffect(() => {
    if (!isConvexAuthenticated || missingVisibleThumbnailAssetIds.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      await ensureManagedAssetsAvailableLocally(missingVisibleThumbnailAssetIds.slice(0, 8));
      if (!cancelled) {
        await refreshExplorer();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ensureManagedAssetsAvailableLocally, isConvexAuthenticated, missingVisibleThumbnailAssetIds, refreshExplorer]);

  useEffect(() => {
    if (staleVisibleProjects.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const project of staleVisibleProjects.slice(0, 4)) {
        if (cancelled) {
          return;
        }
        await ensureProjectThumbnail(project.id);
      }
      if (!cancelled) {
        await refreshExplorer();
        queueExplorerCloudSync();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queueExplorerCloudSync, refreshExplorer, staleVisibleProjects]);

  const requestTrashForKeys = useCallback((keys: ExplorerKey[]) => {
    const folderIds = keys
      .filter((key): key is `folder:${string}` => key.startsWith('folder:'))
      .map((key) => key.slice('folder:'.length));
    const projectIds = keys
      .filter((key): key is `project:${string}` => key.startsWith('project:'))
      .map((key) => key.slice('project:'.length));

    if (folderIds.length === 0 && projectIds.length === 0) {
      return;
    }

    setPendingTrashConfirmation({
      folderIds,
      heading: 'Move selected items to trash?',
      projectIds,
    });
  }, []);

  const requestTrashForSelection = useCallback(async () => {
    if (isExplorerReadOnly) {
      return;
    }

    requestTrashForKeys(selectedKeys);
  }, [isExplorerReadOnly, requestTrashForKeys, selectedKeys]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (explorerShellRef.current?.contains(event.target as Node)) {
        return;
      }

      exitSelectionMode();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }

      if (event.key === 'Escape') {
        exitSelectionMode();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedKeys.length > 0) {
        event.preventDefault();
        void requestTrashForSelection();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [exitSelectionMode, requestTrashForSelection, selectedKeys.length, selectionMode]);

  const handleSelectKey = useCallback((key: ExplorerKey, event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => {
    if (isExplorerReadOnly) {
      return;
    }

    if (!selectionMode) {
      setSelectionMode(true);
    }

    const orderedKeys = visibleItems.map((item) => item.key);
    const append = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;

    if (range && selectionAnchorKey) {
      const rangeKeys = getSelectionRange(orderedKeys, selectionAnchorKey, key);
      setSelectedKeys((current) => Array.from(new Set([...current, ...rangeKeys])));
      setSelectionAnchorKey(key);
      return;
    }

    if (selectionMode) {
      setSelectedKeys((current) => (
        current.includes(key)
          ? current.filter((currentKey) => currentKey !== key)
          : [...current, key]
      ));
      setSelectionAnchorKey(key);
      return;
    }

    setSelectedKeys((current) => {
      if (append) {
        return current.includes(key)
          ? current.filter((currentKey) => currentKey !== key)
          : [...current, key];
      }

      return current.includes(key) && current.length === 1 ? [] : [key];
    });
    setSelectionAnchorKey(key);
  }, [isExplorerReadOnly, selectionAnchorKey, selectionMode, visibleItems]);

  const handleOpenProject = useCallback(async (projectId: string) => {
    if (isExplorerReadOnly) {
      return;
    }

    setIsOpeningProjectId(projectId);
    setImportError(null);
    try {
      onProjectOpen?.({ id: projectId });
    } finally {
      setIsOpeningProjectId(null);
    }
  }, [isExplorerReadOnly, onProjectOpen]);

  const handleCreateProject = useCallback(async () => {
    if (isExplorerReadOnly) {
      return;
    }

    const nextIndex = visibleProjects.length + 1;
    const projectName = `Untitled project ${nextIndex}`;
    const createdProject = createDefaultProject(projectName);
    const savedProject = await saveProject(createdProject);
    await moveProjectToFolder(savedProject.id, currentFolderSafeId);
    queueProjectCloudSync(savedProject.id);
    void (async () => {
      await ensureProjectThumbnail(savedProject.id);
      queueExplorerCloudSync();
    })();
    onProjectOpen?.({ id: savedProject.id });
  }, [currentFolderSafeId, isExplorerReadOnly, onProjectOpen, queueExplorerCloudSync, queueProjectCloudSync, visibleProjects.length]);

  const handleCreateFolder = useCallback(async () => {
    if (isExplorerReadOnly) {
      return;
    }

    const folderName = `New folder ${visibleFolders.length + 1}`;
    const folderId = await createProjectFolder(folderName, currentFolderSafeId);
    await refreshExplorer();
    setRenameDialogState({
      id: folderId,
      kind: 'folder',
      label: folderName,
    });
    setRenameDialogValue(folderName);
    setRenameDialogError(null);
    queueExplorerCloudSync();
  }, [currentFolderSafeId, isExplorerReadOnly, queueExplorerCloudSync, refreshExplorer, visibleFolders.length]);

  const handleImportProject = useCallback(async (file: File) => {
    if (isExplorerReadOnly) {
      return;
    }

    setImportError(null);
    try {
      const project = await importProjectFromFile(file);
      await moveProjectToFolder(project.id, currentFolderSafeId);
      queueProjectCloudSync(project.id);
      void (async () => {
        await ensureProjectThumbnail(project.id);
        await refreshExplorer();
        queueExplorerCloudSync();
      })();
      onProjectOpen?.({ id: project.id });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import project');
    }
  }, [currentFolderSafeId, isExplorerReadOnly, onProjectOpen, queueExplorerCloudSync, queueProjectCloudSync, refreshExplorer]);

  const handleRenameDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      return;
    }
    setRenameDialogState(null);
    setRenameDialogValue('');
    setRenameDialogError(null);
  }, []);

  const openRenameDialog = useCallback((item: VisibleItem) => {
    if (isExplorerReadOnly) {
      return;
    }
    setRenameDialogState({
      id: item.id,
      kind: item.kind,
      label: item.label,
    });
    setRenameDialogValue(item.label);
    setRenameDialogError(null);
  }, [isExplorerReadOnly]);

  const submitRenameDialog = useCallback(async () => {
    if (!renameDialogState || isExplorerReadOnly) {
      return;
    }

    const nextValue = renameDialogValue.trim();
    if (!nextValue) {
      setRenameDialogError('Name cannot be empty.');
      return;
    }

    try {
      if (renameDialogState.kind === 'folder') {
        await renameProjectFolder(renameDialogState.id, nextValue);
        queueExplorerCloudSync();
      } else {
        const changed = await renameStoredProject(renameDialogState.id, nextValue);
        if (changed) {
          queueProjectCloudSync(renameDialogState.id);
        }
      }

      await refreshExplorer();
      setRenameDialogState(null);
      setRenameDialogValue('');
      setRenameDialogError(null);
    } catch (error) {
      setRenameDialogError(error instanceof Error ? error.message : 'Failed to rename item.');
    }
  }, [isExplorerReadOnly, queueExplorerCloudSync, queueProjectCloudSync, refreshExplorer, renameDialogState, renameDialogValue]);

  const commitCurrentFolderRename = useCallback(async () => {
    if (isExplorerReadOnly) {
      return;
    }

    const nextValue = currentFolderNameDraft.trim();
    if (!currentFolder || !nextValue || currentFolder.id === PROJECT_EXPLORER_ROOT_FOLDER_ID) {
      setIsEditingCurrentFolder(false);
      setCurrentFolderNameDraft('');
      return;
    }

    await renameProjectFolder(currentFolder.id, nextValue);
    await refreshExplorer();
    setIsEditingCurrentFolder(false);
    setCurrentFolderNameDraft('');
    queueExplorerCloudSync();
  }, [currentFolder, currentFolderNameDraft, isExplorerReadOnly, queueExplorerCloudSync, refreshExplorer]);

  const handleTrashProject = useCallback((projectId: string) => {
    setPendingTrashConfirmation({
      folderIds: [],
      heading: 'Move this project to trash?',
      projectIds: [projectId],
    });
  }, []);

  const handleTrashFolder = useCallback((folderId: string) => {
    setPendingTrashConfirmation({
      folderIds: [folderId],
      heading: 'Move this folder and everything inside it to trash?',
      projectIds: [],
    });
  }, []);

  const confirmTrash = useCallback(async () => {
    if (!pendingTrashConfirmation || isExplorerReadOnly) {
      return;
    }

    for (const folderId of pendingTrashConfirmation.folderIds) {
      await trashProjectFolder(folderId);
    }
    for (const projectId of pendingTrashConfirmation.projectIds) {
      await trashProjectFromExplorer(projectId);
    }

    setPendingTrashConfirmation(null);
    exitSelectionMode();
    await refreshExplorer();
    queueExplorerCloudSync();
  }, [exitSelectionMode, isExplorerReadOnly, pendingTrashConfirmation, queueExplorerCloudSync, refreshExplorer]);

  const handleRestoreProject = useCallback(async (projectId: string) => {
    if (isExplorerReadOnly) {
      return;
    }

    await restoreProjectFromExplorer(projectId);
    await refreshExplorer();
    queueExplorerCloudSync();
  }, [isExplorerReadOnly, queueExplorerCloudSync, refreshExplorer]);

  const handleRestoreFolder = useCallback(async (folderId: string) => {
    if (isExplorerReadOnly) {
      return;
    }

    await restoreProjectFolder(folderId);
    await refreshExplorer();
    queueExplorerCloudSync();
  }, [isExplorerReadOnly, queueExplorerCloudSync, refreshExplorer]);

  const handleDragStart = useCallback((event: React.DragEvent, key: ExplorerKey) => {
    if (isExplorerReadOnly) {
      event.preventDefault();
      return;
    }

    const nextDragKeys = selectionMode && selectedKeys.includes(key) ? selectedKeys : [key];
    setDragKeys(nextDragKeys);
    setDropFolderId(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-pocha-explorer', JSON.stringify({ keys: nextDragKeys }));
  }, [isExplorerReadOnly, selectedKeys, selectionMode]);

  const handleDropToFolder = useCallback(async (folderId: string) => {
    if (isExplorerReadOnly) {
      return;
    }

    const keys = dragKeys;
    setDropFolderId(null);
    setDragKeys([]);
    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      if (key.startsWith('folder:')) {
        await moveProjectFolder(key.slice('folder:'.length), folderId);
      } else {
        await moveProjectToFolder(key.slice('project:'.length), folderId);
      }
    }

    await refreshExplorer();
    queueExplorerCloudSync();
  }, [dragKeys, isExplorerReadOnly, queueExplorerCloudSync, refreshExplorer]);

  const dropTargetProps = useCallback((folderId: string) => ({
    onDragEnter: (event: React.DragEvent) => {
      if (isExplorerReadOnly) {
        return;
      }
      event.preventDefault();
      setDropFolderId(folderId);
    },
    onDragOver: (event: React.DragEvent) => {
      if (isExplorerReadOnly) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dropFolderId !== folderId) {
        setDropFolderId(folderId);
      }
    },
    onDragLeave: () => {
      if (isExplorerReadOnly) {
        return;
      }
      if (dropFolderId === folderId) {
        setDropFolderId(null);
      }
    },
    onDrop: async (event: React.DragEvent) => {
      if (isExplorerReadOnly) {
        return;
      }
      event.preventDefault();
      await handleDropToFolder(folderId);
    },
  }), [dropFolderId, handleDropToFolder, isExplorerReadOnly]);

  const explorerStatusLabel = useMemo(() => {
    if (isInitialLoading) {
      return 'Loading projects...';
    }
    if (visibleItems.length === 0) {
      return 'Empty folder';
    }
    return null;
  }, [isInitialLoading, visibleItems.length]);

  const handleItemClick = useCallback((item: VisibleItem, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (isExplorerInteractionBlocked) {
      return;
    }
    if (selectionMode || event.shiftKey || event.metaKey || event.ctrlKey) {
      handleSelectKey(item.key, event.nativeEvent);
      return;
    }
    if (item.kind === 'folder') {
      setCurrentFolderId(item.id);
      return;
    }
    if (isExplorerMutationLocked) {
      return;
    }
    void handleOpenProject(item.id);
  }, [
    handleOpenProject,
    handleSelectKey,
    isExplorerInteractionBlocked,
    isExplorerMutationLocked,
    selectionMode,
  ]);

  const renderItemActions = (item: VisibleItem, triggerClassName: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          className={triggerClassName}
          disabled={isExplorerReadOnly}
          label="Open item actions"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          shape="pill"
          size="sm"
        >
          <MoreHorizontal className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isExplorerReadOnly) {
              return;
            }
            openRenameDialog(item);
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isExplorerReadOnly) {
              return;
            }
            if (selectionMode && selectedKeys.includes(item.key)) {
              requestTrashForKeys(selectedKeys);
              return;
            }
            if (item.kind === 'folder') {
              handleTrashFolder(item.id);
              return;
            }
            handleTrashProject(item.id);
          }}
        >
          Move to trash
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <div className="fixed right-4 top-3 z-[100300]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              className="rounded-full border-border/70 bg-surface-floating shadow-[0_18px_50px_-30px_rgba(15,23,42,0.45)] backdrop-blur dark:shadow-[0_28px_70px_-42px_rgba(0,0,0,0.82)]"
              label="Home settings"
              shape="pill"
              size="sm"
              variant="outline"
            >
              <Settings2 className="size-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuCheckboxItem
              checked={isDarkMode}
              onCheckedChange={() => {
                void handleToggleDarkMode();
              }}
            >
              <Palette className="size-4" />
              Dark mode
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setTrashOpen(true)}
            >
              <Trash2 className="size-4" />
              Trash
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setAccountOpen(true)}
            >
              <User className="size-4" />
              Account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <input
        ref={fileInputRef}
        accept=".json,.zip"
        className="hidden"
        type="file"
        onChange={(event) => {
          if (isExplorerReadOnly) {
            event.target.value = '';
            return;
          }
          const file = event.target.files?.[0];
          if (file) {
            void handleImportProject(file);
          }
          event.target.value = '';
        }}
      />

      <main
        ref={explorerShellRef}
        className="relative z-10 mx-auto flex h-full w-full max-w-[1440px] min-h-0 flex-col px-6 py-8 lg:px-10"
      >
        <NameInputDialog
          open={!!renameDialogState}
          title={renameDialogState?.kind === 'folder' ? 'Rename Folder' : 'Rename Project'}
          label="Name"
          value={renameDialogValue}
          submitLabel={renameDialogState?.kind === 'folder' ? 'Rename Folder' : 'Rename Project'}
          description={
            renameDialogState
              ? `Choose a new name for "${renameDialogState.label}".`
              : undefined
          }
          error={renameDialogError}
          onValueChange={setRenameDialogValue}
          onOpenChange={handleRenameDialogOpenChange}
          onSubmit={() => void submitRenameDialog()}
        />

        <div className="mb-8">
          <div className="max-w-4xl">
            {currentFolder && currentFolder.id !== PROJECT_EXPLORER_ROOT_FOLDER_ID ? (
              <nav className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {breadcrumbFolders.map((folder, index) => (
                  <div className="flex items-center gap-2" key={folder.id}>
                    <Button
                      className={cn(
                        'px-2 py-1 transition-colors',
                        folder.id === currentFolderSafeId
                          ? 'bg-foreground text-background shadow-sm'
                          : 'text-muted-foreground hover:bg-surface-interactive hover:text-foreground',
                        dropFolderId === folder.id && 'bg-primary/15 text-primary',
                      )}
                      onClick={() => setCurrentFolderId(folder.id)}
                      shape="pill"
                      size="xs"
                      variant="ghost"
                      {...dropTargetProps(folder.id)}
                    >
                      {folder.id === PROJECT_EXPLORER_ROOT_FOLDER_ID ? 'Home' : folder.name}
                    </Button>
                    {index < breadcrumbFolders.length - 1 ? <ChevronRight className="size-3" /> : null}
                  </div>
                ))}
              </nav>
            ) : null}

            {currentFolder && currentFolder.id !== PROJECT_EXPLORER_ROOT_FOLDER_ID ? (
              <div className="mt-4">
                {isEditingCurrentFolder ? (
                  <InlineRenameField
                    autoFocus
                    className="text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl"
                    inputClassName="text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl"
                    onBlur={() => void commitCurrentFolderRename()}
                    onChange={(event) => setCurrentFolderNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void commitCurrentFolderRename();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setIsEditingCurrentFolder(false);
                        setCurrentFolderNameDraft('');
                      }
                    }}
                    value={currentFolderNameDraft}
                  />
                ) : (
                  <Button
                    className="text-left text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl"
                    disabled={isExplorerReadOnly}
                    onClick={() => {
                      if (isExplorerReadOnly) {
                        return;
                      }
                      setIsEditingCurrentFolder(true);
                      setCurrentFolderNameDraft(currentFolder.name);
                    }}
                    shape="none"
                    size="xs"
                    variant="link"
                  >
                    {currentFolder.name}
                  </Button>
                )}
              </div>
            ) : (
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">
                Home
              </h1>
            )}
          </div>
        </div>

        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-border/70 bg-surface-floating shadow-[0_26px_90px_-38px_rgba(15,23,42,0.45)] backdrop-blur dark:shadow-[0_34px_100px_-52px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className="flex shrink-0 items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label="Create or import" disabled={isExplorerReadOnly} shape="pill" size="sm">
                      <Plus className="size-4" />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onClick={() => void handleCreateProject()}>
                      <FileCode2 className="size-4" />
                      Blank project
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                      <Upload className="size-4" />
                      Import project
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void handleCreateFolder()}>
                      <Folder className="size-4" />
                      New folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {parentFolder ? (
                  <IconButton
                    className={cn(dropFolderId === parentFolder.id && 'bg-primary/10 text-primary')}
                    disabled={isExplorerInteractionBlocked}
                    label="Back to parent folder"
                    onClick={() => setCurrentFolderId(parentFolder.id)}
                    shape="pill"
                    size="sm"
                    {...dropTargetProps(parentFolder.id)}
                  >
                    <ArrowLeft className="size-4" />
                  </IconButton>
                ) : null}
              </div>

              {explorerStatusLabel ? (
                <div className="text-sm font-medium text-foreground/80">
                  {explorerStatusLabel}
                </div>
              ) : null}
              <div className="flex h-7 w-[220px] items-center">
                {authBootstrapState === 'reconnecting' ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/45 bg-sky-100/75 px-3 py-1.5 text-xs font-medium text-sky-950 shadow-sm backdrop-blur dark:border-sky-400/18 dark:bg-sky-400/12 dark:text-sky-100">
                    <Loader2 className="size-3.5 animate-spin text-sky-600" />
                    Reconnecting to cloud...
                  </div>
                ) : isRefreshing ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-floating px-3 py-1.5 text-xs font-medium text-foreground/70 shadow-sm backdrop-blur">
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    Refreshing workspace...
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {importError ? <div className="text-sm text-destructive">{importError}</div> : null}
              <CollectionViewControls
                ariaLabel="Project explorer view"
                disabled={isExplorerReadOnly}
                onDeleteSelected={() => void requestTrashForSelection()}
                onToggleSelectionMode={() => {
                  if (isExplorerReadOnly) {
                    return;
                  }
                  if (selectionMode) {
                    exitSelectionMode();
                    return;
                  }
                  setSelectionMode(true);
                }}
                onViewModeChange={setViewMode}
                selectionCount={selectedKeys.length}
                selectionMode={selectionMode}
                viewMode={viewMode}
              />
            </div>
          </div>

          <div
            ref={explorerListRef}
            className="min-h-0 flex-1 overflow-auto"
            onClick={() => {
              if (!selectionMode) {
                return;
              }
              clearSelection();
            }}
          >
            {isInitialLoading ? (
              viewMode === 'card' ? <ExplorerLoadingCards /> : <ExplorerLoadingRows />
            ) : visibleItems.length === 0 ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 px-6 text-center text-muted-foreground">
                <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <FolderOpen className="size-8" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-foreground">Nothing here yet</div>
                  <div className="mt-2 text-sm leading-6">
                    Create a new project, import one, or drop projects into this folder from somewhere else in the explorer.
                  </div>
                </div>
              </div>
            ) : viewMode === 'card' ? (
              <div className="grid auto-rows-fr gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleItems.map((item) => {
                  const isSelected = selectedKeys.includes(item.key);
                  const isDragging = dragKeys.includes(item.key);
                  const isDropTarget = item.kind === 'folder' && dropFolderId === item.id;

                  return (
                    <div
                      key={item.key}
                      className={collectionCardClassName({
                        dragging: isDragging,
                        dropTarget: isDropTarget,
                        selected: isSelected,
                      })}
                      draggable={!isExplorerReadOnly}
                      onDragStart={(event) => handleDragStart(event, item.key)}
                      onDragEnd={() => {
                        setDragKeys([]);
                        setDropFolderId(null);
                      }}
                      onClick={(event) => handleItemClick(item, event)}
                      {...(item.kind === 'folder' ? dropTargetProps(item.id) : {})}
                    >
                      {selectionMode ? <CollectionSelectionCheckbox checked={isSelected} className="absolute left-3 top-3 z-10 shadow-sm" /> : null}

                      <div className="absolute right-3 top-3 z-10">
                        {renderItemActions(item, 'rounded-full bg-surface-floating shadow-sm backdrop-blur')}
                      </div>

                      {item.kind === 'folder' ? (
                        <div className="flex aspect-[16/10] items-center justify-center bg-muted/60 text-muted-foreground dark:bg-muted/35">
                          <div className="flex size-[4.5rem] items-center justify-center rounded-[28px] border border-border/70 bg-surface-elevated shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)]">
                            <FolderOpen className="size-8" />
                          </div>
                        </div>
                      ) : (
                        <div className="relative aspect-[16/10] overflow-hidden border-b border-border/60 bg-muted">
                          {item.thumbnailUrl ? (
                            <img
                              alt={`${item.label} thumbnail`}
                              className="pointer-events-none h-full w-full select-none object-cover"
                              draggable={false}
                              src={item.thumbnailUrl}
                            />
                          ) : item.staleThumbnail || item.thumbnailAssetMissing ? (
                            <div className="flex h-full items-center justify-center">
                              <Loader2 className="size-5 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <ImageOff className="size-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{item.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Updated {formatExplorerTimestamp(new Date(item.updatedAt))}
                          </div>
                        </div>

                        {item.kind === 'project' && isOpeningProjectId === item.id ? (
                          <div className="mt-auto flex items-center justify-end text-xs text-muted-foreground">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              visibleItems.map((item) => {
                const isSelected = selectedKeys.includes(item.key);
                const isDragging = dragKeys.includes(item.key);
                const isDropTarget = item.kind === 'folder' && dropFolderId === item.id;

                return (
                  <div
                    key={item.key}
                    className={collectionRowClassName({
                      dragging: isDragging,
                      dropTarget: isDropTarget,
                      selected: isSelected,
                    })}
                    draggable={!isExplorerReadOnly}
                    onDragStart={(event) => handleDragStart(event, item.key)}
                    onDragEnd={() => {
                      setDragKeys([]);
                      setDropFolderId(null);
                    }}
                    onClick={(event) => handleItemClick(item, event)}
                    {...(item.kind === 'folder' ? dropTargetProps(item.id) : {})}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      {selectionMode ? <CollectionSelectionCheckbox checked={isSelected} /> : null}

                      {item.kind === 'folder' ? (
                        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
                          <FolderOpen className="size-6" />
                        </div>
                      ) : (
                        <div className="relative flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
                          {item.thumbnailUrl ? (
                            <img
                              alt={`${item.label} thumbnail`}
                              className="pointer-events-none h-full w-full select-none object-cover"
                              draggable={false}
                              src={item.thumbnailUrl}
                            />
                          ) : item.staleThumbnail || item.thumbnailAssetMissing ? (
                            <Loader2 className="size-5 animate-spin text-muted-foreground" />
                          ) : (
                            <ImageOff className="size-5 text-muted-foreground" />
                          )}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">{item.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Updated {formatExplorerTimestamp(new Date(item.updatedAt))}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {item.kind === 'project' && isOpeningProjectId === item.id ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : null}
                      {renderItemActions(item, 'rounded-full')}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-[calc(100vw-2rem)] max-w-none sm:max-w-none border-none bg-transparent p-0 shadow-none"
        >
          <div className="pocha-account-profile max-h-[84vh] overflow-y-auto overflow-x-hidden">
            <UserProfile appearance={clerkAppearance} routing="hash" />
          </div>
        </DialogContent>
      </Dialog>

      {trashOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-scrim px-4 py-6" onClick={() => setTrashOpen(false)}>
          <div
            className="flex h-full max-h-[82vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_32px_120px_-48px_rgba(15,23,42,0.65)] dark:shadow-[0_36px_120px_-54px_rgba(0,0,0,0.94)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-6 py-5">
              <div>
                <div className="text-2xl font-semibold tracking-[-0.03em] text-foreground">Trash</div>
                <div className="mt-2 text-sm text-muted-foreground">Restore projects and folders whenever you’re ready.</div>
              </div>
              <IconButton label="Close trash" onClick={() => setTrashOpen(false)} shape="pill" size="sm">
                <ArrowLeft className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {[...trashedFolders, ...trashedProjects].length === 0 ? (
                <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">Trash is empty.</div>
              ) : (
                <div className="divide-y divide-border/70">
                  {trashedFolders
                    .sort((left, right) => (right.trashedAt ?? 0) - (left.trashedAt ?? 0))
                    .map((folder) => (
                      <div className="flex items-center justify-between gap-4 px-5 py-4" key={`trash-folder:${folder.id}`}>
                        <div className="min-w-0 flex items-center gap-4">
                          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                            <FolderOpen className="size-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{folder.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Deleted {folder.trashedAt ? formatExplorerTimestamp(new Date(folder.trashedAt)) : ''}
                            </div>
                          </div>
                        </div>
                        <Button variant="outline" onClick={() => void handleRestoreFolder(folder.id)}>
                          <RotateCcw className="size-4" />
                          Restore
                        </Button>
                      </div>
                    ))}
                  {trashedProjects
                    .sort((left, right) => (right.trashedAt ?? 0) - (left.trashedAt ?? 0))
                    .map((project) => (
                      <div className="flex items-center justify-between gap-4 px-5 py-4" key={`trash-project:${project.id}`}>
                        <div className="min-w-0 flex items-center gap-4">
                          <div className="relative flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
                            {project.thumbnailUrl ? (
                              <img alt="" className="pointer-events-none h-full w-full select-none object-cover" draggable={false} src={project.thumbnailUrl} />
                            ) : (
                              <ImageOff className="size-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{project.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Deleted {project.trashedAt ? formatExplorerTimestamp(new Date(project.trashedAt)) : ''}
                            </div>
                          </div>
                        </div>
                        <Button variant="outline" onClick={() => void handleRestoreProject(project.id)}>
                          <RotateCcw className="size-4" />
                          Restore
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pendingTrashConfirmation ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface-scrim px-4" onClick={() => setPendingTrashConfirmation(null)}>
          <div
            className="w-full max-w-lg rounded-[24px] border border-border/70 bg-card p-6 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.65)] dark:shadow-[0_32px_100px_-48px_rgba(0,0,0,0.95)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">{pendingTrashConfirmation.heading}</div>
            <div className="mt-3 text-sm leading-6 text-muted-foreground">
              Everything stays recoverable from trash until you decide otherwise.
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPendingTrashConfirmation(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => void confirmTrash()}>Move to trash</Button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

function getSortLabel(value: string): string {
  return value.trim().toLocaleLowerCase();
}
