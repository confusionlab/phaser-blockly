import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import {
  getToolboxConfig,
  registerTypedVariablesCategory,
  setAddVariableCallback,
  setTypedVariableLoading,
  updateVariableBlockAppearance,
} from './toolbox';
import { AddVariableDialog } from '@/components/dialogs/AddVariableDialog';
import { VariableManagerDialog } from '@/components/dialogs/VariableManagerDialog';
import { BlockSearchModal } from './BlockSearchModal';
import type { UndoRedoHandler } from '@/store/editorStore';
import type { Variable } from '@/types';

// Register continuous toolbox plugin once at module load
registerContinuousToolbox();

// Global clipboard for cross-object block copying
// Store the copy data from Blockly's ICopyable interface
let globalBlockClipboard: Blockly.ICopyData | null = null;

// Helper to deep clone and copy a block properly
function copyBlockToClipboard(block: Blockly.BlockSvg): void {
  // Use Blockly's built-in copy mechanism which handles shadow blocks correctly
  const copyData = block.toCopyData();
  if (copyData) {
    globalBlockClipboard = copyData;
    console.log('[Blockly] Block copied to clipboard');
  }
}

// Helper to paste from clipboard
function pasteBlockFromClipboard(workspace: Blockly.WorkspaceSvg): void {
  if (!globalBlockClipboard) return;

  try {
    // Get visible area for positioning
    const metrics = workspace.getMetrics();
    const viewLeft = metrics.viewLeft || 0;
    const viewTop = metrics.viewTop || 0;

    // Paste using Blockly's clipboard paste mechanism
    const pasted = Blockly.clipboard.paste(globalBlockClipboard, workspace);

    // Move pasted block to visible area
    if (pasted && pasted instanceof Blockly.BlockSvg) {
      pasted.moveTo(new Blockly.utils.Coordinate(viewLeft + 100, viewTop + 100));
    }
    console.log('[Blockly] Block pasted from clipboard');
  } catch (err) {
    console.error('[Blockly] Failed to paste block:', err);
  }
}

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
        copyBlockToClipboard(scope.block as Blockly.BlockSvg);
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
    callback: () => {
      const workspace = Blockly.getMainWorkspace() as Blockly.WorkspaceSvg;
      if (workspace && globalBlockClipboard) {
        pasteBlockFromClipboard(workspace);
      }
    },
    scopeType: Blockly.ContextMenuRegistry.ScopeType.WORKSPACE,
    id: 'crossObjectPaste',
    weight: 0,
  });
}

// Register once at module load
registerCrossObjectCopyPaste();

// Block types that have object reference dropdowns
const OBJECT_REFERENCE_BLOCKS: Record<string, string> = {
  'sensing_touching': 'TARGET',
  'sensing_distance_to': 'TARGET',
  'sensing_touching_object': 'TARGET',
  'motion_point_towards': 'TARGET',
  'camera_follow_object': 'TARGET',
  'control_clone_object': 'TARGET',
  'event_when_touching': 'TARGET',
  'motion_attach_to_dropdown': 'TARGET',
  'motion_attach_dropdown_to_me': 'TARGET',
};

// Block types that have sound reference dropdowns
const SOUND_REFERENCE_BLOCKS: Record<string, string> = {
  'sound_play': 'SOUND',
  'sound_play_until_done': 'SOUND',
};

// Block types that have variable reference dropdowns
const VARIABLE_REFERENCE_BLOCKS: Record<string, string> = {
  'typed_variable_get': 'VAR',
  'typed_variable_set': 'VAR',
  'typed_variable_change': 'VAR',
};

// Special values that are always valid (not object IDs)
const VALID_SPECIAL_VALUES = new Set(['EDGE', 'MOUSE', 'MY_CLONES', '']);

