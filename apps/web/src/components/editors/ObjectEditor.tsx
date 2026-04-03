import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { ObjectEditorTab } from '@/store/editorStore';
import { BlocklyEditor } from '../blockly/BlocklyEditor';
import { CostumeEditor } from './CostumeEditor';
import { SoundEditor } from './SoundEditor';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { IconButton } from '@/components/ui/icon-button';
import { Code, Maximize2, Minimize2, Palette, Volume2 } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';

const objectEditorSections: SegmentedControlOption<ObjectEditorTab>[] = [
  { value: 'code', label: 'Code', icon: <Code className="size-3" /> },
  { value: 'costumes', label: 'Costumes', icon: <Palette className="size-3" /> },
  { value: 'sounds', label: 'Sounds', icon: <Volume2 className="size-3" /> },
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
    setActiveObjectTab,
  } = useEditorStore();

  const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
  const hasCodeTarget = !!selectedObjectId || !!selectedComponentId;
  const hasObjectAssetTarget = !!selectedObjectId || !!selectedComponentId;
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
    if ((selectedFolderId || !hasCodeTarget) && activeObjectTab !== 'code') {
      setActiveObjectTab('code');
    }
  }, [activeObjectTab, hasCodeTarget, selectedFolderId, setActiveObjectTab]);

  useEffect(() => {
    setMountedTabs((current) => (
      current[activeObjectTab]
        ? current
        : { ...current, [activeObjectTab]: true }
    ));
  }, [activeObjectTab]);

  const handleSectionChange = useCallback((nextTab: ObjectEditorTab) => {
    setMountedTabs((current) => (
      current[nextTab]
        ? current
        : { ...current, [nextTab]: true }
    ));
    setActiveObjectTab(nextTab);
  }, [setActiveObjectTab]);

  const toggleFullscreen = useCallback(() => {
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
                <IconButton
                  className="size-6"
                  data-testid="object-editor-fullscreen-toggle"
                  label={isFullscreen ? 'Exit fullscreen editor' : 'Fullscreen editor'}
                  pressed={isFullscreen}
                  onClick={toggleFullscreen}
                  shape="pill"
                  size="xs"
                >
                  {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </IconButton>
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
