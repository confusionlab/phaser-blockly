import { useEffect, useRef, useState, useCallback } from 'react';
import * as Blockly from 'blockly';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import {
  getToolboxConfig,
  registerTypedVariablesCategory,
  setAddVariableCallback,
  setMessageDialogCallback,
  setTypedVariableLoading,
  updateVariableBlockAppearance,
} from './toolbox';
import { AddVariableDialog } from '@/components/dialogs/AddVariableDialog';
import { MessageDialog } from '@/components/dialogs/MessageDialog';
import { VariableManagerDialog } from '@/components/dialogs/VariableManagerDialog';
import { BlockSearchModal } from './BlockSearchModal';
import {
  COMPONENT_ANY_PREFIX,
  MESSAGE_REFERENCE_BLOCKS,
  OBJECT_REFERENCE_BLOCKS,
  SCENE_REFERENCE_BLOCKS,
  SOUND_REFERENCE_BLOCKS,
  VALID_OBJECT_SPECIAL_VALUES,
  VARIABLE_REFERENCE_BLOCKS,
} from '@/lib/blocklyReferenceMaps';
import type { UndoRedoHandler } from '@/store/editorStore';
import type { Variable } from '@/types';

// Register continuous toolbox plugin once at module load
registerContinuousToolbox();

// Global clipboard for cross-object block copying
// Store the copy data from Blockly's ICopyable interface
let globalBlockClipboard: Blockly.ICopyData | null = null;
const BLOCK_CLIPBOARD_STORAGE_KEY = 'pochacoding:blocklyClipboard:v1';

type PersistedBlockClipboard = {
  version: 1;
  copyData: Blockly.ICopyData;
};

function isValidCopyData(value: unknown): value is Blockly.ICopyData {
  return typeof value === 'object' && value !== null && 'paster' in value;
}

function saveClipboardToStorage(copyData: Blockly.ICopyData): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedBlockClipboard = { version: 1, copyData };
    window.localStorage.setItem(BLOCK_CLIPBOARD_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[Blockly] Failed to persist clipboard:', err);
  }
}

function loadClipboardFromStorage(): Blockly.ICopyData | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(BLOCK_CLIPBOARD_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { version?: number; copyData?: unknown };
    if (parsed.version === 1 && isValidCopyData(parsed.copyData)) {
      return parsed.copyData;
    }
  } catch (err) {
    console.warn('[Blockly] Failed to parse persisted clipboard:', err);
  }

  window.localStorage.removeItem(BLOCK_CLIPBOARD_STORAGE_KEY);
  return null;
}

function getBlockClipboard(): Blockly.ICopyData | null {
  const persistedClipboard = loadClipboardFromStorage();
  if (persistedClipboard) {
    globalBlockClipboard = persistedClipboard;
    return globalBlockClipboard;
  }

  // Keep memory in sync with shared storage across tabs.
  if (typeof window !== 'undefined' && !window.localStorage.getItem(BLOCK_CLIPBOARD_STORAGE_KEY)) {
    globalBlockClipboard = null;
  }

  return globalBlockClipboard;
}

// Helper to deep clone and copy a block properly
function copyBlockToClipboard(block: Blockly.BlockSvg): void {
  // Use Blockly's built-in copy mechanism which handles shadow blocks correctly
  const copyData = block.toCopyData();
  if (copyData) {
    globalBlockClipboard = copyData;
    saveClipboardToStorage(copyData);
    console.log('[Blockly] Block copied to clipboard');
  }
}

// Helper to paste from clipboard
function pasteBlockFromClipboard(workspace: Blockly.WorkspaceSvg, copyData?: Blockly.ICopyData): void {
  const clipboardData = copyData ?? getBlockClipboard();
  if (!clipboardData) return;

  try {
    // Get visible area for positioning
    const metrics = workspace.getMetrics();
    const viewLeft = metrics.viewLeft || 0;
    const viewTop = metrics.viewTop || 0;

    // Paste using Blockly's clipboard paste mechanism
    const pasted = Blockly.clipboard.paste(clipboardData, workspace);

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
    displayText: () => getBlockClipboard() ? 'Paste Block' : 'Paste Block (empty)',
    preconditionFn: () => {
      return getBlockClipboard() ? 'enabled' : 'disabled';
    },
    callback: () => {
      const workspace = Blockly.getMainWorkspace() as Blockly.WorkspaceSvg;
      const copyData = getBlockClipboard();
      if (workspace && copyData) {
        pasteBlockFromClipboard(workspace, copyData);
      }
    },
    scopeType: Blockly.ContextMenuRegistry.ScopeType.WORKSPACE,
    id: 'crossObjectPaste',
    weight: 0,
  });
}

