import { useEffect, useRef, useCallback } from 'react';
import Phaser from 'phaser';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { RuntimeEngine, setCurrentRuntime, registerCodeGenerators, generateCodeForObject, clearSharedGlobalVariables } from '@/phaser';
import { setBodyGravityY } from '@/phaser/gravity';
import type { Scene as SceneData, GameObject, ComponentDefinition, Variable } from '@/types';
import { getEffectiveObjectProps } from '@/types';

// Register code generators once at module load
registerCodeGenerators();

// Track runtimes for each scene (for pause/resume across scene switches)
const sceneRuntimes: Map<string, RuntimeEngine> = new Map();
const GIZMO_HANDLE_NAMES = ['handle_nw', 'handle_ne', 'handle_sw', 'handle_se', 'handle_n', 'handle_s', 'handle_e', 'handle_w', 'handle_rotate'];
const PIXEL_HIT_ALPHA_TOLERANCE = 1;
const GIZMO_STROKE_PX = 2;
const GIZMO_HANDLE_SIZE_PX = 8;
const GIZMO_EDGE_LONG_PX = 16;
const GIZMO_ROTATE_DISTANCE_PX = 24;
const GIZMO_ROTATE_RADIUS_PX = 6;

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

function isPointOnOpaqueSpritePixel(scene: Phaser.Scene, sprite: Phaser.GameObjects.Image, worldX: number, worldY: number): boolean {
  if (!sprite.visible || !sprite.active || sprite.alpha <= 0) return false;
  if (!sprite.texture || !sprite.frame) return false;

  const local = sprite.getWorldTransformMatrix().applyInverse(worldX, worldY, new Phaser.Math.Vector2());
  const localX = local.x + sprite.displayOriginX;
  const localY = local.y + sprite.displayOriginY;
  const spriteWidth = sprite.width;
  const spriteHeight = sprite.height;

  if (spriteWidth <= 0 || spriteHeight <= 0) return false;
  if (localX < 0 || localY < 0 || localX >= spriteWidth || localY >= spriteHeight) return false;

  // Phaser pixel-perfect input passes local frame-space coordinates directly.
  const alpha = scene.textures.getPixelAlpha(localX, localY, sprite.texture.key, sprite.frame.name);

  if (alpha === null || alpha === undefined) {
    // Fallback if texture pixel lookup is unavailable for this source.
    return true;
  }
  return alpha >= PIXEL_HIT_ALPHA_TOLERANCE;
}

function pickTopObjectIdAtWorldPoint(scene: Phaser.Scene, worldX: number, worldY: number): string | null {
  const containers: Phaser.GameObjects.Container[] = [];
  scene.children.each((child: Phaser.GameObjects.GameObject) => {
    if (child instanceof Phaser.GameObjects.Container && child.getData('objectData')) {
      containers.push(child);
    }
  });

  const displayList = scene.children;
  containers.sort((a, b) => {
    if (a.depth !== b.depth) return b.depth - a.depth;
    return displayList.getIndex(b) - displayList.getIndex(a);
  });

  for (const container of containers) {
    if (!container.visible || !container.active || container.alpha <= 0) continue;

    const sprite = container.getByName('sprite') as Phaser.GameObjects.Image | null;
    if (sprite) {
      if (isPointOnOpaqueSpritePixel(scene, sprite, worldX, worldY)) {
        return container.name;
      }
      continue;
    }

    // Placeholder objects without a sprite: fallback to geometric hit.
    const hitRect = container.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
    const bounds = hitRect ? hitRect.getBounds() : container.getBounds();
    if (bounds.contains(worldX, worldY)) {
      return container.name;
    }
  }

  return null;
}

function getOrderedObjectIdsForActiveScene(fallbackIds: string[] = []): string[] {
  const { project } = useProjectStore.getState();
  const { selectedSceneId } = useEditorStore.getState();
  if (!project || !selectedSceneId) return fallbackIds;

  const activeScene = project.scenes.find((sceneState) => sceneState.id === selectedSceneId);
  return activeScene ? activeScene.objects.map((obj) => obj.id) : fallbackIds;
}

interface PhaserCanvasProps {
  isPlaying: boolean;
}

