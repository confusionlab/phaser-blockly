import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { getToolboxConfig, registerTypedVariablesCategory, setAddVariableCallback } from './toolbox';
import { AddVariableDialog } from '@/components/dialogs/AddVariableDialog';
import { VariableManagerDialog } from '@/components/dialogs/VariableManagerDialog';
import { BlockSearchModal } from './BlockSearchModal';
import type { UndoRedoHandler } from '@/store/editorStore';
import type { Variable } from '@/types';

// Register continuous toolbox plugin once at module load
registerContinuousToolbox();

// Global clipboard for cross-object block copying
let globalBlockClipboard: string | null = null;

// Register custom context menu items for cross-object copy/paste
function registerCrossObjectCopyPaste() {
  // Copy block(s) to global clipboard
  Blockly.ContextMenuRegistry.registry.register({
    displayText: 'Copy Block',
    preconditionFn: (scope) => {
      if (scope.block && !scope.block.isInFlyout) {
        return 'enabled';
      }
      return 'hidden';
    },
    callback: (scope) => {
      if (scope.block) {
        const xml = Blockly.Xml.blockToDom(scope.block, true);
        globalBlockClipboard = Blockly.Xml.domToText(xml);
        console.log('[Blockly] Block copied to clipboard');
      }
    },
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
    id: 'crossObjectCopy',
    weight: 0,
  });

  // Paste from global clipboard
  Blockly.ContextMenuRegistry.registry.register({
    displayText: () => globalBlockClipboard ? 'Paste Block' : 'Paste Block (empty)',
    preconditionFn: () => {
      return globalBlockClipboard ? 'enabled' : 'disabled';
    },
    callback: (_scope, e) => {
      if (globalBlockClipboard && e.currentTarget) {
        const workspace = Blockly.getMainWorkspace() as Blockly.WorkspaceSvg;
        if (workspace) {
          try {
            const xml = Blockly.utils.xml.textToDom(`<xml>${globalBlockClipboard}</xml>`);
            const blockDom = xml.firstElementChild;
            if (blockDom) {
              // Get mouse position in workspace coordinates
              const metrics = workspace.getMetrics();
              const viewLeft = metrics.viewLeft || 0;
              const viewTop = metrics.viewTop || 0;

              // Place block near center of visible area
              const block = Blockly.Xml.domToBlock(blockDom, workspace);
              block.moveBy(viewLeft + 100, viewTop + 100);
              console.log('[Blockly] Block pasted from clipboard');
            }
          } catch (err) {
            console.error('[Blockly] Failed to paste block:', err);
          }
        }
      }
    },
    scopeType: Blockly.ContextMenuRegistry.ScopeType.WORKSPACE,
    id: 'crossObjectPaste',
    weight: 0,
  });
}

// Register once at module load
registerCrossObjectCopyPaste();