// Register once at module load
registerCrossObjectCopyPaste();

const DEPRECATED_BLOCK_MESSAGES: Record<string, string> = {
  control_clone: 'Deprecated clone block. Use "spawn type at x,y".',
  control_clone_object: 'Deprecated clone block. Use "spawn type at x,y".',
  control_delete_clone: 'Deprecated clone block. Use "delete object" patterns with spawned instances.',
  sensing_is_clone_of: 'Deprecated clone/type check. Use "my type", "type of(object)", and "=".',
};

const TYPE_REFERENCE_BLOCKS: Record<string, string> = {
  'control_spawn_type_at': 'TYPE',
  'sensing_type_literal': 'TYPE',
};

const TYPE_REPORTER_BLOCK_TYPES = new Set([
  'sensing_type_literal',
  'sensing_my_type',
  'sensing_type_of_object',
]);
// Validate all blocks in workspace for broken references
function validateBlockReferences(
  workspace: Blockly.WorkspaceSvg,
  sceneObjectIds: Set<string>,
  objectSoundIds: Set<string>,
  validVariableIds: Set<string>,
  validTypeTokens: Set<string>,
  sceneIds: Set<string>,
  sceneNameCounts: Map<string, number>,
  messageIds: Set<string>,
  messageNameCounts: Map<string, number>,
) {
  const allBlocks = workspace.getAllBlocks(false);

  const isTypeReporterBlock = (block: Blockly.Block | null): boolean => {
    if (!block) return false;
    return TYPE_REPORTER_BLOCK_TYPES.has(block.type);
  };

  for (const block of allBlocks) {
    const blockType = block.type;
    let hasError = false;
    const errors: string[] = [];

    const deprecatedMessage = DEPRECATED_BLOCK_MESSAGES[blockType];
    if (deprecatedMessage) {
      hasError = true;
      errors.push(deprecatedMessage);
    }

    // Check object references
    const objectFieldName = OBJECT_REFERENCE_BLOCKS[blockType];
    if (objectFieldName) {
      const fieldValue = block.getFieldValue(objectFieldName);
      if (fieldValue === 'MY_CLONES') {
        hasError = true;
        errors.push('Deprecated target "myself (cloned)". Use "my type".');
      }
      if (fieldValue && !VALID_OBJECT_SPECIAL_VALUES.has(fieldValue)) {
        // Check if it's a component reference (starts with COMPONENT_ANY:)
        if (fieldValue.startsWith(COMPONENT_ANY_PREFIX)) {
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

    // Check scene references
    const sceneFieldName = SCENE_REFERENCE_BLOCKS[blockType];
    if (sceneFieldName) {
      const fieldValue = block.getFieldValue(sceneFieldName);
      const hasLegacyUniqueName = !!fieldValue && (sceneNameCounts.get(fieldValue) || 0) === 1;
      if (!fieldValue || (!sceneIds.has(fieldValue) && !hasLegacyUniqueName)) {
        hasError = true;
        errors.push('Scene not found in project');
      }
    }

    // Check message references
    const messageFieldName = MESSAGE_REFERENCE_BLOCKS[blockType];
    if (messageFieldName) {
      const fieldValue = block.getFieldValue(messageFieldName);
      const hasLegacyUniqueName = !!fieldValue && (messageNameCounts.get(fieldValue) || 0) === 1;
      if (!fieldValue || (!messageIds.has(fieldValue) && !hasLegacyUniqueName)) {
        hasError = true;
        errors.push('Message not found in project');
      }
    }

    const typeFieldName = TYPE_REFERENCE_BLOCKS[blockType];
    if (typeFieldName) {
      const fieldValue = block.getFieldValue(typeFieldName);
      if (!fieldValue) {
        hasError = true;
        errors.push('Type not selected');
      } else if (!validTypeTokens.has(fieldValue)) {
        hasError = true;
        errors.push('Selected type not found in project');
      }
    }

    // Type comparisons must compare type reporters against type reporters/literals.
    if (blockType === 'logic_compare') {
      const left = block.getInputTargetBlock('A');
      const right = block.getInputTargetBlock('B');
      const leftIsTypeLiteral = left?.type === 'sensing_type_literal';
      const rightIsTypeLiteral = right?.type === 'sensing_type_literal';
      if (leftIsTypeLiteral !== rightIsTypeLiteral) {
        const otherSide = leftIsTypeLiteral ? right : left;
        if (!isTypeReporterBlock(otherSide)) {
          hasError = true;
          errors.push('Invalid type comparison. Use "type of(object)" or "my type" when comparing to a type literal.');
        }
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
  const currentComponentIdRef = useRef<string | null>(null);
  const lastLoadedTargetRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  const pendingPersistRef = useRef<{
    sceneId: string | null;
    objectId: string | null;
    componentId: string | null;
    timeoutId: number;
  } | null>(null);
  const pendingMessageFieldApplyRef = useRef<((messageId: string) => void) | null>(null);
  const [showAddVariableDialog, setShowAddVariableDialog] = useState(false);
  const [showVariableManager, setShowVariableManager] = useState(false);
  const [showBlockSearch, setShowBlockSearch] = useState(false);
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  const [messageDialogMode, setMessageDialogMode] = useState<'create' | 'rename'>('create');
  const [messageDialogName, setMessageDialogName] = useState('');
  const [messageDialogError, setMessageDialogError] = useState<string | null>(null);
  const [messageDialogSelectedId, setMessageDialogSelectedId] = useState<string | null>(null);

  const { selectedSceneId, selectedObjectId, selectedComponentId, registerCodeUndo } = useEditorStore();
  const { project, addGlobalVariable, addLocalVariable, addMessage, updateMessage, updateComponent } = useProjectStore();
  const sceneDropdownStamp = project?.scenes
    .map((scene, index) => `${index}:${scene.id}:${scene.name}`)
    .join('|') ?? '';
  const messageDropdownStamp = project?.messages
    .map((message, index) => `${index}:${message.id}:${message.name}`)
    .join('|') ?? '';

  // Keep refs in sync
  useEffect(() => {
    currentSceneIdRef.current = selectedSceneId;
    currentObjectIdRef.current = selectedObjectId;
    currentComponentIdRef.current = selectedComponentId;
  }, [selectedSceneId, selectedObjectId, selectedComponentId]);

  const persistWorkspaceToStore = useCallback((
    sceneId: string | null,
    objectId: string | null,
    componentId: string | null,
  ) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    if (
      currentSceneIdRef.current !== sceneId ||
      currentObjectIdRef.current !== objectId ||
      currentComponentIdRef.current !== componentId
    ) {
      return;
    }

    const state = useProjectStore.getState();

    const topBlocks = workspace.getTopBlocks(false);
    const xmlText = topBlocks.length === 0
      ? ''
      : Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));

    if (componentId && !objectId) {
      const component = (state.project?.components || []).find((componentItem) => componentItem.id === componentId);
      if (!component) return;
      if (component.blocklyXml === xmlText) return;
      state.updateComponent(componentId, { blocklyXml: xmlText });
      return;
    }

    if (!sceneId || !objectId) return;
    const scene = state.project?.scenes.find((s) => s.id === sceneId);
    const obj = scene?.objects.find((o) => o.id === objectId);
    if (!scene || !obj) return;

    const currentXml = obj.componentId
      ? (state.project?.components || []).find((component) => component.id === obj.componentId)?.blocklyXml ?? ''
      : obj.blocklyXml;

    if (currentXml === xmlText) return;

    if (obj.componentId) {
      state.updateComponent(obj.componentId, { blocklyXml: xmlText });
    } else {
      state.updateObject(sceneId, objectId, { blocklyXml: xmlText });
    }
  }, []);

  const flushPendingWorkspacePersist = useCallback((
    sceneId?: string | null,
    objectId?: string | null,
    componentId?: string | null,
  ) => {
    const pending = pendingPersistRef.current;
    if (!pending) return;
    if (
      sceneId !== undefined &&
      objectId !== undefined &&
      componentId !== undefined &&
      (pending.sceneId !== sceneId || pending.objectId !== objectId || pending.componentId !== componentId)
    ) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pendingPersistRef.current = null;
    persistWorkspaceToStore(pending.sceneId, pending.objectId, pending.componentId);
  }, [persistWorkspaceToStore]);

  const scheduleWorkspacePersist = useCallback((
    sceneId: string | null,
    objectId: string | null,
    componentId: string | null,
  ) => {
    const pending = pendingPersistRef.current;
    if (pending) {
      if (
        pending.sceneId === sceneId &&
        pending.objectId === objectId &&
        pending.componentId === componentId
      ) {
        window.clearTimeout(pending.timeoutId);
      } else {
        flushPendingWorkspacePersist(pending.sceneId, pending.objectId, pending.componentId);
      }
    }

    const timeoutId = window.setTimeout(() => {
      persistWorkspaceToStore(sceneId, objectId, componentId);
      if (pendingPersistRef.current?.timeoutId === timeoutId) {
        pendingPersistRef.current = null;
      }
    }, 120);

    pendingPersistRef.current = { sceneId, objectId, componentId, timeoutId };
  }, [flushPendingWorkspacePersist, persistWorkspaceToStore]);

  // Register undo/redo handler for global keyboard shortcuts.
  // Flushing pending persistence keeps history in sync before history-based undo/redo runs.
  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => workspaceRef.current?.undo(false),
      redo: () => workspaceRef.current?.undo(true),
      beforeHistoryUndoRedo: () => flushPendingWorkspacePersist(),
    };
    registerCodeUndo(handler);
    return () => registerCodeUndo(null);
  }, [flushPendingWorkspacePersist, registerCodeUndo]);

  // Flush pending edits whenever selection target changes so we don't drop in-flight saves.
  useEffect(() => {
    const sceneIdAtRender = selectedSceneId;
    const objectIdAtRender = selectedObjectId;
    const componentIdAtRender = selectedComponentId;
    return () => {
      flushPendingWorkspacePersist(sceneIdAtRender, objectIdAtRender, componentIdAtRender);
    };
  }, [selectedSceneId, selectedObjectId, selectedComponentId, flushPendingWorkspacePersist]);

  useEffect(() => {
    setMessageDialogCallback((mode, selectedMessageId, applySelectedMessageId) => {
      pendingMessageFieldApplyRef.current = applySelectedMessageId;
      setMessageDialogMode(mode);
      setMessageDialogSelectedId(selectedMessageId);
      const selectedMessage = (useProjectStore.getState().project?.messages || []).find(
        (message) => message.id === selectedMessageId,
      );
      setMessageDialogName(mode === 'rename' ? selectedMessage?.name || '' : '');
      setMessageDialogError(null);
      setShowMessageDialog(true);
    });

    return () => {
      setMessageDialogCallback(null);
    };
  }, []);

  const closeMessageDialog = useCallback(() => {
    pendingMessageFieldApplyRef.current = null;
    setShowMessageDialog(false);
    setMessageDialogError(null);
    setMessageDialogName('');
    setMessageDialogSelectedId(null);
    setMessageDialogMode('create');
  }, []);

  const handleSubmitMessageDialog = useCallback(() => {
    const trimmedName = messageDialogName.trim();
    if (!trimmedName) {
      setMessageDialogError('Please enter a message name');
      return;
    }

    if (messageDialogMode === 'create') {
      const created = addMessage(trimmedName);
      if (!created) {
        setMessageDialogError('Failed to create message');
        return;
      }
      pendingMessageFieldApplyRef.current?.(created.id);
      closeMessageDialog();
      return;
    }

    if (!messageDialogSelectedId) {
      setMessageDialogError('No message selected');
      return;
    }

    updateMessage(messageDialogSelectedId, { name: trimmedName });
    pendingMessageFieldApplyRef.current?.(messageDialogSelectedId);
    closeMessageDialog();
  }, [
    addMessage,
    closeMessageDialog,
    messageDialogMode,
    messageDialogName,
    messageDialogSelectedId,
    updateMessage,
  ]);

  // Cmd+K to open block search, Cmd+C for cross-object copy
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Block search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (selectedObjectId || selectedComponentId) {
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectId, selectedComponentId]);


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
        const componentId = currentComponentIdRef.current;
        if (!workspaceRef.current) return;
        if (!objectId && !componentId) return;

        scheduleWorkspacePersist(sceneId, objectId, componentId);

        const state = useProjectStore.getState();
        const scene = sceneId ? state.project?.scenes.find((s) => s.id === sceneId) : undefined;
        const obj = scene && objectId ? scene.objects.find((o) => o.id === objectId) : undefined;
        const selectedComponent = componentId
          ? (state.project?.components || []).find((component) => component.id === componentId)
          : undefined;
        const component = selectedComponent
          ?? (obj?.componentId
            ? (state.project?.components || []).find((componentItem) => componentItem.id === obj.componentId)
            : undefined);

        // Validate references on block create/change
        if (event.type === Blockly.Events.BLOCK_CREATE || event.type === Blockly.Events.BLOCK_CHANGE) {
          const sceneObjectIds = new Set((scene?.objects || []).map((objectItem) => objectItem.id));

          // Get effective sounds
          const effectiveSounds: Array<{ id: string }> = component?.sounds || obj?.sounds || [];
          const objectSoundIds = new Set(effectiveSounds.map(s => s.id));

          // Collect valid variable IDs
          const validVariableIds = new Set<string>();
          (state.project?.globalVariables || []).forEach(v => validVariableIds.add(v.id));
          const componentLocalVariables = component?.localVariables || [];
          const localVariablesForValidation = componentLocalVariables.length > 0
            ? componentLocalVariables
            : (obj?.localVariables || []);
          localVariablesForValidation.forEach(v => validVariableIds.add(v.id));
          const validTypeTokens = new Set((state.project?.components || []).map((component) => `component:${component.id}`));
          const sceneIds = new Set((state.project?.scenes || []).map((projectScene) => projectScene.id));
          const sceneNameCounts = new Map<string, number>();
          (state.project?.scenes || []).forEach((projectScene) => {
            sceneNameCounts.set(projectScene.name, (sceneNameCounts.get(projectScene.name) || 0) + 1);
          });
          const messageIds = new Set((state.project?.messages || []).map((message) => message.id));
          const messageNameCounts = new Map<string, number>();
          (state.project?.messages || []).forEach((message) => {
            messageNameCounts.set(message.name, (messageNameCounts.get(message.name) || 0) + 1);
          });

          validateBlockReferences(
            workspaceRef.current!,
            sceneObjectIds,
            objectSoundIds,
            validVariableIds,
            validTypeTokens,
            sceneIds,
            sceneNameCounts,
            messageIds,
            messageNameCounts,
          );
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
      flushPendingWorkspacePersist();
      resizeObserver.disconnect();
      if (workspaceRef.current) {
        workspaceRef.current.dispose();
        workspaceRef.current = null;
      }
    };
  }, [flushPendingWorkspacePersist, scheduleWorkspacePersist]);

  // Keep workspace in sync with selected object XML, including undo/redo history replays.
  useEffect(() => {
    if (!workspaceRef.current) return;

    flushPendingWorkspacePersist();

    // Get fresh object data from store
    const state = useProjectStore.getState();
    const scene = selectedSceneId ? state.project?.scenes.find((s) => s.id === selectedSceneId) : undefined;
    const obj = selectedObjectId ? scene?.objects.find((o) => o.id === selectedObjectId) : undefined;
    const selectedComponent = selectedComponentId
      ? (state.project?.components || []).find((component) => component.id === selectedComponentId)
      : undefined;
    const component = selectedComponent
      ?? (obj?.componentId
        ? (state.project?.components || []).find((componentItem) => componentItem.id === obj.componentId)
        : undefined);

    // Get effective blocklyXml (from explicitly selected component or from component instance if selected object is one)
    const blocklyXml = component?.blocklyXml || obj?.blocklyXml || '';
    const effectiveSounds: Array<{ id: string }> = component?.sounds || obj?.sounds || [];

    const loadTargetKey = `${selectedSceneId ?? ''}:${selectedObjectId ?? ''}:${selectedComponentId ?? ''}`;
    const currentTopBlocks = workspaceRef.current.getTopBlocks(false);
    const currentWorkspaceXml = currentTopBlocks.length === 0
      ? ''
      : Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspaceRef.current));

    if (lastLoadedTargetRef.current === loadTargetKey && currentWorkspaceXml === blocklyXml) {
      return;
    }

    isLoadingRef.current = true;
    setTypedVariableLoading(true);
    workspaceRef.current.clear();

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
    if (workspaceRef.current) {
      const sceneObjectIds = new Set((scene?.objects || []).map((objectItem) => objectItem.id));
      const objectSoundIds = new Set(effectiveSounds.map(s => s.id));

      // Collect valid variable IDs (global + local)
      const validVariableIds = new Set<string>();
      (state.project?.globalVariables || []).forEach(v => validVariableIds.add(v.id));
      const componentLocalVariables = component?.localVariables || [];
      const localVariablesForValidation = componentLocalVariables.length > 0
        ? componentLocalVariables
        : (obj?.localVariables || []);
      localVariablesForValidation.forEach(v => validVariableIds.add(v.id));
      const validTypeTokens = new Set((state.project?.components || []).map((component) => `component:${component.id}`));
      const sceneIds = new Set((state.project?.scenes || []).map((projectScene) => projectScene.id));
      const sceneNameCounts = new Map<string, number>();
      (state.project?.scenes || []).forEach((projectScene) => {
        sceneNameCounts.set(projectScene.name, (sceneNameCounts.get(projectScene.name) || 0) + 1);
      });
      const messageIds = new Set((state.project?.messages || []).map((message) => message.id));
      const messageNameCounts = new Map<string, number>();
      (state.project?.messages || []).forEach((message) => {
        messageNameCounts.set(message.name, (messageNameCounts.get(message.name) || 0) + 1);
      });

      validateBlockReferences(
        workspaceRef.current,
        sceneObjectIds,
        objectSoundIds,
        validVariableIds,
        validTypeTokens,
        sceneIds,
        sceneNameCounts,
        messageIds,
        messageNameCounts,
      );
    }

    setTimeout(() => {
      isLoadingRef.current = false;
    }, 50);
    lastLoadedTargetRef.current = loadTargetKey;
  }, [selectedObjectId, selectedSceneId, selectedComponentId, project, flushPendingWorkspacePersist]);

  // Blockly does not auto-rerender existing dropdown field labels when menu text changes.
  // Refresh scene reference fields so renamed scenes are reflected on already-selected values.
  useEffect(() => {
    if (!workspaceRef.current) return;

    const allBlocks = workspaceRef.current.getAllBlocks(false);
    for (const block of allBlocks) {
      const sceneFieldName = SCENE_REFERENCE_BLOCKS[block.type];
      if (!sceneFieldName) continue;

      const field = block.getField(sceneFieldName);
      if (field instanceof Blockly.FieldDropdown) {
        field.forceRerender();
      }
    }
  }, [sceneDropdownStamp]);

  useEffect(() => {
    if (!workspaceRef.current) return;

    const allBlocks = workspaceRef.current.getAllBlocks(false);
    for (const block of allBlocks) {
      const messageFieldName = MESSAGE_REFERENCE_BLOCKS[block.type];
      if (!messageFieldName) continue;

      const field = block.getField(messageFieldName);
      if (field instanceof Blockly.FieldDropdown) {
        field.forceRerender();
      }
    }
  }, [messageDropdownStamp]);

  // Get current object name for local variable option
  const currentObjectName = (() => {
    if (!project) return undefined;
    if (selectedSceneId && selectedObjectId) {
      const scene = project.scenes.find((s) => s.id === selectedSceneId);
      return scene?.objects.find((o) => o.id === selectedObjectId)?.name;
    }
    if (selectedComponentId) {
      return (project.components || []).find((component) => component.id === selectedComponentId)?.name;
    }
    return undefined;
  })();

  const handleAddVariable = (variable: Variable) => {
    if (variable.scope === 'global') {
      addGlobalVariable(variable);
    } else if (selectedSceneId && selectedObjectId) {
      addLocalVariable(selectedSceneId, selectedObjectId, variable);
    } else if (selectedComponentId) {
      const component = (project?.components || []).find((componentItem) => componentItem.id === selectedComponentId);
      if (component) {
        updateComponent(selectedComponentId, {
          localVariables: [
            ...(component.localVariables || []),
            { ...variable, scope: 'local' },
          ],
        });
      }
    }
    // Refresh the toolbox to show the new variable
    if (workspaceRef.current) {
      workspaceRef.current.refreshToolboxSelection();
    }
  };

  return (
    <>
      <div ref={containerRef} className="h-full w-full" data-blockly-editor="true" />
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
      <MessageDialog
        open={showMessageDialog}
        mode={messageDialogMode}
        name={messageDialogName}
        error={messageDialogError}
        onNameChange={(name) => {
          setMessageDialogName(name);
          if (messageDialogError) {
            setMessageDialogError(null);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            closeMessageDialog();
          }
        }}
        onSubmit={handleSubmitMessageDialog}
      />
    </>
  );
}
