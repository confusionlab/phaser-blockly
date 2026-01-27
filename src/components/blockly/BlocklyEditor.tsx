import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { getToolboxConfig } from './toolbox';

export function BlocklyEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);

  // Use refs to track current selection for the event listener closure
  const currentSceneIdRef = useRef<string | null>(null);
  const currentObjectIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  const { project } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();

  // Keep refs in sync with state
  currentSceneIdRef.current = selectedSceneId;
  currentObjectIdRef.current = selectedObjectId;

  // Get the currently selected object
  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const selectedObject = selectedScene?.objects.find(o => o.id === selectedObjectId);

  // Initialize Blockly workspace
  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up existing workspace
    if (workspaceRef.current) {
      workspaceRef.current.dispose();
    }

    // Create new workspace
    workspaceRef.current = Blockly.inject(containerRef.current, {
      toolbox: getToolboxConfig(),
      grid: {
        spacing: 20,
        length: 3,
        colour: '#ccc',
        snap: true,
      },
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.9,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.1,
      },
      trashcan: true,
      move: {
        scrollbars: true,
        drag: true,
        wheel: true,
      },
      theme: Blockly.Theme.defineTheme('phaserBlockly', {
        name: 'phaserBlockly',
        base: Blockly.Themes.Classic,
        fontStyle: {
          family: 'Nunito, sans-serif',
          weight: '500',
          size: 12,
        },
        startHats: true,
      }),
    });

    // Listen for changes - use refs to get current IDs
    workspaceRef.current.addChangeListener((event) => {
      // Skip save during loading to prevent overwriting with empty workspace
      if (isLoadingRef.current) return;

      if (event.type === Blockly.Events.BLOCK_CHANGE ||
          event.type === Blockly.Events.BLOCK_CREATE ||
          event.type === Blockly.Events.BLOCK_DELETE ||
          event.type === Blockly.Events.BLOCK_MOVE) {
        const sceneId = currentSceneIdRef.current;
        const objectId = currentObjectIdRef.current;

        if (!workspaceRef.current || !sceneId || !objectId) return;

        const xml = Blockly.Xml.workspaceToDom(workspaceRef.current);
        const xmlText = Blockly.Xml.domToText(xml);
        useProjectStore.getState().updateObject(sceneId, objectId, { blocklyXml: xmlText });
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (workspaceRef.current) {
        Blockly.svgResize(workspaceRef.current);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (workspaceRef.current) {
        workspaceRef.current.dispose();
        workspaceRef.current = null;
      }
    };
  }, []);

  // Load workspace when object selection changes
  useEffect(() => {
    if (!workspaceRef.current) return;

    // Set loading flag to prevent the change listener from saving during clear/load
    isLoadingRef.current = true;

    workspaceRef.current.clear();

    if (selectedObject?.blocklyXml) {
      try {
        const xml = Blockly.utils.xml.textToDom(selectedObject.blocklyXml);
        Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
      } catch (e) {
        console.error('Failed to load Blockly XML:', e);
      }
    }

    // Reset loading flag after a small delay to let Blockly settle
    setTimeout(() => {
      isLoadingRef.current = false;
    }, 50);
  }, [selectedObjectId, selectedObject?.blocklyXml]);

  return (
    <div className="flex flex-col h-full">
      {/* Header showing selected object */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Code for:</span>
          {selectedObject ? (
            <span className="px-2 py-1 bg-[var(--color-primary)] text-white text-sm rounded">
              {selectedObject.name}
            </span>
          ) : (
            <span className="text-sm text-gray-400 italic">Select an object</span>
          )}
        </div>
      </div>

      {/* Blockly container */}
      <div ref={containerRef} className="flex-1">
        {!selectedObject && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="bg-white/90 px-6 py-4 rounded-lg shadow-sm text-center">
              <p className="text-gray-600">Select an object from the stage</p>
              <p className="text-gray-400 text-sm mt-1">to start coding its behavior</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
