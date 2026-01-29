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
  const { selectedSceneId, selectedObjectId, selectObject, activeObjectTab, setActiveObjectTab } = useEditorStore();

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const objects = scene?.objects || [];

  useEffect(() => {
    if (objects.length > 0 && !selectedObjectId) {
      selectObject(objects[0].id);
    }
    if (selectedObjectId && !objects.find(o => o.id === selectedObjectId)) {
      selectObject(objects.length > 0 ? objects[0].id : null);
    }
  }, [objects, selectedObjectId, selectObject]);

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
            <TabsTrigger value="costumes">
              <Palette className="size-4" />
              Costumes
            </TabsTrigger>
            <TabsTrigger value="sounds">
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
