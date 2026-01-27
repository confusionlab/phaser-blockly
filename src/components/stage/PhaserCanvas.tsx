import { useEffect, useRef, useCallback } from 'react';
import Phaser from 'phaser';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { RuntimeEngine, setCurrentRuntime, registerCodeGenerators, generateCodeForObject } from '../../phaser';
import type { Scene as SceneData, GameObject } from '../../types';

// Register code generators once at module load
registerCodeGenerators();

interface PhaserCanvasProps {
  isPlaying: boolean;
}

export function PhaserCanvas({ isPlaying }: PhaserCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const runtimeRef = useRef<RuntimeEngine | null>(null);

  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectObject, selectScene } = useEditorStore();

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);

  // Callback to update object position after drag
  const handleObjectDragEnd = useCallback((objId: string, x: number, y: number) => {
    if (selectedSceneId) {
      updateObject(selectedSceneId, objId, { x, y });
    }
  }, [selectedSceneId, updateObject]);

  // Initialize Phaser
  useEffect(() => {
    if (!containerRef.current || !project) return;

    // Clean up existing game
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
    if (runtimeRef.current) {
      setCurrentRuntime(null);
      runtimeRef.current = null;
    }

    const { canvasWidth, canvasHeight, backgroundColor } = project.settings;

    // Create Phaser game
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: backgroundColor,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: !isPlaying,
        },
      },
      scene: {
        key: 'GameScene',
        preload: function(this: Phaser.Scene) {
          // Preload assets if needed
        },
        create: function(this: Phaser.Scene) {
          if (isPlaying) {
            createPlayScene(this, selectedScene, project.scenes, runtimeRef, selectScene);
          } else {
            createEditorScene(this, selectedScene, selectObject, selectedObjectId, handleObjectDragEnd);
          }
        },
        update: function(this: Phaser.Scene) {
          if (isPlaying && runtimeRef.current) {
            runtimeRef.current.update();

            // Check for scene switch
            const pendingSwitch = runtimeRef.current.pendingSceneSwitch;
            if (pendingSwitch) {
              const targetScene = project.scenes.find(s => s.name === pendingSwitch);
              if (targetScene) {
                runtimeRef.current.clearPendingSceneSwitch();
                selectScene(targetScene.id);
              }
            }
          }
        },
      },
    };

    gameRef.current = new Phaser.Game(config);

    return () => {
      if (runtimeRef.current) {
        runtimeRef.current.stopAll();
        setCurrentRuntime(null);
        runtimeRef.current = null;
      }
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [project?.id, selectedSceneId, isPlaying, handleObjectDragEnd]);

  // Update objects when they change (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const scene = gameRef.current.scene.getScene('GameScene');
    if (!scene || !selectedScene) return;

    // Update all objects
    selectedScene.objects.forEach(obj => {
      const container = scene.children.getByName(obj.id) as Phaser.GameObjects.Container | undefined;
      if (container) {
        container.setPosition(obj.x, obj.y);
        container.setScale(obj.scaleX, obj.scaleY);
        container.setRotation(Phaser.Math.DegToRad(obj.rotation));
        container.setVisible(obj.visible);

        // Update selection visual
        const isSelected = obj.id === selectedObjectId;
        container.setData('selected', isSelected);

        const selectionRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
        if (selectionRect) {
          selectionRect.setVisible(isSelected);
        }
      }
    });
  }, [selectedScene?.objects, selectedObjectId, isPlaying]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: isPlaying ? '100vh' : '300px' }}
    />
  );
}

/**
 * Create the editor scene (non-playing mode)
 */