export function PhaserCanvas({ isPlaying }: PhaserCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const runtimeRef = useRef<RuntimeEngine | null>(null);
  const creationIdRef = useRef(0); // Track which creation attempt is current
  // Track the initial scene when play mode starts - don't recreate game when scene changes during play
  const playModeInitialSceneRef = useRef<string | null>(null);

  const { project, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedObjectIds, selectObject, selectObjects, selectScene, showColliderOutlines, viewMode } = useEditorStore();

  // Use refs for values accessed in Phaser callbacks to avoid stale closures
  const selectedSceneIdRef = useRef(selectedSceneId);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const selectedObjectIdsRef = useRef(selectedObjectIds);
  const isPlayingRef = useRef(isPlaying);
  const canvasDimensionsRef = useRef({ width: 800, height: 600 });

  // Keep refs in sync
  selectedSceneIdRef.current = selectedSceneId;
  selectedObjectIdRef.current = selectedObjectId;
  selectedObjectIdsRef.current = selectedObjectIds;
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

  const handleStageObjectPointerDown = useCallback((pointer: Phaser.Input.Pointer, objectId: string) => {
    if (!pointer.leftButtonDown()) return;

    const state = useEditorStore.getState();
    const event = pointer.event as MouseEvent | PointerEvent | undefined;
    const isToggleSelection = !!event && (event.metaKey || event.ctrlKey);
    const isAddSelection = !!event && event.shiftKey;
    const currentSelection = state.selectedObjectIds.length > 0
      ? state.selectedObjectIds
      : (state.selectedObjectId ? [state.selectedObjectId] : []);

    if (isToggleSelection) {
      const alreadySelected = currentSelection.includes(objectId);
      const nextIds = alreadySelected
        ? currentSelection.filter(id => id !== objectId)
        : [...currentSelection, objectId];
      state.selectObjects(nextIds, nextIds.includes(objectId) ? objectId : (nextIds[0] ?? null));
      return;
    }

    if (isAddSelection) {
      const nextIds = currentSelection.includes(objectId)
        ? currentSelection
        : [...currentSelection, objectId];
      state.selectObjects(nextIds, objectId);
      return;
    }

    if (currentSelection.length > 1 && currentSelection.includes(objectId)) {
      // Keep multi-selection intact so immediate drag can move the whole selection.
      return;
    }

    state.selectObject(objectId);
  }, []);

  // Initialize Phaser
  useEffect(() => {
    if (!containerRef.current || !project) return;

    // In play mode, only recreate game when play mode starts (not when selectedSceneId changes)
    // Check if this is just a scene change during an active play session
    const isSceneChangeInPlayMode = isPlaying &&
      playModeInitialSceneRef.current !== null &&
      gameRef.current;

    if (isSceneChangeInPlayMode) {
      console.log('[PhaserCanvas] Skipping game recreation - play mode already active, scene change handled internally');
      // Return a no-op cleanup since we're not creating anything new
      return () => {};
    }

    // Track whether this effect instance actually created a game (for cleanup decision)
    const wasPlayingOnCreation = isPlaying;

    if (isPlaying) {
      // Store the initial scene for this play session
      playModeInitialSceneRef.current = selectedSceneId;
    } else {
      // Exiting play mode or in editor mode - clear the ref
      playModeInitialSceneRef.current = null;
    }

    // Use the initial scene for play mode, current scene for editor mode
    const effectiveSceneId = isPlaying ? (playModeInitialSceneRef.current || selectedSceneId) : selectedSceneId;
    const effectiveScene = project.scenes.find(s => s.id === effectiveSceneId);

    // Increment creation ID - any previous async creation attempts will be ignored
    creationIdRef.current++;
    const thisCreationId = creationIdRef.current;

    console.log(`[PhaserCanvas] Starting init #${thisCreationId}, isPlaying=${isPlaying}, effectiveSceneId=${effectiveSceneId}`);

    // Clean up existing game
    if (runtimeRef.current) {
      console.log('[PhaserCanvas] Cleaning up existing runtime');
      runtimeRef.current.cleanup();
      setCurrentRuntime(null);
      runtimeRef.current = null;
    }
    if (gameRef.current) {
      console.log('[PhaserCanvas] Destroying existing game');
      // Stop all sounds before destroying to prevent AudioContext errors
      try {
        // Try to stop sounds on all active scenes
        const sceneManager = gameRef.current.scene;
        sceneManager.getScenes(true).forEach(scene => {
          if (scene?.sound) {
            scene.sound.stopAll();
            scene.sound.removeAll();
          }
        });
      } catch {
        // Ignore - scene might not exist
      }
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
          // Use consistent scene key format: PlayScene_${sceneId} for all scenes
          key: isPlaying ? `PlayScene_${effectiveSceneId}` : 'EditorScene',
          preload: function(this: Phaser.Scene) {
            // Preload assets if needed
          },
          create: function(this: Phaser.Scene) {
            if (isPlaying) {
              // Collect all objects from all scenes for variable lookup
              const allObjects = project.scenes.flatMap(s => s.objects);
              createPlayScene(this, effectiveScene, project.scenes, project.components || [], runtimeRef, canvasWidth, canvasHeight, project.globalVariables, allObjects, effectiveSceneId || undefined);
            } else {
              // Get current viewMode and cycleViewMode from store
              const { viewMode: currentViewMode, cycleViewMode: cycleFn } = useEditorStore.getState();
              createEditorScene(
                this,
                selectedScene,
                selectObject,
                selectObjects,
                selectedObjectId,
                selectedObjectIds,
                handleStageObjectPointerDown,
                handleObjectDragEnd,
                canvasWidth,
                canvasHeight,
                project.components || [],
                currentViewMode,
                cycleFn,
              );
            }
          },
          update: function(this: Phaser.Scene) {
            if (isPlaying && runtimeRef.current) {
              runtimeRef.current.update();

              // Check for scene switch
              const pendingSwitch = runtimeRef.current.pendingSceneSwitch;
              if (pendingSwitch) {
                const targetSceneData = project.scenes.find(s => s.name === pendingSwitch.sceneName);
                if (targetSceneData) {
                  runtimeRef.current.clearPendingSceneSwitch();
                  // Use consistent scene key format for all scenes
                  const currentSceneKey = `PlayScene_${effectiveSceneId}`;
                  const targetSceneKey = `PlayScene_${targetSceneData.id}`;

                  // Pause current runtime and sleep current scene
                  runtimeRef.current.pause();

                  // Check if target scene already exists (was visited before)
                  const existingRuntime = sceneRuntimes.get(targetSceneData.id);

                  if (existingRuntime && !pendingSwitch.restart) {
                    // Resume existing scene
                    this.scene.sleep(currentSceneKey);
                    this.scene.wake(targetSceneKey);
                    runtimeRef.current = existingRuntime;
                    existingRuntime.resume();
                    setCurrentRuntime(existingRuntime);
                  } else {
                    // Start new scene (or restart)
                    if (existingRuntime) {
                      // Clean up old runtime if restarting
                      existingRuntime.cleanup();
                      sceneRuntimes.delete(targetSceneData.id);
                      this.scene.stop(targetSceneKey);
                    }

                    // Sleep current scene
                    this.scene.sleep(currentSceneKey);

                    // Launch target scene if not already added, or start if restarting
                    if (!this.scene.get(targetSceneKey)) {
                      // Add new scene dynamically
                      this.scene.add(targetSceneKey, createPlaySceneConfig(
                        targetSceneData,
                        project.scenes,
                        project.components || [],
                        runtimeRef,
                        canvasWidth,
                        canvasHeight,
                        project.globalVariables,
                        project.scenes.flatMap(s => s.objects),
                        targetSceneData.id
                      ), true);
                    } else {
                      this.scene.start(targetSceneKey);
                    }
                  }

                  // Update editor's selected scene to sync UI
                  selectScene(targetSceneData.id);
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
      console.log(`[PhaserCanvas] Cleanup triggered (wasPlayingOnCreation=${wasPlayingOnCreation}, isPlayingRef=${isPlayingRef.current})`);

      // Skip cleanup if we're still in play mode - scene switches during play don't need full cleanup
      // This happens when selectedSceneId changes but isPlaying stays true
      if (wasPlayingOnCreation && isPlayingRef.current && playModeInitialSceneRef.current !== null) {
        console.log('[PhaserCanvas] Skipping cleanup - still in active play session');
        return;
      }

      // Clear play mode tracking
      playModeInitialSceneRef.current = null;

      // Clear shared global variables when play session ends
      clearSharedGlobalVariables();

      // Clean up all scene runtimes (for multi-scene play mode)
      for (const [sceneId, runtime] of sceneRuntimes) {
        try {
          runtime.cleanup();
        } catch (e) {
          console.warn(`[PhaserCanvas] Error cleaning up runtime for scene ${sceneId}:`, e);
        }
      }
      sceneRuntimes.clear();

      if (runtimeRef.current) {
        runtimeRef.current.cleanup();
        setCurrentRuntime(null);
        runtimeRef.current = null;
      }
      if (gameRef.current) {
        // Stop all sounds before destroying to prevent AudioContext errors
        try {
          const sceneManager = gameRef.current.scene;
          sceneManager.getScenes(true).forEach(scene => {
            if (scene?.sound) {
              scene.sound.stopAll();
              scene.sound.removeAll();
            }
          });
        } catch {
          // Ignore - scene might not exist
        }
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [project?.id, selectedSceneId, isPlaying, handleObjectDragEnd]);

  // Toggle collider debug rendering at runtime (without recreating game)
  useEffect(() => {
    if (!gameRef.current) return;

    // Get the active scene - could be EditorScene or PlayScene_${sceneId}
    const sceneKey = isPlaying ? `PlayScene_${selectedSceneId}` : 'EditorScene';
    const phaserScene = gameRef.current.scene.getScene(sceneKey) as Phaser.Scene;
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
  }, [isPlaying, showColliderOutlines, selectedSceneId]);

  // Update view mode at runtime (without recreating game)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    if (!phaserScene) return;

    const camera = phaserScene.cameras.main;
    const canvasW = phaserScene.data.get('canvasWidth') as number || 800;
    const canvasH = phaserScene.data.get('canvasHeight') as number || 600;

    phaserScene.data.set('viewMode', viewMode);

    const containerWidth = phaserScene.scale.width;
    const containerHeight = phaserScene.scale.height;

    if (viewMode === 'camera-viewport') {
      // Camera mode: use viewport to letterbox
      const scaleX = containerWidth / canvasW;
      const scaleY = containerHeight / canvasH;
      const scale = Math.min(scaleX, scaleY);

      const viewportWidth = Math.floor(canvasW * scale);
      const viewportHeight = Math.floor(canvasH * scale);
      const viewportX = Math.floor((containerWidth - viewportWidth) / 2);
      const viewportY = Math.floor((containerHeight - viewportHeight) / 2);

      camera.setViewport(viewportX, viewportY, viewportWidth, viewportHeight);
      camera.setZoom(scale);
      camera.centerOn(canvasW / 2, canvasH / 2);
    } else {
      // Editor mode - full viewport
      camera.setViewport(0, 0, containerWidth, containerHeight);
      camera.setZoom(1);
      camera.centerOn(canvasW / 2, canvasH / 2);
    }
  }, [viewMode, isPlaying]);

  // Update objects when they change (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
    if (!phaserScene || !selectedScene) return;
    const selectedIds = new Set(
      selectedObjectIdsRef.current.length > 0
        ? selectedObjectIdsRef.current
        : (selectedObjectIdRef.current ? [selectedObjectIdRef.current] : []),
    );
    const isMultiSelection = selectedIds.size > 1;

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
        const newContainer = createObjectVisual(phaserScene, obj, true, cw, ch, components); // true = editor mode
        container = newContainer;
        const isSelected = selectedIds.has(obj.id);
        newContainer.setData('selected', isSelected);

        const setSelectionVisible = (visible: boolean) => {
          const selRect = newContainer.getByName('selection') as Phaser.GameObjects.Rectangle;
          if (selRect) selRect.setVisible(visible);

          for (const name of [...GIZMO_HANDLE_NAMES, 'rotate_line']) {
            const handle = newContainer.getByName(name);
            if (handle) (handle as Phaser.GameObjects.Shape | Phaser.GameObjects.Graphics).setVisible(visible);
          }

          if (visible) {
            const updateGizmo = newContainer.getData('updateGizmoPositions') as (() => void) | undefined;
            if (updateGizmo) updateGizmo();
          }
        };
        newContainer.setData('setSelectionVisible', setSelectionVisible);

        // Set initial selection visibility
        setSelectionVisible(!isMultiSelection && isSelected);

        let dragContext: {
          leaderStartX: number;
          leaderStartY: number;
          objectIds: string[];
          startPositions: Map<string, { x: number; y: number }>;
        } | null = null;

        newContainer.on('dragstart', () => {
          const storeState = useEditorStore.getState();
          const selectedIds = storeState.selectedObjectIds.length > 0
            ? storeState.selectedObjectIds
            : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
          const orderedSceneObjectIds = getOrderedObjectIdsForActiveScene(
            selectedScene.objects.map((sceneObj) => sceneObj.id),
          );
          const dragIds = (selectedIds.length > 1 && selectedIds.includes(obj.id))
            ? orderedSceneObjectIds.filter((id) => selectedIds.includes(id))
            : [obj.id];
          const startPositions = new Map<string, { x: number; y: number }>();
          for (const id of dragIds) {
            const selectedContainer = phaserScene.children.getByName(id) as Phaser.GameObjects.Container | null;
            if (selectedContainer) {
              startPositions.set(id, { x: selectedContainer.x, y: selectedContainer.y });
            }
          }
          dragContext = {
            leaderStartX: newContainer.x,
            leaderStartY: newContainer.y,
            objectIds: dragIds,
            startPositions,
          };
        });

        newContainer.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
          if (dragContext) {
            const dx = dragX - dragContext.leaderStartX;
            const dy = dragY - dragContext.leaderStartY;
            for (const id of dragContext.objectIds) {
              const selectedContainer = phaserScene.children.getByName(id) as Phaser.GameObjects.Container | null;
              const startPos = dragContext.startPositions.get(id);
              if (selectedContainer && startPos) {
                selectedContainer.x = startPos.x + dx;
                selectedContainer.y = startPos.y + dy;
              }
            }
            return;
          }
          newContainer.x = dragX;
          newContainer.y = dragY;
        });

        newContainer.on('dragend', () => {
          if (dragContext) {
            for (const id of dragContext.objectIds) {
              const selectedContainer = phaserScene.children.getByName(id) as Phaser.GameObjects.Container | null;
              if (selectedContainer) {
                handleObjectDragEnd(id, selectedContainer.x, selectedContainer.y);
              }
            }
            dragContext = null;
            return;
          }
          handleObjectDragEnd(obj.id, newContainer.x, newContainer.y);
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
      const isSelected = selectedIds.has(obj.id);
      container.setData('selected', isSelected);

      const setSelectionVisible = container.getData('setSelectionVisible') as ((visible: boolean) => void) | undefined;
      if (setSelectionVisible) {
        setSelectionVisible(!isMultiSelection && isSelected);
      } else {
        const selectionRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
        if (selectionRect) {
          selectionRect.setVisible(!isMultiSelection && isSelected);
        }
      }
    });
  }, [selectedScene?.objects, isPlaying, handleObjectDragEnd, project?.components]);

  // Update background color when it changes (in editor mode only)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
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

    const phaserScene = gameRef.current.scene.getScene('EditorScene') as Phaser.Scene;
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
  selectObjects: (ids: string[], primaryObjectId?: string | null) => void,
  selectedObjectId: string | null,
  selectedObjectIds: string[],
  onObjectPointerDown: (pointer: Phaser.Input.Pointer, objectId: string) => void,
  onDragEnd: (objId: string, x: number, y: number, scaleX?: number, scaleY?: number, rotation?: number) => void,
  canvasWidth: number,
  canvasHeight: number,
  components: ComponentDefinition[] = [],
  viewMode: 'camera-masked' | 'camera-viewport' | 'editor' = 'editor',
  cycleViewMode: () => void = () => {}
) {
  if (!sceneData) return;
  const getOrderedSceneObjectIds = () => getOrderedObjectIdsForActiveScene(sceneData.objects.map((obj) => obj.id));

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

  // Function to update the view based on current mode
  const updateViewMode = (mode: 'camera-masked' | 'camera-viewport' | 'editor') => {
    scene.data.set('viewMode', mode);

    const containerWidth = scene.scale.width;
    const containerHeight = scene.scale.height;

    if (mode === 'camera-viewport') {
      // Camera mode: use viewport to letterbox and maintain aspect ratio
      const scaleX = containerWidth / canvasWidth;
      const scaleY = containerHeight / canvasHeight;
      const scale = Math.min(scaleX, scaleY);

      const viewportWidth = Math.floor(canvasWidth * scale);
      const viewportHeight = Math.floor(canvasHeight * scale);
      const viewportX = Math.floor((containerWidth - viewportWidth) / 2);
      const viewportY = Math.floor((containerHeight - viewportHeight) / 2);

      camera.setViewport(viewportX, viewportY, viewportWidth, viewportHeight);
      camera.setZoom(scale);
      camera.centerOn(canvasWidth / 2, canvasHeight / 2);
    } else {
      // Editor mode - full viewport, free pan
      camera.setViewport(0, 0, containerWidth, containerHeight);
      camera.setZoom(1);
      camera.centerOn(canvasWidth / 2, canvasHeight / 2);
    }
  };

  // Initialize view mode
  scene.data.set('viewMode', viewMode);
  updateViewMode(viewMode);

  // Handle 'C' key to cycle view modes
  scene.input.keyboard?.on('keydown-C', () => {
    cycleViewMode();
    // Get the new mode from store and apply it
    const newMode = useEditorStore.getState().viewMode;
    updateViewMode(newMode);
  });

  // Enable camera panning with middle mouse or right mouse drag
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let cameraStartX = 0;
  let cameraStartY = 0;

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    // Middle mouse (button 1) or right mouse (button 2) starts panning (only in editor mode)
    const currentMode = scene.data.get('viewMode');
    if (currentMode === 'editor' && (pointer.middleButtonDown() || pointer.rightButtonDown())) {
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

  scene.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.middleButtonDown() && !pointer.rightButtonDown()) {
      isPanning = false;
    }
    endTranslateDrag(pointer);
    if (isMarqueeSelecting && marqueePointerId === pointer.id) {
      endMarqueeSelection(pointer);
    }
  });

  // Prevent context menu on right click
  scene.game.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Natural trackpad/mouse wheel controls (like Figma) - only in editor mode
  // - Two-finger pan (no modifier) = pan
  // - Pinch to zoom (ctrl/meta key on trackpad) = zoom with cursor as pivot
  scene.game.canvas.addEventListener('wheel', (e: WheelEvent) => {
    const currentMode = scene.data.get('viewMode');

    // Only allow pan/zoom in editor mode
    if (currentMode !== 'editor') {
      return;
    }

    e.preventDefault();

    // Check if this is a pinch-to-zoom gesture (trackpad sends ctrlKey=true for pinch)
    if (e.ctrlKey || e.metaKey) {
      // Pinch to zoom with cursor as pivot point
      const rect = scene.game.canvas.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;

      // Get world position before zoom
      const worldXBefore = camera.scrollX + pointerX / camera.zoom;
      const worldYBefore = camera.scrollY + pointerY / camera.zoom;

      // Calculate new zoom (deltaY is inverted for natural feel)
      const zoomDelta = -e.deltaY * 0.01;
      const zoomFactor = 1 + zoomDelta;
      const newZoom = Phaser.Math.Clamp(camera.zoom * zoomFactor, 0.1, 10);
      camera.setZoom(newZoom);

      // Get world position after zoom
      const worldXAfter = camera.scrollX + pointerX / camera.zoom;
      const worldYAfter = camera.scrollY + pointerY / camera.zoom;

      // Adjust scroll to keep cursor at same world position (pivot)
      camera.scrollX += worldXBefore - worldXAfter;
      camera.scrollY += worldYBefore - worldYAfter;
    } else {
      // Two-finger pan (natural trackpad scrolling)
      // Divide by zoom to make pan speed consistent at any zoom level
      camera.scrollX += e.deltaX / camera.zoom;
      camera.scrollY += e.deltaY / camera.zoom;
    }
  }, { passive: false });

  scene.input.setTopOnly(true);

  const marqueeGraphics = scene.add.graphics();
  marqueeGraphics.setDepth(10_000);
  marqueeGraphics.setVisible(false);

  let isMarqueeSelecting = false;
  let marqueeStartX = 0;
  let marqueeStartY = 0;
  let marqueeHasMoved = false;
  let marqueePointerId: number | null = null;
  let marqueeMode: 'replace' | 'add' | 'toggle' = 'replace';
  let activeTranslateDrag: {
    pointerId: number;
    objectIds: string[];
    startWorldX: number;
    startWorldY: number;
    startPositions: Map<string, { x: number; y: number }>;
    hasMoved: boolean;
  } | null = null;
  const groupSelectionRect = scene.add.rectangle(0, 0, 10, 10);
  groupSelectionRect.setStrokeStyle(GIZMO_STROKE_PX, 0x4A90D9);
  groupSelectionRect.setFillStyle(0x4A90D9, 0.08);
  groupSelectionRect.setVisible(false);
  groupSelectionRect.setDepth(10_002);

  const groupRotateLine = scene.add.graphics();
  groupRotateLine.setVisible(false);
  groupRotateLine.setDepth(10_003);

  const groupHandles = new Map<string, Phaser.GameObjects.Shape | Phaser.GameObjects.Arc>();
  const createGroupHandle = (name: string, shape: Phaser.GameObjects.Shape | Phaser.GameObjects.Arc, cursor: string) => {
    shape.setName(name);
    shape.setVisible(false);
    shape.setDepth(10_004);
    shape.setInteractive({ useHandCursor: false, cursor });
    scene.input.setDraggable(shape);
    groupHandles.set(name, shape);
  };

  createGroupHandle('handle_nw', scene.add.rectangle(0, 0, GIZMO_HANDLE_SIZE_PX, GIZMO_HANDLE_SIZE_PX, 0x4A90D9), 'nwse-resize');
  createGroupHandle('handle_ne', scene.add.rectangle(0, 0, GIZMO_HANDLE_SIZE_PX, GIZMO_HANDLE_SIZE_PX, 0x4A90D9), 'nesw-resize');
  createGroupHandle('handle_sw', scene.add.rectangle(0, 0, GIZMO_HANDLE_SIZE_PX, GIZMO_HANDLE_SIZE_PX, 0x4A90D9), 'nesw-resize');
  createGroupHandle('handle_se', scene.add.rectangle(0, 0, GIZMO_HANDLE_SIZE_PX, GIZMO_HANDLE_SIZE_PX, 0x4A90D9), 'nwse-resize');
  createGroupHandle('handle_n', scene.add.rectangle(0, 0, GIZMO_EDGE_LONG_PX, GIZMO_HANDLE_SIZE_PX, 0x4A90D9), 'ns-resize');
  createGroupHandle('handle_s', scene.add.rectangle(0, 0, GIZMO_EDGE_LONG_PX, GIZMO_HANDLE_SIZE_PX, 0x4A90D9), 'ns-resize');
  createGroupHandle('handle_e', scene.add.rectangle(0, 0, GIZMO_HANDLE_SIZE_PX, GIZMO_EDGE_LONG_PX, 0x4A90D9), 'ew-resize');
  createGroupHandle('handle_w', scene.add.rectangle(0, 0, GIZMO_HANDLE_SIZE_PX, GIZMO_EDGE_LONG_PX, 0x4A90D9), 'ew-resize');
  createGroupHandle('handle_rotate', scene.add.circle(0, 0, GIZMO_ROTATE_RADIUS_PX, 0x4A90D9), 'grab');

  let groupTransformContext: {
    handleName: string;
    selectedIds: string[];
    startPointerX: number;
    startPointerY: number;
    bounds: { centerX: number; centerY: number; width: number; height: number };
    startObjects: Map<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>;
  } | null = null;

  const setGroupGizmoVisible = (visible: boolean) => {
    groupSelectionRect.setVisible(visible);
    groupRotateLine.setVisible(visible);
    groupHandles.forEach((handle) => handle.setVisible(visible));
  };

  const getSelectionBounds = (selectedIds: string[]) => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let foundAny = false;

    for (const selectedId of selectedIds) {
      const selectedContainer = scene.children.getByName(selectedId) as Phaser.GameObjects.Container | null;
      if (!selectedContainer) continue;
      const selectedHitRect = selectedContainer.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
      const bounds = selectedHitRect ? selectedHitRect.getBounds() : selectedContainer.getBounds();
      minX = Math.min(minX, bounds.left);
      minY = Math.min(minY, bounds.top);
      maxX = Math.max(maxX, bounds.right);
      maxY = Math.max(maxY, bounds.bottom);
      foundAny = true;
    }

    if (!foundAny) return null;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return {
      centerX: minX + width / 2,
      centerY: minY + height / 2,
      width,
      height,
    };
  };

  const updateGroupGizmo = (bounds: { centerX: number; centerY: number; width: number; height: number }) => {
    const cameraZoom = scene.cameras.main.zoom || 1;
    const uiScale = 1 / cameraZoom;
    const strokeWidth = Math.max(0.5, GIZMO_STROKE_PX / cameraZoom);
    const halfW = bounds.width / 2;
    const halfH = bounds.height / 2;
    const rotateDistance = GIZMO_ROTATE_DISTANCE_PX / cameraZoom;

    groupSelectionRect.setPosition(bounds.centerX, bounds.centerY);
    groupSelectionRect.setSize(bounds.width, bounds.height);
    groupSelectionRect.setStrokeStyle(strokeWidth, 0x4A90D9);
    groupSelectionRect.setFillStyle(0x4A90D9, 0.08);

    const setHandle = (name: string, x: number, y: number) => {
      const handle = groupHandles.get(name);
      if (!handle) return;
      handle.setPosition(x, y);
      handle.setScale(uiScale, uiScale);
    };

    setHandle('handle_nw', bounds.centerX - halfW, bounds.centerY - halfH);
    setHandle('handle_ne', bounds.centerX + halfW, bounds.centerY - halfH);
    setHandle('handle_sw', bounds.centerX - halfW, bounds.centerY + halfH);
    setHandle('handle_se', bounds.centerX + halfW, bounds.centerY + halfH);
    setHandle('handle_n', bounds.centerX, bounds.centerY - halfH);
    setHandle('handle_s', bounds.centerX, bounds.centerY + halfH);
    setHandle('handle_e', bounds.centerX + halfW, bounds.centerY);
    setHandle('handle_w', bounds.centerX - halfW, bounds.centerY);
    setHandle('handle_rotate', bounds.centerX, bounds.centerY - halfH - rotateDistance);

    groupRotateLine.clear();
    groupRotateLine.lineStyle(strokeWidth, 0x4A90D9, 1);
    groupRotateLine.lineBetween(bounds.centerX, bounds.centerY - halfH, bounds.centerX, bounds.centerY - halfH - rotateDistance + 4 / cameraZoom);
  };

  const drawMarquee = (pointer: Phaser.Input.Pointer) => {
    const minX = Math.min(marqueeStartX, pointer.worldX);
    const minY = Math.min(marqueeStartY, pointer.worldY);
    const width = Math.abs(pointer.worldX - marqueeStartX);
    const height = Math.abs(pointer.worldY - marqueeStartY);
    marqueeGraphics.clear();
    marqueeGraphics.fillStyle(0x4a90d9, 0.12);
    marqueeGraphics.fillRect(minX, minY, width, height);
    marqueeGraphics.lineStyle(1, 0x4a90d9, 1);
    marqueeGraphics.strokeRect(minX, minY, width, height);
    marqueeGraphics.setVisible(true);
  };

  const endMarqueeSelection = (pointer: Phaser.Input.Pointer) => {
    marqueeGraphics.clear();
    marqueeGraphics.setVisible(false);

    const currentMode = scene.data.get('viewMode');
    if (currentMode !== 'editor') {
      isMarqueeSelecting = false;
      marqueePointerId = null;
      return;
    }

    const pointerWorldX = pointer.worldX;
    const pointerWorldY = pointer.worldY;
    const minX = Math.min(marqueeStartX, pointerWorldX);
    const minY = Math.min(marqueeStartY, pointerWorldY);
    const maxX = Math.max(marqueeStartX, pointerWorldX);
    const maxY = Math.max(marqueeStartY, pointerWorldY);

    if (!marqueeHasMoved) {
      if (marqueeMode === 'replace') {
        const storeState = useEditorStore.getState();
        const currentSelected = storeState.selectedObjectIds.length > 0
          ? storeState.selectedObjectIds
          : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
        // Avoid unexpectedly clearing an existing multi-selection on a plain background click.
        if (currentSelected.length <= 1) {
          selectObject(null);
        }
      }
      isMarqueeSelecting = false;
      marqueePointerId = null;
      return;
    }

    const hits = new Set<string>();
    scene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (!(child instanceof Phaser.GameObjects.Container) || !child.getData('objectData')) return;
      const objectHitRect = child.getByName('hitArea') as Phaser.GameObjects.Rectangle | null;
      const bounds = objectHitRect ? objectHitRect.getBounds() : child.getBounds();
      const intersects = bounds.right >= minX && bounds.left <= maxX && bounds.bottom >= minY && bounds.top <= maxY;
      if (intersects) {
        hits.add(child.name);
      }
    });

    const orderedSceneObjectIds = getOrderedSceneObjectIds();
    const orderedHitIds = orderedSceneObjectIds.filter((id) => hits.has(id));

    const storeState = useEditorStore.getState();
    const currentSelected = storeState.selectedObjectIds.length > 0
      ? storeState.selectedObjectIds
      : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
    let nextSelection: string[] = orderedHitIds;

    if (marqueeMode === 'add') {
      nextSelection = Array.from(new Set([...currentSelected, ...orderedHitIds]));
    } else if (marqueeMode === 'toggle') {
      const toggled = new Set(currentSelected);
      for (const id of orderedHitIds) {
        if (toggled.has(id)) {
          toggled.delete(id);
        } else {
          toggled.add(id);
        }
      }
      nextSelection = orderedSceneObjectIds.filter((id) => toggled.has(id));
    }

    selectObjects(nextSelection, nextSelection[0] ?? null);
    isMarqueeSelecting = false;
    marqueePointerId = null;
  };

  const isPointerOverVisibleGizmo = (worldX: number, worldY: number): boolean => {
    for (const handle of groupHandles.values()) {
      if (handle.visible && handle.getBounds().contains(worldX, worldY)) {
        return true;
      }
    }

    const { selectedObjectId: activeId, selectedObjectIds: activeIds } = useEditorStore.getState();
    const selectedIds = activeIds.length > 0
      ? activeIds
      : (activeId ? [activeId] : []);
    for (const objectId of selectedIds) {
      const container = scene.children.getByName(objectId) as Phaser.GameObjects.Container | null;
      if (!container) continue;
      for (const name of GIZMO_HANDLE_NAMES) {
        const handle = container.getByName(name) as Phaser.GameObjects.Shape | Phaser.GameObjects.Arc | null;
        if (handle && handle.visible && handle.getBounds().contains(worldX, worldY)) {
          return true;
        }
      }
    }
    return false;
  };

  for (const [handleName, handle] of groupHandles.entries()) {
    handle.on('dragstart', (pointer: Phaser.Input.Pointer) => {
      const storeState = useEditorStore.getState();
      const selectedIds = storeState.selectedObjectIds.length > 0
        ? storeState.selectedObjectIds
        : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
      if (selectedIds.length === 0) {
        groupTransformContext = null;
        return;
      }

      const bounds = getSelectionBounds(selectedIds);
      if (!bounds) {
        groupTransformContext = null;
        return;
      }

      const startObjects = new Map<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>();
      for (const id of selectedIds) {
        const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        if (selectedContainer) {
          startObjects.set(id, {
            x: selectedContainer.x,
            y: selectedContainer.y,
            scaleX: selectedContainer.scaleX,
            scaleY: selectedContainer.scaleY,
            rotation: selectedContainer.rotation,
          });
        }
      }

      groupTransformContext = {
        handleName,
        selectedIds,
        startPointerX: pointer.worldX,
        startPointerY: pointer.worldY,
        bounds,
        startObjects,
      };
    });

    handle.on('drag', (pointer: Phaser.Input.Pointer) => {
      if (!groupTransformContext || groupTransformContext.handleName !== handleName) return;

      const { bounds, startPointerX, startPointerY, startObjects } = groupTransformContext;
      const dx = pointer.worldX - startPointerX;
      const dy = pointer.worldY - startPointerY;

      if (handleName === 'handle_rotate') {
        const angleToStart = Math.atan2(startPointerY - bounds.centerY, startPointerX - bounds.centerX);
        const angleToCurrent = Math.atan2(pointer.worldY - bounds.centerY, pointer.worldX - bounds.centerX);
        const deltaRotation = angleToCurrent - angleToStart;

        for (const [id, start] of startObjects) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (!selectedContainer) continue;

          const relX = start.x - bounds.centerX;
          const relY = start.y - bounds.centerY;
          const cos = Math.cos(deltaRotation);
          const sin = Math.sin(deltaRotation);
          selectedContainer.x = bounds.centerX + relX * cos - relY * sin;
          selectedContainer.y = bounds.centerY + relX * sin + relY * cos;
          selectedContainer.rotation = start.rotation + deltaRotation;
        }
      } else {
        let sx = 1;
        let sy = 1;
        const safeWidth = Math.max(1, bounds.width);
        const safeHeight = Math.max(1, bounds.height);

        if (handleName === 'handle_n') sy = (bounds.height - dy) / safeHeight;
        else if (handleName === 'handle_s') sy = (bounds.height + dy) / safeHeight;
        else if (handleName === 'handle_e') sx = (bounds.width + dx) / safeWidth;
        else if (handleName === 'handle_w') sx = (bounds.width - dx) / safeWidth;
        else if (handleName === 'handle_nw') {
          const uniform = (safeWidth + (-dx - dy) / 2) / safeWidth;
          sx = uniform;
          sy = uniform;
        } else if (handleName === 'handle_ne') {
          const uniform = (safeWidth + (dx - dy) / 2) / safeWidth;
          sx = uniform;
          sy = uniform;
        } else if (handleName === 'handle_sw') {
          const uniform = (safeWidth + (-dx + dy) / 2) / safeWidth;
          sx = uniform;
          sy = uniform;
        } else if (handleName === 'handle_se') {
          const uniform = (safeWidth + (dx + dy) / 2) / safeWidth;
          sx = uniform;
          sy = uniform;
        }

        sx = Math.max(0.1, sx);
        sy = Math.max(0.1, sy);

        for (const [id, start] of startObjects) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (!selectedContainer) continue;

          const relX = start.x - bounds.centerX;
          const relY = start.y - bounds.centerY;
          selectedContainer.x = bounds.centerX + relX * sx;
          selectedContainer.y = bounds.centerY + relY * sy;
          selectedContainer.setScale(Math.max(0.1, start.scaleX * sx), Math.max(0.1, start.scaleY * sy));
        }
      }

      const updatedBounds = getSelectionBounds(groupTransformContext.selectedIds);
      if (updatedBounds) {
        updateGroupGizmo(updatedBounds);
      }
    });

    handle.on('dragend', () => {
      if (!groupTransformContext || groupTransformContext.handleName !== handleName) return;
      for (const id of groupTransformContext.selectedIds) {
        const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        if (!selectedContainer) continue;
        const rotationDeg = Phaser.Math.RadToDeg(selectedContainer.rotation);
        onDragEnd(id, selectedContainer.x, selectedContainer.y, selectedContainer.scaleX, selectedContainer.scaleY, rotationDeg);
      }
      groupTransformContext = null;
    });
  }

  const beginTranslateDrag = (pointer: Phaser.Input.Pointer, objectId: string) => {
    const storeState = useEditorStore.getState();
    const selectedIds = storeState.selectedObjectIds.length > 0
      ? storeState.selectedObjectIds
      : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
    const orderedSceneObjectIds = getOrderedSceneObjectIds();
    const dragIds = (selectedIds.length > 1 && selectedIds.includes(objectId))
      ? orderedSceneObjectIds.filter((id) => selectedIds.includes(id))
      : [objectId];
    const startPositions = new Map<string, { x: number; y: number }>();
    for (const id of dragIds) {
      const draggedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
      if (draggedContainer) {
        startPositions.set(id, { x: draggedContainer.x, y: draggedContainer.y });
      }
    }

    if (startPositions.size === 0) {
      activeTranslateDrag = null;
      return;
    }

    activeTranslateDrag = {
      pointerId: pointer.id,
      objectIds: dragIds,
      startWorldX: pointer.worldX,
      startWorldY: pointer.worldY,
      startPositions,
      hasMoved: false,
    };
  };

  const endTranslateDrag = (pointer: Phaser.Input.Pointer) => {
    if (!activeTranslateDrag || activeTranslateDrag.pointerId !== pointer.id) return;

    if (activeTranslateDrag.hasMoved) {
      for (const id of activeTranslateDrag.objectIds) {
        const draggedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        if (draggedContainer) {
          onDragEnd(id, draggedContainer.x, draggedContainer.y);
        }
      }
    }

    activeTranslateDrag = null;
  };

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.leftButtonDown()) return;

    const worldX = pointer.worldX;
    const worldY = pointer.worldY;

    if (isPointerOverVisibleGizmo(worldX, worldY)) {
      return;
    }

    const pickedObjectId = pickTopObjectIdAtWorldPoint(scene, worldX, worldY);
    if (pickedObjectId) {
      onObjectPointerDown(pointer, pickedObjectId);
      const event = pointer.event as MouseEvent | PointerEvent | undefined;
      const hasSelectionModifier = !!(event?.metaKey || event?.ctrlKey || event?.shiftKey);
      if (!hasSelectionModifier) {
        beginTranslateDrag(pointer, pickedObjectId);
      }
      return;
    }

    const currentMode = scene.data.get('viewMode');
    if (currentMode !== 'editor') {
      const event = pointer.event as MouseEvent | PointerEvent | undefined;
      if (!(event?.metaKey || event?.ctrlKey || event?.shiftKey)) {
        const storeState = useEditorStore.getState();
        const currentSelected = storeState.selectedObjectIds.length > 0
          ? storeState.selectedObjectIds
          : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
        // Keep multi-selection stable unless user explicitly changes it.
        if (currentSelected.length <= 1) {
          selectObject(null);
        }
      }
      return;
    }

    const event = pointer.event as MouseEvent | PointerEvent | undefined;
    marqueeMode = event && (event.metaKey || event.ctrlKey)
      ? 'toggle'
      : (event?.shiftKey ? 'add' : 'replace');
    marqueeStartX = worldX;
    marqueeStartY = worldY;
    marqueeHasMoved = false;
    marqueePointerId = pointer.id;
    isMarqueeSelecting = true;
  });

  // Create objects (reverse depth so top of list = top render)
  const objectCount = sceneData.objects.length;
  const initialSelectedIds = new Set(
    selectedObjectIds.length > 0
      ? selectedObjectIds
      : (selectedObjectId ? [selectedObjectId] : []),
  );
  const isInitialMultiSelection = initialSelectedIds.size > 1;
  sceneData.objects.forEach((obj: GameObject, index: number) => {
    const container = createObjectVisual(scene, obj, true, canvasWidth, canvasHeight, components); // true = editor mode
    container.setDepth(objectCount - index); // Top of list = highest depth = renders on top
    const isSelected = initialSelectedIds.has(obj.id);
    container.setData('selected', isSelected);

    // Set initial selection and gizmo visibility
    const setSelectionVisible = (visible: boolean) => {
      const selRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
      if (selRect) selRect.setVisible(visible);

      // Per-object gizmo handles are disabled in favor of the global selection gizmo.
      for (const name of [...GIZMO_HANDLE_NAMES, 'rotate_line']) {
        const handle = container.getByName(name);
        if (handle) (handle as Phaser.GameObjects.Shape | Phaser.GameObjects.Graphics).setVisible(false);
      }
    };
    setSelectionVisible(!isInitialMultiSelection && isSelected);
    container.setData('setSelectionVisible', setSelectionVisible);

    let dragContext: {
      pointerId: number;
      leaderStartX: number;
      leaderStartY: number;
      objectIds: string[];
      startPositions: Map<string, { x: number; y: number }>;
    } | null = null;

    container.on('dragstart', (pointer: Phaser.Input.Pointer) => {
      const storeState = useEditorStore.getState();
      const selectedIds = storeState.selectedObjectIds.length > 0
        ? storeState.selectedObjectIds
        : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
      const orderedSceneObjectIds = getOrderedSceneObjectIds();
      const dragIds = (selectedIds.length > 1 && selectedIds.includes(obj.id))
        ? orderedSceneObjectIds.filter((id) => selectedIds.includes(id))
        : [obj.id];
      const startPositions = new Map<string, { x: number; y: number }>();
      for (const id of dragIds) {
        const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        if (selectedContainer) {
          startPositions.set(id, { x: selectedContainer.x, y: selectedContainer.y });
        }
      }
      dragContext = {
        pointerId: pointer.id,
        leaderStartX: container.x,
        leaderStartY: container.y,
        objectIds: dragIds,
        startPositions,
      };
    });

    container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (dragContext) {
        const dx = dragX - dragContext.leaderStartX;
        const dy = dragY - dragContext.leaderStartY;
        for (const id of dragContext.objectIds) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          const startPos = dragContext.startPositions.get(id);
          if (selectedContainer && startPos) {
            selectedContainer.x = startPos.x + dx;
            selectedContainer.y = startPos.y + dy;
          }
        }
        return;
      }
      container.x = dragX;
      container.y = dragY;
    });

    container.on('dragend', () => {
      if (dragContext) {
        for (const id of dragContext.objectIds) {
          const selectedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
          if (selectedContainer) {
            onDragEnd(id, selectedContainer.x, selectedContainer.y);
          }
        }
        dragContext = null;
        return;
      }
      onDragEnd(obj.id, container.x, container.y);
    });

    // Handle transform end from gizmo (includes scale and rotation)
    container.on('transformend', () => {
      const rotationDeg = Phaser.Math.RadToDeg(container.rotation);
      onDragEnd(obj.id, container.x, container.y, container.scaleX, container.scaleY, rotationDeg);
    });
  });

  // Update selection visuals on scene update
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (activeTranslateDrag && activeTranslateDrag.pointerId === pointer.id) {
      const dx = pointer.worldX - activeTranslateDrag.startWorldX;
      const dy = pointer.worldY - activeTranslateDrag.startWorldY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        activeTranslateDrag.hasMoved = true;
      }
      for (const id of activeTranslateDrag.objectIds) {
        const draggedContainer = scene.children.getByName(id) as Phaser.GameObjects.Container | null;
        const startPos = activeTranslateDrag.startPositions.get(id);
        if (draggedContainer && startPos) {
          draggedContainer.x = startPos.x + dx;
          draggedContainer.y = startPos.y + dy;
        }
      }
      return;
    }

    if (!isMarqueeSelecting || marqueePointerId !== pointer.id) return;
    const dx = Math.abs(pointer.worldX - marqueeStartX);
    const dy = Math.abs(pointer.worldY - marqueeStartY);
    if (dx > 2 || dy > 2) {
      marqueeHasMoved = true;
      drawMarquee(pointer);
    }
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    endTranslateDrag(pointer);
    if (isMarqueeSelecting && marqueePointerId === pointer.id) {
      endMarqueeSelection(pointer);
    }
  });

  scene.events.on('update', () => {
    const storeState = useEditorStore.getState();
    const selectedIds = storeState.selectedObjectIds.length > 0
      ? storeState.selectedObjectIds
      : (storeState.selectedObjectId ? [storeState.selectedObjectId] : []);
    const selectedSet = new Set(selectedIds);
    const isMultiSelection = selectedIds.length > 1;

    scene.children.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Container && child.getData('objectData')) {
        const isSelected = selectedSet.has(child.name);
        child.setData('selected', isSelected);
        const setSelectionVisible = child.getData('setSelectionVisible') as ((visible: boolean) => void) | undefined;
        if (setSelectionVisible) {
          setSelectionVisible(!isMultiSelection && isSelected);
        } else {
          // Fallback for containers without the helper
          const selectionRect = child.getByName('selection') as Phaser.GameObjects.Rectangle;
          if (selectionRect) {
            selectionRect.setVisible(!isMultiSelection && isSelected);
          }
        }
      }
    });

    if (selectedIds.length === 0) {
      setGroupGizmoVisible(false);
      return;
    }

    if (!groupTransformContext) {
      const selectionBounds = getSelectionBounds(selectedIds);
      if (!selectionBounds) {
        setGroupGizmoVisible(false);
        return;
      }
      updateGroupGizmo(selectionBounds);
    }

    setGroupGizmoVisible(true);
  });
}

