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
import type { Project } from '@/types';
import { EditorTopBar } from '@/components/layout/EditorTopBar';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import {
  createProjectConflictCopy,
  createAutoCheckpoint,
  downloadProject,
  ensureProjectThumbnail,
  getStoredProjectCacheInfo,
  loadProject,
  persistProjectSnapshotWithOptions,
  recoverLegacyStoredProject,
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
import {
  deriveEditorSaveControlState,
  shouldTreatOpenedProjectAsCloudSaved,
} from '@/lib/cloudProjectState';
import { tryStartPlaying } from '@/lib/playStartGuard';
import { getSceneObjectsInLayerOrder } from '@/utils/layerTree';
import {
  getSelectionNudgeDelta,
  isBlocklyShortcutTarget,
  isSceneObjectShortcutSurfaceTarget,
  isTextEntryTarget,
} from '@/utils/keyboard';
import { useModal } from '@/components/ui/modal-provider';
import {
  copySceneObjectsToClipboard,
  cutSceneObjectsWithHistory,
  deleteSceneObjectsWithHistory,
  duplicateSceneObjectsWithHistory,
  nudgeSceneObjectsWithHistory,
  pasteSceneObjectClipboardWithHistory,
} from '@/lib/editor/objectCommands';

type HoveredPanel = 'code' | 'stage' | null;
type FullscreenPanel = 'code' | null;
type CloudSaveState = {
  status: 'saved' | 'unsaved' | 'saving' | 'error';
  lastSavedAt: number | null;
  errorMessage: string | null;
};

type ProjectLoadState = {
  progress: number;
  detail: string;
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
  'refreshThumbnail',
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
  refreshThumbnail: 'refresh thumbnail',
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

function ProjectRouteLoadingScreen({ detail, progress }: ProjectLoadState) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Loading</h1>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border/70">
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(6, Math.min(100, progress))}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{detail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EditorLayout() {
  const { showAlert } = useModal();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const {
    project,
    isDirty,
    openProject,
    acknowledgeProjectSaved,
    closeProject,
    addObject,
    duplicateObject,
    removeObject,
    updateObject,
    updateProjectName,
  } = useProjectStore();
  const {
    isPlaying,
    isDarkMode,
    showAdvancedBlocks,
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
  const [hoveredPanel, setHoveredPanel] = useState<HoveredPanel>(null);
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>(null);
  const [isStageCanvasFullscreen, setIsStageCanvasFullscreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [projectLoadState, setProjectLoadState] = useState<ProjectLoadState>({
    progress: 8,
    detail: 'Opening project page…',
  });
  const [isManualSaveInProgress, setIsManualSaveInProgress] = useState(false);
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
  const isLeaseCheckInProgress = !!leaseProjectId && leaseStatus === 'acquiring';
  const isProjectLeaseBlocking = !!leaseProjectId
    && leaseStatus !== 'active'
    && leaseStatus !== 'idle'
    && leaseStatus !== 'acquiring';
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
  const { syncProjectDraftToCloud, syncProjectExplorerToCloud, syncProjectToCloud, syncProjectFromCloud } = useCloudSync({
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

  const publishProjectThumbnailToCloud = useCallback(async (projectId: string, projectSnapshot?: Project) => {
    try {
      const thumbnailResult = await ensureProjectThumbnail(
        projectId,
        projectSnapshot ? { project: projectSnapshot } : undefined,
      );
      if (thumbnailResult.changed && isCloudWriteEnabled) {
        await syncProjectExplorerToCloud();
      }
    } catch (error) {
      console.error('[ProjectThumbnail] Failed to publish thumbnail after sync:', error);
    }
  }, [isCloudWriteEnabled, syncProjectExplorerToCloud]);

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
      if (!projectId) {
        navigate('/', { replace: true });
        return;
      }

      if (!project || project.id !== projectId) {
        setIsLoading(true);
        try {
          setProjectLoadState({
            progress: 18,
            detail: 'Checking cloud status…',
          });
          const cloudPull = await syncProjectFromCloud(projectId);
          setProjectLoadState({
            progress: 42,
            detail: 'Checking local cache…',
          });
          const cacheInfo = await getStoredProjectCacheInfo(projectId);
          if (cloudPull.status === 'missing') {
            if (cacheInfo.origin === 'cloudCache') {
              navigate('/', { replace: true });
              return;
            }
            if (cacheInfo.origin === 'legacyUnknown') {
              setProjectLoadState({
                progress: 58,
                detail: 'Recovering local project…',
              });
              const recoveredProjectId = await recoverLegacyStoredProject(projectId);
              if (recoveredProjectId && recoveredProjectId !== projectId) {
                navigate(`/project/${recoveredProjectId}`, { replace: true });
                return;
              }
            }
          }
          setProjectLoadState({
            progress: 76,
            detail: 'Loading project data…',
          });
          const loadedProject = await loadProject(projectId);
          if (loadedProject) {
            setProjectLoadState({
              progress: 92,
              detail: 'Preparing editor…',
            });
            if (shouldTreatOpenedProjectAsCloudSaved({
              openedFromCloudCache: cacheInfo.origin === 'cloudCache',
              matchesCloudHead: cloudPull.matchesCloudHead,
              pullStatus: cloudPull.status,
            })) {
              markProjectAsCloudSaved(loadedProject);
            }
            if (cloudPull.changed) {
              void publishProjectThumbnailToCloud(loadedProject.id, loadedProject);
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
      }
    };

    void loadFromUrl();
  }, [markProjectAsCloudSaved, navigate, openProject, project, projectId, publishProjectThumbnailToCloud, syncProjectFromCloud]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    if (!project || project.id !== projectId) {
      setProjectLoadState({
        progress: 8,
        detail: 'Opening project page…',
      });
    }
  }, [project, projectId]);

  // Keep selection aligned with the active project as projects open, close, or change shape.
  useEffect(() => {
    reconcileSelectionToProject(project, { recordHistory: false });
  }, [project, reconcileSelectionToProject]);

  // Navigate to project URL when project is opened
  const handleProjectOpen = useCallback((openedProject: { id: string }) => {
    if (project?.id !== openedProject.id) {
      closeProject();
    }
    navigate(`/project/${openedProject.id}`);
    setShowProjectDialog(false);
  }, [closeProject, navigate, project?.id, setShowProjectDialog]);

  const persistCloudSavedProject = useCallback(async (projectSnapshot: Project) => {
    try {
      const cachedProject = await persistProjectSnapshotWithOptions(projectSnapshot, {
        storageOrigin: 'cloudCache',
        assetGcMode: 'deferred',
      });
      const cachedUpdatedAtMs = cachedProject.updatedAt.getTime();
      lastCloudSavedVersionRef.current.set(projectSnapshot.id, cachedUpdatedAtMs);
      acknowledgeProjectSaved(projectSnapshot);
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
      const thumbnailRefreshStartedAtMs = performance.now();
      await publishProjectThumbnailToCloud(projectSnapshot.id, projectSnapshot);
      const thumbnailRefreshMs = performance.now() - thumbnailRefreshStartedAtMs;
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
            refreshThumbnail: thumbnailRefreshMs,
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
        await publishProjectThumbnailToCloud(refreshedProject.id, refreshedProject);
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
  }, [openProject, persistCloudSavedProject, publishProjectThumbnailToCloud]);

  const handleTakeOverLease = useCallback(async () => {
    const didAcquire = await takeOverLease();
    if (!didAcquire || !leaseProjectId) {
      return;
    }

    try {
      const cloudPull = await syncProjectFromCloud(leaseProjectId);
      const cacheInfo = await getStoredProjectCacheInfo(leaseProjectId);
      if (cloudPull.status === 'missing') {
        if (cacheInfo.origin === 'cloudCache') {
          navigate('/', { replace: true });
          return;
        }
        if (cacheInfo.origin === 'legacyUnknown') {
          const recoveredProjectId = await recoverLegacyStoredProject(leaseProjectId);
          if (recoveredProjectId && recoveredProjectId !== leaseProjectId) {
            navigate(`/project/${recoveredProjectId}`, { replace: true });
            return;
          }
        }
      }
      const refreshedProject = await loadProject(leaseProjectId);
      if (refreshedProject) {
        if (shouldTreatOpenedProjectAsCloudSaved({
          openedFromCloudCache: cacheInfo.origin === 'cloudCache',
          matchesCloudHead: cloudPull.matchesCloudHead,
          pullStatus: cloudPull.status,
        })) {
          markProjectAsCloudSaved(refreshedProject);
        }
        if (cloudPull.changed) {
          void publishProjectThumbnailToCloud(refreshedProject.id, refreshedProject);
        }
        openProject(refreshedProject);
      }
    } catch (error) {
      console.error('[ProjectLease] Failed to refresh project after takeover:', error);
    }
  }, [leaseProjectId, markProjectAsCloudSaved, navigate, openProject, publishProjectThumbnailToCloud, syncProjectFromCloud, takeOverLease]);

  const syncCurrentProjectToCloud = useCallback(async (
    projectSnapshot: Project,
    options: {
      showBlockingOverlay?: boolean;
      allowPullIntoEditor?: boolean;
      uiMode?: 'visible' | 'silent';
    } = {},
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
    if (options.uiMode !== 'silent') {
      setCloudSaveState({
        status: 'saving',
        lastSavedAt: lastCloudSavedVersionRef.current.get(projectSnapshot.id) ?? null,
        errorMessage: null,
      });
    }
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
      void syncCurrentProjectToCloud(projectSnapshot, { uiMode: 'silent' });
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
        await showAlert({
          title: 'Cloud Save Failed',
          description: 'Cloud save failed. Please try Save Now again before leaving.',
          tone: 'destructive',
        });
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
    showAlert,
    syncCurrentProjectToCloud,
    syncProjectToCloud,
  ]);

  const handleSaveNow = useCallback(async () => {
    if (!project || isSyncingCloud) {
      return;
    }

    setIsManualSaveInProgress(true);
    manualSaveMetricsRef.current = {
      projectId: project.id,
      updatedAtMs: project.updatedAt.getTime(),
      startedAtMs: performance.now(),
      uploadSizeBytes: null,
      phaseDurationsMs: null,
    };
    try {
      const synced = await syncCurrentProjectToCloud(project, { allowPullIntoEditor: true });
      if (!synced) {
        await showAlert({
          title: 'Cloud Save Failed',
          description: 'Cloud save failed. Please try Save Now again.',
          tone: 'destructive',
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsManualSaveInProgress(false);
      }
    }
  }, [isSyncingCloud, project, showAlert, syncCurrentProjectToCloud]);

  const handleToggleDarkMode = useCallback(async () => {
    const nextIsDarkMode = !isDarkMode;
    useEditorStore.getState().toggleDarkMode();
    try {
      await updateMySettings({ isDarkMode: nextIsDarkMode });
    } catch (error) {
      console.error('[UserSettings] Failed to persist dark mode setting:', error);
    }
  }, [isDarkMode, updateMySettings]);

  const saveControlState = deriveEditorSaveControlState({
    hasProject: !!project,
    isDirty,
    hasActionableCloudError: cloudSaveState.status === 'error',
    isManualSaveInProgress,
  });

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
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
    const isTyping = isTextEntryTarget(e.target);
    const isInBlocklyArea = isBlocklyShortcutTarget(e.target);
    const isSceneObjectShortcutContext = isSceneObjectShortcutSurfaceTarget(e.target)
      || isSceneObjectShortcutSurfaceTarget(activeElement);
    const selectedSceneObjectIds = selectedObjectIds.length > 0
      ? selectedObjectIds
      : (selectedObjectId ? [selectedObjectId] : []);

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

      if (!isSceneObjectShortcutContext && activeObjectTab === 'costumes') {
        e.preventDefault();
        void Promise.resolve(costumeUndoHandler?.duplicateSelection?.()).catch((error) => {
          console.error('Failed to duplicate costume selection:', error);
        });
        return;
      }

      if (!isSceneObjectShortcutContext || isInBlocklyArea || !selectedSceneId) {
        return;
      }

      if (selectedSceneObjectIds.length === 0) {
        return;
      }

      e.preventDefault();

      duplicateSceneObjectsWithHistory({
        source: 'shortcut:duplicate',
        sceneId: selectedSceneId,
        objectIds: selectedSceneObjectIds,
        duplicateObject,
        selectObjects,
      });
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && !e.altKey) {
      if (isTyping) {
        return;
      }

      if (!isSceneObjectShortcutContext && activeObjectTab === 'costumes') {
        e.preventDefault();
        void Promise.resolve(costumeUndoHandler?.copySelection?.()).catch((error) => {
          console.error('Failed to copy costume selection:', error);
        });
        return;
      }

      if (!isSceneObjectShortcutContext || isInBlocklyArea || !project || !selectedSceneId || selectedSceneObjectIds.length === 0) {
        return;
      }

      e.preventDefault();
      copySceneObjectsToClipboard(project, selectedSceneId, selectedSceneObjectIds);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && !e.altKey) {
      if (isTyping) {
        return;
      }

      if (!isSceneObjectShortcutContext && activeObjectTab === 'costumes') {
        e.preventDefault();
        void Promise.resolve(costumeUndoHandler?.pasteSelection?.()).catch((error) => {
          console.error('Failed to paste costume selection:', error);
        });
        return;
      }

      if (!isSceneObjectShortcutContext || isInBlocklyArea || !project || !selectedSceneId) {
        return;
      }

      const pastedIds = pasteSceneObjectClipboardWithHistory({
        source: 'shortcut:paste',
        project,
        sceneId: selectedSceneId,
        addObject,
        updateObject,
        selectObjects,
      });
      if (pastedIds.length > 0) {
        e.preventDefault();
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x' && !e.altKey) {
      if (isTyping) {
        return;
      }

      if (!isSceneObjectShortcutContext && activeObjectTab === 'costumes') {
        e.preventDefault();
        void Promise.resolve(costumeUndoHandler?.cutSelection?.()).catch((error) => {
          console.error('Failed to cut costume selection:', error);
        });
        return;
      }

      if (!isSceneObjectShortcutContext || isInBlocklyArea || !project || !selectedSceneId || selectedSceneObjectIds.length === 0) {
        return;
      }

      e.preventDefault();
      const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId);
      const orderedSceneObjectIds = selectedScene
        ? getSceneObjectsInLayerOrder(selectedScene).map((object) => object.id)
        : [];

      cutSceneObjectsWithHistory({
        source: 'shortcut:cut',
        project,
        sceneId: selectedSceneId,
        deleteIds: selectedSceneObjectIds,
        orderedSceneObjectIds,
        selectedObjectId,
        selectedObjectIds: selectedSceneObjectIds,
        removeObject,
        selectObject: (objectId) => selectObjects(objectId ? [objectId] : [], objectId),
        selectObjects,
      });
      return;
    }

    // Delete selected object(s): Delete/Backspace (disabled in Blockly area)
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && !isInBlocklyArea) {
      if (!isSceneObjectShortcutContext && activeObjectTab === 'costumes') {
        e.preventDefault();
        costumeUndoHandler?.deleteSelection?.();
        return;
      }

      if (!isSceneObjectShortcutContext || !selectedSceneId) {
        return;
      }

      if (selectedSceneObjectIds.length === 0) {
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
        deleteIds: selectedSceneObjectIds,
        orderedSceneObjectIds,
        selectedObjectId,
        selectedObjectIds: selectedSceneObjectIds,
        removeObject,
        selectObject: (objectId) => selectObjects(objectId ? [objectId] : [], objectId),
        selectObjects,
      });
      return;
    }

    if (isSceneObjectShortcutContext && !isTyping && !isInBlocklyArea && project && selectedSceneId) {
      const nudgeDelta = getSelectionNudgeDelta(e);
      if (nudgeDelta && selectedSceneObjectIds.length > 0) {
        const nudged = nudgeSceneObjectsWithHistory({
          source: 'shortcut:nudge-scene-objects',
          project,
          sceneId: selectedSceneId,
          objectIds: selectedSceneObjectIds,
          dx: nudgeDelta.x,
          dy: -nudgeDelta.y,
          updateObject,
        });
        if (nudged) {
          e.preventDefault();
          return;
        }
      }
    }

    if (!isSceneObjectShortcutContext && activeObjectTab === 'costumes' && !isTyping && !isInBlocklyArea) {
      const nudgeDelta = getSelectionNudgeDelta(e);
      if (nudgeDelta && costumeUndoHandler?.nudgeSelection?.(nudgeDelta.x, nudgeDelta.y)) {
        e.preventDefault();
        return;
      }
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
      void tryStartPlaying();
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
    addObject,
    duplicateObject,
    removeObject,
    updateObject,
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
    const startX = e.clientX;
    const startPos = dividerPosition;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const containerWidth = window.innerWidth;
      const newPos = startPos + (deltaX / containerWidth) * 100;
      setDividerPosition(Math.max(20, Math.min(70, newPos)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const projectLeaseOverlay = isProjectLeaseBlocking ? (
    <div className="fixed inset-0 z-[100240] bg-surface-wash backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border bg-surface-panel px-6 py-5 shadow-2xl">
        <h2 className="text-lg font-semibold">
          {leaseStatus === 'lost'
            ? 'Editing moved to another editor'
            : leaseStatus === 'error'
              ? 'Could not verify editor ownership'
              : 'Another editor is active'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {leaseStatus === 'error'
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
          ) : (
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

  const isRouteProjectReady = !!projectId && !!project && project.id === projectId;
  const projectRouteLoadingState = isLeaseCheckInProgress
    ? {
        progress: Math.max(projectLoadState.progress, 12),
        detail: 'Checking active editor…',
      }
    : projectLoadState;
  const shouldShowProjectLoadingScreen = !isRouteProjectReady || isLoading || isLeaseCheckInProgress;

  if (shouldShowProjectLoadingScreen) {
    return withProjectLeaseOverlay(
      <ProjectRouteLoadingScreen {...projectRouteLoadingState} />,
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
      <EditorTopBar
        hasProject
        isDarkMode={isDarkMode}
        showAdvancedBlocks={showAdvancedBlocks}
        projectName={project.name}
        projectNameDisabled={isSyncingCloud}
        saveControlState={saveControlState}
        saveNowDisabled={!isCloudWriteEnabled || saveControlState === 'saved'}
        onExportProject={() => {
          if (isSyncingCloud) {
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
        onToggleAdvancedBlocks={() => {
          useEditorStore.getState().toggleShowAdvancedBlocks();
        }}
        onToggleTheme={() => {
          void handleToggleDarkMode();
        }}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
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
            isCanvasFullscreen={isStageCanvasFullscreen}
            onCanvasFullscreenChange={handleStageCanvasFullscreenChange}
          />
        </div>
      </div>

      {showProjectDialog && (
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
          closeProject();
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
        <div className="fixed inset-0 z-[100002] bg-surface-scrim flex items-center justify-center">
          <div className="rounded-lg border bg-surface-panel px-5 py-4 text-sm shadow-xl">
            Please wait, Uploading/Syncing to Cloud.
          </div>
        </div>
      )}

      {ASSISTANT_UI_ENABLED && assistantLockRunId && !isBlockingCloudSync ? (
        <div className="fixed inset-0 z-[100250] bg-surface-wash backdrop-blur-[1px] flex items-center justify-center">
          <div className="rounded-lg border bg-surface-panel px-5 py-4 text-sm shadow-xl">
            {assistantLockMessage ?? 'Assistant is working. The editor is temporarily locked.'}
          </div>
        </div>
      ) : null}

      {ASSISTANT_UI_ENABLED ? <AiAssistantPanel /> : null}
    </div>,
  );
}
