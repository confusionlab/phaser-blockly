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
import { RotateCw, FlipHorizontal, FlipVertical, Link, Unlink } from 'lucide-react';
import type { GameObject, Scene, GroundConfig, PhysicsConfig } from '@/types';

// Color swatch with popup picker
interface ColorSwatchProps {
  value: string;
  onChange: (color: string) => void;
}

function ColorSwatch({ value, onChange }: ColorSwatchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    // Delay to avoid immediate close on the same click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleColorChange = useCallback((rgba: [number, number, number, number]) => {
    const hex = Color.rgb(rgba[0], rgba[1], rgba[2]).hex();
    onChange(hex);
  }, [onChange]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-md border border-border cursor-pointer shadow-sm hover:scale-105 transition-transform"
        style={{ backgroundColor: value }}
        title={value}
      />
      {isOpen && (
        <div className="absolute top-10 right-0 z-50 bg-popover border rounded-lg shadow-lg p-3 w-52">
          <ColorPicker value={value} onChange={handleColorChange} className="h-auto gap-3">
            <ColorPickerSelection className="h-32 rounded-md" />
            <ColorPickerHue />
          </ColorPicker>
        </div>
      )}
    </div>
  );
}

// Scrubbing input component with alt+drag support
interface ScrubInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  precision?: number;
  min?: number;
  max?: number;
  suffix?: string;
}