/**
 * Create a Phaser scene config for dynamic scene addition
 */
function createPlaySceneConfig(
  sceneData: SceneData,
  allScenes: SceneData[],
  components: ComponentDefinition[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  canvasWidth: number,
  canvasHeight: number,
  globalVariables: Variable[],
  allObjects: GameObject[],
  sceneId: string
): Phaser.Types.Scenes.CreateSceneFromObjectConfig {
  return {
    create: function(this: Phaser.Scene) {
      createPlaySceneContent(
        this,
        sceneData,
        allScenes,
        components,
        runtimeRef,
        canvasWidth,
        canvasHeight,
        globalVariables,
        allObjects,
        sceneId
      );
    },
    update: function(this: Phaser.Scene) {
      const runtime = sceneRuntimes.get(sceneId);
      if (runtime && !runtime.isPaused()) {
        runtime.update();

        // Check for scene switch from this scene's runtime
        const pendingSwitch = runtime.pendingSceneSwitch;
        if (pendingSwitch) {
          const targetSceneData = allScenes.find(s => s.name === pendingSwitch.sceneName);
          if (targetSceneData) {
            runtime.clearPendingSceneSwitch();
            const currentSceneKey = `PlayScene_${sceneId}`;
            const targetSceneKey = `PlayScene_${targetSceneData.id}`;

            // Pause current runtime
            runtime.pause();

            // Check if target scene already exists
            const existingRuntime = sceneRuntimes.get(targetSceneData.id);

            if (existingRuntime && !pendingSwitch.restart) {
              // Resume existing scene
              this.scene.sleep(currentSceneKey);
              this.scene.wake(targetSceneKey);
              runtimeRef.current = existingRuntime;
              existingRuntime.resume();
              setCurrentRuntime(existingRuntime);
            } else {
              // Clean up and restart if needed
              if (existingRuntime) {
                existingRuntime.cleanup();
                sceneRuntimes.delete(targetSceneData.id);
                this.scene.stop(targetSceneKey);
              }

              this.scene.sleep(currentSceneKey);

              if (!this.scene.get(targetSceneKey)) {
                this.scene.add(targetSceneKey, createPlaySceneConfig(
                  targetSceneData,
                  allScenes,
                  components,
                  runtimeRef,
                  canvasWidth,
                  canvasHeight,
                  globalVariables,
                  allObjects,
                  targetSceneData.id
                ), true);
              } else {
                this.scene.start(targetSceneKey);
              }
            }
          }
        }
      }
    },
  };
}

/**
 * Create the play scene content (running game mode)
 */
function createPlaySceneContent(
  scene: Phaser.Scene,
  sceneData: SceneData,
  _allScenes: SceneData[],
  components: ComponentDefinition[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  canvasWidth: number,
  canvasHeight: number,
  globalVariables: Variable[],
  allObjects: GameObject[],
  sceneId: string
) {
  // Set background
  if (sceneData.background?.type === 'color') {
    scene.cameras.main.setBackgroundColor(sceneData.background.value);
  }

  // Create runtime engine with canvas dimensions for coordinate conversion
  const runtime = new RuntimeEngine(scene, canvasWidth, canvasHeight);
  runtimeRef.current = runtime;
  setCurrentRuntime(runtime);

  // Store runtime for this scene (for pause/resume)
  sceneRuntimes.set(sceneId, runtime);

  // Set up variable lookup for typed variables
  runtime.setVariableLookup((varId: string) => {
    // Check global variables
    const globalVar = globalVariables.find(v => v.id === varId);
    if (globalVar) {
      return {
        name: globalVar.name,
        type: globalVar.type,
        scope: globalVar.scope,
        defaultValue: globalVar.defaultValue,
      };
    }
    // Check local variables in all objects
    for (const obj of allObjects) {
      const localVar = obj.localVariables?.find(v => v.id === varId);
      if (localVar) {
        return {
          name: localVar.name,
          type: localVar.type,
          scope: localVar.scope,
          defaultValue: localVar.defaultValue,
        };
      }
    }
    return undefined;
  });

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
    container.setDepth(objectCount - index);

    // Register with runtime
    const runtimeSprite = runtime.registerSprite(obj.id, obj.name, container, obj.componentId);

    // Set costumes if available
    const costumes = effectiveProps.costumes || [];
    if (costumes.length > 0) {
      runtimeSprite.setCostumes(costumes, effectiveProps.currentCostumeIndex || 0);
    }

    // Register sounds with runtime
    const sounds = effectiveProps.sounds || [];
    if (sounds.length > 0) {
      runtime.registerSounds(sounds);
    }

    // Store collider and physics config
    const physics = effectiveProps.physics;
    const collider = effectiveProps.collider;
    runtimeSprite.setColliderConfig(collider || null);
    runtimeSprite.setPhysicsConfig(physics || null);

    if (physics?.enabled) {
      // Get default size from costume bounds
      const costume = costumes[effectiveProps.currentCostumeIndex || 0];
      let defaultWidth = 64, defaultHeight = 64;
      if (costume?.bounds && costume.bounds.width > 0 && costume.bounds.height > 0) {
        defaultWidth = costume.bounds.width;
        defaultHeight = costume.bounds.height;
      }

      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;
      const scaledDefaultWidth = defaultWidth * Math.abs(scaleX);
      const scaledDefaultHeight = defaultHeight * Math.abs(scaleY);

      const bodyOptions: Phaser.Types.Physics.Matter.MatterBodyConfig = {
        restitution: physics.bounce ?? 0,
        frictionAir: 0.01,
        friction: physics.friction ?? 0.1,
      };

      let body: MatterJS.BodyType;
      const posX = container.x;
      const posY = container.y;

      const colliderOffsetX = (collider?.offsetX ?? 0) * scaleX;
      const colliderOffsetY = (collider?.offsetY ?? 0) * scaleY;
      const bodyX = posX + colliderOffsetX;
      const bodyY = posY + colliderOffsetY;

      const colliderType = collider?.type ?? 'circle';

      switch (colliderType) {
        case 'none': {
          body = scene.matter.add.rectangle(bodyX, bodyY, scaledDefaultWidth, scaledDefaultHeight, { ...bodyOptions, isSensor: true });
          break;
        }
        case 'circle': {
          const avgScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
          const baseRadius = collider?.radius || Math.max(defaultWidth, defaultHeight) / 2;
          const radius = baseRadius * avgScale;
          body = scene.matter.add.circle(bodyX, bodyY, radius, bodyOptions);
          break;
        }
        case 'capsule': {
          const baseWidth = collider?.width || defaultWidth;
          const baseHeight = collider?.height || defaultHeight;
          const width = baseWidth * Math.abs(scaleX);
          const height = baseHeight * Math.abs(scaleY);
          const chamferRadius = Math.min(width, height) / 2;
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
          body = scene.matter.add.rectangle(bodyX, bodyY, width, height, bodyOptions);
          break;
        }
      }

      const existingBody = (container as unknown as { body?: MatterJS.BodyType }).body;
      if (existingBody) {
        scene.matter.world.remove(existingBody);
      }

      (body as MatterJS.BodyType & { destroy?: () => void }).destroy = () => {
        if (scene.matter?.world) {
          scene.matter.world.remove(body);
        }
      };

      (container as unknown as { body: MatterJS.BodyType }).body = body;

      container.setData('colliderOffsetX', colliderOffsetX);
      container.setData('colliderOffsetY', colliderOffsetY);

      scene.matter.world.on('afterupdate', () => {
        if (body && container.active && !body.isStatic) {
          const offsetX = container.getData('colliderOffsetX') ?? 0;
          const offsetY = container.getData('colliderOffsetY') ?? 0;
          container.setPosition(body.position.x - offsetX, body.position.y - offsetY);
          if (physics.allowRotation) {
            container.setRotation(body.angle);
          }
        }
      });

      container.setData('allowRotation', physics.allowRotation ?? false);

      scene.matter.body.setVelocity(body, {
        x: physics.velocityX ?? 0,
        y: -(physics.velocityY ?? 0)
      });

      if (physics.bodyType === 'static') {
        scene.matter.body.setVelocity(body, { x: 0, y: 0 });
        scene.matter.body.setAngularVelocity(body, 0);
        scene.matter.body.setStatic(body, true);
      }

      if (!physics.allowRotation) {
        scene.matter.body.setInertia(body, Infinity);
      }

      const gravityValue = physics.gravityY ?? 1;
      setBodyGravityY(body, gravityValue);
    }

    // Save template for cloning
    runtime.saveTemplate(obj.id);

    // Generate and execute code for this object
    const blocklyXml = effectiveProps.blocklyXml;
    if (blocklyXml) {
      try {
        const code = generateCodeForObject(blocklyXml, obj.id);
        if (code) {
          const functionBody = `return ${code};`;
          const execFunction = new Function('runtime', 'spriteId', 'sprite', functionBody);
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

  // Set up physics colliders
  runtime.setupPhysicsColliders();

  // Start the runtime
  runtime.start();
}

/**
 * Create the play scene (running game mode) - wrapper for initial scene
 */
function createPlayScene(
  scene: Phaser.Scene,
  sceneData: SceneData | undefined,
  allScenes: SceneData[],
  components: ComponentDefinition[],
  runtimeRef: React.MutableRefObject<RuntimeEngine | null>,
  canvasWidth: number,
  canvasHeight: number,
  globalVariables: Variable[],
  allObjects: GameObject[],
  sceneId?: string
) {
  if (!sceneData) return;

  // Use provided sceneId or fallback to sceneData.id
  const effectiveSceneId = sceneId || sceneData.id;

  createPlaySceneContent(
    scene,
    sceneData,
    allScenes,
    components,
    runtimeRef,
    canvasWidth,
    canvasHeight,
    globalVariables,
    allObjects,
    effectiveSceneId
  );
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
  const gizmoHandles: Phaser.GameObjects.GameObject[] = [];

  if (isEditorMode) {
    // Selection visual
    selectionRect = scene.add.rectangle(0, 0, defaultSize + 8, defaultSize + 8);
    selectionRect.setStrokeStyle(2, 0x4A90D9);
    selectionRect.setFillStyle(0x4A90D9, 0.1);
    selectionRect.setVisible(false);
    selectionRect.setName('selection');
    container.add(selectionRect);

    // Create gizmo handles
    const handleColor = 0x4A90D9;

    // Corner handles (for proportional scaling)
    const cornerNames = ['nw', 'ne', 'sw', 'se'];
    const cornerCursors = ['nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize'];
    for (let i = 0; i < 4; i++) {
      const handle = scene.add.rectangle(0, 0, GIZMO_HANDLE_SIZE_PX, GIZMO_HANDLE_SIZE_PX, handleColor);
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
      const handle = scene.add.rectangle(0, 0, isVertical ? GIZMO_EDGE_LONG_PX : GIZMO_HANDLE_SIZE_PX, isVertical ? GIZMO_HANDLE_SIZE_PX : GIZMO_EDGE_LONG_PX, handleColor);
      handle.setName(`handle_${edgeNames[i]}`);
      handle.setVisible(false);
      handle.setInteractive({ useHandCursor: false, cursor: edgeCursors[i] });
      scene.input.setDraggable(handle);
      container.add(handle);
      gizmoHandles.push(handle);
    }

    // Rotation handle (circle above object)
    const rotateHandle = scene.add.circle(0, 0, GIZMO_ROTATE_RADIUS_PX, handleColor);
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

    // Invisible hit area - this is what actually receives clicks
    hitRect = scene.add.rectangle(0, 0, defaultSize, defaultSize, 0x000000, 0);
    hitRect.setName('hitArea');
    container.add(hitRect);

    // Track drag offset to prevent jumping
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // Set up editor interactivity immediately (with one-frame fallback for scene init edge cases).
    const setupEditorInteractivity = () => {
      if (!hitRect || !hitRect.scene) return;
      if (container.getData('editorInteractivityBound')) return;

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
        container.emit('dragstart', pointer);
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

      container.setData('editorInteractivityBound', true);
    };

    setupEditorInteractivity();
    scene.time.delayedCall(0, setupEditorInteractivity);

    // Function to update gizmo handle positions based on current bounds
    const updateGizmoPositions = () => {
      const selRect = container.getByName('selection') as Phaser.GameObjects.Rectangle;
      if (!selRect) return;
      const cameraZoom = scene.cameras.main.zoom || 1;
      const absScaleX = Math.max(Math.abs(container.scaleX), 0.0001);
      const absScaleY = Math.max(Math.abs(container.scaleY), 0.0001);
      const invUiScaleX = 1 / (absScaleX * cameraZoom);
      const invUiScaleY = 1 / (absScaleY * cameraZoom);
      const strokeWidth = GIZMO_STROKE_PX / (Math.max(absScaleX, absScaleY) * cameraZoom);
      selRect.setStrokeStyle(Math.max(0.5, strokeWidth), 0x4A90D9);

      const halfW = selRect.width / 2;
      const halfH = selRect.height / 2;
      const offsetX = selRect.x;
      const offsetY = selRect.y;
      const rotateDistance = GIZMO_ROTATE_DISTANCE_PX / (Math.max(absScaleX, absScaleY) * cameraZoom);

      // Corner handles
      const nw = container.getByName('handle_nw') as Phaser.GameObjects.Rectangle;
      const ne = container.getByName('handle_ne') as Phaser.GameObjects.Rectangle;
      const sw = container.getByName('handle_sw') as Phaser.GameObjects.Rectangle;
      const se = container.getByName('handle_se') as Phaser.GameObjects.Rectangle;
      if (nw) nw.setScale(invUiScaleX, invUiScaleY);
      if (ne) ne.setScale(invUiScaleX, invUiScaleY);
      if (sw) sw.setScale(invUiScaleX, invUiScaleY);
      if (se) se.setScale(invUiScaleX, invUiScaleY);
      if (nw) nw.setPosition(offsetX - halfW, offsetY - halfH);
      if (ne) ne.setPosition(offsetX + halfW, offsetY - halfH);
      if (sw) sw.setPosition(offsetX - halfW, offsetY + halfH);
      if (se) se.setPosition(offsetX + halfW, offsetY + halfH);

      // Edge handles
      const n = container.getByName('handle_n') as Phaser.GameObjects.Rectangle;
      const s = container.getByName('handle_s') as Phaser.GameObjects.Rectangle;
      const e = container.getByName('handle_e') as Phaser.GameObjects.Rectangle;
      const w = container.getByName('handle_w') as Phaser.GameObjects.Rectangle;
      if (n) n.setScale(invUiScaleX, invUiScaleY);
      if (s) s.setScale(invUiScaleX, invUiScaleY);
      if (e) e.setScale(invUiScaleX, invUiScaleY);
      if (w) w.setScale(invUiScaleX, invUiScaleY);
      if (n) n.setPosition(offsetX, offsetY - halfH);
      if (s) s.setPosition(offsetX, offsetY + halfH);
      if (e) e.setPosition(offsetX + halfW, offsetY);
      if (w) w.setPosition(offsetX - halfW, offsetY);

      // Rotation handle and line
      const rotateHandle = container.getByName('handle_rotate') as Phaser.GameObjects.Arc;
      const rotateLine = container.getByName('rotate_line') as Phaser.GameObjects.Graphics;
      if (rotateHandle) {
        rotateHandle.setScale(invUiScaleX, invUiScaleY);
        rotateHandle.setPosition(offsetX, offsetY - halfH - rotateDistance);
      }
      if (rotateLine) {
        rotateLine.clear();
        rotateLine.lineStyle(Math.max(0.5, strokeWidth), 0x4A90D9, 1);
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
