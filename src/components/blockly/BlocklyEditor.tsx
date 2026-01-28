import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { getToolboxConfig } from './toolbox';

export function BlocklyEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const currentSceneIdRef = useRef<string | null>(null);
  const currentObjectIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  const { project } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();

  // Keep refs in sync
  useEffect(() => {
    currentSceneIdRef.current = selectedSceneId;
    currentObjectIdRef.current = selectedObjectId;
  }, [selectedSceneId, selectedObjectId]);

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const selectedObject = selectedScene?.objects.find(o => o.id === selectedObjectId);

  // Initialize Blockly workspace
  useEffect(() => {
    if (!containerRef.current) return;

    if (workspaceRef.current) {
      workspaceRef.current.dispose();
    }

    // Standard Blockly config with Zelos renderer
    workspaceRef.current = Blockly.inject(containerRef.current, {
      toolbox: getToolboxConfig(),
      renderer: 'zelos',
      trashcan: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: 1,
      },
      move: {
        scrollbars: true,
        drag: true,
        wheel: true,
      },
    });

    // Save on changes
    workspaceRef.current.addChangeListener((event) => {
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

  // Load workspace when object ID changes (not when XML changes - we're the ones changing it)
  useEffect(() => {
    if (!workspaceRef.current) return;
    isLoadingRef.current = true;
    workspaceRef.current.clear();

    // Get fresh object data from store
    const state = useProjectStore.getState();
    const scene = state.project?.scenes.find(s => s.id === selectedSceneId);
    const obj = scene?.objects.find(o => o.id === selectedObjectId);

    if (obj?.blocklyXml) {
      try {
        const xml = Blockly.utils.xml.textToDom(obj.blocklyXml);
        Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
      } catch (e) {
        console.error('Failed to load Blockly XML:', e);
      }
    }

    setTimeout(() => {
      isLoadingRef.current = false;
    }, 50);
  }, [selectedObjectId, selectedSceneId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-4 py-2 bg-gray-50 border-b border-[var(--color-border)]">
        <span className="text-sm font-medium text-gray-600">Code for:</span>
        {selectedObject ? (
          <span className="ml-2 px-2 py-1 bg-[var(--color-primary)] text-white text-sm rounded">
            {selectedObject.name}
          </span>
        ) : (
          <span className="ml-2 text-sm text-gray-400 italic">Select an object</span>
        )}
      </div>

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
