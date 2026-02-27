import { useState, useEffect, useRef, useCallback } from 'react';
import Color from 'color';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ColorPicker,
  ColorPickerSelection,
  ColorPickerHue,
} from '@/components/ui/color-picker';
import { RotateCw, FlipHorizontal, FlipVertical, Link, Unlink, Component } from 'lucide-react';
import type { GameObject, Scene, GroundConfig, PhysicsConfig } from '@/types';
import { createDefaultColliderConfig } from '@/types';

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
      className={`flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg flex-1 min-w-0 ${isDragging ? 'ring-1 ring-primary' : ''}`}
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
        className="flex-1 min-w-0 bg-transparent text-sm outline-none text-foreground"
        style={{ cursor: isAltHover || isDragging ? 'ew-resize' : 'text' }}
      />
    </div>
  );
}

export function ObjectInspector() {
  const { project, updateObject, updateScene } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedObjectIds } = useEditorStore();
  const [activeTab, setActiveTab] = useState<string>('object');

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
    if (selectedObjectId || selectedObjectIds.length > 0) {
      setActiveTab('object');
    }
  }, [selectedObjectId, selectedObjectIds.length]);

  return (
    <div className="bg-card border-t">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList variant="line" className="w-full justify-start px-4">
          <TabsTrigger value="object">Object</TabsTrigger>
          <TabsTrigger value="scene">Scene</TabsTrigger>
        </TabsList>

        <TabsContent value="object" className="px-4 py-3 mt-0">
          <ObjectProperties
            objects={selectedObjects}
            sceneId={selectedSceneId}
            updateObject={updateObject}
          />
        </TabsContent>
        <TabsContent value="scene" className="px-4 py-3 mt-0">
          <SceneProperties
            scene={scene}
            updateScene={updateScene}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface ObjectPropertiesProps {
  objects: GameObject[];
  sceneId: string | null;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
}

function ObjectProperties({ objects, sceneId, updateObject }: ObjectPropertiesProps) {
  const [linkScale, setLinkScale] = useState(true);
  const dragStartValuesRef = useRef<Partial<Record<'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation', Map<string, number>>>>({});
  const object = objects[0];
  const isMultiSelection = objects.length > 1;

  if (!object || !sceneId) {
    return (
      <div className="text-center text-muted-foreground text-sm py-4">
        Select an object to view its properties
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
    for (const selectedObj of objects) {
      updateObject(sceneId, selectedObj.id, buildUpdates(selectedObj));
    }
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
    dragStartValuesRef.current[field] = new Map(objects.map((selectedObj) => [selectedObj.id, picker(selectedObj)]));
  };

  const clearDragStart = (field: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation') => {
    delete dragStartValuesRef.current[field];
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
  const allVisible = objects.every((selectedObj) => selectedObj.visible);
  const mixedVisible = objects.some((selectedObj) => selectedObj.visible !== allVisible);
  const allFlippedH = objects.every((selectedObj) => selectedObj.scaleX < 0);
  const allFlippedV = objects.every((selectedObj) => selectedObj.scaleY < 0);
  const visibleToggleId = isMultiSelection ? 'visible-toggle-multi' : 'visible-toggle';

  return (
    <div className="space-y-4">
      {/* Component indicator */}
      {anyComponentInstance && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/50">
          <Component className="size-4 text-purple-600" />
          <span className="text-xs text-muted-foreground">Component - code and physics sync across all instances</span>
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
        <div className="flex gap-2">
          <ScrubInput
            label="X"
            value={xField.value}
            mixed={xField.mixed}
            onChange={(x, source, delta) => handlePositionChange('x', x, source, delta)}
            precision={2}
            onDragStart={() => saveDragStart('x', (selectedObj) => selectedObj.x)}
            onDragEnd={() => clearDragStart('x')}
          />
          <ScrubInput
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
        <div className="flex gap-2 items-center">
          <ScrubInput
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
            className={linkScale ? 'text-primary' : 'text-muted-foreground'}
            title={linkScale ? 'Unlink scale' : 'Link scale'}
          >
            {linkScale ? <Link className="size-4" /> : <Unlink className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Rotation */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Rotation</div>
        <div className="flex gap-2 items-center">
          <ScrubInput
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
            className={allFlippedH ? 'text-primary' : ''}
          >
            <FlipHorizontal className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleFlipV}
            title="Flip vertical"
            className={allFlippedV ? 'text-primary' : ''}
          >
            <FlipVertical className="size-4" />
          </Button>
        </div>
      </div>

      {/* Physics is single-object only */}
      {!isMultiSelection && (
        <>
          <PhysicsToggle object={object} sceneId={sceneId} updateObject={updateObject} />
          {object.physics?.enabled && (
            <PhysicsProperties object={object} sceneId={sceneId} updateObject={updateObject} />
          )}
        </>
      )}
    </div>
  );
}

interface ScenePropertiesProps {
  scene: Scene | undefined;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
}

function SceneProperties({ scene, updateScene }: ScenePropertiesProps) {
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
    <div className="space-y-4">
      {/* Background Color */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Background</span>
        <ColorSwatch
          value={scene.background?.value || '#87CEEB'}
          onChange={(color) => updateScene(scene.id, {
            background: { type: 'color', value: color }
          })}
        />
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
            <div className="flex gap-2 items-center">
              <ScrubInput
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
    </div>
  );
}

// Object property field components

interface FieldProps {
  object: GameObject;
  sceneId: string;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
}

function PhysicsToggle({ object, sceneId, updateObject }: FieldProps) {
  const hasPhysics = object.physics?.enabled ?? false;

  const togglePhysics = (checked: boolean) => {
    if (!checked) {
      // Keep collider when physics is turned off (as per requirement)
      updateObject(sceneId, object.id, { physics: null });
    } else {
      // Enable physics with default settings
      const updates: Partial<GameObject> = {
        physics: {
          enabled: true,
          bodyType: 'dynamic',
          gravityY: 1, // Matter.js gravity scale: 1 = normal gravity
          velocityX: 0,
          velocityY: 0,
          bounce: 0.2,
          friction: 0.1,
          allowRotation: false,
        },
      };

      // If no collider exists, create a default circle collider
      if (!object.collider || object.collider.type === 'none') {
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

function PhysicsProperties({ object, sceneId, updateObject }: FieldProps) {
  const physics = object.physics!;
  const syncedLabelClass = object.componentId ? 'text-purple-600' : 'text-muted-foreground';

  const updatePhysics = (updates: Partial<PhysicsConfig>) => {
    updateObject(sceneId, object.id, {
      physics: { ...physics, ...updates }
    });
  };

  return (
    <div className="space-y-4 mt-3">
      {/* Body Type */}
      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Body Type</div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg flex-1">
            <select
              value={physics.bodyType}
              onChange={(e) => updatePhysics({ bodyType: e.target.value as 'dynamic' | 'static' })}
              className="flex-1 bg-transparent text-sm outline-none text-foreground cursor-pointer"
            >
              <option value="dynamic">Dynamic</option>
              <option value="static">Static</option>
            </select>
          </div>
        </div>
      </div>

      {/* Gravity */}
      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Gravity</div>
        <div className="flex gap-2">
          <ScrubInput
            label="Y"
            value={physics.gravityY}
            onChange={(gravityY) => updatePhysics({ gravityY })}
            precision={0}
          />
        </div>
      </div>

      {/* Bounce */}
      <div>
        <div className={`text-xs mb-2 ${syncedLabelClass}`}>Bounce</div>
        <div className="flex gap-2">
          <ScrubInput
            label=""
            value={physics.bounce ?? 0.2}
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
        <div className="flex gap-2">
          <ScrubInput
            label=""
            value={physics.friction ?? 0.1}
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
          checked={physics.allowRotation ?? false}
          onCheckedChange={(checked) => updatePhysics({ allowRotation: !!checked })}
        />
        <Label htmlFor="allow-rotation" className={`text-xs cursor-pointer ${syncedLabelClass}`}>
          Rotate with Physics
        </Label>
      </div>
    </div>
  );
}