function createEditorScene(
  scene: Phaser.Scene,
  sceneData: SceneData | undefined,
  selectObject: (id: string | null) => void,
  selectedObjectId: string | null,
  onDragEnd: (objId: string, x: number, y: number) => void
) {
  if (!sceneData) return;

  // Set background
  if (sceneData.background?.type === 'color') {
    scene.cameras.main.setBackgroundColor(sceneData.background.value);
  }

  // Create objects
  sceneData.objects.forEach((obj: GameObject) => {
    const container = createObjectVisual(scene, obj);
    container.setData('selected', obj.id === selectedObjectId);

    // Make interactive in editor mode
    container.setInteractive({ draggable: true });

    container.on('pointerdown', () => {
      selectObject(obj.id);
    });

    container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      container.x = dragX;
      container.y = dragY;
    });

    container.on('dragend', () => {
      onDragEnd(obj.id, container.x, container.y);
    });

    // Selection indicator
    const selectionRect = scene.add.rectangle(0, 0, 72, 72);
    selectionRect.setStrokeStyle(2, 0x4A90D9);
    selectionRect.setFillStyle(0x4A90D9, 0.1);
    selectionRect.setVisible(obj.id === selectedObjectId);
    selectionRect.setName('selection');
    container.add(selectionRect);
    container.sendToBack(selectionRect);
  });

  // Update selection visuals on scene update
  scene.events.on('update', () => {
    scene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Container && child.getData('objectData')) {
        const isSelected = child.getData('selected');
        const selectionRect = child.getByName('selection') as Phaser.GameObjects.Rectangle;
        if (selectionRect) {
          selectionRect.setVisible(isSelected);
        }
      }
    });
  });
}

/**
 * Create the play scene (running game mode)
 */
function createPlayScene(
  scene: Phaser.Scene,
  sceneData: SceneData | undefined,
  _allScenes: SceneData[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  _selectScene: (id: string) => void
) {
  if (!sceneData) return;

  // Set background
  if (sceneData.background?.type === 'color') {
    scene.cameras.main.setBackgroundColor(sceneData.background.value);
  }

  // Create runtime engine
  const runtime = new RuntimeEngine(scene);
  runtimeRef.current = runtime;
  setCurrentRuntime(runtime);

  // Create objects and register them with runtime
  sceneData.objects.forEach((obj: GameObject) => {
    const container = createObjectVisual(scene, obj, true);

    // Enable physics by default in play mode for collision detection
    scene.physics.add.existing(container);

    // Register with runtime
    const runtimeSprite = runtime.registerSprite(obj.id, obj.name, container);

    // Generate and execute code for this object
    if (obj.blocklyXml) {
      try {
        const code = generateCodeForObject(obj.blocklyXml, obj.id);
        if (code) {
          // Execute the generated code
          const execFunction = new Function('runtime', 'spriteId', 'sprite', `
            return ${code};
          `);
          const registerFunc = execFunction(runtime, obj.id, runtimeSprite);
          if (typeof registerFunc === 'function') {
            registerFunc(runtime, obj.id, runtimeSprite);
          }
        }
      } catch (e) {
        console.error('Error executing code for object', obj.name, e);
      }
    }
  });

  // Start the runtime (execute all onStart handlers)
  runtime.start();
}

/**
 * Create visual representation of a game object
 */
function createObjectVisual(
  scene: Phaser.Scene,
  obj: GameObject,
  isPlayMode: boolean = false
): Phaser.GameObjects.Container {
  // Create colored rectangle as placeholder for sprite
  const graphics = scene.add.graphics();
  const color = getObjectColor(obj.id);

  graphics.fillStyle(color, 1);
  graphics.fillRoundedRect(-32, -32, 64, 64, 8);
  graphics.lineStyle(2, 0x333333);
  graphics.strokeRoundedRect(-32, -32, 64, 64, 8);

  // Create container for the object
  const container = scene.add.container(obj.x, obj.y, [graphics]);
  container.setName(obj.id);
  container.setSize(64, 64);
  container.setScale(obj.scaleX, obj.scaleY);
  container.setRotation(Phaser.Math.DegToRad(obj.rotation));
  container.setVisible(obj.visible);
  container.setData('objectData', obj);

  // Add name label only in editor mode
  if (!isPlayMode) {
    const label = scene.add.text(0, 40, obj.name, {
      fontSize: '12px',
      color: '#333',
      backgroundColor: '#fff',
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5, 0);
    container.add(label);
  }

  return container;
}

/**
 * Generate a consistent color from an ID
 */
function getObjectColor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash = hash & hash;
  }
  const hue = Math.abs(hash % 360);
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.7).color;
}
