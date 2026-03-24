import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { ObjectEditorTab } from '@/store/editorStore';
import { BlocklyEditor } from '../blockly/BlocklyEditor';
import { CostumeEditor } from './CostumeEditor';
import { SoundEditor } from './SoundEditor';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { Code, Palette, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const objectEditorSections: SegmentedControlOption<ObjectEditorTab>[] = [
  { value: 'code', label: 'Code', icon: <Code className="size-3.5" /> },
  { value: 'costumes', label: 'Costume', icon: <Palette className="size-3.5" /> },
  { value: 'sounds', label: 'Sound', icon: <Volume2 className="size-3.5" /> },
];

export function ObjectEditor() {
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

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const isFolderSelected = !!selectedFolderId;
  const hasCodeTarget = !!selectedObjectId || !!selectedComponentId;
  const hasObjectAssetTarget = !!selectedObjectId;
  const emptyStateMessage = isFolderSelected
    ? 'Folder selected'
    : (!hasCodeTarget ? 'Nothing selected' : null);
  const [mountedTabs, setMountedTabs] = useState<Record<ObjectEditorTab, boolean>>({
    code: true,
    costumes: false,
    sounds: false,
  });

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
    setMountedTabs((current) => (
      current[nextTab]
        ? current
        : { ...current, [nextTab]: true }
    ));
    setActiveObjectTab(nextTab);
  }, [setActiveObjectTab]);

  const sectionOptions = objectEditorSections.map((section) => ({
    ...section,
    disabled: section.value !== 'code' && !hasObjectAssetTarget,
  }));

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-0">
        {!emptyStateMessage ? (
          <div className="shrink-0 border-b border-zinc-200/80 px-3 py-1.5 dark:border-white/10">
            <SegmentedControl
              ariaLabel="Object editor sections"
              className="w-full"
              options={sectionOptions}
              value={activeObjectTab}
              onValueChange={handleSectionChange}
            />
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
