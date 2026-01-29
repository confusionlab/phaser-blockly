import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { getToolboxConfig } from './toolbox';

// Register continuous toolbox plugin once at module load
registerContinuousToolbox();

export function BlocklyEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const currentSceneIdRef = useRef<string | null>(null);
  const currentObjectIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  const { selectedSceneId, selectedObjectId } = useEditorStore();

  // Keep refs in sync
  useEffect(() => {
    currentSceneIdRef.current = selectedSceneId;
    currentObjectIdRef.current = selectedObjectId;
  }, [selectedSceneId, selectedObjectId]);


  // Initialize Blockly workspace
  useEffect(() => {
    if (!containerRef.current) return;

    if (workspaceRef.current) {
      workspaceRef.current.dispose();
    }

    // Blockly config with Zelos renderer and continuous toolbox
    workspaceRef.current = Blockly.inject(containerRef.current, {
      toolbox: getToolboxConfig(),
      renderer: 'zelos',
      plugins: {
        toolbox: 'ContinuousToolbox',
        flyoutsVerticalToolbox: 'ContinuousFlyout',
        metricsManager: 'ContinuousMetrics',
      },
      trashcan: false,
      zoom: {
        controls: false,
        wheel: true,
        startScale: 0.8,
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

        // Check if workspace has any blocks
        const topBlocks = workspaceRef.current.getTopBlocks(false);
        if (topBlocks.length === 0) {
          // No blocks - clear the XML
          useProjectStore.getState().updateObject(sceneId, objectId, { blocklyXml: '' });
        } else {
          const xml = Blockly.Xml.workspaceToDom(workspaceRef.current);
          const xmlText = Blockly.Xml.domToText(xml);
          useProjectStore.getState().updateObject(sceneId, objectId, { blocklyXml: xmlText });
        }
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
    <div ref={containerRef} className="h-full w-full" />
  );
}
