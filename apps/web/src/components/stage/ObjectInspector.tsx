import { useState, useEffect, useRef, useCallback } from 'react';
import Color from 'color';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ColorPicker,
  ColorPickerSelection,
  ColorPickerHue,
} from '@/components/ui/color-picker';
import { RotateCw, FlipHorizontal, FlipVertical, Link, Unlink, Component, Paintbrush } from 'lucide-react';
import type { GameObject, Scene, GroundConfig, PhysicsConfig } from '@/types';
import { createDefaultColliderConfig, createDefaultPhysicsConfig, getEffectiveObjectProps } from '@/types';
import {
  beginHistoryTransaction,
  endHistoryTransaction,
  runInHistoryTransaction,
} from '@/store/universalHistory';
import { freezeEditorResizeForLayoutTransition } from '@/lib/freezeEditorResize';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import { cn } from '@/lib/utils';

type InspectorTab = 'object' | 'scene';
type PhysicsBodyType = PhysicsConfig['bodyType'];
type ColliderType = NonNullable<GameObject['collider']>['type'];

const inspectorTabs: SegmentedControlOption<InspectorTab>[] = [
  { value: 'object', label: 'Object' },
  { value: 'scene', label: 'Scene' },
];

const bodyTypeOptions: Array<{ value: PhysicsBodyType; label: string }> = [
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'static', label: 'Static' },
];

function isPhysicsBodyType(value: string): value is PhysicsBodyType {
  return bodyTypeOptions.some((option) => option.value === value);
}

// Color swatch with popup picker
interface ColorSwatchProps {
  value: string;
  onChange: (color: string) => void;
}

function ColorSwatch({ value, onChange }: ColorSwatchProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleColorChange = useCallback((value: Parameters<typeof Color>[0]) => {
    try {
      const hex = Color(value).hex();
      onChange(hex);
    } catch {
      // Ignore invalid color values from picker
    }
  }, [onChange]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-md border border-border cursor-pointer shadow-sm hover:scale-105 transition-transform"
        style={{ backgroundColor: value }}
        title={value}
      />
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-lg p-3 shadow-lg">
            <ColorPicker value={value} onChange={handleColorChange} className="w-48">
              <ColorPickerSelection className="h-32 rounded mb-2" />
              <ColorPickerHue />
            </ColorPicker>
          </div>
        </>
      )}
    </div>
  );
}

// Scrubbing input component with alt+drag support
interface ScrubInputProps {
  label: string;
  value: number;
  onChange: (value: number, source?: 'input' | 'drag', delta?: number) => void;
  className?: string;
  step?: number;
  precision?: number;
  min?: number;
  max?: number;
  suffix?: string;
  mixed?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

function ScrubInput({
  label,
  value,
  onChange,
  className,
  step = 1,
  precision = 2,
  min,
  max,
  suffix = '',
  mixed = false,
  onDragStart,
  onDragEnd,
}: ScrubInputProps) {
  const [localValue, setLocalValue] = useState(mixed ? 'multiple' : value.toFixed(precision));
  const [isDragging, setIsDragging] = useState(false);
  const [isAltHover, setIsAltHover] = useState(false);
  const startXRef = useRef(0);
  const startValueRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveringRef = useRef(false);

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(mixed ? 'multiple' : value.toFixed(precision));
    }
  }, [value, precision, mixed, isDragging]);

  // Listen for alt key while hovering
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && isHoveringRef.current) {
        setIsAltHover(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsAltHover(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleMouseEnter = () => {
    isHoveringRef.current = true;
  };

  const handleMouseLeave = () => {
    isHoveringRef.current = false;
    setIsAltHover(false);
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.altKey) {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startValueRef.current = value;
      onDragStart?.();
      document.body.style.cursor = 'ew-resize';
    }
  }, [value, onDragStart]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      const sensitivity = e.shiftKey ? 0.1 : 1;
      let newValue = startValueRef.current + (deltaX * step * sensitivity);

      if (min !== undefined) newValue = Math.max(min, newValue);
      if (max !== undefined) newValue = Math.min(max, newValue);

      const roundedValue = Number(newValue.toFixed(precision));
      const delta = Number((roundedValue - startValueRef.current).toFixed(precision));
      setLocalValue(roundedValue.toFixed(precision));
      onChange(roundedValue, 'drag', delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onDragEnd?.();
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, step, precision, min, max, onChange, onDragEnd]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = suffix ? e.target.value.replace(suffix, '') : e.target.value;
    setLocalValue(nextValue);
  };

  const handleFocus = () => {
    if (mixed) {
      setLocalValue('');
    }
  };

  const handleBlur = () => {
    const trimmed = localValue.trim();
    if (!trimmed || trimmed.toLowerCase() === 'multiple') {
      setLocalValue(mixed ? 'multiple' : value.toFixed(precision));
      return;
    }

    let newValue = Number.parseFloat(trimmed);
    if (Number.isNaN(newValue)) {
      setLocalValue(mixed ? 'multiple' : value.toFixed(precision));
      return;
    }

    if (min !== undefined) newValue = Math.max(min, newValue);
    if (max !== undefined) newValue = Math.min(max, newValue);
    const roundedValue = Number(newValue.toFixed(precision));
    onChange(roundedValue, 'input');
    setLocalValue(roundedValue.toFixed(precision));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur();
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex w-full min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2',
        isDragging && 'ring-1 ring-primary',
        className,
      )}
      style={{ cursor: isAltHover || isDragging ? 'ew-resize' : 'default' }}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="text-xs text-muted-foreground shrink-0 select-none">{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={localValue === 'multiple' ? localValue : localValue + suffix}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-0 min-w-0 flex-1 bg-transparent text-sm outline-none text-foreground"
        style={{ cursor: isAltHover || isDragging ? 'ew-resize' : 'text' }}
      />
    </div>
  );
}

