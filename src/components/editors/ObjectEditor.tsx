import { useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { ObjectEditorTab } from '@/store/editorStore';
import { BlocklyEditor } from '../blockly/BlocklyEditor';
import { CostumeEditor } from './CostumeEditor';
import { SoundEditor } from './SoundEditor';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Code, Palette, Volume2 } from 'lucide-react';

export function ObjectEditor() {
  const { project } = useProjectStore();
  const {
    selectedSceneId,
    selectedObjectId,
    selectedComponentId,
    selectObject,
    activeObjectTab,
    setActiveObjectTab,
  } = useEditorStore();

  const scene = project?.scenes.find(s => s.id === selectedSceneId);

  useEffect(() => {
    if (selectedComponentId) return;

    const sceneObjects = scene?.objects || [];

    if (sceneObjects.length > 0 && !selectedObjectId) {
      selectObject(sceneObjects[0].id);
    }
    if (selectedObjectId && !sceneObjects.find((o) => o.id === selectedObjectId)) {
      selectObject(sceneObjects.length > 0 ? sceneObjects[0].id : null);
    }
  }, [scene, selectedObjectId, selectedComponentId, selectObject]);

  useEffect(() => {
    if (selectedComponentId && activeObjectTab !== 'code') {
      setActiveObjectTab('code');
    }
  }, [selectedComponentId, activeObjectTab, setActiveObjectTab]);

  // Show placeholder when no object is selected
  if (!selectedObjectId && !selectedComponentId) {
    return (
      <div className="flex flex-col h-full bg-card items-center justify-center text-muted-foreground">
        <Code className="size-12 mb-4 opacity-20" />
        <p className="text-sm">Select an object to edit its code</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <Tabs
        value={activeObjectTab}
        onValueChange={(value) => setActiveObjectTab(value as ObjectEditorTab)}
        className="flex flex-col h-full"
      >
        {/* Tab Header */}
        <div className="flex items-center border-b px-2">
          <TabsList variant="line">
            <TabsTrigger value="code">
              <Code className="size-4" />
              Code
            </TabsTrigger>
            <TabsTrigger value="costumes" disabled={!selectedObjectId}>
              <Palette className="size-4" />
              Costumes
            </TabsTrigger>
            <TabsTrigger value="sounds" disabled={!selectedObjectId}>
              <Volume2 className="size-4" />
              Sounds
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <TabsContent value="code" className="flex-1 min-h-0 mt-0">
          <BlocklyEditor />
        </TabsContent>
        <TabsContent value="costumes" className="flex-1 min-h-0 mt-0">
          <CostumeEditor />
        </TabsContent>
        <TabsContent value="sounds" className="flex-1 min-h-0 mt-0">
          <SoundEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
