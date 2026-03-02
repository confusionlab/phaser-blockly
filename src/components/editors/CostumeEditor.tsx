import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import { CostumeList } from './costume/CostumeList';
import { CostumeCanvas, type CostumeCanvasHandle } from './costume/CostumeCanvas';
import {
  CostumeToolbar,
  type DrawingTool,
  type EditorMode,
  type TextToolStyle,
} from './costume/CostumeToolbar';
import { getEffectiveObjectProps, createDefaultColliderConfig } from '@/types';
import type { Costume, ColliderConfig } from '@/types';

const VECTOR_TOOLS = new Set<DrawingTool>(['select', 'rectangle', 'circle', 'line', 'text', 'collider']);
const BITMAP_TOOLS = new Set<DrawingTool>(['select', 'brush', 'eraser', 'fill', 'circle', 'rectangle', 'line', 'collider']);

function ensureToolForMode(mode: EditorMode, tool: DrawingTool): DrawingTool {
  if (mode === 'vector') {
    return VECTOR_TOOLS.has(tool) ? tool : 'select';
  }
  return BITMAP_TOOLS.has(tool) ? tool : 'brush';
}

export function CostumeEditor() {
  const canvasRef = useRef<CostumeCanvasHandle>(null);
  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId, registerCostumeUndo } = useEditorStore();

  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => canvasRef.current?.undo(),
      redo: () => canvasRef.current?.redo(),
      canUndo: () => canvasRef.current?.canUndo() ?? false,
      canRedo: () => canvasRef.current?.canRedo() ?? false,
      deleteSelection: () => canvasRef.current?.deleteSelection() ?? false,
      duplicateSelection: () => canvasRef.current?.duplicateSelection() ?? false,
      isTextEditing: () => canvasRef.current?.isTextEditing() ?? false,
    };
    registerCostumeUndo(handler);
    return () => registerCostumeUndo(null);
  }, [registerCostumeUndo]);

  const [editorMode, setEditorMode] = useState<EditorMode>('vector');
  const [activeTool, setActiveTool] = useState<DrawingTool>('select');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
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

  const currentCostumeIdRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSavedRef = useRef(false);
  const isLoadingRef = useRef(true);

  useEffect(() => {
    currentCostumeIdRef.current = null;
    isLoadingRef.current = true;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, [selectedSceneId, selectedObjectId]);

  const scene = project?.scenes.find((s) => s.id === selectedSceneId);
  const object = scene?.objects.find((o) => o.id === selectedObjectId);

  const effectiveProps = useMemo(() => {
    if (!object || !project) return null;
    return getEffectiveObjectProps(object, project.components || []);
  }, [object, project]);

  const costumes = useMemo(() => effectiveProps?.costumes || [], [effectiveProps]);
  const currentCostumeIndex = effectiveProps?.currentCostumeIndex ?? 0;
  const collider = effectiveProps?.collider ?? null;

  const saveToCostume = useCallback(() => {
    if (!canvasRef.current) return;
    if (isLoadingRef.current) return;

    const editorState = useEditorStore.getState();
    const projectState = useProjectStore.getState();

    const sceneId = editorState.selectedSceneId;
    const objectId = editorState.selectedObjectId;
    if (!sceneId || !objectId || !projectState.project) return;

    const freshScene = projectState.project.scenes.find((s) => s.id === sceneId);
    const freshObject = freshScene?.objects.find((o) => o.id === objectId);
    if (!freshObject) return;

    const freshEffectiveProps = getEffectiveObjectProps(freshObject, projectState.project.components || []);
    const freshCostumes = freshEffectiveProps.costumes || [];
    const freshCostumeIndex = freshEffectiveProps.currentCostumeIndex ?? 0;
    if (freshCostumes.length === 0) return;

    const state = canvasRef.current.exportCostumeState();
    if (!state.dataUrl) return;

    justSavedRef.current = true;
    const updatedCostumes = freshCostumes.map((c, i) =>
      i === freshCostumeIndex
        ? {
            ...c,
            assetId: state.dataUrl,
            bounds: state.bounds || undefined,
            editorMode: state.editorMode,
            vectorDocument: state.vectorDocument,
          }
        : c
    );

    updateObject(sceneId, objectId, { costumes: updatedCostumes });

    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [updateObject]);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(saveToCostume, 300);
  }, [saveToCostume]);

  useEffect(() => {
    if (!canvasRef.current || costumes.length === 0) return;
    if (justSavedRef.current) return;

    const currentCostume = costumes[currentCostumeIndex];
    if (!currentCostume) return;

    if (currentCostumeIdRef.current !== currentCostume.id) {
      currentCostumeIdRef.current = currentCostume.id;
      isLoadingRef.current = true;

      const initialMode: EditorMode = currentCostume.editorMode === 'bitmap' ? 'bitmap' : 'vector';
      setEditorMode(initialMode);
      setActiveTool((prev) => ensureToolForMode(initialMode, prev));

      canvasRef.current.loadCostume(currentCostume).finally(() => {
        isLoadingRef.current = false;
        const resolvedMode = canvasRef.current?.getEditorMode() ?? initialMode;
        setEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      });
    }
  }, [costumes, currentCostumeIndex]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleHistoryChange = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }
    if (canvasRef.current) {
      setCanUndo(canvasRef.current.canUndo());
      setCanRedo(canvasRef.current.canRedo());
    }
    debouncedSave();
  }, [debouncedSave]);

  const persistCurrentCostumeInMemory = useCallback(() => {
    if (isLoadingRef.current) {
      return costumes;
    }
    if (!canvasRef.current || costumes.length === 0) {
      return costumes;
    }
    const state = canvasRef.current.exportCostumeState();
    if (!state.dataUrl) {
      return costumes;
    }
    return costumes.map((c, i) =>
      i === currentCostumeIndex
        ? {
            ...c,
            assetId: state.dataUrl,
            bounds: state.bounds || undefined,
            editorMode: state.editorMode,
            vectorDocument: state.vectorDocument,
          }
        : c
    );
  }, [costumes, currentCostumeIndex]);

  const handleSelectCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const updatedCostumes = persistCurrentCostumeInMemory();
    currentCostumeIdRef.current = null;
    updateObject(selectedSceneId, selectedObjectId, {
      costumes: updatedCostumes,
      currentCostumeIndex: index,
    });
  }, [selectedSceneId, selectedObjectId, persistCurrentCostumeInMemory, updateObject]);

  const handleAddCostume = useCallback((costume: Costume) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const updatedCostumes = persistCurrentCostumeInMemory();
    currentCostumeIdRef.current = null;
    updateObject(selectedSceneId, selectedObjectId, {
      costumes: [...updatedCostumes, costume],
      currentCostumeIndex: updatedCostumes.length,
    });
  }, [selectedSceneId, selectedObjectId, persistCurrentCostumeInMemory, updateObject]);

  const handleDeleteCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId || costumes.length <= 1) return;

    const updatedCostumes = costumes.filter((_, i) => i !== index);
    const newIndex = Math.min(currentCostumeIndex, updatedCostumes.length - 1);

    currentCostumeIdRef.current = null;
    updateObject(selectedSceneId, selectedObjectId, {
      costumes: updatedCostumes,
      currentCostumeIndex: newIndex,
    });
  }, [selectedSceneId, selectedObjectId, costumes, currentCostumeIndex, updateObject]);

  const handleRenameCostume = useCallback((index: number, name: string) => {
    if (!selectedSceneId || !selectedObjectId) return;

    justSavedRef.current = true;
    const updatedCostumes = costumes.map((c, i) =>
      i === index ? { ...c, name } : c
    );
    updateObject(selectedSceneId, selectedObjectId, { costumes: updatedCostumes });
    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [selectedSceneId, selectedObjectId, costumes, updateObject]);

  const handleEditorModeChange = useCallback((mode: EditorMode) => {
    setEditorMode(mode);
    setActiveTool((prev) => ensureToolForMode(mode, prev));
    if (canvasRef.current) {
      void canvasRef.current.setEditorMode(mode);
    }
  }, []);

  const handleCanvasModeChange = useCallback((mode: EditorMode) => {
    setEditorMode(mode);
    setActiveTool((prev) => ensureToolForMode(mode, prev));
    if (mode !== 'vector') {
      setHasTextSelection(false);
    }
  }, []);

  const handleToolChange = useCallback((tool: DrawingTool) => {
    setActiveTool(ensureToolForMode(editorMode, tool));
  }, [editorMode]);

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
    if (!selectedSceneId || !selectedObjectId) return;

    justSavedRef.current = true;

    if (type === 'none') {
      updateObject(selectedSceneId, selectedObjectId, { collider: null });
    } else {
      const newCollider: ColliderConfig = collider
        ? { ...collider, type }
        : createDefaultColliderConfig(type);
      updateObject(selectedSceneId, selectedObjectId, { collider: newCollider });
    }

    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [selectedSceneId, selectedObjectId, collider, updateObject]);

  const handleColliderChange = useCallback((newCollider: ColliderConfig) => {
    if (!selectedSceneId || !selectedObjectId) return;

    justSavedRef.current = true;
    updateObject(selectedSceneId, selectedObjectId, { collider: newCollider });
    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [selectedSceneId, selectedObjectId, updateObject]);

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
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
    <div className="flex flex-col h-full">
      <CostumeToolbar
        editorMode={editorMode}
        activeTool={activeTool}
        showTextControls={editorMode === 'vector' && (activeTool === 'text' || hasTextSelection)}
        brushColor={brushColor}
        brushSize={brushSize}
        textStyle={textStyle}
        onEditorModeChange={handleEditorModeChange}
        onToolChange={handleToolChange}
        onColorChange={setBrushColor}
        onBrushSizeChange={setBrushSize}
        onTextStyleChange={handleTextStyleChange}
      />

      <div className="flex-1 flex overflow-hidden">
        <CostumeList
          costumes={costumes}
          selectedIndex={currentCostumeIndex}
          onSelectCostume={handleSelectCostume}
          onAddCostume={handleAddCostume}
          onDeleteCostume={handleDeleteCostume}
          onRenameCostume={handleRenameCostume}
        />

        <CostumeCanvas
          ref={canvasRef}
          activeTool={activeTool}
          brushColor={brushColor}
          brushSize={brushSize}
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
        />
      </div>
    </div>
  );
}
