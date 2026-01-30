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
  const { selectedSceneId, selectedObjectId, selectObject, selectScene, showColliderOutlines } = useEditorStore();

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

  // Callback to update object position/scale/rotation after drag - convert from Phaser to user coordinates
  const handleObjectDragEnd = useCallback((objId: string, phaserX: number, phaserY: number, scaleX?: number, scaleY?: number, rotation?: number) => {
    const sceneId = selectedSceneIdRef.current;
    if (sceneId) {
      const { width, height } = canvasDimensionsRef.current;
      const userCoords = phaserToUser(phaserX, phaserY, width, height);
      const updates: Partial<GameObject> = { x: userCoords.x, y: userCoords.y };
      if (scaleX !== undefined) updates.scaleX = scaleX;
      if (scaleY !== undefined) updates.scaleY = scaleY;
      if (rotation !== undefined) updates.rotation = rotation;
      updateObject(sceneId, objId, updates);
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
          default: 'matter',
          matter: {
            gravity: { x: 0, y: 1 }, // Default gravity, scaled per-body
            debug: (!isPlaying || showColliderOutlines) ? {
              showBody: true,
              showStaticBody: true,
              renderFill: false,
              renderLine: true,
              lineColor: 0x00ff00,
              lineThickness: 2,
              staticLineColor: 0x00ff00,
              fillColor: 0x00ff00,
              staticFillColor: 0x00ff00,
            } : false,
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

  // Toggle collider debug rendering at runtime (without recreating game)
  useEffect(() => {
    if (!gameRef.current) return;

    const phaserScene = gameRef.current.scene.getScene('GameScene') as Phaser.Scene;
    if (!phaserScene?.matter?.world) return;

    const world = phaserScene.matter.world;
    const shouldShowDebug = !isPlaying || showColliderOutlines;

    if (shouldShowDebug && !world.debugGraphic) {
      // Enable debug - create debug graphic if it doesn't exist
      world.createDebugGraphic();
      world.drawDebug = true;
    } else if (shouldShowDebug && world.debugGraphic) {
      world.debugGraphic.setVisible(true);
      world.drawDebug = true;
    } else if (!shouldShowDebug && world.debugGraphic) {
      world.debugGraphic.setVisible(false);
      world.drawDebug = false;
    }
  }, [isPlaying, showColliderOutlines]);

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

      // Get effective props (resolves component references)
      const components = project?.components || [];
      const effectiveProps = getEffectiveObjectProps(obj, components);

      if (!container) {
        // Create new object
        const cw = phaserScene.data.get('canvasWidth') as number || 800;
        const ch = phaserScene.data.get('canvasHeight') as number || 600;
        container = createObjectVisual(phaserScene, obj, true, cw, ch, components); // true = editor mode
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

        // Update costume if changed (use effective props for component instances)
        const costumes = effectiveProps.costumes || [];
        const currentCostumeIndex = effectiveProps.currentCostumeIndex ?? 0;
        const currentCostume = costumes[currentCostumeIndex];
        const storedCostumeId = container.getData('costumeId');
        const storedAssetId = container.getData('assetId');

        // Check if costume ID or asset content changed
        const costumeChanged = currentCostume && (
          currentCostume.id !== storedCostumeId ||
          currentCostume.assetId !== storedAssetId
        );

        if (costumeChanged) {
          // Costume changed - update the sprite
          const existingSprite = container.getByName('sprite') as Phaser.GameObjects.Image | null;

          // Get the old texture key to remove it
          const oldTextureKey = container.getData('textureKey') as string | undefined;

          if (existingSprite) {
            existingSprite.destroy();
          }

          // Remove old texture to force reload with new content
          if (oldTextureKey && phaserScene.textures.exists(oldTextureKey)) {
            phaserScene.textures.remove(oldTextureKey);
          }

          // Helper to update container with new sprite using bounds
          const updateWithSprite = (
            sprite: Phaser.GameObjects.Image,
            cont: Phaser.GameObjects.Container,
            bounds: { x: number; y: number; width: number; height: number } | null | undefined
          ) => {
            sprite.setName('sprite');
            cont.add(sprite);

            const imgWidth = sprite.width;
            const imgHeight = sprite.height;

            // Keep sprite at (0, 0) - aligned to 1024x1024 canvas center
            // This ensures collider alignment regardless of costume bounds
            sprite.setPosition(0, 0);

            // If we have bounds, offset the hit area and selection to cover visible content
            if (bounds && bounds.width > 0 && bounds.height > 0) {
              const w = Math.max(bounds.width, 32);
              const h = Math.max(bounds.height, 32);

              // Calculate offset from canvas center (512, 512) to bounds center
              const visibleCenterX = bounds.x + bounds.width / 2;
              const visibleCenterY = bounds.y + bounds.height / 2;
              const offsetX = visibleCenterX - imgWidth / 2;
              const offsetY = visibleCenterY - imgHeight / 2;

              cont.setSize(w, h);

              const hitRect = cont.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
              if (hitRect) {
                hitRect.setSize(w, h);
                hitRect.setPosition(offsetX, offsetY);
                hitRect.removeInteractive();
                hitRect.setInteractive({ useHandCursor: true });
                phaserScene.input.setDraggable(hitRect);
              }

              const selRect = cont.getByName('selection') as Phaser.GameObjects.Rectangle | null;
              if (selRect) {
                selRect.setSize(w + 8, h + 8);
                selRect.setPosition(offsetX, offsetY);
                cont.sendToBack(selRect);
              }
            } else {
              // No bounds - use full image size (fallback)
              const width = Math.max(imgWidth, 32);
              const height = Math.max(imgHeight, 32);

              cont.setSize(width, height);

              const hitRect = cont.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
              if (hitRect) {
                hitRect.setSize(width, height);
                hitRect.setPosition(0, 0);
                hitRect.removeInteractive();
                hitRect.setInteractive({ useHandCursor: true });
                phaserScene.input.setDraggable(hitRect);
              }

              const selRect = cont.getByName('selection') as Phaser.GameObjects.Rectangle | null;
              if (selRect) {
                selRect.setSize(width + 8, height + 8);
                selRect.setPosition(0, 0);
                cont.sendToBack(selRect);
              }
            }
          };

          // Use a unique texture key with timestamp to guarantee uniqueness
          const textureKey = `costume_${obj.id}_${currentCostume.id}_${Date.now()}`;

          // Always load fresh - we removed any existing texture above
          const img = new Image();
          img.onload = () => {
            // Check if container still exists and this is still the expected costume
            if (!container || container.getData('assetId') !== currentCostume.assetId) return;
            if (phaserScene.textures.exists(textureKey)) return;

            phaserScene.textures.addImage(textureKey, img);
            const sprite = phaserScene.add.image(0, 0, textureKey);
            updateWithSprite(sprite, container, currentCostume.bounds);
          };
          img.src = currentCostume.assetId;

          container.setData('costumeId', currentCostume.id);
          container.setData('assetId', currentCostume.assetId);
          container.setData('textureKey', textureKey);
          container.setData('bounds', currentCostume.bounds);
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
  }, [selectedScene?.objects, selectedObjectId, isPlaying, selectObject, handleObjectDragEnd, project?.components]);

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
  onDragEnd: (objId: string, x: number, y: number, scaleX?: number, scaleY?: number, rotation?: number) => void,
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

    // Set initial selection and gizmo visibility
    const setSelectionVisible = (visible: boolean) => {
      const selRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
      if (selRect) selRect.setVisible(visible);

      // Toggle gizmo handles
      const handleNames = ['handle_nw', 'handle_ne', 'handle_sw', 'handle_se',
                          'handle_n', 'handle_s', 'handle_e', 'handle_w',
                          'handle_rotate', 'rotate_line'];
      for (const name of handleNames) {
        const handle = container.getByName(name);
        if (handle) (handle as Phaser.GameObjects.Shape | Phaser.GameObjects.Graphics).setVisible(visible);
      }

      // Update gizmo positions when showing
      if (visible) {
        const updateGizmo = container.getData('updateGizmoPositions') as (() => void) | undefined;
        if (updateGizmo) updateGizmo();
      }
    };
    setSelectionVisible(isSelected);
    container.setData('setSelectionVisible', setSelectionVisible);

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

    // Handle transform end from gizmo (includes scale and rotation)
    container.on('transformend', () => {
      const rotationDeg = Phaser.Math.RadToDeg(container.rotation);
      onDragEnd(obj.id, container.x, container.y, container.scaleX, container.scaleY, rotationDeg);
    });
  });

  // Update selection visuals on scene update
  scene.events.on('update', () => {
    scene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Container && child.getData('objectData')) {
        const isSelected = child.getData('selected');
        const setSelectionVisible = child.getData('setSelectionVisible') as ((visible: boolean) => void) | undefined;
        if (setSelectionVisible) {
          setSelectionVisible(isSelected);
        } else {
          // Fallback for containers without the helper
          const selectionRect = child.getByName('selection') as Phaser.GameObjects.Rectangle;
          if (selectionRect) {
            selectionRect.setVisible(isSelected);
          }
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

    // Register with runtime (include componentId for component instances)
    const runtimeSprite = runtime.registerSprite(obj.id, obj.name, container, obj.componentId);

    // Set costumes if available (use effective costumes for component instances)
    const costumes = effectiveProps.costumes || [];
    if (costumes.length > 0) {
      runtimeSprite.setCostumes(costumes, effectiveProps.currentCostumeIndex || 0);
    }

    // Store collider and physics config on sprite for later use (e.g., when enabling physics via code)
    const physics = effectiveProps.physics;
    const collider = effectiveProps.collider;
    runtimeSprite.setColliderConfig(collider || null);
    runtimeSprite.setPhysicsConfig(physics || null);
    console.log(`[Physics] Object "${obj.name}" physics config:`, physics);
    console.log(`[Physics] Object "${obj.name}" collider:`, collider);
    if (physics?.enabled) {
      // Get default size from costume bounds
      const costume = costumes[effectiveProps.currentCostumeIndex || 0];
      let defaultWidth = 64, defaultHeight = 64;
      if (costume?.bounds && costume.bounds.width > 0 && costume.bounds.height > 0) {
        defaultWidth = costume.bounds.width;
        defaultHeight = costume.bounds.height;
      }

      // Apply object scale to collider dimensions
      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;
      const scaledDefaultWidth = defaultWidth * Math.abs(scaleX);
      const scaledDefaultHeight = defaultHeight * Math.abs(scaleY);

      // Body config options
      const bodyOptions: Phaser.Types.Physics.Matter.MatterBodyConfig = {
        restitution: physics.bounce ?? 0,
        frictionAir: 0.01,
        friction: physics.friction ?? 0.1,
      };

      // Create Matter body based on collider config
      let body: MatterJS.BodyType;
      const posX = container.x;
      const posY = container.y;

      // Apply collider offset (scaled) - both editor and Phaser use Y-down
      const colliderOffsetX = (collider?.offsetX ?? 0) * scaleX;
      const colliderOffsetY = (collider?.offsetY ?? 0) * scaleY;
      const bodyX = posX + colliderOffsetX;
      const bodyY = posY + colliderOffsetY;

      // Determine collider type - default to circle if no collider specified
      const colliderType = collider?.type ?? 'circle';
      console.log(`[Physics] Creating ${colliderType} collider for "${obj.name}" with scale (${scaleX}, ${scaleY}), offset (${colliderOffsetX}, ${colliderOffsetY})`);

      switch (colliderType) {
        case 'none': {
          // No physics body - skip
          console.log(`[Physics] Collider type 'none', skipping physics body`);
          body = scene.matter.add.rectangle(bodyX, bodyY, scaledDefaultWidth, scaledDefaultHeight, { ...bodyOptions, isSensor: true });
          break;
        }
        case 'circle': {
          // For circle, use the average scale or max scale to determine radius
          const avgScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
          const baseRadius = collider?.radius || Math.max(defaultWidth, defaultHeight) / 2;
          const radius = baseRadius * avgScale;
          console.log(`[Physics] Circle radius: ${radius} (base: ${baseRadius}, scale: ${avgScale})`);
          body = scene.matter.add.circle(bodyX, bodyY, radius, bodyOptions);
          break;
        }
        case 'capsule': {
          // Matter.js doesn't have native capsule - use chamfered rectangle (pill shape)
          const baseWidth = collider?.width || defaultWidth;
          const baseHeight = collider?.height || defaultHeight;
          const width = baseWidth * Math.abs(scaleX);
          const height = baseHeight * Math.abs(scaleY);
          const chamferRadius = Math.min(width, height) / 2;
          console.log(`[Physics] Capsule: ${width}x${height}, chamfer: ${chamferRadius}`);
          body = scene.matter.add.rectangle(bodyX, bodyY, width, height, {
            ...bodyOptions,
            chamfer: { radius: chamferRadius },
          });
          break;
        }
        case 'box':
        default: {
          const baseWidth = collider?.width || defaultWidth;
          const baseHeight = collider?.height || defaultHeight;
          const width = baseWidth * Math.abs(scaleX);
          const height = baseHeight * Math.abs(scaleY);
          console.log(`[Physics] Box: ${width}x${height} (base: ${baseWidth}x${baseHeight}, scale: ${scaleX}x${scaleY})`);
          body = scene.matter.add.rectangle(bodyX, bodyY, width, height, bodyOptions);
          break;
        }
      }

      // Attach body to container
      const existingBody = (container as unknown as { body?: MatterJS.BodyType }).body;
      if (existingBody) {
        scene.matter.world.remove(existingBody);
      }

      // Add a destroy method to the body so Phaser can clean it up properly
      // Raw Matter.js bodies don't have destroy(), which causes errors when container is destroyed
      (body as MatterJS.BodyType & { destroy?: () => void }).destroy = () => {
        if (scene.matter?.world) {
          scene.matter.world.remove(body);
        }
      };

      (container as unknown as { body: MatterJS.BodyType }).body = body;

      // Store collider offset for position sync
      container.setData('colliderOffsetX', colliderOffsetX);
      container.setData('colliderOffsetY', colliderOffsetY);

      // Set up Matter.js to sync container position with body
      // Subtract the collider offset to get the container position
      scene.matter.world.on('afterupdate', () => {
        if (body && container.active) {
          const offsetX = container.getData('colliderOffsetX') ?? 0;
          const offsetY = container.getData('colliderOffsetY') ?? 0;
          container.setPosition(body.position.x - offsetX, body.position.y - offsetY);
          if (physics.allowRotation) {
            container.setRotation(body.angle);
          }
        }
      });

      // Store allowRotation flag for runtime updates
      container.setData('allowRotation', physics.allowRotation ?? false);

      // Set initial velocity (invert Y for user space)
      scene.matter.body.setVelocity(body, {
        x: physics.velocityX ?? 0,
        y: -(physics.velocityY ?? 0) // Invert Y for user space
      });

      // Set body type (static bodies don't move)
      if (physics.bodyType === 'static') {
        scene.matter.body.setStatic(body, true);
      }

      // Configure rotation
      if (!physics.allowRotation) {
        scene.matter.body.setInertia(body, Infinity); // Prevent rotation
      }

      // Gravity scale - uses Matter.js built-in gravityScale property
      // Default of 1 means normal gravity, 0 means no gravity, 2 means double, etc.
      const gravityValue = physics.gravityY ?? 1;
      body.gravityScale = { x: 0, y: gravityValue };
      console.log(`[Physics] Object "${obj.name}" gravity scale set to: ${gravityValue}`);
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
  // Gizmo handles for transform
  let gizmoHandles: Phaser.GameObjects.GameObject[] = [];

  if (isEditorMode) {
    // Selection visual
    selectionRect = scene.add.rectangle(0, 0, defaultSize + 8, defaultSize + 8);
    selectionRect.setStrokeStyle(2, 0x4A90D9);
    selectionRect.setFillStyle(0x4A90D9, 0.1);
    selectionRect.setVisible(false);
    selectionRect.setName('selection');
    container.add(selectionRect);

    // Create gizmo handles
    const handleSize = 8;
    const handleColor = 0x4A90D9;
    const rotateHandleDistance = 24;

    // Corner handles (for proportional scaling)
    const cornerNames = ['nw', 'ne', 'sw', 'se'];
    const cornerCursors = ['nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize'];
    for (let i = 0; i < 4; i++) {
      const handle = scene.add.rectangle(0, 0, handleSize, handleSize, handleColor);
      handle.setName(`handle_${cornerNames[i]}`);
      handle.setVisible(false);
      handle.setInteractive({ useHandCursor: false, cursor: cornerCursors[i] });
      scene.input.setDraggable(handle);
      container.add(handle);
      gizmoHandles.push(handle);
    }

    // Edge handles (for axis scaling)
    const edgeNames = ['n', 's', 'e', 'w'];
    const edgeCursors = ['ns-resize', 'ns-resize', 'ew-resize', 'ew-resize'];
    for (let i = 0; i < 4; i++) {
      const isVertical = i < 2;
      const handle = scene.add.rectangle(0, 0, isVertical ? handleSize * 2 : handleSize, isVertical ? handleSize : handleSize * 2, handleColor);
      handle.setName(`handle_${edgeNames[i]}`);
      handle.setVisible(false);
      handle.setInteractive({ useHandCursor: false, cursor: edgeCursors[i] });
      scene.input.setDraggable(handle);
      container.add(handle);
      gizmoHandles.push(handle);
    }

    // Rotation handle (circle above object)
    const rotateHandle = scene.add.circle(0, 0, handleSize / 2 + 2, handleColor);
    rotateHandle.setName('handle_rotate');
    rotateHandle.setVisible(false);
    rotateHandle.setInteractive({ useHandCursor: false, cursor: 'grab' });
    scene.input.setDraggable(rotateHandle);
    container.add(rotateHandle);
    gizmoHandles.push(rotateHandle);

    // Rotation line connecting to top edge
    const rotateLine = scene.add.graphics();
    rotateLine.setName('rotate_line');
    rotateLine.setVisible(false);
    container.add(rotateLine);

    // Store gizmo data on container
    container.setData('gizmoHandles', gizmoHandles);
    container.setData('rotateHandleDistance', rotateHandleDistance);

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

      // Set up gizmo handle drag logic
      let startScaleX = 1, startScaleY = 1;
      let startWidth = 0, startHeight = 0;
      let startPointerX = 0, startPointerY = 0;
      let startRotation = 0;
      let startCenterX = 0, startCenterY = 0;

      for (const handle of gizmoHandles) {
        const handleName = handle.name;

        (handle as Phaser.GameObjects.Shape).on('dragstart', (pointer: Phaser.Input.Pointer) => {
          startScaleX = container.scaleX;
          startScaleY = container.scaleY;
          startWidth = container.width * container.scaleX;
          startHeight = container.height * container.scaleY;
          startPointerX = pointer.worldX;
          startPointerY = pointer.worldY;
          startRotation = container.rotation;
          startCenterX = container.x;
          startCenterY = container.y;
        });

        (handle as Phaser.GameObjects.Shape).on('drag', (pointer: Phaser.Input.Pointer) => {
          const dx = pointer.worldX - startPointerX;
          const dy = pointer.worldY - startPointerY;

          if (handleName === 'handle_rotate') {
            // Rotation handle
            const angleToStart = Math.atan2(startPointerY - startCenterY, startPointerX - startCenterX);
            const angleToCurrent = Math.atan2(pointer.worldY - startCenterY, pointer.worldX - startCenterX);
            container.rotation = startRotation + (angleToCurrent - angleToStart);
          } else if (handleName.startsWith('handle_n') || handleName.startsWith('handle_s') ||
                     handleName === 'handle_e' || handleName === 'handle_w') {
            // Scale handles
            let newScaleX = startScaleX;
            let newScaleY = startScaleY;

            // Corner handles (proportional)
            if (handleName === 'handle_nw') {
              const avgDelta = (-dx - dy) / 2;
              const scale = (startWidth + avgDelta) / startWidth;
              newScaleX = startScaleX * scale;
              newScaleY = startScaleY * scale;
            } else if (handleName === 'handle_ne') {
              const avgDelta = (dx - dy) / 2;
              const scale = (startWidth + avgDelta) / startWidth;
              newScaleX = startScaleX * scale;
              newScaleY = startScaleY * scale;
            } else if (handleName === 'handle_sw') {
              const avgDelta = (-dx + dy) / 2;
              const scale = (startWidth + avgDelta) / startWidth;
              newScaleX = startScaleX * scale;
              newScaleY = startScaleY * scale;
            } else if (handleName === 'handle_se') {
              const avgDelta = (dx + dy) / 2;
              const scale = (startWidth + avgDelta) / startWidth;
              newScaleX = startScaleX * scale;
              newScaleY = startScaleY * scale;
            }
            // Edge handles (axis scale)
            else if (handleName === 'handle_n') {
              newScaleY = startScaleY * (startHeight - dy) / startHeight;
            } else if (handleName === 'handle_s') {
              newScaleY = startScaleY * (startHeight + dy) / startHeight;
            } else if (handleName === 'handle_e') {
              newScaleX = startScaleX * (startWidth + dx) / startWidth;
            } else if (handleName === 'handle_w') {
              newScaleX = startScaleX * (startWidth - dx) / startWidth;
            }

            // Apply scale with minimum
            container.setScale(Math.max(0.1, newScaleX), Math.max(0.1, newScaleY));
          }

          // Update gizmo handle positions
          updateGizmoPositions();
        });

        (handle as Phaser.GameObjects.Shape).on('dragend', () => {
          // Emit transform end event for editor scene to handle
          container.emit('transformend');
        });
      }
    });

    // Function to update gizmo handle positions based on current bounds
    const updateGizmoPositions = () => {
      const selRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
      if (!selRect) return;

      const halfW = selRect.width / 2;
      const halfH = selRect.height / 2;
      const offsetX = selRect.x;
      const offsetY = selRect.y;
      const rotateDistance = container.getData('rotateHandleDistance') || 24;

      // Corner handles
      const nw = container.getByName('handle_nw') as Phaser.GameObjects.Rectangle;
      const ne = container.getByName('handle_ne') as Phaser.GameObjects.Rectangle;
      const sw = container.getByName('handle_sw') as Phaser.GameObjects.Rectangle;
      const se = container.getByName('handle_se') as Phaser.GameObjects.Rectangle;
      if (nw) nw.setPosition(offsetX - halfW, offsetY - halfH);
      if (ne) ne.setPosition(offsetX + halfW, offsetY - halfH);
      if (sw) sw.setPosition(offsetX - halfW, offsetY + halfH);
      if (se) se.setPosition(offsetX + halfW, offsetY + halfH);

      // Edge handles
      const n = container.getByName('handle_n') as Phaser.GameObjects.Rectangle;
      const s = container.getByName('handle_s') as Phaser.GameObjects.Rectangle;
      const e = container.getByName('handle_e') as Phaser.GameObjects.Rectangle;
      const w = container.getByName('handle_w') as Phaser.GameObjects.Rectangle;
      if (n) n.setPosition(offsetX, offsetY - halfH);
      if (s) s.setPosition(offsetX, offsetY + halfH);
      if (e) e.setPosition(offsetX + halfW, offsetY);
      if (w) w.setPosition(offsetX - halfW, offsetY);

      // Rotation handle and line
      const rotateHandle = container.getByName('handle_rotate') as Phaser.GameObjects.Arc;
      const rotateLine = container.getByName('rotate_line') as Phaser.GameObjects.Graphics;
      if (rotateHandle) {
        rotateHandle.setPosition(offsetX, offsetY - halfH - rotateDistance);
      }
      if (rotateLine) {
        rotateLine.clear();
        rotateLine.lineStyle(2, 0x4A90D9, 1);
        rotateLine.lineBetween(offsetX, offsetY - halfH, offsetX, offsetY - halfH - rotateDistance + 4);
      }
    };

    // Store updateGizmoPositions on container for external access
    container.setData('updateGizmoPositions', updateGizmoPositions);
  }

  // Helper to update container size, hit area, and selection rect based on bounds
  const updateContainerWithBounds = (
    sprite: Phaser.GameObjects.Image,
    bounds: { x: number; y: number; width: number; height: number } | null | undefined
  ) => {
    const imgWidth = sprite.width;
    const imgHeight = sprite.height;

    // Keep sprite at (0, 0) - aligned to 1024x1024 canvas center
    // This ensures collider alignment regardless of costume bounds
    sprite.setPosition(0, 0);

    // If we have bounds, offset the hit area and selection to cover visible content
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const w = Math.max(bounds.width, 32);
      const h = Math.max(bounds.height, 32);

      // Calculate offset from canvas center (512, 512) to bounds center
      const visibleCenterX = bounds.x + bounds.width / 2;
      const visibleCenterY = bounds.y + bounds.height / 2;
      const offsetX = visibleCenterX - imgWidth / 2;
      const offsetY = visibleCenterY - imgHeight / 2;

      container.setSize(w, h);

      // Update hit area rectangle - position it over the visible bounds
      if (hitRect) {
        hitRect.setSize(w, h);
        hitRect.setPosition(offsetX, offsetY);
        hitRect.removeInteractive();
        hitRect.setInteractive({ useHandCursor: true });
        scene.input.setDraggable(hitRect);
      }

      // Update selection rectangle
      if (selectionRect) {
        selectionRect.setSize(w + 8, h + 8);
        selectionRect.setPosition(offsetX, offsetY);
      }

      // Update gizmo handle positions
      const updateGizmo = container.getData('updateGizmoPositions') as (() => void) | undefined;
      if (updateGizmo) updateGizmo();
    } else {
      // No bounds - use full image size (fallback)
      const w = Math.max(imgWidth, 32);
      const h = Math.max(imgHeight, 32);

      container.setSize(w, h);

      if (hitRect) {
        hitRect.setSize(w, h);
        hitRect.setPosition(0, 0);
        hitRect.removeInteractive();
        hitRect.setInteractive({ useHandCursor: true });
        scene.input.setDraggable(hitRect);
      }

      if (selectionRect) {
        selectionRect.setSize(w + 8, h + 8);
        selectionRect.setPosition(0, 0);
      }

      // Update gizmo handle positions
      const updateGizmo = container.getData('updateGizmoPositions') as (() => void) | undefined;
      if (updateGizmo) updateGizmo();
    }
  };

  // Get current costume (use effective props for component instances)
  const effectiveProps = getEffectiveObjectProps(obj, components);
  const costumes = effectiveProps.costumes || [];
  const currentCostumeIndex = effectiveProps.currentCostumeIndex ?? 0;
  const currentCostume = costumes[currentCostumeIndex];

  if (currentCostume && currentCostume.assetId) {
    // Use unique texture key with timestamp
    const textureKey = `costume_${obj.id}_${currentCostume.id}_${Date.now()}`;

    // Store costume ID, assetId, textureKey, and bounds for change detection
    container.setData('costumeId', currentCostume.id);
    container.setData('assetId', currentCostume.assetId);
    container.setData('textureKey', textureKey);
    container.setData('bounds', currentCostume.bounds);

    // Load texture from data URL (always fresh load with unique key)
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
      updateContainerWithBounds(sprite, currentCostume.bounds);
    };
    img.src = currentCostume.assetId;
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
    // Ensure hit area is properly configured for placeholder
    if (hitRect) {
      hitRect.setSize(64, 64);
    }
    if (selectionRect) {
      selectionRect.setSize(72, 72);
    }
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