export function ObjectInspector() {
  const { project, updateObject, updateScene } = useProjectStore();
  const {
    selectedSceneId,
    selectedFolderId,
    selectedObjectId,
    selectedObjectIds,
    openBackgroundEditor,
    openWorldBoundaryEditor,
    openCostumeColliderEditor,
  } = useEditorStore();
  const [activeTab, setActiveTab] = useState<InspectorTab>('object');

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const selectedObjects = scene
    ? (selectedObjectIds.length > 0
      ? selectedObjectIds
          .map((id) => scene.objects.find(o => o.id === id))
          .filter((obj): obj is GameObject => !!obj)
      : (selectedObjectId ? scene.objects.filter(o => o.id === selectedObjectId) : []))
    : [];

  // Switch to object tab when an object is selected
  useEffect(() => {
    if (selectedFolderId || selectedObjectId || selectedObjectIds.length > 0) {
      setActiveTab('object');
    }
  }, [selectedFolderId, selectedObjectId, selectedObjectIds.length]);

  const handleSegmentedTabChange = useCallback((value: InspectorTab) => {
    freezeEditorResizeForLayoutTransition();
    setActiveTab(value);
  }, []);

  return (
    <div className="inspector-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
      <div className="shrink-0 border-b border-zinc-200/80 px-3 py-1.5 dark:border-white/10">
        <SegmentedControl
          ariaLabel="Inspector sections"
          className="w-full"
          options={inspectorTabs}
          size="small"
          value={activeTab}
          onValueChange={handleSegmentedTabChange}
        />
      </div>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <ScrollArea
          aria-hidden={activeTab !== 'object'}
          className={cn(
            'absolute inset-0 h-full min-h-0 min-w-0',
            activeTab === 'object' ? 'z-10' : 'hidden',
          )}
        >
          <div className="min-h-full min-w-0 px-4 py-3">
            <ObjectProperties
              objects={selectedObjects}
              sceneId={selectedSceneId}
              updateObject={updateObject}
              openCostumeColliderEditor={openCostumeColliderEditor}
            />
          </div>
        </ScrollArea>

        <ScrollArea
          aria-hidden={activeTab !== 'scene'}
          className={cn(
            'absolute inset-0 h-full min-h-0 min-w-0',
            activeTab === 'scene' ? 'z-10' : 'hidden',
          )}
        >
          <div className="min-h-full min-w-0 px-4 py-3">
            <SceneProperties
              scene={scene}
              updateScene={updateScene}
              onOpenBackgroundEditor={openBackgroundEditor}
              onOpenWorldBoundaryEditor={openWorldBoundaryEditor}
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

interface ObjectPropertiesProps {
  objects: GameObject[];
  sceneId: string | null;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
  openCostumeColliderEditor: (sceneId: string, objectId: string) => void;
}

function ObjectProperties({ objects, sceneId, updateObject, openCostumeColliderEditor }: ObjectPropertiesProps) {
  const [linkScale, setLinkScale] = useState(true);
  const dragStartValuesRef = useRef<Partial<Record<'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation', Map<string, number>>>>({});
  const activeDragTransactionsRef = useRef(0);
  const object = objects[0];
  const isMultiSelection = objects.length > 1;
  const components = useProjectStore((state) => state.project?.components || []);

  useEffect(() => {
    return () => {
      while (activeDragTransactionsRef.current > 0) {
        activeDragTransactionsRef.current -= 1;
        endHistoryTransaction('inspector:drag:cleanup');
      }
      dragStartValuesRef.current = {};
    };
  }, []);

  if (!object || !sceneId) {
    return (
      <div className="text-center text-muted-foreground text-sm py-4">
        {NO_OBJECT_SELECTED_MESSAGE}
      </div>
    );
  }

  const areValuesEqual = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  const getSharedNumber = (picker: (obj: GameObject) => number) => {
    const first = picker(objects[0]);
    const mixed = objects.some((selectedObj) => !areValuesEqual(picker(selectedObj), first));
    return { value: first, mixed };
  };

  const xField = getSharedNumber((selectedObj) => selectedObj.x);
  const yField = getSharedNumber((selectedObj) => selectedObj.y);
  const scaleXField = getSharedNumber((selectedObj) => Math.abs(selectedObj.scaleX));
  const scaleYField = getSharedNumber((selectedObj) => Math.abs(selectedObj.scaleY));
  const rotationField = getSharedNumber((selectedObj) => selectedObj.rotation);

  const applyToSelected = (buildUpdates: (obj: GameObject) => Partial<GameObject>) => {
    runInHistoryTransaction('inspector:apply-selected', () => {
      for (const selectedObj of objects) {
        updateObject(sceneId, selectedObj.id, buildUpdates(selectedObj));
      }
    });
  };

  const clamp = (value: number, minValue?: number, maxValue?: number) => {
    let next = value;
    if (minValue !== undefined) next = Math.max(minValue, next);
    if (maxValue !== undefined) next = Math.min(maxValue, next);
    return next;
  };

  const saveDragStart = (
    field: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation',
    picker: (obj: GameObject) => number,
  ) => {
    if (activeDragTransactionsRef.current === 0) {
      beginHistoryTransaction(`inspector:drag:${field}`);
    }
    activeDragTransactionsRef.current += 1;
    dragStartValuesRef.current[field] = new Map(objects.map((selectedObj) => [selectedObj.id, picker(selectedObj)]));
  };

  const clearDragStart = (field: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation') => {
    delete dragStartValuesRef.current[field];
    activeDragTransactionsRef.current = Math.max(0, activeDragTransactionsRef.current - 1);
    if (activeDragTransactionsRef.current === 0) {
      endHistoryTransaction(`inspector:drag:${field}`);
    }
  };

  const handlePositionChange = (
    axis: 'x' | 'y',
    nextValue: number,
    source?: 'input' | 'drag',
    delta = 0,
  ) => {
    if (source === 'drag') {
      const startValues = dragStartValuesRef.current[axis];
      if (!startValues) return;
      applyToSelected((selectedObj) => {
        const startValue = startValues.get(selectedObj.id) ?? selectedObj[axis];
        return { [axis]: startValue + delta };
      });
      return;
    }
    applyToSelected(() => ({ [axis]: nextValue }));
  };

  const handleScaleXChange = (nextAbsScaleX: number, source?: 'input' | 'drag', delta = 0) => {
    if (source === 'drag') {
      const startValues = dragStartValuesRef.current.scaleX;
      if (!startValues) return;
      applyToSelected((selectedObj) => {
        const startAbsScaleX = startValues.get(selectedObj.id) ?? Math.abs(selectedObj.scaleX);
        const newAbsScaleX = clamp(startAbsScaleX + delta, 0.01);
        const scaleX = (selectedObj.scaleX < 0 ? -1 : 1) * newAbsScaleX;
        if (linkScale) {
          const scaleY = (selectedObj.scaleY < 0 ? -1 : 1) * newAbsScaleX;
          return { scaleX, scaleY };
        }
        return { scaleX };
      });
      return;
    }

    const clampedAbsScaleX = clamp(nextAbsScaleX, 0.01);
    applyToSelected((selectedObj) => {
      const scaleX = (selectedObj.scaleX < 0 ? -1 : 1) * clampedAbsScaleX;
      if (linkScale) {
        const scaleY = (selectedObj.scaleY < 0 ? -1 : 1) * clampedAbsScaleX;
        return { scaleX, scaleY };
      }
      return { scaleX };
    });
  };

  const handleScaleYChange = (nextAbsScaleY: number, source?: 'input' | 'drag', delta = 0) => {
    if (source === 'drag') {
      const startValues = dragStartValuesRef.current.scaleY;
      if (!startValues) return;
      applyToSelected((selectedObj) => {
        const startAbsScaleY = startValues.get(selectedObj.id) ?? Math.abs(selectedObj.scaleY);
        const newAbsScaleY = clamp(startAbsScaleY + delta, 0.01);
        const scaleY = (selectedObj.scaleY < 0 ? -1 : 1) * newAbsScaleY;
        if (linkScale) {
          const scaleX = (selectedObj.scaleX < 0 ? -1 : 1) * newAbsScaleY;
          return { scaleX, scaleY };
        }
        return { scaleY };
      });
      return;
    }

    const clampedAbsScaleY = clamp(nextAbsScaleY, 0.01);
    applyToSelected((selectedObj) => {
      const scaleY = (selectedObj.scaleY < 0 ? -1 : 1) * clampedAbsScaleY;
      if (linkScale) {
        const scaleX = (selectedObj.scaleX < 0 ? -1 : 1) * clampedAbsScaleY;
        return { scaleX, scaleY };
      }
      return { scaleY };
    });
  };

  const handleRotationChange = (nextRotation: number, source?: 'input' | 'drag', delta = 0) => {
    if (source === 'drag') {
      const startValues = dragStartValuesRef.current.rotation;
      if (!startValues) return;
      applyToSelected((selectedObj) => {
        const startRotation = startValues.get(selectedObj.id) ?? selectedObj.rotation;
        return { rotation: startRotation + delta };
      });
      return;
    }
    applyToSelected(() => ({ rotation: nextRotation }));
  };

  const handleUpdate = (updates: Partial<GameObject>) => {
    applyToSelected(() => updates);
  };

  const handleFlipH = () => {
    applyToSelected((selectedObj) => ({ scaleX: -selectedObj.scaleX }));
  };

  const handleFlipV = () => {
    applyToSelected((selectedObj) => ({ scaleY: -selectedObj.scaleY }));
  };

  const handleRotate90 = () => {
    applyToSelected((selectedObj) => ({ rotation: (selectedObj.rotation + 90) % 360 }));
  };

  const anyComponentInstance = objects.some((selectedObj) => !!selectedObj.componentId);
  const effectiveObjectProps = getEffectiveObjectProps(object, components);
  const effectivePhysics = effectiveObjectProps.physics;
  const effectiveCollider = effectiveObjectProps.collider;
  const allVisible = objects.every((selectedObj) => selectedObj.visible);
  const mixedVisible = objects.some((selectedObj) => selectedObj.visible !== allVisible);
  const allFlippedH = objects.every((selectedObj) => selectedObj.scaleX < 0);
  const allFlippedV = objects.every((selectedObj) => selectedObj.scaleY < 0);
  const visibleToggleId = isMultiSelection ? 'visible-toggle-multi' : 'visible-toggle';

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Component indicator */}
      {anyComponentInstance && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/50">
          <Component className="size-4 text-purple-600" />
          <span className="min-w-0 text-xs text-muted-foreground">Component - code and physics sync across all instances</span>
        </div>
      )}

      {/* Visibility */}
      <div className="flex items-center gap-2">
        <Checkbox
          id={visibleToggleId}
          checked={mixedVisible ? 'indeterminate' : allVisible}
          onCheckedChange={(checked) => handleUpdate({ visible: checked === true })}
        />
        <Label htmlFor={visibleToggleId} className="text-xs text-muted-foreground cursor-pointer">
          Visible
        </Label>
      </div>

      {/* Position */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Position</div>
        <div className="inspector-field-grid">
          <ScrubInput
            className="min-w-0"
            label="X"
            value={xField.value}
            mixed={xField.mixed}
            onChange={(x, source, delta) => handlePositionChange('x', x, source, delta)}
            precision={2}
            onDragStart={() => saveDragStart('x', (selectedObj) => selectedObj.x)}
            onDragEnd={() => clearDragStart('x')}
          />
          <ScrubInput
            className="min-w-0"
            label="Y"
            value={yField.value}
            mixed={yField.mixed}
            onChange={(y, source, delta) => handlePositionChange('y', y, source, delta)}
            precision={2}
            onDragStart={() => saveDragStart('y', (selectedObj) => selectedObj.y)}
            onDragEnd={() => clearDragStart('y')}
          />
        </div>
      </div>

      {/* Scale (Dimensions) */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Scale</div>
        <div className="inspector-scale-row">
          <ScrubInput
            className="min-w-0"
            label="W"
            value={scaleXField.value}
            mixed={scaleXField.mixed}
            onChange={handleScaleXChange}
            step={0.01}
            precision={2}
            min={0.01}
            onDragStart={() => saveDragStart('scaleX', (selectedObj) => Math.abs(selectedObj.scaleX))}
            onDragEnd={() => clearDragStart('scaleX')}
          />
          <ScrubInput
            className="min-w-0"
            label="H"
            value={scaleYField.value}
            mixed={scaleYField.mixed}
            onChange={handleScaleYChange}
            step={0.01}
            precision={2}
            min={0.01}
            onDragStart={() => saveDragStart('scaleY', (selectedObj) => Math.abs(selectedObj.scaleY))}
            onDragEnd={() => clearDragStart('scaleY')}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setLinkScale(!linkScale)}
            className={cn(
              'inspector-inline-icon-action',
              linkScale ? 'text-primary' : 'text-muted-foreground',
            )}
            title={linkScale ? 'Unlink scale' : 'Link scale'}
          >
            {linkScale ? <Link className="size-4" /> : <Unlink className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Rotation */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Rotation</div>
        <div className="inspector-rotation-row">
          <ScrubInput
            className="inspector-rotation-input min-w-0"
            label="↻"
            value={rotationField.value}
            mixed={rotationField.mixed}
            onChange={handleRotationChange}
            precision={0}
            suffix="°"
            onDragStart={() => saveDragStart('rotation', (selectedObj) => selectedObj.rotation)}
            onDragEnd={() => clearDragStart('rotation')}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="inspector-inline-icon-action"
            onClick={handleRotate90}
            title="Rotate 90°"
          >
            <RotateCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleFlipH}
            title="Flip horizontal"
            className={cn(
              'inspector-inline-icon-action',
              allFlippedH && 'text-primary',
            )}
          >
            <FlipHorizontal className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleFlipV}
            title="Flip vertical"
            className={cn(
              'inspector-inline-icon-action',
              allFlippedV && 'text-primary',
            )}
          >
            <FlipVertical className="size-4" />
          </Button>
        </div>
      </div>

      {/* Physics is single-object only */}
      {!isMultiSelection && (
        <>
          <PhysicsToggle
            object={object}
            sceneId={sceneId}
            updateObject={updateObject}
            physics={effectivePhysics}
            collider={effectiveCollider}
          />
          <PhysicsProperties
            object={object}
            sceneId={sceneId}
            updateObject={updateObject}
            physics={effectivePhysics}
            collider={effectiveCollider}
            enabled={!!effectivePhysics?.enabled}
            onEditCollider={() => openCostumeColliderEditor(sceneId, object.id)}
          />
        </>
      )}
    </div>
  );
}

