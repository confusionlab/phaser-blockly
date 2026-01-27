import { useState, useEffect } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import type { GameObject } from '../../types';

export function ObjectInspector() {
  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();

  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const object = scene?.objects.find(o => o.id === selectedObjectId);

  if (!object) {
    return (
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 text-center text-gray-500 text-sm">
        Select an object to view its properties
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-4 py-3">
      <div className="text-sm font-medium text-gray-700 mb-3">
        Properties: {object.name}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <PositionField object={object} sceneId={selectedSceneId!} updateObject={updateObject} />
        <ScaleField object={object} sceneId={selectedSceneId!} updateObject={updateObject} />
        <RotationField object={object} sceneId={selectedSceneId!} updateObject={updateObject} />
        <VisibilityField object={object} sceneId={selectedSceneId!} updateObject={updateObject} />
        <PhysicsToggle object={object} sceneId={selectedSceneId!} updateObject={updateObject} />
      </div>
    </div>
  );
}

interface FieldProps {
  object: GameObject;
  sceneId: string;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
}

function PositionField({ object, sceneId, updateObject }: FieldProps) {
  const [x, setX] = useState(object.x.toString());
  const [y, setY] = useState(object.y.toString());

  useEffect(() => {
    setX(object.x.toString());
    setY(object.y.toString());
  }, [object.x, object.y]);

  const handleBlur = () => {
    const newX = parseFloat(x) || 0;
    const newY = parseFloat(y) || 0;
    updateObject(sceneId, object.id, { x: newX, y: newY });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <label className="text-gray-600 w-6">X:</label>
        <input
          type="number"
          value={x}
          onChange={(e) => setX(e.target.value)}
          onBlur={handleBlur}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-gray-600 w-6">Y:</label>
        <input
          type="number"
          value={y}
          onChange={(e) => setY(e.target.value)}
          onBlur={handleBlur}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
        />
      </div>
    </>
  );
}

function ScaleField({ object, sceneId, updateObject }: FieldProps) {
  const [scaleX, setScaleX] = useState((object.scaleX * 100).toString());
  const [scaleY, setScaleY] = useState((object.scaleY * 100).toString());

  useEffect(() => {
    setScaleX((object.scaleX * 100).toString());
    setScaleY((object.scaleY * 100).toString());
  }, [object.scaleX, object.scaleY]);

  const handleBlur = () => {
    const newScaleX = (parseFloat(scaleX) || 100) / 100;
    const newScaleY = (parseFloat(scaleY) || 100) / 100;
    updateObject(sceneId, object.id, { scaleX: newScaleX, scaleY: newScaleY });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <label className="text-gray-600 w-16">Scale X:</label>
        <input
          type="number"
          value={scaleX}
          onChange={(e) => setScaleX(e.target.value)}
          onBlur={handleBlur}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
        />
        <span className="text-gray-500">%</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-gray-600 w-16">Scale Y:</label>
        <input
          type="number"
          value={scaleY}
          onChange={(e) => setScaleY(e.target.value)}
          onBlur={handleBlur}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
        />
        <span className="text-gray-500">%</span>
      </div>
    </>
  );
}

function RotationField({ object, sceneId, updateObject }: FieldProps) {
  const [rotation, setRotation] = useState(object.rotation.toString());

  useEffect(() => {
    setRotation(object.rotation.toString());
  }, [object.rotation]);

  const handleBlur = () => {
    const newRotation = parseFloat(rotation) || 0;
    updateObject(sceneId, object.id, { rotation: newRotation });
  };

  return (
    <div className="flex items-center gap-2 col-span-2">
      <label className="text-gray-600 w-16">Rotation:</label>
      <input
        type="number"
        value={rotation}
        onChange={(e) => setRotation(e.target.value)}
        onBlur={handleBlur}
        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
        min="0"
        max="360"
      />
      <span className="text-gray-500">degrees</span>
    </div>
  );
}

function VisibilityField({ object, sceneId, updateObject }: FieldProps) {
  return (
    <div className="flex items-center gap-2 col-span-2">
      <label className="text-gray-600">Visible:</label>
      <input
        type="checkbox"
        checked={object.visible}
        onChange={(e) => updateObject(sceneId, object.id, { visible: e.target.checked })}
        className="w-4 h-4 rounded border-gray-300"
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
          bounceY: 0.2,
          collideWorldBounds: true,
          immovable: false,
        },
      });
    }
  };

  return (
    <div className="flex items-center gap-2 col-span-2 pt-2 border-t border-gray-200">
      <label className="text-gray-600">Physics:</label>
      <button
        onClick={togglePhysics}
        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
          hasPhysics
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
        }`}
      >
        {hasPhysics ? 'Enabled' : 'Disabled'}
      </button>
    </div>
  );
}
