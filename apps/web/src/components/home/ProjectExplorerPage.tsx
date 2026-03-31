import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvexAuth } from 'convex/react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  ImageOff,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  SquareCheck,
  Trash2,
  Upload,
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
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
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

function SelectionCheckbox({ checked }: { checked: boolean }) {
  return (
    <div
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
      )}
    >
      {checked ? <Check className="size-3" /> : null}
    </div>
  );
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

function fileRowClassName(options: {
  dragging?: boolean;
  selected?: boolean;
  dropTarget?: boolean;
}) {
  return cn(
    'group flex w-full items-center gap-4 border-b border-border/70 bg-background/95 px-4 py-3 text-left transition',
    options.selected && 'bg-primary/6',
    options.dropTarget && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
    options.dragging && 'opacity-45',
    'hover:bg-accent/50',
  );
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

export function ProjectExplorerPage({
  authBootstrapState = 'steady',
  onProjectOpen,
}: ProjectExplorerPageProps) {
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
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
  const [selectedKeys, setSelectedKeys] = useState<ExplorerKey[]>([]);
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<ExplorerKey | null>(null);
  const [editingKey, setEditingKey] = useState<ExplorerKey | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isEditingCurrentFolder, setIsEditingCurrentFolder] = useState(false);
  const [currentFolderNameDraft, setCurrentFolderNameDraft] = useState('');
  const [dragKeys, setDragKeys] = useState<ExplorerKey[]>([]);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [pendingTrashConfirmation, setPendingTrashConfirmation] = useState<PendingTrashConfirmation>(null);
  const [importError, setImportError] = useState<string | null>(null);
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
    if (!editingKey || visibleKeySet.has(editingKey)) {
      return;
    }

    setEditingKey(null);
    setEditingValue('');
  }, [editingKey, visibleKeySet]);

  useEffect(() => {
    if (currentFolderSafeId === PROJECT_EXPLORER_ROOT_FOLDER_ID) {
      setIsEditingCurrentFolder(false);
      setCurrentFolderNameDraft('');
    }
  }, [currentFolderSafeId]);

  useEffect(() => {
    if (!isExplorerReadOnly) {
      return;
    }

    setSelectionMode(false);
    setSelectedKeys([]);
    setSelectionAnchorKey(null);
    setEditingKey(null);
    setEditingValue('');
    setIsEditingCurrentFolder(false);
    setCurrentFolderNameDraft('');
    setDragKeys([]);
    setDropFolderId(null);
    setTrashOpen(false);
    setPendingTrashConfirmation(null);
  }, [isExplorerReadOnly]);

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

  const requestTrashForSelection = useCallback(async () => {
    if (isExplorerReadOnly) {
      return;
    }

    const folderIds = selectedKeys
      .filter((key): key is `folder:${string}` => key.startsWith('folder:'))
      .map((key) => key.slice('folder:'.length));
    const projectIds = selectedKeys
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
  }, [isExplorerReadOnly, selectedKeys]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (explorerListRef.current?.contains(event.target as Node)) {
        return;
      }

      setSelectionMode(false);
      setSelectedKeys([]);
      setSelectionAnchorKey(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }

      if (event.key === 'Escape') {
        setSelectionMode(false);
        setSelectedKeys([]);
        setSelectionAnchorKey(null);
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
  }, [requestTrashForSelection, selectedKeys.length, selectionMode]);

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

    const folderId = await createProjectFolder(`New folder ${visibleFolders.length + 1}`, currentFolderSafeId);
    await refreshExplorer();
    setEditingKey(`folder:${folderId}`);
    setEditingValue(`New folder ${visibleFolders.length + 1}`);
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

  const commitRename = useCallback(async () => {
    if (!editingKey || isExplorerReadOnly) {
      return;
    }

    const nextValue = editingValue.trim();
    if (!nextValue) {
      setEditingKey(null);
      setEditingValue('');
      return;
    }

    if (editingKey.startsWith('folder:')) {
      await renameProjectFolder(editingKey.slice('folder:'.length), nextValue);
      queueExplorerCloudSync();
    } else {
      const projectId = editingKey.slice('project:'.length);
      const changed = await renameStoredProject(projectId, nextValue);
      if (changed) {
        queueProjectCloudSync(projectId);
      }
    }

    await refreshExplorer();
    setEditingKey(null);
    setEditingValue('');
  }, [editingKey, editingValue, isExplorerReadOnly, queueExplorerCloudSync, queueProjectCloudSync, refreshExplorer]);

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
    setSelectionMode(false);
    setSelectedKeys([]);
    setSelectionAnchorKey(null);
    await refreshExplorer();
    queueExplorerCloudSync();
  }, [isExplorerReadOnly, pendingTrashConfirmation, queueExplorerCloudSync, refreshExplorer]);

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

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
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

      <main className="relative z-10 mx-auto flex h-full w-full max-w-[1440px] min-h-0 flex-col px-6 py-8 lg:px-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            {currentFolder && currentFolder.id !== PROJECT_EXPLORER_ROOT_FOLDER_ID ? (
              <nav className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {breadcrumbFolders.map((folder, index) => (
                  <div className="flex items-center gap-2" key={folder.id}>
                    <button
                      type="button"
                      className={cn(
                        'rounded-full px-2 py-1 transition-colors',
                        folder.id === currentFolderSafeId
                          ? 'bg-foreground text-background shadow-sm'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground dark:hover:bg-white/8',
                        dropFolderId === folder.id && 'bg-primary/15 text-primary',
                      )}
                      onClick={() => setCurrentFolderId(folder.id)}
                      {...dropTargetProps(folder.id)}
                    >
                      {folder.id === PROJECT_EXPLORER_ROOT_FOLDER_ID ? 'Home' : folder.name}
                    </button>
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
                  <button
                    className="text-left text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl"
                    disabled={isExplorerReadOnly}
                    type="button"
                    onClick={() => {
                      if (isExplorerReadOnly) {
                        return;
                      }
                      setIsEditingCurrentFolder(true);
                      setCurrentFolderNameDraft(currentFolder.name);
                    }}
                  >
                    {currentFolder.name}
                  </button>
                )}
              </div>
            ) : (
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">
                Home
              </h1>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/78 px-3 py-2 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.45)] backdrop-blur dark:bg-card/72 dark:shadow-[0_28px_70px_-42px_rgba(0,0,0,0.82)]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="rounded-full" disabled={isExplorerReadOnly}>
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
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
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn('rounded-full', dropFolderId === parentFolder.id && 'bg-primary/10 text-primary')}
                disabled={isExplorerInteractionBlocked}
                onClick={() => setCurrentFolderId(parentFolder.id)}
                {...dropTargetProps(parentFolder.id)}
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : null}

            {selectionMode && selectedKeys.length > 0 ? (
              <Button
                size="icon-sm"
                variant="ghost"
                className="rounded-full"
                disabled={isExplorerReadOnly}
                onClick={() => void requestTrashForSelection()}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}

            <Button
              size="icon-sm"
              variant={selectionMode ? 'default' : 'ghost'}
              className="rounded-full"
              disabled={isExplorerReadOnly}
              onClick={() => {
                if (isExplorerReadOnly) {
                  return;
                }
                setSelectionMode((current) => {
                  if (current) {
                    setSelectedKeys([]);
                    setSelectionAnchorKey(null);
                  }
                  return !current;
                });
              }}
            >
              <SquareCheck className="size-4" />
            </Button>

            <Button
              size="icon-sm"
              variant="ghost"
              className="rounded-full"
              disabled={isExplorerReadOnly}
              onClick={() => setTrashOpen(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card/80 shadow-[0_26px_90px_-38px_rgba(15,23,42,0.45)] backdrop-blur dark:bg-card/74 dark:shadow-[0_34px_100px_-52px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium text-foreground/80">
                {isInitialLoading
                  ? 'Loading projects...'
                  : visibleItems.length === 0
                    ? 'Empty folder'
                    : `${visibleItems.length} item${visibleItems.length === 1 ? '' : 's'}`}
              </div>
              <div className="flex h-7 w-[220px] items-center">
                {authBootstrapState === 'reconnecting' ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/45 bg-sky-100/75 px-3 py-1.5 text-xs font-medium text-sky-950 shadow-sm backdrop-blur dark:border-sky-400/18 dark:bg-sky-400/12 dark:text-sky-100">
                    <Loader2 className="size-3.5 animate-spin text-sky-600" />
                    Reconnecting to cloud...
                  </div>
                ) : isRefreshing ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/75 px-3 py-1.5 text-xs font-medium text-foreground/70 shadow-sm backdrop-blur dark:bg-card/72">
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    Refreshing workspace...
                  </div>
                ) : null}
              </div>
            </div>
            {importError ? <div className="text-sm text-destructive">{importError}</div> : null}
          </div>

          <div
            ref={explorerListRef}
            className="min-h-0 flex-1 overflow-auto"
            onClick={() => {
              if (!selectionMode) {
                return;
              }
              setSelectedKeys([]);
              setSelectionAnchorKey(null);
            }}
          >
            {isInitialLoading ? (
              <ExplorerLoadingRows />
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
            ) : (
              visibleItems.map((item) => {
                const isSelected = selectedKeys.includes(item.key);
                const isDragging = dragKeys.includes(item.key);
                const isDropTarget = item.kind === 'folder' && dropFolderId === item.id;

                return (
                  <div
                    key={item.key}
                    className={fileRowClassName({
                      dragging: isDragging,
                      dropTarget: isDropTarget,
                      selected: isSelected,
                    })}
                    draggable={!isExplorerReadOnly && editingKey !== item.key}
                    onDragStart={(event) => handleDragStart(event, item.key)}
                    onDragEnd={() => {
                      setDragKeys([]);
                      setDropFolderId(null);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isExplorerInteractionBlocked) {
                        return;
                      }
                      if (selectionMode || event.shiftKey || event.metaKey || event.ctrlKey) {
                        handleSelectKey(item.key, event.nativeEvent);
                        return;
                      }

                      if (editingKey === item.key) {
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
                    }}
                    {...(item.kind === 'folder' ? dropTargetProps(item.id) : {})}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      {selectionMode ? <SelectionCheckbox checked={isSelected} /> : null}

                      {item.kind === 'folder' ? (
                        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
                          <FolderOpen className="size-6" />
                        </div>
                      ) : (
                        <div className="relative flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
                          {item.thumbnailUrl ? (
                            <img
                              alt={`${item.label} thumbnail`}
                              className="h-full w-full object-cover"
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
                        {editingKey === item.key ? (
                        <InlineRenameField
                          autoFocus
                          className="max-w-lg"
                          inputClassName="text-sm font-medium"
                            onBlur={() => void commitRename()}
                            onChange={(event) => setEditingValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void commitRename();
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setEditingKey(null);
                                setEditingValue('');
                              }
                            }}
                            value={editingValue}
                          />
                        ) : (
                          <div className="truncate text-sm font-semibold text-foreground">{item.label}</div>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">
                          Updated {formatExplorerTimestamp(new Date(item.updatedAt))}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {item.kind === 'project' && isOpeningProjectId === item.id ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full"
                            disabled={isExplorerReadOnly}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.preventDefault();
                              if (isExplorerReadOnly) {
                                return;
                              }
                              setEditingKey(item.key);
                              setEditingValue(item.label);
                            }}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(event) => {
                              event.preventDefault();
                              if (isExplorerReadOnly) {
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
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>

      {trashOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6" onClick={() => setTrashOpen(false)}>
          <div
            className="flex h-full max-h-[82vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_32px_120px_-48px_rgba(15,23,42,0.65)] dark:shadow-[0_36px_120px_-54px_rgba(0,0,0,0.94)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-6 py-5">
              <div>
                <div className="text-2xl font-semibold tracking-[-0.03em] text-foreground">Trash</div>
                <div className="mt-2 text-sm text-muted-foreground">Restore projects and folders whenever you’re ready.</div>
              </div>
              <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={() => setTrashOpen(false)}>
                <ArrowLeft className="size-4" />
              </Button>
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
                              <img alt="" className="h-full w-full object-cover" src={project.thumbnailUrl} />
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4" onClick={() => setPendingTrashConfirmation(null)}>
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