interface ScenePropertiesProps {
  scene: Scene | undefined;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  onOpenBackgroundEditor: (sceneId: string) => void;
  onOpenWorldBoundaryEditor: (sceneId: string) => void;
}

function SceneProperties({ scene, updateScene, onOpenBackgroundEditor, onOpenWorldBoundaryEditor }: ScenePropertiesProps) {
  if (!scene) {
    return (
      <div className="text-center text-muted-foreground text-sm py-4">
        No scene selected
      </div>
    );
  }

  const ground = scene.ground || { enabled: false, y: -200, color: '#8B4513' };

  const updateGround = (updates: Partial<GroundConfig>) => {
    updateScene(scene.id, {
      ground: { ...ground, ...updates }
    });
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Background Color */}
      <div className="inspector-split-row">
        <span className="text-xs text-muted-foreground">Background</span>
        <div className="inspector-inline-controls">
          <Button
            variant="outline"
            size="sm"
            className="inspector-inline-button h-8 px-2 text-xs"
            onClick={() => onOpenBackgroundEditor(scene.id)}
            title="Draw background"
          >
            <Paintbrush className="size-3.5" />
            Draw
          </Button>
          <ColorSwatch
            value={!scene.background || scene.background.type === 'image'
              ? '#87CEEB'
              : scene.background.value}
            onChange={(color) => updateScene(scene.id, {
              background: scene.background?.type === 'tiled'
                ? { ...scene.background, value: color }
                : { type: 'color', value: color }
            })}
          />
        </div>
      </div>

      {/* Ground Settings */}
      <div className="border-t pt-3">
        <div className="flex items-center gap-2 mb-3">
          <Checkbox
            id="ground-toggle"
            checked={ground.enabled}
            onCheckedChange={(checked) => updateGround({ enabled: !!checked })}
          />
          <Label htmlFor="ground-toggle" className="text-xs text-muted-foreground cursor-pointer">
            Ground
          </Label>
        </div>

        {ground.enabled && (
          <div className="space-y-3">
            <div className="inspector-select-row">
              <ScrubInput
                className="min-w-0"
                label="Y"
                value={ground.y}
                onChange={(y) => updateGround({ y })}
                precision={0}
              />
              <ColorSwatch
                value={ground.color}
                onChange={(color) => updateGround({ color })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-3">
        <div className="inspector-split-row">
          <div className="inspector-inline-controls">
            <Checkbox
              id="world-boundary-toggle"
              checked={!!scene.worldBoundary?.enabled}
              onCheckedChange={(checked) => updateScene(scene.id, {
                worldBoundary: {
                  enabled: !!checked,
                  points: scene.worldBoundary?.points || [],
                },
              })}
            />
            <Label htmlFor="world-boundary-toggle" className="text-xs text-muted-foreground cursor-pointer">
              World Boundary
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="inspector-inline-button h-8 px-2 text-xs"
            onClick={() => onOpenWorldBoundaryEditor(scene.id)}
          >
            Edit
          </Button>
        </div>
        {scene.worldBoundary?.points?.length ? (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {scene.worldBoundary.points.length} points
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-muted-foreground">
            No boundary points yet
          </div>
        )}
      </div>
    </div>
  );
}

// Object property field components

interface FieldProps {
  object: GameObject;
  sceneId: string;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
}

function PhysicsToggle({
  object,
  sceneId,
  updateObject,
  physics,
  collider,
}: FieldProps & {
  physics: PhysicsConfig | null;
  collider: GameObject['collider'];
}) {
  const hasPhysics = physics?.enabled ?? false;

  const togglePhysics = (checked: boolean) => {
    freezeEditorResizeForLayoutTransition();
    if (!checked) {
      // Keep collider when physics is turned off (as per requirement)
      updateObject(sceneId, object.id, { physics: null });
    } else {
      // Enable physics with default settings
      const updates: Partial<GameObject> = {
        physics: createDefaultPhysicsConfig(),
      };

      // If no collider exists, create a default circle collider
      if (!collider || collider.type === 'none') {
        updates.collider = createDefaultColliderConfig('circle');
      }

      updateObject(sceneId, object.id, updates);
    }
  };

  return (
    <div className="flex items-center gap-2 pt-2 border-t">
      <Checkbox
        id="physics-toggle"
        checked={hasPhysics}
        onCheckedChange={togglePhysics}
      />
      <Label
        htmlFor="physics-toggle"
        className={`text-xs cursor-pointer ${object.componentId ? 'text-purple-600' : 'text-muted-foreground'}`}
      >
        Physics
      </Label>
    </div>
  );
}

const colliderTypeOptions: Array<{ value: ColliderType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'box', label: 'Box' },
  { value: 'circle', label: 'Circle' },
  { value: 'capsule', label: 'Capsule' },
];

function isColliderType(value: string): value is ColliderType {
  return colliderTypeOptions.some((option) => option.value === value);
}

function PhysicsProperties({
  object,
  sceneId,
  updateObject,
  physics,
  collider,
  enabled,
  onEditCollider,
}: FieldProps & {
  physics: PhysicsConfig | null;
  collider: GameObject['collider'];
  enabled: boolean;
  onEditCollider: () => void;
}) {
  const syncedLabelClass = object.componentId ? 'text-purple-600' : 'text-muted-foreground';
  const resolvedPhysics = physics ?? createDefaultPhysicsConfig();
  const colliderType = collider?.type ?? 'none';

  const updatePhysics = (updates: Partial<PhysicsConfig>) => {
    if (!enabled) {
      return;
    }
    updateObject(sceneId, object.id, {
      physics: { ...resolvedPhysics, ...updates }
    });
  };

  const updateColliderType = (type: ColliderType) => {
    if (!enabled) {
      return;
    }
    if (type === 'none') {
      updateObject(sceneId, object.id, { collider: null });
      return;
    }

    updateObject(sceneId, object.id, {
      collider: collider ? { ...collider, type } : createDefaultColliderConfig(type),
    });
  };

  return (
    <div
      aria-hidden={!enabled}
      className={cn(
        'mt-3 w-full min-w-0 space-y-4',
        !enabled && 'hidden',
      )}
    >
      {/* Body Type */}
      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Body Type</div>
        <div className="inspector-select-row">
          <div className="w-full min-w-0">
            <Select
              value={resolvedPhysics.bodyType}
              onValueChange={(bodyType) => {
                if (isPhysicsBodyType(bodyType)) {
                  updatePhysics({ bodyType });
                }
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-lg border-0 bg-muted/50 px-3 shadow-none focus-visible:ring-2">
                <SelectValue placeholder="Select body type" />
              </SelectTrigger>
              <SelectContent>
                {bodyTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Gravity */}
      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Gravity</div>
        <div className="inspector-field-grid">
          <ScrubInput
            className="min-w-0"
            label="Y"
            value={resolvedPhysics.gravityY}
            onChange={(gravityY) => updatePhysics({ gravityY })}
            precision={0}
          />
        </div>
      </div>

      {/* Bounce */}
      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Bounce</div>
        <div className="inspector-field-grid">
          <ScrubInput
            className="min-w-0"
            label=""
            value={resolvedPhysics.bounce ?? 0.2}
            onChange={(bounce) => updatePhysics({ bounce })}
            step={0.1}
            precision={2}
            min={0}
            max={1}
          />
        </div>
      </div>

      {/* Friction */}
      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Friction</div>
        <div className="inspector-field-grid">
          <ScrubInput
            className="min-w-0"
            label=""
            value={resolvedPhysics.friction ?? 0.1}
            onChange={(friction) => updatePhysics({ friction })}
            step={0.05}
            precision={2}
            min={0}
            max={1}
          />
        </div>
      </div>

      {/* Rotate Toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="allow-rotation"
          checked={resolvedPhysics.allowRotation ?? false}
          onCheckedChange={(checked) => updatePhysics({ allowRotation: !!checked })}
        />
        <Label htmlFor="allow-rotation" className={`text-xs cursor-pointer ${syncedLabelClass}`}>
          Rotate with Physics
        </Label>
      </div>

      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Collider</div>
        <div className="inspector-select-row">
          <div className="w-full min-w-0">
            <Select
              value={colliderType}
              onValueChange={(value) => {
                if (isColliderType(value)) {
                  updateColliderType(value);
                }
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-lg border-0 bg-muted/50 px-3 shadow-none focus-visible:ring-2">
                <SelectValue placeholder="Select collider" />
              </SelectTrigger>
              <SelectContent>
                {colliderTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="inspector-inline-button h-10 px-3 text-xs"
            onClick={onEditCollider}
            disabled={colliderType === 'none'}
          >
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
}
