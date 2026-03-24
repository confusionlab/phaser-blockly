import { useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { ObjectEditorTab } from '@/store/editorStore';
import { BlocklyEditor } from '../blockly/BlocklyEditor';
import { CostumeEditor } from './CostumeEditor';
import { SoundEditor } from './SoundEditor';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { Code, Palette, Volume2 } from 'lucide-react';

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

  const sectionOptions = objectEditorSections.map((section) => ({
    ...section,
    disabled: section.value !== 'code' && !hasObjectAssetTarget,
  }));

  const activeEditor = (() => {
    switch (activeObjectTab) {
      case 'costumes':
        return <CostumeEditor />;
      case 'sounds':
        return <SoundEditor />;
      case 'code':
      default:
        return (
          <div className="relative h-full">
            <BlocklyEditor />
            {emptyStateMessage ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-card text-muted-foreground">
                <Code className="size-12 mb-4 opacity-20" />
                <p className="text-sm">{emptyStateMessage}</p>
              </div>
            ) : null}
          </div>
        );
    }
  })();

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex h-full flex-col gap-0">
        {!emptyStateMessage ? (
          <div className="border-b border-zinc-200/80 px-3 py-2 dark:border-white/10">
            <SegmentedControl
              ariaLabel="Object editor sections"
              className="w-full"
              options={sectionOptions}
              value={activeObjectTab}
              onValueChange={setActiveObjectTab}
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          {activeEditor}
        </div>
      </div>
    </div>
  );
}
