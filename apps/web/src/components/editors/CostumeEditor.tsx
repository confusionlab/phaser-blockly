import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import { CostumeList } from './costume/CostumeList';
import { CostumeCanvas, type CostumeCanvasHandle } from './costume/CostumeCanvas';
import {
  CostumeToolbar,
  type AlignAction,
  type DrawingTool,
  type MoveOrderAction,
  type TextToolStyle,
  type VectorHandleType,
} from './costume/CostumeToolbar';
import { resolveCostumeToolShortcut } from './costume/costumeToolShortcuts';
import { getEffectiveObjectProps, createDefaultColliderConfig } from '@/types';
import type { Costume, ColliderConfig, CostumeEditorMode } from '@/types';
import {
  createCostumeEditorSession,
  type CostumeEditorObjectTarget,
  type CostumeEditorOperation,
  type CostumeEditorPersistedSession,
  type CostumeEditorPersistedState,
  type CostumeEditorSession,
  type CostumeEditorTarget,
} from '@/lib/editor/costumeEditorSession';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';

const VECTOR_TOOLS = new Set<DrawingTool>(['select', 'vector', 'rectangle', 'circle', 'line', 'text', 'collider']);
const BITMAP_TOOLS = new Set<DrawingTool>(['select', 'brush', 'eraser', 'fill', 'circle', 'rectangle', 'line', 'collider']);

function ensureToolForMode(mode: CostumeEditorMode, tool: DrawingTool): DrawingTool {
  if (mode === 'vector') {
    return VECTOR_TOOLS.has(tool) ? tool : 'select';
  }
  return BITMAP_TOOLS.has(tool) ? tool : 'brush';
}

function getInitialCostumeEditorMode(costume: Costume | undefined): CostumeEditorMode {
  return costume?.editorMode === 'bitmap' ? 'bitmap' : 'vector';
}

function createCostumeTarget(
  sceneId: string | null,
  objectId: string | null,
  costumeId: string | null,
): CostumeEditorTarget | null {
  if (!sceneId || !objectId || !costumeId) {
    return null;
  }

  return {
    sceneId,
    objectId,
    costumeId,
  };
}

function createCostumeObjectTarget(
  sceneId: string | null,
  objectId: string | null,
): CostumeEditorObjectTarget | null {
  if (!sceneId || !objectId) {
    return null;
  }

  return {
    sceneId,
    objectId,
  };
}

