import { useEffect, useRef, useCallback } from 'react';
import Phaser from 'phaser';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { RuntimeEngine, setCurrentRuntime, registerCodeGenerators, generateCodeForObject } from '@/phaser';
import type { Scene as SceneData, GameObject, ComponentDefinition } from '@/types';
import { getEffectiveObjectProps } from '@/types';

// Register code generators once at module load
registerCodeGenerators();

// Coordinate transformation utilities
// User space: (0,0) at center, +Y is up
// Phaser space: (0,0) at top-left, +Y is down

function userToPhaser(userX: number, userY: number, canvasWidth: number, canvasHeight: number) {
  return {
    x: userX + canvasWidth / 2,
    y: canvasHeight / 2 - userY
  };
}

function phaserToUser(phaserX: number, phaserY: number, canvasWidth: number, canvasHeight: number) {
  return {
    x: phaserX - canvasWidth / 2,
    y: canvasHeight / 2 - phaserY
  };
}

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
  const canvasDimensionsRef = useRef({ width: 800, height: 600 });

  // Keep refs in sync
  selectedSceneIdRef.current = selectedSceneId;
  selectedObjectIdRef.current = selectedObjectId;
  isPlayingRef.current = isPlaying;
  if (project) {
    canvasDimensionsRef.current = { width: project.settings.canvasWidth, height: project.settings.canvasHeight };
  }

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);

  // Callback to update object position after drag - convert from Phaser to user coordinates
  const handleObjectDragEnd = useCallback((objId: string, phaserX: number, phaserY: number) => {
    const sceneId = selectedSceneIdRef.current;
    if (sceneId) {
      const { width, height } = canvasDimensionsRef.current;
      const userCoords = phaserToUser(phaserX, phaserY, width, height);
      updateObject(sceneId, objId, { x: userCoords.x, y: userCoords.y });
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
              createPlayScene(this, selectedScene, project.scenes, project.components || [], runtimeRef, canvasWidth, canvasHeight);
            } else {
              createEditorScene(this, selectedScene, selectObject, selectedObjectId, handleObjectDragEnd, canvasWidth, canvasHeight, project.components || []);
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

    // Update or create objects (reverse depth so top of list = top render)
    const objectCount = selectedScene.objects.length;
    selectedScene.objects.forEach((obj, index) => {
      let container = phaserScene.children.getByName(obj.id) as Phaser.GameObjects.Container | undefined;

      if (!container) {
        // Create new object
        const cw = phaserScene.data.get('canvasWidth') as number || 800;
        const ch = phaserScene.data.get('canvasHeight') as number || 600;
        container = createObjectVisual(phaserScene, obj, true, cw, ch); // true = editor mode
        const isSelected = obj.id === selectedObjectId;
        container.setData('selected', isSelected);

        // Set initial selection visibility
        const selectionRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
        if (selectionRect) {
          selectionRect.setVisible(isSelected);
        }

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
      } else {
        // Update existing object - convert user coords to Phaser coords
        const cw = phaserScene.data.get('canvasWidth') as number || 800;
        const ch = phaserScene.data.get('canvasHeight') as number || 600;
        const phaserPos = userToPhaser(obj.x, obj.y, cw, ch);
        container.setPosition(phaserPos.x, phaserPos.y);
        container.setScale(obj.scaleX, obj.scaleY);
        container.setRotation(Phaser.Math.DegToRad(obj.rotation));
        container.setVisible(obj.visible);

        // Update costume if changed
        const costumes = obj.costumes || [];
        const currentCostumeIndex = obj.currentCostumeIndex ?? 0;
        const currentCostume = costumes[currentCostumeIndex];
        const storedCostumeId = container.getData('costumeId');

        if (currentCostume && currentCostume.id !== storedCostumeId) {
          // Costume changed - update the sprite
          const existingSprite = container.getByName('sprite') as Phaser.GameObjects.Image | null;
          if (existingSprite) {
            existingSprite.destroy();
          }

          // Helper to update container with new sprite
          const updateWithSprite = (sprite: Phaser.GameObjects.Image, cont: Phaser.GameObjects.Container) => {
            sprite.setName('sprite');
            cont.add(sprite);
            const width = Math.max(sprite.width, 32);
            const height = Math.max(sprite.height, 32);
            cont.setSize(width, height);
            // Update hit area rectangle size and refresh interactive
            const hitRect = cont.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
            if (hitRect) {
              hitRect.setSize(width, height);
              hitRect.removeInteractive();
              hitRect.setInteractive({ useHandCursor: true });
              phaserScene.input.setDraggable(hitRect);
            }
            // Update selection rectangle size
            const selRect = cont.getByName('selection') as Phaser.GameObjects.Rectangle | null;
            if (selRect) {
              selRect.setSize(width + 8, height + 8);
              cont.sendToBack(selRect);
            }
          };

          const textureKey = `costume_${obj.id}_${currentCostume.id}`;
          if (!phaserScene.textures.exists(textureKey)) {
            const img = new Image();
            img.onload = () => {
              if (phaserScene.textures.exists(textureKey)) return;
              phaserScene.textures.addImage(textureKey, img);
              const sprite = phaserScene.add.image(0, 0, textureKey);
              updateWithSprite(sprite, container!);
            };
            img.src = currentCostume.assetId;
          } else {
            const sprite = phaserScene.add.image(0, 0, textureKey);
            updateWithSprite(sprite, container);
          }
          container.setData('costumeId', currentCostume.id);
        }
      }

      // Update z-depth based on array index (top of list = highest depth = renders on top)
      container.setDepth(objectCount - index);

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

  // Update ground when it changes (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying || !project) return;

    const phaserScene = gameRef.current.scene.getScene('GameScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;

    const groundGraphics = phaserScene.data.get('groundGraphics') as Phaser.GameObjects.Graphics | undefined;
    if (groundGraphics) {
      groundGraphics.clear();

      if (selectedScene.ground?.enabled) {
        const groundColor = Phaser.Display.Color.HexStringToColor(selectedScene.ground.color || '#8B4513');
        const userGroundY = selectedScene.ground.y ?? -200;
        // Convert user Y to Phaser Y (user Y is up-positive, Phaser Y is down-positive)
        const phaserGroundY = project.settings.canvasHeight / 2 - userGroundY;
        const groundHeight = 2000;
        const groundWidth = 10000;
        groundGraphics.fillStyle(groundColor.color, 1);
        groundGraphics.fillRect(-groundWidth / 2, phaserGroundY, groundWidth, groundHeight);
      }
    }
  }, [selectedScene?.ground, isPlaying, project]);

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
  canvasHeight: number,
  components: ComponentDefinition[] = []
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

  // Draw ground if enabled
  const groundGraphics = scene.add.graphics();
  groundGraphics.setDepth(-1000); // Behind everything
  if (sceneData.ground?.enabled) {
    const groundColor = Phaser.Display.Color.HexStringToColor(sceneData.ground.color || '#8B4513');
    const userGroundY = sceneData.ground.y ?? -200;
    // Convert user Y to Phaser Y (user Y is up-positive, Phaser Y is down-positive)
    const phaserGroundY = canvasHeight / 2 - userGroundY;
    const groundHeight = 2000;
    const groundWidth = 10000;
    groundGraphics.fillStyle(groundColor.color, 1);
    groundGraphics.fillRect(-groundWidth / 2, phaserGroundY, groundWidth, groundHeight);
  }

  // Store references for dynamic updates
  scene.data.set('boundsGraphics', boundsGraphics);
  scene.data.set('groundGraphics', groundGraphics);
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

  // Create objects (reverse depth so top of list = top render)
  const objectCount = sceneData.objects.length;
  sceneData.objects.forEach((obj: GameObject, index: number) => {
    const container = createObjectVisual(scene, obj, true, canvasWidth, canvasHeight, components); // true = editor mode
    container.setDepth(objectCount - index); // Top of list = highest depth = renders on top
    const isSelected = obj.id === selectedObjectId;
    container.setData('selected', isSelected);

    // Set initial selection visibility
    const selectionRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
    if (selectionRect) {
      selectionRect.setVisible(isSelected);
    }

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
  components: ComponentDefinition[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  canvasWidth: number,
  canvasHeight: number
) {
  if (!sceneData) return;

  // Set background
  if (sceneData.background?.type === 'color') {
    scene.cameras.main.setBackgroundColor(sceneData.background.value);
  }

  // Create runtime engine with canvas dimensions for coordinate conversion
  const runtime = new RuntimeEngine(scene, canvasWidth, canvasHeight);
  runtimeRef.current = runtime;
  setCurrentRuntime(runtime);

  // Configure ground from scene settings
  if (sceneData.ground) {
    runtime.configureGround(
      sceneData.ground.enabled,
      sceneData.ground.y,
      sceneData.ground.color
    );
  }

  // Create objects and register them with runtime (reverse depth so top of list = top render)
  const objectCount = sceneData.objects.length;
  sceneData.objects.forEach((obj: GameObject, index: number) => {
    // Get effective properties (resolves component references)
    const effectiveProps = getEffectiveObjectProps(obj, components);

    const container = createObjectVisual(scene, obj, false, canvasWidth, canvasHeight, components);
    container.setDepth(objectCount - index); // Top of list = highest depth = renders on top

    // Enable physics for collision detection (needed for all sprites to detect collisions)
    scene.physics.add.existing(container);

    // Register with runtime
    const runtimeSprite = runtime.registerSprite(obj.id, obj.name, container);

    // Set costumes if available (use effective costumes for component instances)
    const costumes = effectiveProps.costumes || [];
    if (costumes.length > 0) {
      runtimeSprite.setCostumes(costumes, effectiveProps.currentCostumeIndex || 0);
    }

    // Update physics body size to match costume
    runtimeSprite.updatePhysicsBodySize();

    // Apply physics configuration (use effective physics for component instances)
    const physics = effectiveProps.physics;
    const body = container.body as Phaser.Physics.Arcade.Body;
    if (body) {
      if (physics?.enabled) {
        // Apply physics settings
        body.setGravityY(physics.gravityY ?? 0);
        body.setBounce(physics.bounceX ?? 0, physics.bounceY ?? 0);
        body.setCollideWorldBounds(physics.collideWorldBounds ?? false);
        body.setImmovable(physics.immovable ?? false);
        body.setVelocity(physics.velocityX ?? 0, physics.velocityY ?? 0);

        // Set body type (static bodies don't move)
        if (physics.bodyType === 'static') {
          body.setImmovable(true);
          body.setGravityY(0);
        }
      } else {
        // No physics enabled - disable gravity and make it not respond to physics
        body.setGravityY(0);
        body.setImmovable(true);
        body.setAllowGravity(false);
      }
    }

    // Generate and execute code for this object (use effective blocklyXml)
    const blocklyXml = effectiveProps.blocklyXml;
    console.log(`[CodeExec] Object "${obj.name}" has blocklyXml:`, !!blocklyXml);
    if (blocklyXml) {
      console.log(`[CodeExec] blocklyXml length: ${blocklyXml.length}`);
      console.log(`[CodeExec] blocklyXml preview: ${blocklyXml.substring(0, 200)}...`);
      try {
        const code = generateCodeForObject(blocklyXml, obj.id);
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

  // Set up physics colliders between all sprites
  runtime.setupPhysicsColliders();

  // Start the runtime (execute all onStart handlers)
  runtime.start();
}

/**
 * Create visual representation of a game object
 */
function createObjectVisual(
  scene: Phaser.Scene,
  obj: GameObject,
  isEditorMode: boolean = false,
  canvasWidth: number = 800,
  canvasHeight: number = 600,
  components: ComponentDefinition[] = []
): Phaser.GameObjects.Container {
  // Convert user coordinates to Phaser coordinates
  const phaserPos = userToPhaser(obj.x, obj.y, canvasWidth, canvasHeight);

  // Create container for the object
  const container = scene.add.container(phaserPos.x, phaserPos.y);
  container.setName(obj.id);
  container.setScale(obj.scaleX, obj.scaleY);
  container.setRotation(Phaser.Math.DegToRad(obj.rotation));
  container.setVisible(obj.visible);
  container.setData('objectData', obj);

  // Default size - will be updated when image loads
  const defaultSize = 64;
  container.setSize(defaultSize, defaultSize);

  // Create selection rectangle in editor mode (added first, sent to back)
  let selectionRect: Phaser.GameObjects.Rectangle | null = null;
  // Create invisible hit area rectangle for reliable click detection
  let hitRect: Phaser.GameObjects.Rectangle | null = null;

  if (isEditorMode) {
    // Selection visual
    selectionRect = scene.add.rectangle(0, 0, defaultSize + 8, defaultSize + 8);
    selectionRect.setStrokeStyle(2, 0x4A90D9);
    selectionRect.setFillStyle(0x4A90D9, 0.1);
    selectionRect.setVisible(false);
    selectionRect.setName('selection');
    container.add(selectionRect);

    // Invisible hit area - this is what actually receives clicks
    hitRect = scene.add.rectangle(0, 0, defaultSize, defaultSize, 0x000000, 0);
    hitRect.setName('hitArea');
    container.add(hitRect);

    // Track drag offset to prevent jumping
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // Set up interactive after adding to container, deferred to next frame
    // to ensure input system is ready
    scene.time.delayedCall(0, () => {
      if (!hitRect || !hitRect.scene) return; // Guard against destroyed objects
      hitRect.setInteractive({ useHandCursor: true });
      scene.input.setDraggable(hitRect);

      // Forward hit area events to container
      hitRect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        container.emit('pointerdown', pointer);
      });
      hitRect.on('dragstart', (pointer: Phaser.Input.Pointer) => {
        // Record offset between pointer and container position
        dragOffsetX = container.x - pointer.worldX;
        dragOffsetY = container.y - pointer.worldY;
      });
      hitRect.on('drag', (pointer: Phaser.Input.Pointer) => {
        // Move container maintaining the initial offset
        const newX = pointer.worldX + dragOffsetX;
        const newY = pointer.worldY + dragOffsetY;
        container.emit('drag', pointer, newX, newY);
      });
      hitRect.on('dragend', (pointer: Phaser.Input.Pointer) => {
        container.emit('dragend', pointer);
      });
    });
  }

  // Helper to update container size, hit area, and selection rect
  const updateContainerSize = (width: number, height: number) => {
    const w = Math.max(width, 32);
    const h = Math.max(height, 32);
    container.setSize(w, h);

    // Update hit area rectangle size and refresh interactive bounds
    if (hitRect) {
      hitRect.setSize(w, h);
      // Must refresh interactive to update hit area bounds
      hitRect.removeInteractive();
      hitRect.setInteractive({ useHandCursor: true });
      scene.input.setDraggable(hitRect);
    }

    // Update selection rectangle size
    if (selectionRect) {
      selectionRect.setSize(w + 8, h + 8);
    }
  };

  // Get current costume (use effective props for component instances)
  const effectiveProps = getEffectiveObjectProps(obj, components);
  const costumes = effectiveProps.costumes || [];
  const currentCostumeIndex = effectiveProps.currentCostumeIndex ?? 0;
  const currentCostume = costumes[currentCostumeIndex];

  if (currentCostume && currentCostume.assetId) {
    // Store costume ID for change detection
    container.setData('costumeId', currentCostume.id);

    // Load and display the costume image
    const textureKey = `costume_${obj.id}_${currentCostume.id}`;

    // Check if texture already exists
    if (!scene.textures.exists(textureKey)) {
      // Load texture from data URL
      const img = new Image();
      img.onload = () => {
        if (scene.textures.exists(textureKey)) return; // Avoid double-add
        scene.textures.addImage(textureKey, img);

        // Create sprite after texture is loaded
        const sprite = scene.add.image(0, 0, textureKey);
        sprite.setName('sprite');
        container.add(sprite);
        // Send selection to back, bring hit area to front for input
        if (selectionRect) container.sendToBack(selectionRect);
        if (hitRect) container.bringToTop(hitRect);
        updateContainerSize(sprite.width, sprite.height);
      };
      img.src = currentCostume.assetId;
    } else {
      // Texture already exists, create sprite immediately
      const sprite = scene.add.image(0, 0, textureKey);
      sprite.setName('sprite');
      container.add(sprite);
      // Send selection to back, bring hit area to front for input
      if (selectionRect) container.sendToBack(selectionRect);
      if (hitRect) container.bringToTop(hitRect);
      updateContainerSize(sprite.width, sprite.height);
    }
  } else {
    // No costume - create colored rectangle as placeholder
    const graphics = scene.add.graphics();
    const color = getObjectColor(obj.id);

    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(-32, -32, 64, 64, 8);
    graphics.lineStyle(2, 0x333333);
    graphics.strokeRoundedRect(-32, -32, 64, 64, 8);

    container.add(graphics);
    // Send selection to back, bring hit area to front for input
    if (selectionRect) container.sendToBack(selectionRect);
    if (hitRect) container.bringToTop(hitRect);
    // Ensure hit area is properly configured
    updateContainerSize(64, 64);
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