function ScrubInput({ label, value, onChange, step = 1, precision = 2, min, max, suffix = '' }: ScrubInputProps) {
  const [localValue, setLocalValue] = useState(value.toFixed(precision));
  const [isDragging, setIsDragging] = useState(false);
  const [isAltHover, setIsAltHover] = useState(false);
  const startXRef = useRef(0);
  const startValueRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveringRef = useRef(false);

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value.toFixed(precision));
    }
  }, [value, precision, isDragging]);

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
      document.body.style.cursor = 'ew-resize';
    }
  }, [value]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      const sensitivity = e.shiftKey ? 0.1 : 1;
      let newValue = startValueRef.current + (deltaX * step * sensitivity);

      if (min !== undefined) newValue = Math.max(min, newValue);
      if (max !== undefined) newValue = Math.min(max, newValue);

      onChange(Number(newValue.toFixed(precision)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, step, precision, min, max, onChange]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    let newValue = parseFloat(localValue) || 0;
    if (min !== undefined) newValue = Math.max(min, newValue);
    if (max !== undefined) newValue = Math.min(max, newValue);
    onChange(Number(newValue.toFixed(precision)));
    setLocalValue(newValue.toFixed(precision));
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
        value={localValue + suffix}
        onChange={handleChange}
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
  const { selectedSceneId, selectedObjectId } = useEditorStore();
  const [activeTab, setActiveTab] = useState<string>('object');

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const object = scene?.objects.find(o => o.id === selectedObjectId);

  // Switch to object tab when an object is selected
  useEffect(() => {
    if (selectedObjectId) {
      setActiveTab('object');
    }
  }, [selectedObjectId]);

  return (
    <div className="bg-card border-t">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList variant="line" className="w-full justify-start px-4">
          <TabsTrigger value="object">Object</TabsTrigger>
          <TabsTrigger value="scene">Scene</TabsTrigger>
        </TabsList>

        <TabsContent value="object" className="px-4 py-3 mt-0">
          <ObjectProperties
            object={object}
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
  object: GameObject | undefined;
  sceneId: string | null;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
}

function ObjectProperties({ object, sceneId, updateObject }: ObjectPropertiesProps) {
  const [linkScale, setLinkScale] = useState(true);

  if (!object || !sceneId) {
    return (
      <div className="text-center text-muted-foreground text-sm py-4">
        Select an object to view its properties
      </div>
    );
  }

  const handleUpdate = (updates: Partial<GameObject>) => {
    updateObject(sceneId, object.id, updates);
  };

  const handleScaleXChange = (newScaleX: number) => {
    if (linkScale) {
      handleUpdate({ scaleX: newScaleX, scaleY: newScaleX });
    } else {
      handleUpdate({ scaleX: newScaleX });
    }
  };

  const handleScaleYChange = (newScaleY: number) => {
    if (linkScale) {
      handleUpdate({ scaleX: newScaleY, scaleY: newScaleY });
    } else {
      handleUpdate({ scaleY: newScaleY });
    }
  };

  const handleFlipH = () => {
    handleUpdate({ scaleX: -object.scaleX });
  };

  const handleFlipV = () => {
    handleUpdate({ scaleY: -object.scaleY });
  };

  const handleRotate90 = () => {
    handleUpdate({ rotation: (object.rotation + 90) % 360 });
  };

  return (
    <div className="space-y-4">
      {/* Visibility */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="visible-toggle"
          checked={object.visible}
          onCheckedChange={(checked) => handleUpdate({ visible: !!checked })}
        />
        <Label htmlFor="visible-toggle" className="text-xs text-muted-foreground cursor-pointer">
          Visible
        </Label>
      </div>

      {/* Position */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Position</div>
        <div className="flex gap-2">
          <ScrubInput
            label="X"
            value={object.x}
            onChange={(x) => handleUpdate({ x })}
            precision={2}
          />
          <ScrubInput
            label="Y"
            value={object.y}
            onChange={(y) => handleUpdate({ y })}
            precision={2}
          />
        </div>
      </div>

      {/* Scale (Dimensions) */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Scale</div>
        <div className="flex gap-2 items-center">
          <ScrubInput
            label="W"
            value={Math.abs(object.scaleX)}
            onChange={handleScaleXChange}
            step={0.01}
            precision={2}
            min={0.01}
          />
          <ScrubInput
            label="H"
            value={Math.abs(object.scaleY)}
            onChange={handleScaleYChange}
            step={0.01}
            precision={2}
            min={0.01}
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
            value={object.rotation}
            onChange={(rotation) => handleUpdate({ rotation })}
            precision={0}
            suffix="°"
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
            className={object.scaleX < 0 ? 'text-primary' : ''}
          >
            <FlipHorizontal className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleFlipV}
            title="Flip vertical"
            className={object.scaleY < 0 ? 'text-primary' : ''}
          >
            <FlipVertical className="size-4" />
          </Button>
        </div>
      </div>

      {/* Physics Toggle */}
      <PhysicsToggle object={object} sceneId={sceneId} updateObject={updateObject} />

      {/* Physics Properties */}
      {object.physics?.enabled && (
        <PhysicsProperties object={object} sceneId={sceneId} updateObject={updateObject} />
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
      updateObject(sceneId, object.id, { physics: null });
    } else {
      updateObject(sceneId, object.id, {
        physics: {
          enabled: true,
          bodyType: 'dynamic',
          gravityY: 300,
          velocityX: 0,
          velocityY: 0,
          bounceX: 0,
          bounceY: 0,
          collideWorldBounds: true,
          immovable: false,
        },
      });
    }
  };

  return (
    <div className="flex items-center gap-2 pt-2 border-t">
      <Checkbox
        id="physics-toggle"
        checked={hasPhysics}
        onCheckedChange={togglePhysics}
      />
      <Label htmlFor="physics-toggle" className="text-xs text-muted-foreground cursor-pointer">
        Physics
      </Label>
    </div>
  );
}

function PhysicsProperties({ object, sceneId, updateObject }: FieldProps) {
  const physics = object.physics!;

  const updatePhysics = (updates: Partial<PhysicsConfig>) => {
    updateObject(sceneId, object.id, {
      physics: { ...physics, ...updates }
    });
  };

  return (
    <div className="space-y-4 mt-3">
      {/* Body Type */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Body Type</div>
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
        <div className="text-xs text-muted-foreground mb-2">Gravity</div>
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
        <div className="text-xs text-muted-foreground mb-2">Bounce</div>
        <div className="flex gap-2">
          <ScrubInput
            label="X"
            value={physics.bounceX}
            onChange={(bounceX) => updatePhysics({ bounceX })}
            step={0.1}
            precision={2}
            min={0}
            max={1}
          />
          <ScrubInput
            label="Y"
            value={physics.bounceY}
            onChange={(bounceY) => updatePhysics({ bounceY })}
            step={0.1}
            precision={2}
            min={0}
            max={1}
          />
        </div>
      </div>

      {/* Checkboxes */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="collide-bounds"
            checked={physics.collideWorldBounds}
            onCheckedChange={(checked) => updatePhysics({ collideWorldBounds: !!checked })}
          />
          <Label htmlFor="collide-bounds" className="text-xs text-muted-foreground cursor-pointer">
            Collide Bounds
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="immovable"
            checked={physics.immovable}
            onCheckedChange={(checked) => updatePhysics({ immovable: !!checked })}
          />
          <Label htmlFor="immovable" className="text-xs text-muted-foreground cursor-pointer">
            Immovable
          </Label>
        </div>
      </div>
    </div>
  );
}
