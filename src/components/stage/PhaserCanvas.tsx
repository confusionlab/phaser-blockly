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
  const creationIdRef = useRef(0); // Track which creation attempt is current

  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectObject, selectScene } = useEditorStore();

  // Use refs for values accessed in Phaser callbacks to avoid stale closures
  const selectedSceneIdRef = useRef(selectedSceneId);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const isPlayingRef = useRef(isPlaying);

  // Keep refs in sync
  selectedSceneIdRef.current = selectedSceneId;
  selectedObjectIdRef.current = selectedObjectId;
  isPlayingRef.current = isPlaying;

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);

  // Callback to update object position after drag - use ref for sceneId
  const handleObjectDragEnd = useCallback((objId: string, x: number, y: number) => {
    const sceneId = selectedSceneIdRef.current;
    if (sceneId) {
      updateObject(sceneId, objId, { x, y });
    }
  }, [updateObject]);

  // Initialize Phaser
  useEffect(() => {
    if (!containerRef.current || !project) return;

    // Increment creation ID - any previous async creation attempts will be ignored
    creationIdRef.current++;
    const thisCreationId = creationIdRef.current;

    console.log(`[PhaserCanvas] Starting init #${thisCreationId}, isPlaying=${isPlaying}`);

    // Clean up existing game
    if (runtimeRef.current) {
      console.log('[PhaserCanvas] Cleaning up existing runtime');
      runtimeRef.current.cleanup();
      setCurrentRuntime(null);
      runtimeRef.current = null;
    }
    if (gameRef.current) {
      console.log('[PhaserCanvas] Destroying existing game');
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

    const { canvasWidth, canvasHeight, backgroundColor } = project.settings;
    const container = containerRef.current;

    // Function to create the game
    const createGame = () => {
      // Check if this creation attempt is still current
      if (thisCreationId !== creationIdRef.current) {
        console.log(`[PhaserCanvas] Skipping stale creation #${thisCreationId}, current is #${creationIdRef.current}`);
        return;
      }
      if (!container) return;
      console.log(`[PhaserCanvas] Creating game #${thisCreationId}`);

      // Editor mode uses container size for infinite canvas, play mode uses game dimensions
      const editorBgColor = selectedScene?.background?.type === 'color' ? selectedScene.background.value : backgroundColor;
      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: container,
        width: isPlaying ? canvasWidth : container.clientWidth,
        height: isPlaying ? canvasHeight : container.clientHeight,
        backgroundColor: isPlaying ? backgroundColor : editorBgColor,
        scale: isPlaying ? {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        } : {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.NO_CENTER,
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
              createPlayScene(this, selectedScene, project.scenes, runtimeRef);
            } else {
              createEditorScene(this, selectedScene, selectObject, selectedObjectId, handleObjectDragEnd, canvasWidth, canvasHeight);
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
      console.log(`[PhaserCanvas] Game #${thisCreationId} created`);

      // Force scale refresh after a frame to ensure proper sizing
      requestAnimationFrame(() => {
        if (gameRef.current?.scale) {
          gameRef.current.scale.refresh();
        }
      });
    };

    // In play mode, wait for layout to settle before creating game
    if (isPlaying) {
      // Use requestAnimationFrame to wait for CSS layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          createGame();
        });
      });
    } else {
      createGame();
    }

    return () => {
      console.log('[PhaserCanvas] Cleanup triggered');
      if (runtimeRef.current) {
        runtimeRef.current.cleanup();
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

    const phaserScene = gameRef.current.scene.getScene('GameScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;

    // Get current object IDs in scene data
    const sceneObjectIds = new Set(selectedScene.objects.map(o => o.id));

    // Remove objects that no longer exist in scene data
    const toRemove: Phaser.GameObjects.Container[] = [];
    phaserScene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Container && child.getData('objectData')) {
        if (!sceneObjectIds.has(child.name)) {
          toRemove.push(child);
        }
      }
    });
    toRemove.forEach(c => c.destroy());

    // Update or create objects
    selectedScene.objects.forEach(obj => {
      let container = phaserScene.children.getByName(obj.id) as Phaser.GameObjects.Container | undefined;

      if (!container) {
        // Create new object
        container = createObjectVisual(phaserScene, obj);
        container.setData('selected', obj.id === selectedObjectId);

        // Make interactive in editor mode
        container.setInteractive({ draggable: true });

        container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (pointer.leftButtonDown()) {
            selectObject(obj.id);
          }
        });

        container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
          container!.x = dragX;
          container!.y = dragY;
        });

        container.on('dragend', () => {
          handleObjectDragEnd(obj.id, container!.x, container!.y);
        });

        // Selection indicator
        const selectionRect = phaserScene.add.rectangle(0, 0, 72, 72);
        selectionRect.setStrokeStyle(2, 0x4A90D9);
        selectionRect.setFillStyle(0x4A90D9, 0.1);
        selectionRect.setVisible(obj.id === selectedObjectId);
        selectionRect.setName('selection');
        container.add(selectionRect);
        container.sendToBack(selectionRect);
      } else {
        // Update existing object
        container.setPosition(obj.x, obj.y);
        container.setScale(obj.scaleX, obj.scaleY);
        container.setRotation(Phaser.Math.DegToRad(obj.rotation));
        container.setVisible(obj.visible);
      }

      // Update selection visual
      const isSelected = obj.id === selectedObjectId;
      container.setData('selected', isSelected);

      const selectionRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
      if (selectionRect) {
        selectionRect.setVisible(isSelected);
      }
    });
  }, [selectedScene?.objects, selectedObjectId, isPlaying, selectObject, handleObjectDragEnd]);

  // Update background color when it changes (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const phaserScene = gameRef.current.scene.getScene('GameScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;

    const bgColorValue = selectedScene.background?.type === 'color'
      ? selectedScene.background.value
      : '#87CEEB';

    phaserScene.cameras.main.setBackgroundColor(bgColorValue);

    // Update bounds graphics color to contrast with new background
    const boundsGraphics = phaserScene.data.get('boundsGraphics') as Phaser.GameObjects.Graphics | undefined;
    if (boundsGraphics) {
      const canvasWidth = phaserScene.data.get('canvasWidth') as number;
      const canvasHeight = phaserScene.data.get('canvasHeight') as number;

      const bgColor = Phaser.Display.Color.HexStringToColor(bgColorValue);
      const luminance = (0.299 * bgColor.red + 0.587 * bgColor.green + 0.114 * bgColor.blue) / 255;
      const borderColor = luminance < 0.5 ? 0xffffff : 0x333333;

      boundsGraphics.clear();
      boundsGraphics.lineStyle(1, borderColor, 0.5);
      boundsGraphics.strokeRect(0, 0, canvasWidth, canvasHeight);
    }
  }, [selectedScene?.background, isPlaying]);

  return (
    <div
      ref={containerRef}
      className={isPlaying ? "w-full h-full" : "w-full h-full min-h-[300px]"}
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
  onDragEnd: (objId: string, x: number, y: number) => void,
  canvasWidth: number,
  canvasHeight: number
) {
  if (!sceneData) return;

  const camera = scene.cameras.main;

  // Set background color (same everywhere)
  const bgColorValue = sceneData.background?.type === 'color' ? sceneData.background.value : '#2d2d44';
  camera.setBackgroundColor(bgColorValue);

  // Calculate if background is dark to choose contrasting border color
  const bgColor = Phaser.Display.Color.HexStringToColor(bgColorValue);
  const luminance = (0.299 * bgColor.red + 0.587 * bgColor.green + 0.114 * bgColor.blue) / 255;
  const borderColor = luminance < 0.5 ? 0xffffff : 0x333333;

  // Draw game bounds rectangle with contrasting color
  const boundsGraphics = scene.add.graphics();
  boundsGraphics.lineStyle(1, borderColor, 0.5);
  boundsGraphics.strokeRect(0, 0, canvasWidth, canvasHeight);

  // Store references for dynamic updates
  scene.data.set('boundsGraphics', boundsGraphics);
  scene.data.set('canvasWidth', canvasWidth);
  scene.data.set('canvasHeight', canvasHeight);

  // Enable camera panning with middle mouse or right mouse drag
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let cameraStartX = 0;
  let cameraStartY = 0;

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    // Middle mouse (button 1) or right mouse (button 2) starts panning
    if (pointer.middleButtonDown() || pointer.rightButtonDown()) {
      isPanning = true;
      panStartX = pointer.x;
      panStartY = pointer.y;
      cameraStartX = camera.scrollX;
      cameraStartY = camera.scrollY;
    }
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (isPanning) {
      // Divide by zoom to make panning match mouse movement 1:1
      const dx = (pointer.x - panStartX) / camera.zoom;
      const dy = (pointer.y - panStartY) / camera.zoom;
      camera.scrollX = cameraStartX - dx;
      camera.scrollY = cameraStartY - dy;
    }
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.middleButtonDown() && !pointer.rightButtonDown()) {
      isPanning = false;
    }
  });

  // Prevent context menu on right click
  scene.game.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Mouse wheel zoom (proportional to current zoom for consistent feel)
  scene.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
    const zoomFactor = deltaY > 0 ? 0.9 : 1.1; // 10% zoom per scroll step
    const newZoom = Phaser.Math.Clamp(camera.zoom * zoomFactor, 0.25, 3);
    camera.setZoom(newZoom);
  });

  // Center camera on game area initially
  camera.centerOn(canvasWidth / 2, canvasHeight / 2);

  // Create objects
  sceneData.objects.forEach((obj: GameObject) => {
    const container = createObjectVisual(scene, obj);
    container.setData('selected', obj.id === selectedObjectId);

    // Make interactive in editor mode
    container.setInteractive({ draggable: true });

    container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Only select on left click
      if (pointer.leftButtonDown()) {
        selectObject(obj.id);
      }
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
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>
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
    const container = createObjectVisual(scene, obj);

    // Enable physics by default in play mode for collision detection
    scene.physics.add.existing(container);

    // Register with runtime
    const runtimeSprite = runtime.registerSprite(obj.id, obj.name, container);

    // Set costumes if available
    const costumes = obj.costumes || [];
    if (costumes.length > 0) {
      runtimeSprite.setCostumes(costumes, obj.currentCostumeIndex || 0);
    }

    // Generate and execute code for this object
    console.log(`[CodeExec] Object "${obj.name}" has blocklyXml:`, !!obj.blocklyXml);
    if (obj.blocklyXml) {
      console.log(`[CodeExec] blocklyXml length: ${obj.blocklyXml.length}`);
      console.log(`[CodeExec] blocklyXml preview: ${obj.blocklyXml.substring(0, 200)}...`);
      try {
        const code = generateCodeForObject(obj.blocklyXml, obj.id);
        console.log(`[CodeExec] Generated code for "${obj.name}":\n${code}`);
        if (code) {
          // Execute the generated code
          const functionBody = `return ${code};`;
          console.log(`[CodeExec] Function body:\n${functionBody}`);
          const execFunction = new Function('runtime', 'spriteId', 'sprite', functionBody);
          console.log(`[CodeExec] execFunction created, calling it...`);
          const registerFunc = execFunction(runtime, obj.id, runtimeSprite);
          console.log(`[CodeExec] registerFunc type: ${typeof registerFunc}`);
          if (typeof registerFunc === 'function') {
            console.log(`[CodeExec] Calling registerFunc...`);
            registerFunc(runtime, obj.id, runtimeSprite);
            console.log(`[CodeExec] registerFunc called successfully`);
          } else {
            console.error(`[CodeExec] registerFunc is not a function! Got: ${registerFunc}`);
          }
        } else {
          console.log(`[CodeExec] No code generated for "${obj.name}"`);
        }
      } catch (e) {
        console.error('Error executing code for object', obj.name, e);
      }
    } else {
      console.log(`[CodeExec] No blocklyXml for "${obj.name}"`);
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
  obj: GameObject
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