// Validate all blocks in workspace for broken references
function validateBlockReferences(
  workspace: Blockly.WorkspaceSvg,
  sceneObjectIds: Set<string>,
  objectSoundIds: Set<string>,
  validVariableIds: Set<string>
) {
  const allBlocks = workspace.getAllBlocks(false);

  for (const block of allBlocks) {
    const blockType = block.type;
    let hasError = false;
    const errors: string[] = [];

    // Check object references
    const objectFieldName = OBJECT_REFERENCE_BLOCKS[blockType];
    if (objectFieldName) {
      const fieldValue = block.getFieldValue(objectFieldName);
      if (fieldValue && !VALID_SPECIAL_VALUES.has(fieldValue)) {
        // Check if it's a component reference (starts with COMPONENT_ANY:)
        if (fieldValue.startsWith('COMPONENT_ANY:')) {
          // Component references are allowed
        } else if (!sceneObjectIds.has(fieldValue)) {
          hasError = true;
          errors.push('Object not found in this scene');
        }
      }
    }

    // Check sound references
    const soundFieldName = SOUND_REFERENCE_BLOCKS[blockType];
    if (soundFieldName) {
      const fieldValue = block.getFieldValue(soundFieldName);
      if (fieldValue && fieldValue !== '' && !objectSoundIds.has(fieldValue)) {
        hasError = true;
        errors.push('Sound not found in this object');
      }
    }

    // Check variable references
    const variableFieldName = VARIABLE_REFERENCE_BLOCKS[blockType];
    if (variableFieldName) {
      const fieldValue = block.getFieldValue(variableFieldName);
      if (fieldValue && fieldValue !== '' && !validVariableIds.has(fieldValue)) {
        hasError = true;
        errors.push('Variable not found');
      }
    }

    // Apply visual feedback
    if (hasError) {
      block.setWarningText(errors.join('\n'));
      // Store original color if not already stored
      if (!block.data) {
        block.data = block.getColour();
      }
      block.setColour('#CC0000'); // Red for error
    } else {
      block.setWarningText(null);
      // Restore original color if it was stored
      if (block.data) {
        block.setColour(block.data);
        block.data = null;
      }
    }
  }
}

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
          copyBlockToClipboard(selected);
        }
      }

      // Cross-object paste (Cmd+V)
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && workspaceRef.current && globalBlockClipboard) {
        e.preventDefault();
        pasteBlockFromClipboard(workspaceRef.current);
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

    // Save on changes and validate references
    workspaceRef.current.addChangeListener((event) => {
      // Debug: log typed variable getter disconnects
      if (event.type === Blockly.Events.BLOCK_MOVE && workspaceRef.current) {
        const moveEvent = event as Blockly.Events.BlockMove;
        const block = workspaceRef.current.getBlockById(moveEvent.blockId || '');
        if (block?.type === 'typed_variable_get') {
          const output = block.outputConnection;
          const target = output?.targetConnection;
          const movedFromParent = moveEvent.oldParentId && !moveEvent.newParentId;
          if (movedFromParent) {
            console.log('[Blockly][TypedVar][Disconnected]', {
              blockId: block.id,
              varId: block.getFieldValue('VAR'),
              oldParentId: moveEvent.oldParentId,
              oldInputName: moveEvent.oldInputName,
              newParentId: moveEvent.newParentId,
              newInputName: moveEvent.newInputName,
              outputCheck: output?.getCheck(),
              targetCheck: target?.getCheck(),
              parentType: block.getParent()?.type,
              isLoading: isLoadingRef.current,
            });
          }
        }
      }
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
        if (!scene || !obj) return;

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

        // Validate references on block create/change
        if (event.type === Blockly.Events.BLOCK_CREATE || event.type === Blockly.Events.BLOCK_CHANGE) {
          const sceneObjectIds = new Set(scene.objects.map(o => o.id));

          // Get effective sounds
          let effectiveSounds: Array<{ id: string }> = obj.sounds || [];
          if (obj.componentId) {
            const component = (state.project?.components || []).find(c => c.id === obj.componentId);
            if (component) {
              effectiveSounds = component.sounds || [];
            }
          }
          const objectSoundIds = new Set(effectiveSounds.map(s => s.id));

          // Collect valid variable IDs
          const validVariableIds = new Set<string>();
          (state.project?.globalVariables || []).forEach(v => validVariableIds.add(v.id));
          (obj.localVariables || []).forEach(v => validVariableIds.add(v.id));

          validateBlockReferences(workspaceRef.current!, sceneObjectIds, objectSoundIds, validVariableIds);
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
    setTypedVariableLoading(true);
    workspaceRef.current.clear();

    // Get fresh object data from store
    const state = useProjectStore.getState();
    const scene = state.project?.scenes.find(s => s.id === selectedSceneId);
    const obj = scene?.objects.find(o => o.id === selectedObjectId);

    // Get effective blocklyXml (from component if it's an instance)
    let blocklyXml = obj?.blocklyXml || '';
    let effectiveSounds: Array<{ id: string }> = obj?.sounds || [];
    if (obj?.componentId) {
      const component = (state.project?.components || []).find(c => c.id === obj.componentId);
      if (component) {
        blocklyXml = component.blocklyXml;
        effectiveSounds = component.sounds || [];
      }
    }

    const expectedConnections = new Map<string, { parentId: string; inputName: string }>();

    if (blocklyXml) {
      try {
        const xml = Blockly.utils.xml.textToDom(blocklyXml);

        // Debug: track expected typed_variable_get connections from XML
        const blocks = Array.from(xml.getElementsByTagName('block'));
        for (const blockEl of blocks) {
          if (blockEl.getAttribute('type') !== 'typed_variable_get') continue;
          const parentValue = blockEl.parentElement;
          if (!parentValue) continue;
          const parentBlockEl = parentValue.parentElement;
          if (!parentBlockEl || parentBlockEl.tagName !== 'block') continue;
          const childId = blockEl.getAttribute('id');
          const parentId = parentBlockEl.getAttribute('id');
          const inputName = parentValue.getAttribute('name') || '';
          if (childId && parentId && inputName) {
            expectedConnections.set(childId, { parentId, inputName });
          }
        }

        Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
      } catch (e) {
        console.error('Failed to load Blockly XML:', e);
      }
    }

    // Debug: log any typed_variable_get blocks that failed to reconnect
    if (workspaceRef.current && expectedConnections.size > 0) {
      for (const [childId, expected] of expectedConnections.entries()) {
        const childBlock = workspaceRef.current.getBlockById(childId);
        if (!childBlock) continue;
        const parent = childBlock.getParent();
        if (!parent || parent.id !== expected.parentId) {
          console.log('[Blockly][LoadMismatch]', {
            childId,
            childType: childBlock.type,
            expectedParentId: expected.parentId,
            expectedInputName: expected.inputName,
            actualParentId: parent?.id ?? null,
            actualParentType: parent?.type ?? null,
            outputCheck: childBlock.outputConnection?.getCheck(),
            targetCheck: childBlock.outputConnection?.targetConnection?.getCheck(),
          });
        }
      }
    }

    // Ensure typed variable getters have correct output types after load
    if (workspaceRef.current) {
      setTypedVariableLoading(false);
      const allBlocks = workspaceRef.current.getAllBlocks(false);
      for (const block of allBlocks) {
        if (block.type === 'typed_variable_get') {
          updateVariableBlockAppearance(block, true);
        }
      }
    } else {
      setTypedVariableLoading(false);
    }

    // Validate blocks for broken references
    if (scene && workspaceRef.current) {
      const sceneObjectIds = new Set(scene.objects.map(o => o.id));
      const objectSoundIds = new Set(effectiveSounds.map(s => s.id));

      // Collect valid variable IDs (global + local)
      const validVariableIds = new Set<string>();
      (state.project?.globalVariables || []).forEach(v => validVariableIds.add(v.id));
      (obj?.localVariables || []).forEach(v => validVariableIds.add(v.id));

      validateBlockReferences(workspaceRef.current, sceneObjectIds, objectSoundIds, validVariableIds);
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
