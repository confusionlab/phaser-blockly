import { useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { generateCodeForObject } from '../../phaser/CodeGenerator';

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'xml' | 'state'>('code');

  const { project } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const selectedObject = selectedScene?.objects.find(o => o.id === selectedObjectId);

  // Generate code for selected object
  const generatedCode = selectedObject?.blocklyXml
    ? generateCodeForObject(selectedObject.blocklyXml, selectedObject.id)
    : '// No blocks';

  // Format XML for display
  const formattedXml = selectedObject?.blocklyXml
    ? formatXml(selectedObject.blocklyXml)
    : '<!-- No blocks -->';

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 px-3 py-2 bg-gray-800 text-white text-sm rounded-lg shadow-lg hover:bg-gray-700 z-50"
      >
        Debug
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-[500px] h-[400px] bg-gray-900 text-white rounded-lg shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 rounded-t-lg">
        <div className="flex gap-2">
          <TabButton active={activeTab === 'code'} onClick={() => setActiveTab('code')}>
            Code
          </TabButton>
          <TabButton active={activeTab === 'xml'} onClick={() => setActiveTab('xml')}>
            XML
          </TabButton>
          <TabButton active={activeTab === 'state'} onClick={() => setActiveTab('state')}>
            State
          </TabButton>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-white"
        >
          ×
        </button>
      </div>

      {/* Object selector info */}
      <div className="px-4 py-2 bg-gray-800/50 text-xs text-gray-400 border-b border-gray-700">
        {selectedObject ? (
          <span>Object: <span className="text-green-400">{selectedObject.name}</span> ({selectedObject.id.slice(0, 8)}...)</span>
        ) : (
          <span className="text-yellow-400">No object selected</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 font-mono text-xs">
        {activeTab === 'code' && (
          <pre className="whitespace-pre-wrap text-green-300">{generatedCode}</pre>
        )}
        {activeTab === 'xml' && (
          <pre className="whitespace-pre-wrap text-blue-300">{formattedXml}</pre>
        )}
        {activeTab === 'state' && (
          <div className="space-y-4">
            <Section title="Project">
              <div>Name: {project?.name || 'None'}</div>
              <div>Scenes: {project?.scenes.length || 0}</div>
            </Section>
            <Section title="Selected Scene">
              <div>Name: {selectedScene?.name || 'None'}</div>
              <div>Objects: {selectedScene?.objects.length || 0}</div>
            </Section>
            <Section title="Selected Object">
              {selectedObject ? (
                <>
                  <div>Name: {selectedObject.name}</div>
                  <div>Position: ({selectedObject.x}, {selectedObject.y})</div>
                  <div>Scale: ({selectedObject.scaleX}, {selectedObject.scaleY})</div>
                  <div>Rotation: {selectedObject.rotation}°</div>
                  <div>Visible: {selectedObject.visible ? 'Yes' : 'No'}</div>
                  <div>Has Blocks: {selectedObject.blocklyXml ? 'Yes' : 'No'}</div>
                </>
              ) : (
                <div className="text-gray-500">None selected</div>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm rounded ${
        active ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-yellow-400 font-bold mb-1">{title}</div>
      <div className="pl-2 text-gray-300">{children}</div>
    </div>
  );
}

function formatXml(xml: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const serializer = new XMLSerializer();
    let formatted = serializer.serializeToString(doc);

    // Simple formatting
    formatted = formatted.replace(/></g, '>\n<');
    const lines = formatted.split('\n');
    let indent = 0;
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('</')) {
        indent = Math.max(0, indent - 1);
      }
      result.push('  '.repeat(indent) + trimmed);
      if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
        indent++;
      }
    }

    return result.join('\n');
  } catch {
    return xml;
  }
}