export function CostumeEditor() {
  const canvasRef = useRef<CostumeCanvasHandle>(null);
  const {
    project,
    updateObject,
    updateCostumeFromEditor,
    applyCostumeEditorOperation,
  } = useProjectStore();
  const { selectedSceneId, selectedObjectId, registerCostumeUndo, activeObjectTab } = useEditorStore();

  const currentCostumeIdRef = useRef<string | null>(null);
  const previousSelectionRef = useRef<{ sceneId: string | null; objectId: string | null }>({
    sceneId: null,
    objectId: null,
  });
  const loadRequestIdRef = useRef(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(true);
  const loadedSessionRef = useRef<CostumeEditorSession | null>(null);

  const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
  const object = scene?.objects.find((candidate) => candidate.id === selectedObjectId);

  const effectiveProps = useMemo(() => {
    if (!object || !project) return null;
    return getEffectiveObjectProps(object, project.components || []);
  }, [object, project]);

  const costumes = useMemo(() => effectiveProps?.costumes || [], [effectiveProps]);
  const currentCostumeIndex = effectiveProps?.currentCostumeIndex ?? 0;
  const collider = effectiveProps?.collider ?? null;
  const currentCostume = costumes[currentCostumeIndex];
  const currentSession = useMemo(() => {
    const target = createCostumeTarget(selectedSceneId, selectedObjectId, currentCostume?.id ?? null);
    return target ? createCostumeEditorSession(target) : null;
  }, [currentCostume?.id, selectedObjectId, selectedSceneId]);
  const currentObjectTarget = useMemo(
    () => createCostumeObjectTarget(selectedSceneId, selectedObjectId),
    [selectedObjectId, selectedSceneId],
  );
  const initialEditorMode: CostumeEditorMode = currentCostume
    ? getInitialCostumeEditorMode(currentCostume)
    : 'bitmap';

  const [editorMode, setEditorMode] = useState<CostumeEditorMode>(initialEditorMode);
  const [activeTool, setActiveTool] = useState<DrawingTool>('select');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [vectorHandleType, setVectorHandleType] = useState<VectorHandleType>('corner');
  const [textStyle, setTextStyle] = useState<TextToolStyle>({
    fontFamily: 'Arial',
    fontSize: 32,
    fontWeight: 'normal',
    textAlign: 'left',
    opacity: 1,
  });
  const [hasTextSelection, setHasTextSelection] = useState(false);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasCanvasSelection, setHasCanvasSelection] = useState(false);
  const [hasBitmapFloatingSelection, setHasBitmapFloatingSelection] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);

  useEffect(() => {
    setEditorMode((prev) => {
      if (prev === initialEditorMode) return prev;
      return currentCostumeIdRef.current === null ? initialEditorMode : prev;
    });
    setActiveTool((prev) => {
      if (currentCostumeIdRef.current !== null) return prev;
      return ensureToolForMode(initialEditorMode, prev);
    });
  }, [initialEditorMode]);

  const isCanvasReadyForSession = useCallback((session: CostumeEditorSession | null): boolean => {
    if (!canvasRef.current || !session) {
      return false;
    }
    return canvasRef.current.getLoadedSessionKey() === session.key;
  }, []);

  const getCanvasPersistedStateForSession = useCallback((
    session: CostumeEditorSession | null,
    options: { skipLoadingGuard?: boolean } = {}
  ): CostumeEditorPersistedState | null => {
    if (!canvasRef.current || !session) return null;
    if (!options.skipLoadingGuard && isLoadingRef.current) return null;

    const state = canvasRef.current.exportCostumeState(session.key);
    if (!state?.dataUrl) return null;

    return {
      assetId: state.dataUrl,
      bounds: state.bounds ?? undefined,
      editorMode: state.editorMode,
      vectorDocument: state.vectorDocument,
    };
  }, []);

  const persistCanvasStateToSession = useCallback((
    session: CostumeEditorSession | null,
    options: { skipLoadingGuard?: boolean; recordHistory?: boolean } = {}
  ): boolean => {
    if (!session) return false;

    const persistedState = getCanvasPersistedStateForSession(session, options);
    if (!persistedState) {
      return false;
    }

    const didPersist = updateCostumeFromEditor(session, persistedState, {
      recordHistory: options.recordHistory,
    });
    if (!didPersist) {
      return false;
    }
    return true;
  }, [getCanvasPersistedStateForSession, updateCostumeFromEditor]);

  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => canvasRef.current?.undo(),
      redo: () => canvasRef.current?.redo(),
      canUndo: () => canvasRef.current?.canUndo() ?? false,
      canRedo: () => canvasRef.current?.canRedo() ?? false,
      beforeSelectionChange: ({ recordHistory }) => {
        persistCanvasStateToSession(loadedSessionRef.current, {
          skipLoadingGuard: true,
          recordHistory,
        });
      },
      deleteSelection: () => canvasRef.current?.deleteSelection() ?? false,
      duplicateSelection: () => canvasRef.current?.duplicateSelection() ?? false,
      isTextEditing: () => canvasRef.current?.isTextEditing() ?? false,
    };
    registerCostumeUndo(handler);
    return () => registerCostumeUndo(null);
  }, [persistCanvasStateToSession, registerCostumeUndo]);

  const applyOperationToCurrentObject = useCallback((operation: CostumeEditorOperation): boolean => {
    if (isLoadingRef.current || !currentObjectTarget) {
      return false;
    }

    const loadedSession = loadedSessionRef.current;
    if (loadedSession && !isCanvasReadyForSession(loadedSession)) {
      return false;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const persistedState = getCanvasPersistedStateForSession(loadedSession);
    const persistedSession: CostumeEditorPersistedSession | undefined =
      loadedSession && persistedState
        ? {
            target: loadedSession,
            state: persistedState,
          }
        : undefined;

    return applyCostumeEditorOperation(currentObjectTarget, {
      persistedSession,
      operation,
    });
  }, [applyCostumeEditorOperation, currentObjectTarget, getCanvasPersistedStateForSession, isCanvasReadyForSession]);

  const saveToCostume = useCallback((session: CostumeEditorSession | null) => {
    persistCanvasStateToSession(session);
  }, [persistCanvasStateToSession]);

  const debouncedSave = useCallback((session: CostumeEditorSession | null) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveToCostume(session);
    }, 300);
  }, [saveToCostume]);

  useEffect(() => {
    const previousSelection = previousSelectionRef.current;
    const selectionChanged =
      previousSelection.sceneId !== selectedSceneId ||
      previousSelection.objectId !== selectedObjectId;

    if (selectionChanged) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      loadRequestIdRef.current += 1;
      currentCostumeIdRef.current = null;
      isLoadingRef.current = true;
      setIsSessionLoading(!!selectedObjectId);
    }

    previousSelectionRef.current = {
      sceneId: selectedSceneId,
      objectId: selectedObjectId,
    };
  }, [selectedSceneId, selectedObjectId]);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (!currentCostume || !currentSession) {
      currentCostumeIdRef.current = null;
      const requestId = ++loadRequestIdRef.current;
      isLoadingRef.current = true;
      setIsSessionLoading(!!selectedObjectId);
      const fallbackMode: CostumeEditorMode = 'bitmap';
      setEditorMode(fallbackMode);
      setActiveTool((prev) => ensureToolForMode(fallbackMode, prev));

      canvasRef.current.loadFromDataURL('', null).finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadedSessionRef.current = null;
        isLoadingRef.current = false;
        setIsSessionLoading(false);
        const resolvedMode = canvasRef.current?.getEditorMode() ?? fallbackMode;
        setEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      });
      return;
    }

    const loadedSessionKey = canvasRef.current.getLoadedSessionKey();
    if (currentCostumeIdRef.current !== currentCostume.id || loadedSessionKey !== currentSession.key) {
      currentCostumeIdRef.current = currentCostume.id;
      isLoadingRef.current = true;
      setIsSessionLoading(true);
      const requestId = ++loadRequestIdRef.current;

      const nextMode = getInitialCostumeEditorMode(currentCostume);
      setEditorMode(nextMode);
      setActiveTool((prev) => ensureToolForMode(nextMode, prev));

      canvasRef.current.loadCostume(currentSession.key, currentCostume).finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadedSessionRef.current = currentSession;
        isLoadingRef.current = false;
        setIsSessionLoading(false);
        const resolvedMode = canvasRef.current?.getEditorMode() ?? nextMode;
        setEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      });
    }
  }, [currentCostume, currentSession, selectedObjectId]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      persistCanvasStateToSession(loadedSessionRef.current, {
        skipLoadingGuard: true,
      });
    };
  }, [persistCanvasStateToSession]);

  const handleHistoryChange = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }

    if (canvasRef.current) {
      setCanUndo(canvasRef.current.canUndo());
      setCanRedo(canvasRef.current.canRedo());
    }

    const loadedSession = loadedSessionRef.current;
    if (!loadedSession || !isCanvasReadyForSession(loadedSession)) {
      return;
    }

    debouncedSave(loadedSession);
  }, [debouncedSave, isCanvasReadyForSession]);

  const handleSelectCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

    const nextCostume = costumes[index];
    if (!nextCostume) return;

    applyOperationToCurrentObject({
      type: 'select',
      costumeId: nextCostume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleAddCostume = useCallback((costume: Costume) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

    applyOperationToCurrentObject({
      type: 'add',
      costume,
    });
  }, [applyOperationToCurrentObject, selectedObjectId, selectedSceneId]);

  const handleDeleteCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

    const costume = costumes[index];
    if (!costume) return;

    applyOperationToCurrentObject({
      type: 'remove',
      costumeId: costume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleRenameCostume = useCallback((index: number, name: string) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

    const costume = costumes[index];
    if (!costume) return;

    applyOperationToCurrentObject({
      type: 'rename',
      costumeId: costume.id,
      name,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleEditorModeChange = useCallback((mode: CostumeEditorMode) => {
    if (isLoadingRef.current || !isCanvasReadyForSession(loadedSessionRef.current)) {
      return;
    }

    setEditorMode(mode);
    setActiveTool((prev) => ensureToolForMode(mode, prev));
    if (canvasRef.current) {
      void canvasRef.current.setEditorMode(mode);
    }
  }, [isCanvasReadyForSession]);

  const handleCanvasModeChange = useCallback((mode: CostumeEditorMode) => {
    setEditorMode(mode);
    setActiveTool((prev) => ensureToolForMode(mode, prev));
    if (mode !== 'vector') {
      setHasTextSelection(false);
    }
  }, []);

  const handleToolChange = useCallback((tool: DrawingTool) => {
    if (isLoadingRef.current) {
      return;
    }
    setActiveTool(ensureToolForMode(editorMode, tool));
  }, [editorMode]);

  useEffect(() => {
    if (activeObjectTab !== 'costumes') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isLoadingRef.current) {
        return;
      }
      if (shouldIgnoreGlobalKeyboardEvent(event)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (canvasRef.current?.isTextEditing()) {
        return;
      }

      const nextTool = resolveCostumeToolShortcut(event.key, editorMode);
      if (!nextTool) {
        return;
      }

      event.preventDefault();
      setActiveTool((prev) => {
        const resolvedTool = ensureToolForMode(editorMode, nextTool);
        return prev === resolvedTool ? prev : resolvedTool;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeObjectTab, editorMode]);

  const handleMoveOrder = useCallback((action: MoveOrderAction) => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.moveSelectionOrder(action);
  }, []);

  const handleAlign = useCallback((action: AlignAction) => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.alignSelection(action);
  }, []);

  const handleSelectionStateChange = useCallback((state: { hasSelection: boolean; hasBitmapFloatingSelection: boolean }) => {
    setHasCanvasSelection(state.hasSelection);
    setHasBitmapFloatingSelection(state.hasBitmapFloatingSelection);
  }, []);

  const handleTextStyleChange = useCallback((updates: Partial<TextToolStyle>) => {
    setTextStyle((prev) => {
      const next = { ...prev, ...updates };
      if (
        next.fontFamily === prev.fontFamily &&
        next.fontSize === prev.fontSize &&
        next.fontWeight === prev.fontWeight &&
        next.textAlign === prev.textAlign &&
        next.opacity === prev.opacity
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleColliderTypeChange = useCallback((type: ColliderConfig['type']) => {
    const loadedSession = loadedSessionRef.current;
    if (!loadedSession || isLoadingRef.current || !isCanvasReadyForSession(loadedSession)) return;

    if (type === 'none') {
      updateObject(loadedSession.sceneId, loadedSession.objectId, { collider: null });
    } else {
      const newCollider: ColliderConfig = collider
        ? { ...collider, type }
        : createDefaultColliderConfig(type);
      updateObject(loadedSession.sceneId, loadedSession.objectId, { collider: newCollider });
    }
  }, [collider, isCanvasReadyForSession, updateObject]);

  const handleColliderChange = useCallback((newCollider: ColliderConfig) => {
    const loadedSession = loadedSessionRef.current;
    if (!loadedSession || isLoadingRef.current || !isCanvasReadyForSession(loadedSession)) return;

    updateObject(loadedSession.sceneId, loadedSession.objectId, { collider: newCollider });
  }, [isCanvasReadyForSession, updateObject]);

  const handleUndo = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.redo();
  }, []);

  if (!object) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Select an object to edit costumes
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      <CostumeList
        costumes={costumes}
        selectedIndex={currentCostumeIndex}
        onSelectCostume={handleSelectCostume}
        onAddCostume={handleAddCostume}
        onDeleteCostume={handleDeleteCostume}
        onRenameCostume={handleRenameCostume}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <CostumeToolbar
          editorMode={editorMode}
          activeTool={activeTool}
          showTextControls={editorMode === 'vector' && (activeTool === 'text' || hasTextSelection)}
          brushColor={brushColor}
          brushSize={brushSize}
          textStyle={textStyle}
          onEditorModeChange={handleEditorModeChange}
          onToolChange={handleToolChange}
          onMoveOrder={handleMoveOrder}
          vectorHandleType={vectorHandleType}
          onVectorHandleTypeChange={setVectorHandleType}
          onAlign={handleAlign}
          alignDisabled={editorMode === 'bitmap' ? !hasBitmapFloatingSelection : !hasCanvasSelection}
          onColorChange={setBrushColor}
          onBrushSizeChange={setBrushSize}
          onTextStyleChange={handleTextStyleChange}
        />

        <CostumeCanvas
          ref={canvasRef}
          initialEditorMode={initialEditorMode}
          activeTool={activeTool}
          brushColor={brushColor}
          brushSize={brushSize}
          vectorHandleType={vectorHandleType}
          textStyle={textStyle}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onToolChange={handleToolChange}
          colliderType={collider?.type ?? 'none'}
          onColliderTypeChange={handleColliderTypeChange}
          collider={collider}
          onHistoryChange={handleHistoryChange}
          onColliderChange={handleColliderChange}
          onModeChange={handleCanvasModeChange}
          onTextStyleSync={handleTextStyleChange}
          onTextSelectionChange={setHasTextSelection}
          onSelectionStateChange={handleSelectionStateChange}
        />
      </div>

      {isSessionLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]">
          Switching costume editor to the selected object...
        </div>
      )}
    </div>
  );
}
