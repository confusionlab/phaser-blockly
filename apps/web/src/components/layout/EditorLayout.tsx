import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { ObjectEditor } from '../editors/ObjectEditor';
import { StagePanel } from '../stage/StagePanel';
import { ObjectPicker } from '../stage/ObjectPicker';
import { BackgroundCanvasEditor } from '../stage/BackgroundCanvasEditor';
import { WorldBoundaryEditor } from '../stage/WorldBoundaryEditor';
import { ProjectDialog } from '../dialogs/ProjectDialog';
import { PlayValidationDialog } from '../dialogs/PlayValidationDialog';
import { ProjectHistoryDialog } from '../dialogs/ProjectHistoryDialog';
import { AiAssistantPanel } from '../assistant/AiAssistantPanel';
import { ProjectExplorerPage } from '@/components/home/ProjectExplorerPage';
import type { Project } from '@/types';
import { EditorTopBar } from '@/components/layout/EditorTopBar';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import {
  CURRENT_SCHEMA_VERSION,
  createProjectConflictCopy,
  createAutoCheckpoint,
  downloadProject,
  loadProject,
  migrateAllLocalProjects,
  saveProject,
} from '@/db/database';
import {
  useCloudSync,
  type CloudProjectSyncPhaseDurations,
  type CloudProjectSyncStatus,
  type CloudProjectSyncTimingEvent,
  type CloudProjectSyncTimingPhase,
  type CloudProjectUploadEvent,
} from '@/hooks/useCloudSync';
import { useProjectLease } from '@/hooks/useProjectLease';
import { Button } from '@/components/ui/button';
import { assistantFeatureFlags } from '@/lib/assistant/config';
import { tryStartPlaying } from '@/lib/playStartGuard';
import { getSceneObjectsInLayerOrder } from '@/utils/layerTree';
import { isBlocklyShortcutTarget, isTextEntryTarget } from '@/utils/keyboard';
import { deleteSceneObjectsWithHistory, duplicateSceneObjectsWithHistory } from '@/lib/editor/objectCommands';

type HoveredPanel = 'code' | 'stage' | null;
type FullscreenPanel = 'code' | null;
type CloudSaveState = {
  status: 'saved' | 'unsaved' | 'saving' | 'error';
  lastSavedAt: number | null;
  errorMessage: string | null;
};

const ASSISTANT_UI_ENABLED = assistantFeatureFlags.isEnabled;
const UNSAVED_CLOUD_CHANGES_MESSAGE = 'Changes are not yet saved to cloud.';
const CLOUD_PULL_CONFLICT_MESSAGE = 'Newer cloud changes are available. Click Save Now to load them.';

function formatUploadSizeMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(3)} MB`;
}

function formatSaveDuration(durationMs: number): string {
  return durationMs >= 1_000
    ? `${(durationMs / 1_000).toFixed(2)}s`
    : `${Math.round(durationMs)}ms`;
}

const CLOUD_SYNC_PHASE_ORDER: CloudProjectSyncTimingPhase[] = [
  'preparePayload',
  'loadLocalRevisionState',
  'planProject',
  'ensureProjectAssets',
  'uploadProjectPayload',
  'commitProjectMetadata',
  'planRevisions',
  'uploadRevisions',
  'pullRevisions',
  'refreshLocalCache',
];

const CLOUD_SYNC_PHASE_LABELS: Record<CloudProjectSyncTimingPhase, string> = {
  preparePayload: 'prepare payload',
  loadLocalRevisionState: 'load local revisions',
  planProject: 'plan project sync',
  ensureProjectAssets: 'ensure assets',
  uploadProjectPayload: 'upload project payload',
  commitProjectMetadata: 'commit project sync',
  planRevisions: 'plan revisions',
  uploadRevisions: 'upload revisions',
  pullRevisions: 'pull revisions',
  refreshLocalCache: 'refresh local cache',
};

function formatSyncPhaseBreakdown(phaseDurationsMs: CloudProjectSyncPhaseDurations): string {
  return CLOUD_SYNC_PHASE_ORDER
    .map((phase) => {
      const durationMs = phaseDurationsMs[phase];
      if (durationMs === undefined) {
        return null;
      }
      return `${CLOUD_SYNC_PHASE_LABELS[phase]} ${formatSaveDuration(durationMs)}`;
    })
    .filter((segment): segment is string => segment !== null)
    .join(', ');
}

function dispatchEditorResizeFreeze(active: boolean): void {
  window.dispatchEvent(new CustomEvent('pocha-editor-resize-freeze', { detail: { active } }));
}

export function EditorLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const {
    project,
    isDirty,
    openProject,
    acknowledgeProjectSaved,
    closeProject,
    duplicateObject,
    removeObject,
    updateProjectName,
  } = useProjectStore();
  const {
    isPlaying,
    isDarkMode,
    selectedSceneId,
    selectedObjectId,
    selectedObjectIds,
    showProjectDialog,
    setShowProjectDialog,
    reconcileSelectionToProject,
    selectObjects,
    stopPlaying,
    undo,
    redo,
    showPlayValidationDialog,
    playValidationIssues,
    setShowPlayValidationDialog,
    focusPlayValidationIssue,
    activeObjectTab,
    costumeUndoHandler,
    backgroundEditorOpen,
    worldBoundaryEditorOpen,
    backgroundShortcutHandler,
    cycleViewMode,
    assistantLockRunId,
    assistantLockMessage,
  } = useEditorStore();
  const updateMySettings = useMutation(api.userSettings.updateMySettings);
  const [dividerPosition, setDividerPosition] = useState(60);
  const [isMainDividerDragging, setIsMainDividerDragging] = useState(false);
  const [hoveredPanel, setHoveredPanel] = useState<HoveredPanel>(null);
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>(null);
  const [isStageCanvasFullscreen, setIsStageCanvasFullscreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMigratingProjects, setIsMigratingProjects] = useState(true);
  const [isBlockingCloudSync, setIsBlockingCloudSync] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudSaveState, setCloudSaveState] = useState<CloudSaveState>({
    status: 'saved',
    lastSavedAt: null,
    errorMessage: null,
  });
  const hoveredPanelRef = useRef<HoveredPanel>(null);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const isBlockingCloudSyncRef = useRef(false);
  const isMountedRef = useRef(true);
  const lastCloudSavedVersionRef = useRef(new Map<string, number>());
  const inFlightCloudSaveRef = useRef<{ projectId: string; updatedAtMs: number } | null>(null);
  const manualSaveMetricsRef = useRef<{
    projectId: string;
    updatedAtMs: number;
    startedAtMs: number;
    uploadSizeBytes: number | null;
    phaseDurationsMs: CloudProjectSyncPhaseDurations | null;
  } | null>(null);
  const activeProjectId = project?.id ?? null;
  const leaseProjectId = projectId ?? activeProjectId;
  const {
    leaseStatus,
    activeEditorSessionId,
    isWriteAllowed,
    takeOverLease,
    retryLease,
  } = useProjectLease(leaseProjectId);
  const isProjectLeaseBlocking = !!leaseProjectId && leaseStatus !== 'active' && leaseStatus !== 'idle';
  const isCloudWriteEnabled = !leaseProjectId || isWriteAllowed;
  const currentCloudSavedVersionMs = project ? (lastCloudSavedVersionRef.current.get(project.id) ?? null) : null;
  const isCurrentVersionCloudSaved = !!project && currentCloudSavedVersionMs === project.updatedAt.getTime();
  const handleProjectPayloadUploaded = useCallback((event: CloudProjectUploadEvent) => {
    const pendingSave = manualSaveMetricsRef.current;
    if (!pendingSave) {
      return;
    }
    if (
      pendingSave.projectId !== event.projectId
      || pendingSave.updatedAtMs !== event.updatedAt
    ) {
      return;
    }
    pendingSave.uploadSizeBytes = event.sizeBytes;
  }, []);

  const handleProjectSyncMeasured = useCallback((event: CloudProjectSyncTimingEvent) => {
    const pendingSave = manualSaveMetricsRef.current;
    if (!pendingSave) {
      return;
    }
    if (
      pendingSave.projectId !== event.projectId
      || pendingSave.updatedAtMs !== event.updatedAt
    ) {
      return;
    }
    pendingSave.phaseDurationsMs = event.phaseDurationsMs;
  }, []);

  // The editor treats cloud save as authoritative and uses IndexedDB as a synced cache.
  const { syncProjectDraftToCloud, syncProjectToCloud, syncProjectFromCloud } = useCloudSync({
    enabled: isCloudWriteEnabled,
    syncOnMount: false,
    enableCloudProjectListQuery: false,
    currentProjectId: project?.id ?? null,
    currentProject: project,
    isDirty,
    syncOnUnmount: false,
    checkpointIntervalMs: 0,
    backgroundSyncDebounceMs: 0,
    autoSyncCurrentProject: false,
    onProjectPayloadUploaded: handleProjectPayloadUploaded,
    onProjectSyncMeasured: handleProjectSyncMeasured,
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isBlockingCloudSyncRef.current = isBlockingCloudSync;
  }, [isBlockingCloudSync]);

  useEffect(() => {
    if (!project) {
      setCloudSaveState({
        status: 'saved',
        lastSavedAt: null,
        errorMessage: null,
      });
      return;
    }

    const updatedAtMs = project.updatedAt.getTime();
    const inFlight = inFlightCloudSaveRef.current;
    if (
      inFlight
      && inFlight.projectId === project.id
      && inFlight.updatedAtMs === updatedAtMs
      && cloudSaveState.status === 'saving'
    ) {
      return;
    }

    if (isCurrentVersionCloudSaved) {
      setCloudSaveState({
        status: 'saved',
        lastSavedAt: updatedAtMs,
        errorMessage: null,
      });
      return;
    }

    setCloudSaveState({
      status: 'unsaved',
      lastSavedAt: lastCloudSavedVersionRef.current.get(project.id) ?? null,
      errorMessage: null,
    });
  }, [cloudSaveState.status, isCurrentVersionCloudSaved, project]);

  useEffect(() => {
    if (!activeProjectId || !isCloudWriteEnabled) return;

    const intervalId = window.setInterval(() => {
      const latestProject = useProjectStore.getState().project;
      if (!latestProject) return;
      void createAutoCheckpoint(latestProject);
    }, 5 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [activeProjectId, isCloudWriteEnabled]);

  const hasUnsavedCloudChanges = !!project && (!isCurrentVersionCloudSaved || isSyncingCloud || cloudSaveState.status === 'error');

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!project || isBlockingCloudSyncRef.current || !hasUnsavedCloudChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = UNSAVED_CLOUD_CHANGES_MESSAGE;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedCloudChanges, project]);

  // Keep ref in sync for use in event handler
  useEffect(() => {
    hoveredPanelRef.current = hoveredPanel;
  }, [hoveredPanel]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  const getPanelFromElement = useCallback((element: Element | null): HoveredPanel => {
    const panelElement = element?.closest('[data-editor-panel]');
    if (!panelElement) return null;
    const panel = panelElement.getAttribute('data-editor-panel');
    return panel === 'code' || panel === 'stage' ? panel : null;
  }, []);

  // Run local project migrations proactively so every project stays schema-compatible.
  useEffect(() => {
    void (async () => {
      setIsMigratingProjects(true);
      try {
        const result = await migrateAllLocalProjects();
        if (result.migrated > 0) {
          console.log(`[Migration] Migrated ${result.migrated} local projects to schema v${CURRENT_SCHEMA_VERSION}`);
        }
        if (result.failed > 0) {
          console.error(`[Migration] Failed to migrate ${result.failed} local projects`);
        }
      } finally {
        setIsMigratingProjects(false);
      }
    })();
  }, []);

  const markProjectAsCloudSaved = useCallback((projectSnapshot: { id: string; updatedAt: Date }) => {
    const savedAt = projectSnapshot.updatedAt.getTime();
    lastCloudSavedVersionRef.current.set(projectSnapshot.id, savedAt);
    if (useProjectStore.getState().project?.id === projectSnapshot.id) {
      setCloudSaveState({
        status: 'saved',
        lastSavedAt: savedAt,
        errorMessage: null,
      });
    }
  }, []);

  // Load project from URL
  useEffect(() => {
    const loadFromUrl = async () => {
      if (isMigratingProjects) {
        return;
      }
      if (projectId && (!project || project.id !== projectId)) {
        setIsLoading(true);
        try {
          const hydratedFromCloud = await syncProjectFromCloud(projectId);
          const loadedProject = await loadProject(projectId);
          if (loadedProject) {
            if (hydratedFromCloud) {
              markProjectAsCloudSaved(loadedProject);
            }
            openProject(loadedProject);
          } else {
            // Project not found, redirect to home
            navigate('/', { replace: true });
          }
        } catch (e) {
          console.error('Failed to load project:', e);
          navigate('/', { replace: true });
        } finally {
          setIsLoading(false);
        }
      } else if (!projectId && project) {
        // URL is home but we have a project open - navigate to project URL
        navigate(`/project/${project.id}`, { replace: true });
      } else if (!projectId && !project) {
        // No project in URL and no project open - show project list page
        setShowProjectDialog(false);
      }
    };

    loadFromUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMigratingProjects, markProjectAsCloudSaved, projectId, syncProjectFromCloud]);

  // Keep selection aligned with the active project as projects open, close, or change shape.
  useEffect(() => {
    reconcileSelectionToProject(project, { recordHistory: false });
  }, [project, reconcileSelectionToProject]);

  // Navigate to project URL when project is opened
  const handleProjectOpen = useCallback((openedProject: { id: string }) => {
    navigate(`/project/${openedProject.id}`);
    setShowProjectDialog(false);
  }, [navigate, setShowProjectDialog]);

  const persistCloudSavedProject = useCallback(async (projectSnapshot: Project) => {
    try {
      const cachedProject = await saveProject(projectSnapshot);
      const cachedUpdatedAtMs = cachedProject.updatedAt.getTime();
      lastCloudSavedVersionRef.current.set(cachedProject.id, cachedUpdatedAtMs);
      acknowledgeProjectSaved(cachedProject);
      return cachedUpdatedAtMs;
    } catch (error) {
      console.error('[CloudSync] Failed to refresh the local project cache after cloud save:', error);
      const fallbackUpdatedAtMs = projectSnapshot.updatedAt.getTime();
      lastCloudSavedVersionRef.current.set(projectSnapshot.id, fallbackUpdatedAtMs);
      acknowledgeProjectSaved(projectSnapshot);
      return fallbackUpdatedAtMs;
    }
  }, [acknowledgeProjectSaved]);

  const finishCloudSync = useCallback(async (
    projectSnapshot: Project,
    result: CloudProjectSyncStatus,
    options: { allowPullIntoEditor?: boolean } = {},
  ): Promise<boolean> => {
    if (result === 'saved') {
      const localCacheRefreshStartedAtMs = performance.now();
      const savedAt = await persistCloudSavedProject(projectSnapshot);
      const localCacheRefreshMs = performance.now() - localCacheRefreshStartedAtMs;
      const currentProject = useProjectStore.getState().project;
      const currentUpdatedAtMs = currentProject?.id === projectSnapshot.id
        ? currentProject.updatedAt.getTime()
        : null;
      const finalStatus = currentUpdatedAtMs !== null && currentUpdatedAtMs > savedAt ? 'unsaved' : 'saved';

      setCloudSaveState({
        status: finalStatus,
        lastSavedAt: savedAt,
        errorMessage: null,
      });
      const pendingSave = manualSaveMetricsRef.current;
      if (
        pendingSave
        && pendingSave.projectId === projectSnapshot.id
        && pendingSave.updatedAtMs === projectSnapshot.updatedAt.getTime()
      ) {
        if (finalStatus === 'saved') {
          const elapsedMs = performance.now() - pendingSave.startedAtMs;
          const sizeText = pendingSave.uploadSizeBytes !== null
            ? formatUploadSizeMb(pendingSave.uploadSizeBytes)
            : 'unknown size';
          const phaseBreakdown = formatSyncPhaseBreakdown({
            ...(pendingSave.phaseDurationsMs ?? {}),
            refreshLocalCache: localCacheRefreshMs,
          });
          console.log(
            `[CloudSync] Saved project "${projectSnapshot.id}" (${sizeText}, ${formatSaveDuration(elapsedMs)} from Save click to Saved).`,
          );
          if (phaseBreakdown.length > 0) {
            console.log(`[CloudSync] Save breakdown "${projectSnapshot.id}" (${phaseBreakdown}).`);
          }
        }
        manualSaveMetricsRef.current = null;
      }
      return true;
    }

    if (result === 'pulled') {
      const refreshedProject = await loadProject(projectSnapshot.id);
      if (refreshedProject) {
        const refreshedUpdatedAtMs = refreshedProject.updatedAt.getTime();
        lastCloudSavedVersionRef.current.set(refreshedProject.id, refreshedUpdatedAtMs);

        const currentProject = useProjectStore.getState().project;
        if (!options.allowPullIntoEditor) {
          setCloudSaveState({
            status: 'error',
            lastSavedAt: refreshedUpdatedAtMs,
            errorMessage: CLOUD_PULL_CONFLICT_MESSAGE,
          });
          manualSaveMetricsRef.current = null;
          return false;
        }

        if (
          currentProject
          && currentProject.id === refreshedProject.id
          && currentProject.updatedAt.getTime() !== refreshedUpdatedAtMs
        ) {
          await createProjectConflictCopy(currentProject);
        }

        if (currentProject?.id === refreshedProject.id) {
          openProject(refreshedProject);
        }
        setCloudSaveState({
          status: 'saved',
          lastSavedAt: refreshedUpdatedAtMs,
          errorMessage: null,
        });
        manualSaveMetricsRef.current = null;
      } else {
        setCloudSaveState((current) => ({
          status: 'error',
          lastSavedAt: current.lastSavedAt,
          errorMessage: 'Could not load the latest cloud version.',
        }));
        manualSaveMetricsRef.current = null;
        return false;
      }
      return true;
    }

    if (result === 'skipped') {
      setCloudSaveState((current) => ({
        status: 'error',
        lastSavedAt: current.lastSavedAt,
        errorMessage: 'Cloud save is unavailable right now.',
      }));
      manualSaveMetricsRef.current = null;
      return false;
    }

    setCloudSaveState((current) => ({
      status: 'error',
      lastSavedAt: current.lastSavedAt,
      errorMessage: 'Could not save to cloud.',
    }));
    manualSaveMetricsRef.current = null;
    return false;
  }, [openProject, persistCloudSavedProject]);

  const handleTakeOverLease = useCallback(async () => {
    const didAcquire = await takeOverLease();
    if (!didAcquire || !leaseProjectId) {
      return;
    }

    try {
      const hydratedFromCloud = await syncProjectFromCloud(leaseProjectId);
      const refreshedProject = await loadProject(leaseProjectId);
      if (refreshedProject) {
        if (hydratedFromCloud) {
          markProjectAsCloudSaved(refreshedProject);
        }
        openProject(refreshedProject);
      }
    } catch (error) {
      console.error('[ProjectLease] Failed to refresh project after takeover:', error);
    }
  }, [leaseProjectId, markProjectAsCloudSaved, openProject, syncProjectFromCloud, takeOverLease]);

  const syncCurrentProjectToCloud = useCallback(async (
    projectSnapshot: Project,
    options: { showBlockingOverlay?: boolean; allowPullIntoEditor?: boolean } = {},
  ): Promise<boolean> => {
    if (!isCloudWriteEnabled) {
      setCloudSaveState((current) => ({
        status: 'error',
        lastSavedAt: current.lastSavedAt,
        errorMessage: 'Cloud save is unavailable right now.',
      }));
      return false;
    }

    const projectUpdatedAtMs = projectSnapshot.updatedAt.getTime();
    inFlightCloudSaveRef.current = {
      projectId: projectSnapshot.id,
      updatedAtMs: projectUpdatedAtMs,
    };
    setCloudSaveState({
      status: 'saving',
      lastSavedAt: lastCloudSavedVersionRef.current.get(projectSnapshot.id) ?? null,
      errorMessage: null,
    });
    if (isMountedRef.current) {
      setIsSyncingCloud(true);
      if (options.showBlockingOverlay) {
        setIsBlockingCloudSync(true);
      }
    }

    try {
      const result = await syncProjectDraftToCloud(projectSnapshot);
      return await finishCloudSync(projectSnapshot, result, {
        allowPullIntoEditor: options.allowPullIntoEditor,
      });
    } finally {
      const inFlight = inFlightCloudSaveRef.current;
      if (
        inFlight
        && inFlight.projectId === projectSnapshot.id
        && inFlight.updatedAtMs === projectUpdatedAtMs
      ) {
        inFlightCloudSaveRef.current = null;
      }

      if (isMountedRef.current) {
        setIsSyncingCloud(false);
        if (options.showBlockingOverlay) {
          setIsBlockingCloudSync(false);
        }
      }
    }
  }, [finishCloudSync, isCloudWriteEnabled, syncProjectDraftToCloud]);

  useEffect(() => {
    if (!project || !isDirty || !isCloudWriteEnabled) {
      return;
    }

    const projectSnapshot = project;
    const timeoutId = window.setTimeout(() => {
      void syncCurrentProjectToCloud(projectSnapshot);
    }, 15_000);

    return () => window.clearTimeout(timeoutId);
  }, [isCloudWriteEnabled, isDirty, project, syncCurrentProjectToCloud]);

  useEffect(() => {
    if (!project || isDirty || isCurrentVersionCloudSaved || !isCloudWriteEnabled) {
      return;
    }

    const projectSnapshot = project;
    const timeoutId = window.setTimeout(() => {
      void syncCurrentProjectToCloud(projectSnapshot);
    }, 1_000);

    return () => window.clearTimeout(timeoutId);
  }, [isCloudWriteEnabled, isCurrentVersionCloudSaved, isDirty, project, syncCurrentProjectToCloud]);

  useEffect(() => {
    if (!project || !isDirty || !isCloudWriteEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const latestProject = useProjectStore.getState().project;
      if (!latestProject) {
        return;
      }
      void syncCurrentProjectToCloud(latestProject);
    }, 5 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [isCloudWriteEnabled, isDirty, project, syncCurrentProjectToCloud]);

  const handleGoToDashboard = useCallback(async () => {
    if (isSyncingCloud) {
      return;
    }

    const projectSnapshot = project;
    const projectIdToClose = projectSnapshot?.id ?? null;
    const shouldBlockForSync = !!projectSnapshot && hasUnsavedCloudChanges;

    if (projectSnapshot && shouldBlockForSync) {
      const synced = await syncCurrentProjectToCloud(projectSnapshot, {
        showBlockingOverlay: true,
        allowPullIntoEditor: true,
      });
      if (!synced) {
        alert('Cloud save failed. Please try Save Now again before leaving.');
        return;
      }
    }

    closeProject();
    navigate('/');

    if (projectIdToClose && !shouldBlockForSync && isCloudWriteEnabled) {
      void syncProjectToCloud(projectIdToClose);
    }
  }, [
    closeProject,
    hasUnsavedCloudChanges,
    isCloudWriteEnabled,
    isSyncingCloud,
    navigate,
    project,
    syncCurrentProjectToCloud,
    syncProjectToCloud,
  ]);

  const handleSaveNow = useCallback(async () => {
    if (!project || isSyncingCloud) {
      return;
    }

    manualSaveMetricsRef.current = {
      projectId: project.id,
      updatedAtMs: project.updatedAt.getTime(),
      startedAtMs: performance.now(),
      uploadSizeBytes: null,
      phaseDurationsMs: null,
    };
    const synced = await syncCurrentProjectToCloud(project, { allowPullIntoEditor: true });
    if (!synced) {
      alert('Cloud save failed. Please try Save Now again.');
    }
  }, [isSyncingCloud, project, syncCurrentProjectToCloud]);

  const handleToggleDarkMode = useCallback(async () => {
    const nextIsDarkMode = !isDarkMode;
    useEditorStore.getState().toggleDarkMode();
    try {
      await updateMySettings({ isDarkMode: nextIsDarkMode });
    } catch (error) {
      console.error('[UserSettings] Failed to persist dark mode setting:', error);
    }
  }, [isDarkMode, updateMySettings]);

  const saveControlState = !project
    ? 'saved'
    : cloudSaveState.status === 'saving'
      ? 'saving'
      : isCurrentVersionCloudSaved
        ? 'saved'
        : 'save';

  useEffect(() => {
    if (!isProjectLeaseBlocking || !isPlaying) {
      return;
    }
    stopPlaying();
  }, [isPlaying, isProjectLeaseBlocking, stopPlaying]);

  useEffect(() => {
    if (!project || isPlaying || backgroundEditorOpen || worldBoundaryEditorOpen) {
      setIsStageCanvasFullscreen(false);
    }
  }, [backgroundEditorOpen, isPlaying, project, worldBoundaryEditorOpen]);

  const handleCodeEditorFullscreenChange = useCallback((isFullscreen: boolean) => {
    if (isFullscreen) {
      setIsStageCanvasFullscreen(false);
      setFullscreenPanel('code');
      return;
    }

    setFullscreenPanel(null);
  }, []);

  const handleStageCanvasFullscreenChange = useCallback((isFullscreen: boolean) => {
    if (isFullscreen) {
      setFullscreenPanel(null);
    }
    setIsStageCanvasFullscreen(isFullscreen);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isTyping = isTextEntryTarget(e.target);
    const isInBlocklyArea = isBlocklyShortcutTarget(e.target);

    if (e.defaultPrevented || e.isComposing) {
      return;
    }

    if (ASSISTANT_UI_ENABLED && assistantLockRunId) {
      e.preventDefault();
      return;
    }

    if (isProjectLeaseBlocking) {
      e.preventDefault();
      return;
    }

    if (backgroundEditorOpen) {
      if (isTyping) {
        return;
      }

      const handled = backgroundShortcutHandler?.(e) ?? false;
      if (handled) {
        return;
      }

      if (
        e.key === '`' ||
        e.key === 'Escape' ||
        e.key === 'Enter' ||
        e.key === 'Delete' ||
        e.key === 'Backspace' ||
        e.metaKey ||
        e.ctrlKey
      ) {
        e.preventDefault();
      }
      return;
    }

    // Backtick for fullscreen toggle
    if (e.key === '`' && !isTyping) {
      e.preventDefault();
      if (fullscreenPanel === 'code') {
        handleCodeEditorFullscreenChange(false);
      } else if (isStageCanvasFullscreen) {
        handleStageCanvasFullscreenChange(false);
      } else {
        const panelFromTarget = getPanelFromElement(target);
        const pointerPosition = lastPointerPositionRef.current;
        const elementUnderPointer = pointerPosition
          ? document.elementFromPoint(pointerPosition.x, pointerPosition.y)
          : null;
        const panelFromPointer = getPanelFromElement(elementUnderPointer);
        const panelToFullscreen = panelFromPointer ?? panelFromTarget ?? hoveredPanelRef.current;

        if (panelToFullscreen === 'code') {
          handleCodeEditorFullscreenChange(true);
        } else if (panelToFullscreen === 'stage') {
          handleStageCanvasFullscreenChange(true);
        }
      }
      return;
    }

    // Stage view toggle: C
    if (
      e.key.toLowerCase() === 'c' &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !isTyping &&
      !isInBlocklyArea &&
      !isPlaying
    ) {
      e.preventDefault();
      cycleViewMode();
      return;
    }

    // Escape to exit fullscreen or stop playing
    if (e.key === 'Escape' && !isTyping) {
      e.preventDefault();
      if (fullscreenPanel === 'code') {
        handleCodeEditorFullscreenChange(false);
        return;
      }
      if (isStageCanvasFullscreen) {
        handleStageCanvasFullscreenChange(false);
        return;
      }
      if (isPlaying) {
        stopPlaying();
        return;
      }
    }

    // Undo: Cmd+Z or Ctrl+Z
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      if (isTyping && !isInBlocklyArea) {
        return;
      }
      e.preventDefault();
      undo();
      return;
    }

    // Redo: Cmd+Shift+Z / Ctrl+Shift+Z / Ctrl+Y
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
      if (isTyping && !isInBlocklyArea) {
        return;
      }
      e.preventDefault();
      redo();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      if (isTyping && !isInBlocklyArea) {
        return;
      }
      e.preventDefault();
      redo();
      return;
    }

    // Duplicate selected object(s): Cmd/Ctrl + D (disabled in Blockly area)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      if (isTyping) {
        return;
      }

      if (activeObjectTab === 'costumes') {
        e.preventDefault();
        void Promise.resolve(costumeUndoHandler?.duplicateSelection?.()).catch((error) => {
          console.error('Failed to duplicate costume selection:', error);
        });
        return;
      }

      if (isInBlocklyArea || !selectedSceneId) {
        return;
      }

      const idsToDuplicate = selectedObjectIds.length > 0
        ? selectedObjectIds
        : (selectedObjectId ? [selectedObjectId] : []);

      if (idsToDuplicate.length === 0) {
        return;
      }

      e.preventDefault();

      duplicateSceneObjectsWithHistory({
        source: 'shortcut:duplicate',
        sceneId: selectedSceneId,
        objectIds: idsToDuplicate,
        duplicateObject,
        selectObjects,
      });
      return;
    }

    // Delete selected object(s): Delete/Backspace (disabled in Blockly area)
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && !isInBlocklyArea) {
      if (activeObjectTab === 'costumes') {
        e.preventDefault();
        costumeUndoHandler?.deleteSelection?.();
        return;
      }

      if (!selectedSceneId) {
        return;
      }

      const idsToDelete = selectedObjectIds.length > 0
        ? selectedObjectIds
        : (selectedObjectId ? [selectedObjectId] : []);

      if (idsToDelete.length === 0) {
        return;
      }

      e.preventDefault();
      const selectedScene = project?.scenes.find((scene) => scene.id === selectedSceneId);
      const orderedSceneObjectIds = selectedScene
        ? getSceneObjectsInLayerOrder(selectedScene).map((object) => object.id)
        : [];

      deleteSceneObjectsWithHistory({
        source: 'shortcut:delete',
        sceneId: selectedSceneId,
        deleteIds: idsToDelete,
        orderedSceneObjectIds,
        selectedObjectId,
        selectedObjectIds: idsToDelete.length > 0 ? idsToDelete : [],
        removeObject,
        selectObject: (objectId) => selectObjects(objectId ? [objectId] : [], objectId),
        selectObjects,
      });
      return;
    }

    if (e.key === 'Enter' && activeObjectTab === 'costumes' && costumeUndoHandler?.isTextEditing?.()) {
      return;
    }

    if (
      e.key === 'Enter' &&
      !isTyping &&
      !isPlaying &&
      project &&
      (fullscreenPanel === null || fullscreenPanel === 'code')
    ) {
      e.preventDefault();
      tryStartPlaying();
      return;
    }
  }, [
    isPlaying,
    project,
    stopPlaying,
    fullscreenPanel,
    isStageCanvasFullscreen,
    undo,
    redo,
    selectedSceneId,
    selectedObjectId,
    selectedObjectIds,
    duplicateObject,
    removeObject,
    selectObjects,
    getPanelFromElement,
    activeObjectTab,
    costumeUndoHandler,
    backgroundEditorOpen,
    backgroundShortcutHandler,
    cycleViewMode,
    handleCodeEditorFullscreenChange,
    handleStageCanvasFullscreenChange,
    assistantLockRunId,
    isProjectLeaseBlocking,
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleDividerDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dispatchEditorResizeFreeze(true);
    setIsMainDividerDragging(true);
    const startX = e.clientX;
    const startPos = dividerPosition;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const containerWidth = window.innerWidth;
      const newPos = startPos + (deltaX / containerWidth) * 100;
      setDividerPosition(Math.max(20, Math.min(70, newPos)));
    };

    const handleMouseUp = () => {
      dispatchEditorResizeFreeze(false);
      setIsMainDividerDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const projectLeaseOverlay = isProjectLeaseBlocking ? (
    <div className="fixed inset-0 z-[100240] bg-background/72 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border bg-background px-6 py-5 shadow-2xl">
        <h2 className="text-lg font-semibold">
          {leaseStatus === 'acquiring'
            ? 'Checking active editor...'
            : leaseStatus === 'lost'
              ? 'Editing moved to another editor'
              : leaseStatus === 'error'
                ? 'Could not verify editor ownership'
                : 'Another editor is active'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {leaseStatus === 'acquiring'
            ? 'Please wait while we confirm whether this project is already being edited elsewhere.'
            : leaseStatus === 'error'
              ? 'We could not confirm the current editor lease for this project.'
              : activeEditorSessionId
                ? `Project ${leaseProjectId} is currently owned by another editor session.`
                : 'This project is currently blocked from editing in this window.'}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              closeProject();
              navigate('/');
            }}
          >
            Go Back
          </Button>
          {leaseStatus === 'error' ? (
            <Button onClick={() => void retryLease()}>
              Retry
            </Button>
          ) : leaseStatus === 'acquiring' ? null : (
            <Button onClick={() => void handleTakeOverLease()}>
              Edit Here
            </Button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const withProjectLeaseOverlay = (content: ReactNode) => (
    <>
      {content}
      {projectLeaseOverlay}
    </>
  );

  if (isLoading || isMigratingProjects) {
    return withProjectLeaseOverlay(
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{isMigratingProjects ? 'Migrating projects...' : 'Loading project...'}</p>
        </div>
      </div>,
    );
  }

  if (isPlaying) {
    return withProjectLeaseOverlay(
      <StagePanel
        fullscreen
        isCanvasFullscreen={false}
        onCanvasFullscreenChange={handleStageCanvasFullscreenChange}
      />,
    );
  }

  if (backgroundEditorOpen) {
    return withProjectLeaseOverlay(<BackgroundCanvasEditor />);
  }

  if (worldBoundaryEditorOpen) {
    return withProjectLeaseOverlay(<WorldBoundaryEditor />);
  }

  return withProjectLeaseOverlay(
    <div className="relative flex flex-col h-screen bg-background">
      {project ? (
        <EditorTopBar
          hasProject={!!project}
          isDarkMode={isDarkMode}
          projectName={project.name}
          projectNameDisabled={isSyncingCloud}
          saveControlState={saveControlState}
          saveNowDisabled={!isCloudWriteEnabled || saveControlState === 'saved'}
          onExportProject={() => {
            if (!project || isSyncingCloud) {
              return;
            }
            void downloadProject(project);
          }}
          onGoToDashboard={() => {
            void handleGoToDashboard();
          }}
          onOpenHistory={() => setHistoryOpen(true)}
          onProjectNameCommit={(name) => updateProjectName(name)}
          onSaveNow={() => {
            void handleSaveNow();
          }}
          onToggleTheme={() => {
            void handleToggleDarkMode();
          }}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {project ? (
          <>
            {/* Object Editor - Left Panel */}
            <div
              className="h-full min-w-0 overflow-hidden"
              data-editor-panel="code"
              style={{ width: `${dividerPosition}%` }}
              onMouseEnter={() => setHoveredPanel('code')}
              onMouseLeave={() => setHoveredPanel(null)}
            >
              <ObjectEditor
                isFullscreen={fullscreenPanel === 'code'}
                onFullscreenChange={handleCodeEditorFullscreenChange}
              />
            </div>

            {/* Resizable Divider */}
            <div
              data-testid="editor-layout-divider"
              className="app-resize-divider-x hover:text-primary cursor-col-resize transition-colors"
              onMouseDown={handleDividerDrag}
            />

            {/* Stage Panel - Right Panel */}
            <div
              className="h-full min-w-0 overflow-hidden"
              data-editor-panel="stage"
              style={{ width: `${100 - dividerPosition}%` }}
              onMouseEnter={() => setHoveredPanel('stage')}
              onMouseLeave={() => setHoveredPanel(null)}
            >
              <StagePanel
                deferEditorResize={isMainDividerDragging}
                isCanvasFullscreen={isStageCanvasFullscreen}
                onCanvasFullscreenChange={handleStageCanvasFullscreenChange}
              />
            </div>
          </>
        ) : (
          <ProjectExplorerPage
            onProjectOpen={handleProjectOpen}
            onProjectHydratedFromCloud={markProjectAsCloudSaved}
          />
        )}
      </div>

      {project && showProjectDialog && (
        <ProjectDialog
          onClose={() => setShowProjectDialog(false)}
          onProjectOpen={handleProjectOpen}
        />
      )}

      <ProjectHistoryDialog
        project={project}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestoredProject={(restoredProject) => {
          openProject(restoredProject);
          navigate(`/project/${restoredProject.id}`);
        }}
      />

      <PlayValidationDialog
        open={showPlayValidationDialog}
        issues={playValidationIssues}
        onOpenChange={setShowPlayValidationDialog}
        onIssueClick={focusPlayValidationIssue}
      />

      {/* Object picker overlay */}
      <ObjectPicker />

      {isBlockingCloudSync && (
        <div className="fixed inset-0 z-[100002] bg-black/45 flex items-center justify-center">
          <div className="rounded-lg border bg-background px-5 py-4 text-sm shadow-xl">
            Please wait, Uploading/Syncing to Cloud.
          </div>
        </div>
      )}

      {ASSISTANT_UI_ENABLED && assistantLockRunId && !isBlockingCloudSync ? (
        <div className="fixed inset-0 z-[100250] bg-background/70 backdrop-blur-[1px] flex items-center justify-center">
          <div className="rounded-lg border bg-background px-5 py-4 text-sm shadow-xl">
            {assistantLockMessage ?? 'Assistant is working. The editor is temporarily locked.'}
          </div>
        </div>
      ) : null}

      {ASSISTANT_UI_ENABLED ? <AiAssistantPanel /> : null}
    </div>,
  );
}
