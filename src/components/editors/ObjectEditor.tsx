import { useEffect } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import type { ObjectEditorTab } from '../../store/editorStore';
import { BlocklyEditor } from '../blockly/BlocklyEditor';
import { CostumeEditor } from './CostumeEditor';
import { SoundEditor } from './SoundEditor';

const tabs: { id: ObjectEditorTab; label: string; icon: string }[] = [
  { id: 'code', label: 'Code', icon: '💻' },
  { id: 'costumes', label: 'Costumes', icon: '🎨' },
  { id: 'sounds', label: 'Sounds', icon: '🔊' },
];

export function ObjectEditor() {
  const { project } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectObject, activeObjectTab, setActiveObjectTab } = useEditorStore();

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const objects = scene?.objects || [];

  // Auto-select first object if none selected
  useEffect(() => {
    if (objects.length > 0 && !selectedObjectId) {
      selectObject(objects[0].id);
    }
    // If selected object was deleted, select first available
    if (selectedObjectId && !objects.find(o => o.id === selectedObjectId)) {
      selectObject(objects.length > 0 ? objects[0].id : null);
    }
  }, [objects, selectedObjectId, selectObject]);

  const selectedObject = objects.find(o => o.id === selectedObjectId);

  return (
    <div className="flex flex-col h-full">
      {/* Tab Header */}
      <div className="flex items-center border-b border-gray-200 bg-white">
        {/* Object indicator */}
        <div className="flex items-center px-4 py-2 border-r border-gray-200">
          {selectedObject ? (
            <span className="px-2 py-1 bg-[var(--color-primary)] text-white text-sm rounded font-medium">
              {selectedObject.name}
            </span>
          ) : (
            <span className="text-sm text-gray-400 italic">No object</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveObjectTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[2px] ${
                activeObjectTab === tab.id
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeObjectTab === 'code' && <BlocklyEditor />}
        {activeObjectTab === 'costumes' && <CostumeEditor />}
        {activeObjectTab === 'sounds' && <SoundEditor />}
      </div>
    </div>
  );
}
