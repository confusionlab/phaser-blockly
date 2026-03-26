import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { ObjectEditorTab } from '@/store/editorStore';
import { BlocklyEditor } from '../blockly/BlocklyEditor';
import { CostumeEditor } from './CostumeEditor';
import { SoundEditor } from './SoundEditor';
import { ProjectHistoryDialog } from '@/components/dialogs/ProjectHistoryDialog';
import { ProductMenu } from '@/components/layout/ProductMenu';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { Code, Maximize2, Minimize2, Palette, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { freezeEditorResizeForLayoutTransition } from '@/lib/freezeEditorResize';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import { downloadProject } from '@/db/database';
import { useCloudSync } from '@/hooks/useCloudSync';

const objectEditorSections: SegmentedControlOption<ObjectEditorTab>[] = [
  { value: 'code', label: 'Code', icon: <Code className="size-3" /> },
  { value: 'costumes', label: 'Costume', icon: <Palette className="size-3" /> },
  { value: 'sounds', label: 'Sound', icon: <Volume2 className="size-3" /> },
];

interface ObjectEditorProps {
  isFullscreen: boolean;
  onFullscreenChange: (isFullscreen: boolean) => void;
}

export function ObjectEditor({ isFullscreen, onFullscreenChange }: ObjectEditorProps) {
  const navigate = useNavigate();
  const {
    project,
    isDirty,
    saveCurrentProject,
    closeProject,
    openProject,
    updateProjectName,
  } = useProjectStore();
  const {
    isDarkMode,
    selectedSceneId,
    selectedFolderId,
    selectedObjectId,
    selectedComponentId,
    selectObject,
    selectScene,
    activeObjectTab,
    setActiveObjectTab,
    toggleDarkMode,
  } = useEditorStore();
  const updateMySettings = useMutation(api.userSettings.updateMySettings);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const isMountedRef = useRef(true);

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const hasCodeTarget = !!selectedObjectId || !!selectedComponentId;
  const hasObjectAssetTarget = !!selectedObjectId;
  const emptyStateMessage = !hasCodeTarget ? NO_OBJECT_SELECTED_MESSAGE : null;
  const [mountedTabs, setMountedTabs] = useState<Record<ObjectEditorTab, boolean>>({
    code: true,
    costumes: false,
    sounds: false,
  });
  const { syncProjectToCloud } = useCloudSync({
    currentProjectId: project?.id ?? null,
    currentProject: project,
    isDirty,
    syncOnUnmount: false,
    checkpointIntervalMs: 0,
    backgroundSyncDebounceMs: 0,
  });

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const syncCurrentProjectToCloud = useCallback(async (): Promise<boolean> => {
    if (!project) return true;

    setIsSyncingCloud(true);
    try {
      await saveCurrentProject();
      const synced = await syncProjectToCloud(project.id);
      if (!synced) {
        alert('Cloud sync failed. Please try Upload/Update to Cloud again.');
        return false;
      }
      return true;
    } finally {
      if (isMountedRef.current) {
        setIsSyncingCloud(false);
      }
    }
  }, [project, saveCurrentProject, syncProjectToCloud]);

  useEffect(() => {
    if (selectedComponentId || selectedFolderId || !scene) return;

    if (selectedObjectId && !scene.objects.find((object) => object.id === selectedObjectId)) {
      selectObject(null, { recordHistory: false });
    }
  }, [scene, selectedObjectId, selectedComponentId, selectedFolderId, selectObject]);

  useEffect(() => {
    if ((selectedComponentId || selectedFolderId || !selectedObjectId) && activeObjectTab !== 'code') {
      setActiveObjectTab('code');
    }
  }, [selectedComponentId, selectedFolderId, selectedObjectId, activeObjectTab, setActiveObjectTab]);

  useEffect(() => {
    setMountedTabs((current) => (
      current[activeObjectTab]
        ? current
        : { ...current, [activeObjectTab]: true }
    ));
  }, [activeObjectTab]);

  const handleSectionChange = useCallback((nextTab: ObjectEditorTab) => {
    freezeEditorResizeForLayoutTransition();
    setMountedTabs((current) => (
      current[nextTab]
        ? current
        : { ...current, [nextTab]: true }
    ));
    setActiveObjectTab(nextTab);
  }, [setActiveObjectTab]);

  const toggleFullscreen = useCallback(() => {
    freezeEditorResizeForLayoutTransition();
    onFullscreenChange(!isFullscreen);
  }, [isFullscreen, onFullscreenChange]);

  const handleGoToDashboard = useCallback(async () => {
    if (isSyncingCloud) {
      return;
    }

    if (project) {
      const synced = await syncCurrentProjectToCloud();
      if (!synced) return;
    }

    closeProject();
    navigate('/');
  }, [closeProject, isSyncingCloud, navigate, project, syncCurrentProjectToCloud]);

  const handleToggleDarkMode = useCallback(async () => {
    const nextIsDarkMode = !isDarkMode;
    toggleDarkMode();
    try {
      await updateMySettings({ isDarkMode: nextIsDarkMode });
    } catch (error) {
      console.error('[UserSettings] Failed to persist dark mode setting:', error);
    }
  }, [isDarkMode, toggleDarkMode, updateMySettings]);

  const handleRenameProject = useCallback(() => {
    if (!project) {
      return;
    }

    const nextName = window.prompt('Project name', project.name);
    if (nextName === null) {
      return;
    }

    const trimmedName = nextName.trim();
    if (!trimmedName) {
      alert('Project name cannot be empty.');
      return;
    }

    if (trimmedName !== project.name) {
      updateProjectName(trimmedName);
    }
  }, [project, updateProjectName]);

  const sectionOptions = objectEditorSections.map((section) => ({
    ...section,
    disabled: section.value !== 'code' && !hasObjectAssetTarget,
  }));

  return (
    <div
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card',
        isFullscreen && 'fixed inset-0 z-[100001]',
      )}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-0">
        <div className="shrink-0 border-b border-zinc-200/80 px-3 py-1.5 dark:border-white/10">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="flex justify-start">
              <ProductMenu
                isDarkMode={isDarkMode}
                hasProject={!!project}
                onExportProject={() => {
                  if (!project || isSyncingCloud) return;
                  void downloadProject(project);
                }}
                onGoToDashboard={() => {
                  void handleGoToDashboard();
                }}
                onOpenHistory={() => setHistoryOpen(true)}
                onRenameProject={handleRenameProject}
                onToggleTheme={() => {
                  void handleToggleDarkMode();
                }}
              />
            </div>
            <div className="flex justify-center">
              <SegmentedControl
                ariaLabel="Object editor sections"
                className="max-w-full"
                layout="content"
                options={sectionOptions}
                size="large"
                value={activeObjectTab}
                onValueChange={handleSectionChange}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 rounded-full"
                data-testid="object-editor-fullscreen-toggle"
                title={isFullscreen ? 'Exit fullscreen editor' : 'Fullscreen editor'}
                aria-label={isFullscreen ? 'Exit fullscreen editor' : 'Fullscreen editor'}
                aria-pressed={isFullscreen}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            aria-hidden={activeObjectTab !== 'code'}
            className={cn(
              'h-full min-h-0 min-w-0',
              activeObjectTab !== 'code' && 'hidden',
            )}
          >
            <div className="relative h-full min-w-0">
              <BlocklyEditor />
              {emptyStateMessage ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-card text-muted-foreground">
                  <Code className="mb-4 size-12 opacity-20" />
                  <p className="text-sm">{emptyStateMessage}</p>
                </div>
              ) : null}
            </div>
          </div>

          {mountedTabs.costumes ? (
            <div
              aria-hidden={activeObjectTab !== 'costumes'}
              className={cn(
                'h-full min-h-0 min-w-0',
                activeObjectTab !== 'costumes' && 'hidden',
              )}
            >
              <CostumeEditor />
            </div>
          ) : null}

          {mountedTabs.sounds ? (
            <div
              aria-hidden={activeObjectTab !== 'sounds'}
              className={cn(
                'h-full min-h-0 min-w-0',
                activeObjectTab !== 'sounds' && 'hidden',
              )}
            >
              <SoundEditor />
            </div>
          ) : null}
        </div>

        <ProjectHistoryDialog
          project={project}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          onRestoredProject={(restoredProject) => {
            openProject(restoredProject);
            if (restoredProject.scenes.length > 0) {
              selectScene(restoredProject.scenes[0].id, { recordHistory: false });
            }
            navigate(`/project/${restoredProject.id}`);
          }}
        />

        {isSyncingCloud ? (
          <div className="fixed inset-0 z-[9999] bg-black/45 flex items-center justify-center">
            <div className="rounded-lg border bg-background px-5 py-4 text-sm shadow-xl">
              Please wait, Uploading/Syncing to Cloud.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