export function BlocklyEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const currentSceneIdRef = useRef<string | null>(null);
  const currentObjectIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  const [showAddVariableDialog, setShowAddVariableDialog] = useState(false);
  const [showVariableManager, setShowVariableManager] = useState(false);
  const [showBlockSearch, setShowBlockSearch] = useState(false);

  const { selectedSceneId, selectedObjectId, registerCodeUndo } = useEditorStore();
  const { project, addGlobalVariable, addLocalVariable } = useProjectStore();

  // Register undo/redo handler for keyboard shortcuts
  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => workspaceRef.current?.undo(false),
      redo: () => workspaceRef.current?.undo(true),
    };
    registerCodeUndo(handler);
    return () => registerCodeUndo(null);
  }, [registerCodeUndo]);

  // Keep refs in sync
  useEffect(() => {
    currentSceneIdRef.current = selectedSceneId;
    currentObjectIdRef.current = selectedObjectId;
  }, [selectedSceneId, selectedObjectId]);

  // Cmd+K to open block search, Cmd+C/V for cross-object copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Block search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (selectedObjectId) {
          setShowBlockSearch(true);
        }
        return;
      }

      // Cross-object copy (Cmd+C)
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && workspaceRef.current) {
        const selected = Blockly.getSelected();
        if (selected && selected instanceof Blockly.BlockSvg && !selected.isInFlyout) {
          const xml = Blockly.Xml.blockToDom(selected, true);
          globalBlockClipboard = Blockly.Xml.domToText(xml);
          console.log('[Blockly] Block copied via Cmd+C');
        }
      }

      // Cross-object paste (Cmd+V)
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && workspaceRef.current && globalBlockClipboard) {
        e.preventDefault();
        try {
          const xml = Blockly.utils.xml.textToDom(`<xml>${globalBlockClipboard}</xml>`);
          const blockDom = xml.firstElementChild;
          if (blockDom) {
            const metrics = workspaceRef.current.getMetrics();
            const viewLeft = metrics.viewLeft || 0;
            const viewTop = metrics.viewTop || 0;
            const block = Blockly.Xml.domToBlock(blockDom, workspaceRef.current);
            block.moveBy(viewLeft + 100, viewTop + 100);
            console.log('[Blockly] Block pasted via Cmd+V');
          }
        } catch (err) {
          console.error('[Blockly] Failed to paste block:', err);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectId]);


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

    // Register typed variables category callback
    registerTypedVariablesCategory(workspaceRef.current);

    // Set up callback for "Add Variable" button
    setAddVariableCallback(() => setShowAddVariableDialog(true));

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

        const state = useProjectStore.getState();
        const scene = state.project?.scenes.find(s => s.id === sceneId);
        const obj = scene?.objects.find(o => o.id === objectId);
        if (!obj) return;

        // Check if workspace has any blocks
        const topBlocks = workspaceRef.current.getTopBlocks(false);
        const xmlText = topBlocks.length === 0
          ? ''
          : Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspaceRef.current));

        // If this is a component instance, update the component definition
        if (obj.componentId) {
          state.updateComponent(obj.componentId, { blocklyXml: xmlText });
        } else {
          state.updateObject(sceneId, objectId, { blocklyXml: xmlText });
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

    // Get effective blocklyXml (from component if it's an instance)
    let blocklyXml = obj?.blocklyXml || '';
    if (obj?.componentId) {
      const component = (state.project?.components || []).find(c => c.id === obj.componentId);
      if (component) {
        blocklyXml = component.blocklyXml;
      }
    }

    if (blocklyXml) {
      try {
        const xml = Blockly.utils.xml.textToDom(blocklyXml);
        Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
      } catch (e) {
        console.error('Failed to load Blockly XML:', e);
      }
    }

    setTimeout(() => {
      isLoadingRef.current = false;
    }, 50);
  }, [selectedObjectId, selectedSceneId]);

  // Get current object name for local variable option
  const currentObjectName = (() => {
    if (!project || !selectedSceneId || !selectedObjectId) return undefined;
    const scene = project.scenes.find(s => s.id === selectedSceneId);
    return scene?.objects.find(o => o.id === selectedObjectId)?.name;
  })();

  const handleAddVariable = (variable: Variable) => {
    if (variable.scope === 'global') {
      addGlobalVariable(variable);
    } else if (selectedSceneId && selectedObjectId) {
      addLocalVariable(selectedSceneId, selectedObjectId, variable);
    }
    // Refresh the toolbox to show the new variable
    if (workspaceRef.current) {
      workspaceRef.current.refreshToolboxSelection();
    }
  };

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      <AddVariableDialog
        open={showAddVariableDialog}
        onOpenChange={setShowAddVariableDialog}
        onAdd={handleAddVariable}
        objectName={currentObjectName}
      />
      <VariableManagerDialog
        open={showVariableManager}
        onOpenChange={setShowVariableManager}
        onAddNew={() => setShowAddVariableDialog(true)}
      />
      <BlockSearchModal
        isOpen={showBlockSearch}
        onClose={() => setShowBlockSearch(false)}
        workspace={workspaceRef.current}
        onNewVariable={() => setShowAddVariableDialog(true)}
        onManageVariables={() => setShowVariableManager(true)}
      />
    </>
  );
}
