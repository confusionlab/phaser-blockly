import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import { CostumeList } from './costume/CostumeList';
import { CostumeCanvas, type CostumeCanvasHandle } from './costume/CostumeCanvas';
import { CostumeToolbar, type DrawingTool } from './costume/CostumeToolbar';
import { getEffectiveObjectProps, createDefaultColliderConfig } from '@/types';
import type { Costume, ColliderConfig } from '@/types';

export function CostumeEditor() {
  const canvasRef = useRef<CostumeCanvasHandle>(null);
  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId, registerCostumeUndo } = useEditorStore();

  // Register undo/redo handler for keyboard shortcuts
  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => canvasRef.current?.undo(),
      redo: () => canvasRef.current?.redo(),
      canUndo: () => canvasRef.current?.canUndo() ?? false,
      canRedo: () => canvasRef.current?.canRedo() ?? false,
    };
    registerCostumeUndo(handler);
    return () => registerCostumeUndo(null);
  }, [registerCostumeUndo]);

  // Tool state
  const [activeTool, setActiveTool] = useState<DrawingTool>('brush');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);

  // History state for UI
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Track current costume to detect changes
  const currentCostumeIdRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSavedRef = useRef(false);
  const isLoadingRef = useRef(false);

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const object = scene?.objects.find(o => o.id === selectedObjectId);

  // Get effective costumes (from component if applicable)
  const effectiveProps = useMemo(() => {
    if (!object || !project) return null;
    return getEffectiveObjectProps(object, project.components || []);
  }, [object, project]);

  const costumes = useMemo(() => effectiveProps?.costumes || [], [effectiveProps]);
  const currentCostumeIndex = effectiveProps?.currentCostumeIndex ?? 0;
  const collider = effectiveProps?.collider ?? null;

  // Save canvas to current costume - reads fresh data from store at execution time
  const saveToCostume = useCallback(() => {
    if (!canvasRef.current) return;
    if (isLoadingRef.current) return; // Don't save while loading

    // Get fresh data directly from stores at save time (not from closures)
    const editorState = useEditorStore.getState();
    const projectState = useProjectStore.getState();

    const sceneId = editorState.selectedSceneId;
    const objectId = editorState.selectedObjectId;

    if (!sceneId || !objectId || !projectState.project) return;

    // Get fresh object data from store
    const freshScene = projectState.project.scenes.find(s => s.id === sceneId);
    const freshObject = freshScene?.objects.find(o => o.id === objectId);
    if (!freshObject) return;

    // Get effective props fresh
    const freshEffectiveProps = getEffectiveObjectProps(freshObject, projectState.project.components || []);
    const freshCostumes = freshEffectiveProps.costumes || [];
    const freshCostumeIndex = freshEffectiveProps.currentCostumeIndex ?? 0;

    if (freshCostumes.length === 0) return;

    // Get both data URL and bounds in one call
    const { dataUrl, bounds } = canvasRef.current.toDataURLWithBounds();
    if (!dataUrl) return;

    justSavedRef.current = true;
    const updatedCostumes = freshCostumes.map((c, i) =>
      i === freshCostumeIndex ? { ...c, assetId: dataUrl, bounds: bounds || undefined } : c
    );

    updateObject(sceneId, objectId, { costumes: updatedCostumes });

    // Clear the flag after a short delay
    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [updateObject]);

  // Debounced save - stable function that doesn't need to change
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(saveToCostume, 300);
  }, [saveToCostume]);

  // Load costume when selection changes
  useEffect(() => {
    if (!canvasRef.current || costumes.length === 0) return;
    if (justSavedRef.current) return; // Skip if we just saved

    const currentCostume = costumes[currentCostumeIndex];
    if (!currentCostume) return;

    // Only reload if costume changed
    if (currentCostumeIdRef.current !== currentCostume.id) {
      currentCostumeIdRef.current = currentCostume.id;
      isLoadingRef.current = true;
      canvasRef.current.loadFromDataURL(currentCostume.assetId).then(() => {
        isLoadingRef.current = false;
      });
    }
  }, [costumes, currentCostumeIndex]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Handle history changes
  const handleHistoryChange = useCallback(() => {
    if (canvasRef.current) {
      setCanUndo(canvasRef.current.canUndo());
      setCanRedo(canvasRef.current.canRedo());
    }
    debouncedSave();
  }, [debouncedSave]);

  // Costume management handlers
  const handleSelectCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;

    // Save current costume before switching
    if (canvasRef.current && costumes.length > 0) {
      const { dataUrl, bounds } = canvasRef.current.toDataURLWithBounds();
      const updatedCostumes = costumes.map((c, i) =>
        i === currentCostumeIndex ? { ...c, assetId: dataUrl, bounds: bounds || undefined } : c
      );
      // Clear the costume ID ref to force reload of new costume
      currentCostumeIdRef.current = null;
      updateObject(selectedSceneId, selectedObjectId, {
        costumes: updatedCostumes,
        currentCostumeIndex: index,
      });
    } else {
      currentCostumeIdRef.current = null;
      updateObject(selectedSceneId, selectedObjectId, { currentCostumeIndex: index });
    }
  }, [selectedSceneId, selectedObjectId, costumes, currentCostumeIndex, updateObject]);

  const handleAddCostume = useCallback((costume: Costume) => {
    if (!selectedSceneId || !selectedObjectId) return;

    // Save current costume before adding new one
    if (canvasRef.current && costumes.length > 0) {
      const { dataUrl, bounds } = canvasRef.current.toDataURLWithBounds();
      const updatedCostumes = costumes.map((c, i) =>
        i === currentCostumeIndex ? { ...c, assetId: dataUrl, bounds: bounds || undefined } : c
      );
      // Clear the costume ID ref to force reload of new costume
      currentCostumeIdRef.current = null;
      updateObject(selectedSceneId, selectedObjectId, {
        costumes: [...updatedCostumes, costume],
        currentCostumeIndex: updatedCostumes.length, // Select the new costume
      });
    } else {
      currentCostumeIdRef.current = null;
      updateObject(selectedSceneId, selectedObjectId, {
        costumes: [...costumes, costume],
        currentCostumeIndex: costumes.length,
      });
    }
  }, [selectedSceneId, selectedObjectId, costumes, currentCostumeIndex, updateObject]);

  const handleDeleteCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId || costumes.length <= 1) return;

    const updatedCostumes = costumes.filter((_, i) => i !== index);
    const newIndex = Math.min(currentCostumeIndex, updatedCostumes.length - 1);

    // Clear the costume ID ref to force reload
    currentCostumeIdRef.current = null;
    updateObject(selectedSceneId, selectedObjectId, {
      costumes: updatedCostumes,
      currentCostumeIndex: newIndex,
    });
  }, [selectedSceneId, selectedObjectId, costumes, currentCostumeIndex, updateObject]);

  const handleRenameCostume = useCallback((index: number, name: string) => {
    if (!selectedSceneId || !selectedObjectId) return;

    // For rename, we DON'T want to reload the canvas, so set justSaved flag
    justSavedRef.current = true;
    const updatedCostumes = costumes.map((c, i) =>
      i === index ? { ...c, name } : c
    );
    updateObject(selectedSceneId, selectedObjectId, { costumes: updatedCostumes });
    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [selectedSceneId, selectedObjectId, costumes, updateObject]);

  // Collider type change handler
  const handleColliderTypeChange = useCallback((type: ColliderConfig['type']) => {
    if (!selectedSceneId || !selectedObjectId) return;

    // For rename/collider changes, we DON'T want to reload the canvas
    justSavedRef.current = true;

    if (type === 'none') {
      updateObject(selectedSceneId, selectedObjectId, { collider: null });
    } else {
      // Create default collider config with the new type, preserving existing offset/dimensions if possible
      const newCollider: ColliderConfig = collider
        ? { ...collider, type }
        : createDefaultColliderConfig(type);
      updateObject(selectedSceneId, selectedObjectId, { collider: newCollider });
    }

    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [selectedSceneId, selectedObjectId, collider, updateObject]);

  // Collider config change handler (for moving/resizing)
  const handleColliderChange = useCallback((newCollider: ColliderConfig) => {
    if (!selectedSceneId || !selectedObjectId) return;

    justSavedRef.current = true;
    updateObject(selectedSceneId, selectedObjectId, { collider: newCollider });
    setTimeout(() => {
      justSavedRef.current = false;
    }, 100);
  }, [selectedSceneId, selectedObjectId, updateObject]);

  // Undo/Redo handlers
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
      {/* Toolbar */}
      <CostumeToolbar
        activeTool={activeTool}
        brushColor={brushColor}
        brushSize={brushSize}
        canUndo={canUndo}
        canRedo={canRedo}
        colliderType={collider?.type ?? 'none'}
        onToolChange={setActiveTool}
        onColorChange={setBrushColor}
        onBrushSizeChange={setBrushSize}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onColliderTypeChange={handleColliderTypeChange}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Costume List */}
        <CostumeList
          costumes={costumes}
          selectedIndex={currentCostumeIndex}
          onSelectCostume={handleSelectCostume}
          onAddCostume={handleAddCostume}
          onDeleteCostume={handleDeleteCostume}
          onRenameCostume={handleRenameCostume}
        />

        {/* Right: Canvas */}
        <CostumeCanvas
          ref={canvasRef}
          activeTool={activeTool}
          brushColor={brushColor}
          brushSize={brushSize}
          collider={collider}
          onHistoryChange={handleHistoryChange}
          onColliderChange={handleColliderChange}
        />
      </div>
    </div>
  );
}
