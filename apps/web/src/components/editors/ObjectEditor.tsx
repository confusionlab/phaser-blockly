import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { ObjectEditorTab } from '@/store/editorStore';
import { BlocklyEditor } from '../blockly/BlocklyEditor';
import { CostumeEditor } from './CostumeEditor';
import { SoundEditor } from './SoundEditor';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { Code, Maximize2, Minimize2, Palette, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { freezeEditorResizeForLayoutTransition } from '@/lib/freezeEditorResize';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';

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
  const { project } = useProjectStore();
  const {
    selectedSceneId,
    selectedFolderId,
    selectedObjectId,
    selectedComponentId,
    selectObject,
    activeObjectTab,
    costumeUndoHandler,
    setActiveObjectTab,
  } = useEditorStore();

  const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
  const hasCodeTarget = !!selectedObjectId || !!selectedComponentId;
  const hasObjectAssetTarget = !!selectedObjectId;
  const emptyStateMessage = !hasCodeTarget ? NO_OBJECT_SELECTED_MESSAGE : null;
  const [mountedTabs, setMountedTabs] = useState<Record<ObjectEditorTab, boolean>>({
    code: true,
    costumes: false,
    sounds: false,
  });

  useEffect(() => {
    if (selectedComponentId || selectedFolderId || !scene) {
      return;
    }

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
    if (nextTab === activeObjectTab) {
      return;
    }

    freezeEditorResizeForLayoutTransition();
    setMountedTabs((current) => (
      current[nextTab]
        ? current
        : { ...current, [nextTab]: true }
    ));

    void (async () => {
      if (activeObjectTab === 'costumes') {
        await costumeUndoHandler?.flushPendingState?.({
          includePreview: true,
          settleHistory: true,
        });
      }
      setActiveObjectTab(nextTab);
    })();
  }, [activeObjectTab, costumeUndoHandler, setActiveObjectTab]);

  const toggleFullscreen = useCallback(() => {
    freezeEditorResizeForLayoutTransition();
    onFullscreenChange(!isFullscreen);
  }, [isFullscreen, onFullscreenChange]);

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
        {hasCodeTarget ? (
          <div className={cn(panelHeaderClassNames.chrome, 'h-[var(--editor-panel-header-height)]')}>
            <div className="grid h-full w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div aria-hidden="true" />
              <div className="flex justify-center">
                <SegmentedControl
                  ariaLabel="Object editor sections"
                  className="max-w-full"
                  layout="content"
                  options={sectionOptions}
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
        ) : null}

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
      </div>
    </div>
  );
}
