import { useState, useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { GameObject, Scene, GroundConfig, PhysicsConfig } from '@/types';

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
  if (!object || !sceneId) {
    return (
      <div className="text-center text-muted-foreground text-sm py-4">
        Select an object to view its properties
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Compact property row: X, Y, Scale, Rotation, Visible */}
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <CompactPositionField object={object} sceneId={sceneId} updateObject={updateObject} />
        <CompactScaleField object={object} sceneId={sceneId} updateObject={updateObject} />
        <CompactRotationField object={object} sceneId={sceneId} updateObject={updateObject} />
        <CompactVisibilityField object={object} sceneId={sceneId} updateObject={updateObject} />
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

  const ground = scene.ground || { enabled: false, y: 500, color: '#8B4513' };

  const updateGround = (updates: Partial<GroundConfig>) => {
    updateScene(scene.id, {
      ground: { ...ground, ...updates }
    });
  };

  return (
    <>
      {/* Background Color */}
      <div className="mb-4">
        <Label className="text-sm text-muted-foreground mb-1">Background Color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={scene.background?.value || '#87CEEB'}
            onChange={(e) => updateScene(scene.id, {
              background: { type: 'color', value: e.target.value }
            })}
            className="w-10 h-8 rounded border border-border cursor-pointer"
          />
          <Input
            value={scene.background?.value || '#87CEEB'}
            onChange={(e) => updateScene(scene.id, {
              background: { type: 'color', value: e.target.value }
            })}
            className="flex-1 h-8"
          />
        </div>
      </div>

      {/* Ground Settings */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">Ground</span>
          <Button
            variant={ground.enabled ? 'default' : 'secondary'}
            size="sm"
            onClick={() => updateGround({ enabled: !ground.enabled })}
          >
            {ground.enabled ? 'Enabled' : 'Disabled'}
          </Button>
        </div>

        {ground.enabled && (
          <div className="space-y-3">
            {/* Ground Y Position */}
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground w-20">Y Position:</Label>
              <Input
                type="number"
                value={Math.round(ground.y)}
                onChange={(e) => updateGround({ y: Math.round(parseFloat(e.target.value) || 500) })}
                className="flex-1 h-8"
              />
            </div>

            {/* Ground Color */}
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground w-20">Color:</Label>
              <input
                type="color"
                value={ground.color}
                onChange={(e) => updateGround({ color: e.target.value })}
                className="w-10 h-8 rounded border border-border cursor-pointer"
              />
              <Input
                value={ground.color}
                onChange={(e) => updateGround({ color: e.target.value })}
                className="flex-1 h-8"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Object property field components

interface FieldProps {
  object: GameObject;
  sceneId: string;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
}

function CompactPositionField({ object, sceneId, updateObject }: FieldProps) {
  const [x, setX] = useState(Math.round(object.x).toString());
  const [y, setY] = useState(Math.round(object.y).toString());

  useEffect(() => {
    setX(Math.round(object.x).toString());
    setY(Math.round(object.y).toString());
  }, [object.x, object.y]);

  const handleBlur = () => {
    const newX = Math.round(parseFloat(x) || 0);
    const newY = Math.round(parseFloat(y) || 0);
    updateObject(sceneId, object.id, { x: newX, y: newY });
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Label className="text-muted-foreground text-xs">X:</Label>
        <Input
          type="number"
          value={x}
          onChange={(e) => setX(e.target.value)}
          onBlur={handleBlur}
          className="w-16 h-7 text-xs"
        />
      </div>
      <div className="flex items-center gap-1">
        <Label className="text-muted-foreground text-xs">Y:</Label>
        <Input
          type="number"
          value={y}
          onChange={(e) => setY(e.target.value)}
          onBlur={handleBlur}
          className="w-16 h-7 text-xs"
        />
      </div>
    </>
  );
}

function CompactScaleField({ object, sceneId, updateObject }: FieldProps) {
  // Use uniform scale (average of scaleX and scaleY, or just scaleX if they're equal)
  const [scale, setScale] = useState(Math.round(object.scaleX * 100).toString());

  useEffect(() => {
    setScale(Math.round(object.scaleX * 100).toString());
  }, [object.scaleX]);

  const handleBlur = () => {
    const newScale = (Math.round(parseFloat(scale) || 100)) / 100;
    updateObject(sceneId, object.id, { scaleX: newScale, scaleY: newScale });
  };

  return (
    <div className="flex items-center gap-1">
      <Label className="text-muted-foreground text-xs">Scale:</Label>
      <Input
        type="number"
        value={scale}
        onChange={(e) => setScale(e.target.value)}
        onBlur={handleBlur}
        className="w-14 h-7 text-xs"
      />
      <span className="text-muted-foreground text-xs">%</span>
    </div>
  );
}

function CompactRotationField({ object, sceneId, updateObject }: FieldProps) {
  const [rotation, setRotation] = useState(Math.round(object.rotation).toString());

  useEffect(() => {
    setRotation(Math.round(object.rotation).toString());
  }, [object.rotation]);

  const handleBlur = () => {
    const newRotation = Math.round(parseFloat(rotation) || 0);
    updateObject(sceneId, object.id, { rotation: newRotation });
  };

  return (
    <div className="flex items-center gap-1">
      <Label className="text-muted-foreground text-xs">Rot:</Label>
      <Input
        type="number"
        value={rotation}
        onChange={(e) => setRotation(e.target.value)}
        onBlur={handleBlur}
        className="w-14 h-7 text-xs"
        min="0"
        max="360"
      />
      <span className="text-muted-foreground text-xs">°</span>
    </div>
  );
}

function CompactVisibilityField({ object, sceneId, updateObject }: FieldProps) {
  return (
    <div className="flex items-center gap-1">
      <Label className="text-muted-foreground text-xs">Visible:</Label>
      <input
        type="checkbox"
        checked={object.visible}
        onChange={(e) => updateObject(sceneId, object.id, { visible: e.target.checked })}
        className="w-4 h-4 rounded border-border"
      />
    </div>
  );
}

function PhysicsToggle({ object, sceneId, updateObject }: FieldProps) {
  const hasPhysics = object.physics?.enabled ?? false;

  const togglePhysics = () => {
    if (hasPhysics) {
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
      <Label className="text-muted-foreground text-xs">Physics:</Label>
      <Button
        variant={hasPhysics ? 'default' : 'secondary'}
        size="sm"
        onClick={togglePhysics}
        className="h-7 text-xs"
      >
        {hasPhysics ? 'Enabled' : 'Disabled'}
      </Button>
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
    <div className="border-t pt-3 space-y-3">
      <div className="text-sm font-medium text-muted-foreground">Physics Properties</div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* Body Type */}
        <div className="flex items-center gap-2 col-span-2">
          <Label className="text-muted-foreground w-20">Body Type:</Label>
          <select
            value={physics.bodyType}
            onChange={(e) => updatePhysics({ bodyType: e.target.value as 'dynamic' | 'static' })}
            className="flex-1 h-8 px-2 rounded border border-border bg-background text-sm"
          >
            <option value="dynamic">Dynamic</option>
            <option value="static">Static</option>
          </select>
        </div>

        {/* Gravity */}
        <div className="flex items-center gap-2 col-span-2">
          <Label className="text-muted-foreground w-20">Gravity Y:</Label>
          <Input
            type="number"
            value={Math.round(physics.gravityY)}
            onChange={(e) => updatePhysics({ gravityY: Math.round(parseFloat(e.target.value) || 0) })}
            className="flex-1 h-8"
          />
        </div>

        {/* Velocity */}
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground w-16">Vel X:</Label>
          <Input
            type="number"
            value={Math.round(physics.velocityX)}
            onChange={(e) => updatePhysics({ velocityX: Math.round(parseFloat(e.target.value) || 0) })}
            className="w-full h-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground w-16">Vel Y:</Label>
          <Input
            type="number"
            value={Math.round(physics.velocityY)}
            onChange={(e) => updatePhysics({ velocityY: Math.round(parseFloat(e.target.value) || 0) })}
            className="w-full h-8"
          />
        </div>

        {/* Bounce */}
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground w-16">Bounce X:</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={physics.bounceX}
            onChange={(e) => updatePhysics({ bounceX: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) })}
            className="w-full h-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground w-16">Bounce Y:</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={physics.bounceY}
            onChange={(e) => updatePhysics({ bounceY: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) })}
            className="w-full h-8"
          />
        </div>

        {/* Checkboxes */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={physics.collideWorldBounds}
            onChange={(e) => updatePhysics({ collideWorldBounds: e.target.checked })}
            className="w-4 h-4 rounded border-border"
          />
          <Label className="text-muted-foreground text-xs">Collide Bounds</Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={physics.immovable}
            onChange={(e) => updatePhysics({ immovable: e.target.checked })}
            className="w-4 h-4 rounded border-border"
          />
          <Label className="text-muted-foreground text-xs">Immovable</Label>
        </div>
      </div>
    </div>
  );
}
