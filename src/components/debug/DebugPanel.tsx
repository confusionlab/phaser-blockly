import { useState, useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { generateCodeForObject } from '@/phaser/CodeGenerator';
import { runtimeDebugLog, clearDebugLog, getCurrentRuntime } from '@/phaser/RuntimeEngine';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Project } from '@/types';

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'xml' | 'state' | 'variables' | 'runtime' | 'console'>('code');
  const [, setLogRefresh] = useState(0);

  const { project } = useProjectStore();
  const { selectedSceneId, selectedObjectId, isPlaying, showColliderOutlines, setShowColliderOutlines } = useEditorStore();

  // Auto-refresh logs and variables when playing
  useEffect(() => {
    if (!isPlaying || (activeTab !== 'runtime' && activeTab !== 'console' && activeTab !== 'variables')) return;
    const interval = setInterval(() => {
      setLogRefresh(r => r + 1);
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying, activeTab]);

  // Filter user logs for console tab
  const userLogs = runtimeDebugLog.filter(entry => entry.type === 'user');

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const selectedObject = selectedScene?.objects.find(o => o.id === selectedObjectId);

  // Generate code for selected object
  const generatedCode = selectedObject?.blocklyXml
    ? generateCodeForObject(selectedObject.blocklyXml, selectedObject.id)
    : '// No blocks';

  // Generate code for all objects in current scene
  const generateAllCode = (): string => {
    if (!selectedScene) return '// No scene selected';

    const allCode: string[] = [];
    for (const obj of selectedScene.objects) {
      if (obj.blocklyXml) {
        allCode.push(`// ========== ${obj.name} (${obj.id}) ==========`);
        allCode.push(generateCodeForObject(obj.blocklyXml, obj.id));
        allCode.push('');
      }
    }
    return allCode.length > 0 ? allCode.join('\n') : '// No objects with code';
  };

  const copyAllCode = async () => {
    const code = generateAllCode();
    await navigator.clipboard.writeText(code);
  };

  // Format XML for display
  const formattedXml = selectedObject?.blocklyXml
    ? formatXml(selectedObject.blocklyXml)
    : '<!-- No blocks -->';

  if (!isOpen) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-gray-800 text-white hover:bg-gray-700"
      >
        Debug
      </Button>
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
          <TabButton active={activeTab === 'variables'} onClick={() => setActiveTab('variables')}>
            Vars {isPlaying && <span className="ml-1 w-2 h-2 bg-orange-500 rounded-full inline-block animate-pulse" />}
          </TabButton>
          <TabButton active={activeTab === 'runtime'} onClick={() => setActiveTab('runtime')}>
            Runtime {isPlaying && <span className="ml-1 w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse" />}
          </TabButton>
          <TabButton active={activeTab === 'console'} onClick={() => setActiveTab('console')}>
            Console {userLogs.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs bg-purple-600 rounded-full">{userLogs.length}</span>}
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
      <div className="px-4 py-2 bg-gray-800/50 text-xs text-gray-400 border-b border-gray-700 flex items-center justify-between">
        <div>
          {selectedObject ? (
            <span>Object: <span className="text-green-400">{selectedObject.name}</span> ({selectedObject.id.slice(0, 8)}...)</span>
          ) : (
            <span className="text-yellow-400">No object selected</span>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={showColliderOutlines}
            onCheckedChange={(checked) => setShowColliderOutlines(checked === true)}
            className="border-green-400 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
          />
          <span className="text-green-400">Colliders</span>
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 font-mono text-xs">
        {activeTab === 'code' && (
          <div className="space-y-2">
            <div className="flex justify-end mb-2">
              <button
                onClick={copyAllCode}
                className="px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600"
              >
                Copy All Code
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-green-300">{generatedCode}</pre>
          </div>
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
        {activeTab === 'variables' && (
          <VariablesTab project={project} />
        )}
        {activeTab === 'runtime' && (
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
              <span className="text-yellow-400 font-bold">Runtime Log</span>
              <button
                onClick={() => { clearDebugLog(); setLogRefresh(r => r + 1); }}
                className="px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600"
              >
                Clear
              </button>
            </div>
            {runtimeDebugLog.filter(e => e.type !== 'user').length === 0 ? (
              <div className="text-gray-500">No logs yet. Press Play to start.</div>
            ) : (
              <div className="space-y-1">
                {runtimeDebugLog.filter(e => e.type !== 'user').slice(-50).map((entry, i) => (
                  <div key={i} className={`text-xs ${getLogColor(entry.type)}`}>
                    <span className="text-gray-500">[{entry.type}]</span> {entry.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'console' && (
          <div className="space-y-2">
            <div className="flex justify-between items-center mb-2">
              <span className="text-purple-400 font-bold">Console Output</span>
              <button
                onClick={() => { clearDebugLog(); setLogRefresh(r => r + 1); }}
                className="px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600"
              >
                Clear
              </button>
            </div>
            {userLogs.length === 0 ? (
              <div className="text-gray-500">No console output yet. Use the "console log" block to print messages.</div>
            ) : (
              <div className="space-y-1">
                {userLogs.slice(-100).map((entry, i) => (
                  <div key={i} className="text-sm text-purple-300 font-mono">
                    {entry.message}
                  </div>
                ))}
              </div>
            )}
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

function getLogColor(type: string): string {
  switch (type) {
    case 'info': return 'text-blue-300';
    case 'event': return 'text-green-300';
    case 'action': return 'text-yellow-300';
    case 'error': return 'text-red-400';
    case 'user': return 'text-purple-300 font-bold';
    default: return 'text-gray-300';
  }
}

function VariablesTab({ project }: { project: Project | null }) {
  const runtime = getCurrentRuntime();
  const variableNamesById = new Map<string, string>();

  for (const variable of project?.globalVariables ?? []) {
    variableNamesById.set(variable.id, variable.name);
  }
  for (const scene of project?.scenes ?? []) {
    for (const object of scene.objects) {
      for (const variable of object.localVariables ?? []) {
        variableNamesById.set(variable.id, variable.name);
      }
    }
  }

  if (!runtime) {
    return (
      <div className="text-gray-500">
        Press Play to see variable values during runtime.
        <div className="mt-4 text-xs">
          <div className="text-orange-400 font-bold mb-2">Defined Variables:</div>
          {project?.globalVariables && project.globalVariables.length > 0 ? (
            <div className="space-y-1">
              {project.globalVariables.map(v => (
                <div key={v.id} className="flex items-center gap-2">
                  <span className="text-blue-400">[global]</span>
                  <span className="text-gray-300">{v.name}</span>
                  <span className="text-gray-500">({v.type})</span>
                  <span className="text-gray-400">= {String(v.defaultValue)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-600">No global variables defined</div>
          )}
        </div>
      </div>
    );
  }

  const globalVars = Array.from(runtime.globalVariables.entries());
  const localVarsMap = runtime.localVariables;

  // Get sprite names for display
  const spriteNames = new Map<string, string>();
  for (const [id, sprite] of runtime.sprites) {
    spriteNames.set(id, sprite.name);
  }

  return (
    <div className="space-y-4">
      <Section title="Global Variables">
        {globalVars.length === 0 ? (
          <div className="text-gray-500">No global variables</div>
        ) : (
          <div className="space-y-1">
            {globalVars.map(([varId, value]) => (
              <div key={varId} className="flex items-center gap-2">
                <span className="text-orange-300 font-medium">{formatVariableLabel(varId, variableNamesById)}</span>
                <span className="text-gray-500">=</span>
                <span className={getValueColor(value)}>{formatValue(value)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Local Variables (per sprite)">
        {localVarsMap.size === 0 ? (
          <div className="text-gray-500">No local variables</div>
        ) : (
          <div className="space-y-3">
            {Array.from(localVarsMap.entries()).map(([spriteId, vars]) => {
              const varsArray = Array.from(vars.entries());
              if (varsArray.length === 0) return null;
              const spriteName = spriteNames.get(spriteId) || spriteId.slice(0, 8);
              return (
                <div key={spriteId} className="pl-2 border-l-2 border-gray-700">
                  <div className="text-cyan-400 text-xs mb-1">{spriteName}</div>
                  <div className="space-y-1 pl-2">
                    {varsArray.map(([varId, value]) => (
                      <div key={varId} className="flex items-center gap-2">
                        <span className="text-orange-300 font-medium">{formatVariableLabel(varId, variableNamesById)}</span>
                        <span className="text-gray-500">=</span>
                        <span className={getValueColor(value)}>{formatValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function getValueColor(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'text-green-400' : 'text-red-400';
  if (typeof value === 'number') return 'text-blue-300';
  if (typeof value === 'string') return 'text-yellow-300';
  return 'text-gray-300';
}

function formatVariableLabel(varId: string, variableNamesById: Map<string, string>): string {
  const variableName = variableNamesById.get(varId);
  return variableName ? `${variableName} (${varId})` : varId;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
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
