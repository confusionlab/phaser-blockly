import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { getEffectiveObjectProps } from '@/types';
import type { GameObject, ComponentDefinition } from '@/types';
import { Button } from '@/components/ui/button';
import { X, Crosshair } from 'lucide-react';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import { loadImageSource } from '@/lib/assets/imageSourceCache';

const EMPTY_COMPONENTS: ComponentDefinition[] = [];

// Coordinate conversion
function userToPhaser(userX: number, userY: number, canvasWidth: number, canvasHeight: number) {
  return {
    x: userX + canvasWidth / 2,
    y: canvasHeight / 2 - userY
  };
}

export function ObjectPicker() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [hoveredObject, setHoveredObject] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const { project } = useProjectStore();
  const {
    selectedSceneId,
    objectPickerOpen,
    objectPickerCallback,
    objectPickerExcludeId,
    closeObjectPicker
  } = useEditorStore();

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const components = project?.components || EMPTY_COMPONENTS;
  const canvasWidth = project?.settings.canvasWidth;
  const canvasHeight = project?.settings.canvasHeight;

  // Get hovered object name for display
  const hoveredObjectData = selectedScene?.objects.find(o => o.id === hoveredObject);

  useEffect(() => {
    if (!objectPickerOpen || !containerRef.current || !selectedScene) return;
    if (canvasWidth == null || canvasHeight == null) return;
    if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return;
    const container = containerRef.current;
    setHoveredObject(null);

    // Create Phaser game for picking
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: container,
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: !selectedScene.background || selectedScene.background.type === 'image'
        ? '#87CEEB'
        : selectedScene.background.value,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: {
        create: function(this: Phaser.Scene) {
          createPickerScene(
            this,
            selectedScene,
            components,
            canvasWidth,
            canvasHeight,
            objectPickerExcludeId,
            (objId) => setHoveredObject(objId),
            (objId) => {
              if (objectPickerCallback) {
                objectPickerCallback(objId);
              }
              closeObjectPicker();
            }
          );
        },
      },
    };

    gameRef.current = new Phaser.Game(config);

    // Track mouse position for tooltip
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    // Handle Escape key to close picker
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreGlobalKeyboardEvent(e)) {
        return;
      }

      if (e.key === 'Escape') {
        closeObjectPicker();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [
    objectPickerOpen,
    selectedScene,
    components,
    canvasWidth,
    canvasHeight,
    objectPickerExcludeId,
    objectPickerCallback,
    closeObjectPicker,
  ]);

  if (!objectPickerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur border-b">
        <div className="flex items-center gap-2 text-sm">
          <Crosshair className="size-4 text-primary" />
          <span>Click on an object to select it</span>
        </div>
        <Button variant="ghost" size="icon" onClick={closeObjectPicker}>
          <X className="size-5" />
        </Button>
      </div>

      {/* Phaser canvas */}
      <div ref={containerRef} className="flex-1" style={{ cursor: 'crosshair' }} />

      {/* Hover tooltip */}
      {hoveredObject && hoveredObjectData && (
        <div
          className="fixed pointer-events-none z-50 flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg shadow-lg text-sm font-medium"
          style={{
            left: mousePos.x + 16,
            top: mousePos.y + 16,
          }}
        >
          <Crosshair className="size-4" />
          {hoveredObjectData.name}
        </div>
      )}
    </div>
  );
}

/**
 * Create the picker scene
 */
function createPickerScene(
  scene: Phaser.Scene,
  sceneData: { objects: GameObject[]; background?: { type: string; value: string } | null },
  components: ComponentDefinition[],
  canvasWidth: number,
  canvasHeight: number,
  excludeId: string | null,
  onHover: (objId: string | null) => void,
  onPick: (objId: string) => void
) {
  const camera = scene.cameras.main;
  camera.centerOn(canvasWidth / 2, canvasHeight / 2);

  // Draw bounds
  const boundsGraphics = scene.add.graphics();
  boundsGraphics.lineStyle(2, 0xffffff, 0.3);
  boundsGraphics.strokeRect(0, 0, canvasWidth, canvasHeight);

  // Create objects
  sceneData.objects.forEach((obj) => {
    // Skip excluded object
    if (obj.id === excludeId) return;

    const effectiveProps = getEffectiveObjectProps(obj, components);
    const phaserPos = userToPhaser(obj.x, obj.y, canvasWidth, canvasHeight);

    const container = scene.add.container(phaserPos.x, phaserPos.y);
    container.setName(obj.id);
    container.setScale(obj.scaleX, obj.scaleY);
    container.setRotation(Phaser.Math.DegToRad(obj.rotation));
    container.setVisible(obj.visible);

    // Default size
    let width = 64;
    let height = 64;

    // Get costume
    const costumes = effectiveProps.costumes || [];
    const currentCostume = costumes[effectiveProps.currentCostumeIndex ?? 0];

    if (currentCostume && currentCostume.assetId) {
      const textureKey = `picker_${obj.id}_${currentCostume.id}`;

      if (!scene.textures.exists(textureKey)) {
        void loadImageSource(currentCostume.assetId).then((img) => {
          if (!scene.sys.isActive()) return;
          if (scene.textures.exists(textureKey)) return;
          scene.textures.addImage(textureKey, img);

          const sprite = scene.add.image(0, 0, textureKey);
          container.add(sprite);

          width = sprite.width;
          height = sprite.height;
          container.setSize(width, height);

          setupInteractive(container, width, height);
        }).catch((error) => {
          console.warn('Failed to load object picker costume texture.', error);
        });
      } else {
        const sprite = scene.add.image(0, 0, textureKey);
        container.add(sprite);
        width = sprite.width;
        height = sprite.height;
        container.setSize(width, height);
        setupInteractive(container, width, height);
      }
    } else {
      // Placeholder graphics
      const graphics = scene.add.graphics();
      const color = getObjectColor(obj.id);
      graphics.fillStyle(color, 1);
      graphics.fillRoundedRect(-32, -32, 64, 64, 8);
      container.add(graphics);
      container.setSize(64, 64);
      setupInteractive(container, 64, 64);
    }

    function setupInteractive(cont: Phaser.GameObjects.Container, w: number, h: number) {
      // Create invisible hit area
      const hitRect = scene.add.rectangle(0, 0, w, h, 0x000000, 0);
      cont.add(hitRect);
      hitRect.setInteractive({ useHandCursor: true });

      // Highlight on hover
      const highlight = scene.add.rectangle(0, 0, w + 8, h + 8);
      highlight.setStrokeStyle(3, 0x4A90D9);
      highlight.setFillStyle(0x4A90D9, 0.2);
      highlight.setVisible(false);
      cont.addAt(highlight, 0);

      hitRect.on('pointerover', () => {
        highlight.setVisible(true);
        onHover(obj.id);
      });

      hitRect.on('pointerout', () => {
        highlight.setVisible(false);
        onHover(null);
      });

      hitRect.on('pointerdown', () => {
        onPick(obj.id);
      });
    }
  });
}

function getObjectColor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash = hash & hash;
  }
  const hue = Math.abs(hash % 360);
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.7).color;
}
