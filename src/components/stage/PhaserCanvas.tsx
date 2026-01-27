import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import type { Scene, GameObject } from '../../types';

interface PhaserCanvasProps {
  isPlaying: boolean;
}

export function PhaserCanvas({ isPlaying }: PhaserCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  const { project } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectObject } = useEditorStore();

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);

  // Initialize Phaser
  useEffect(() => {
    if (!containerRef.current || !project) return;

    // Clean up existing game
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
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
        mode: isPlaying ? Phaser.Scale.FIT : Phaser.Scale.FIT,
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
        key: 'EditorScene',
        create: function(this: Phaser.Scene) {
          createScene(this, selectedScene, isPlaying, selectObject, selectedObjectId);
        },
        update: function(this: Phaser.Scene) {
          if (isPlaying) {
            updateScene(this);
          }
        },
      },
    };

    gameRef.current = new Phaser.Game(config);

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [project?.id, selectedSceneId, isPlaying]);

  // Update objects when they change (in editor mode)
  useEffect(() => {
    if (!gameRef.current || isPlaying) return;

    const scene = gameRef.current.scene.getScene('EditorScene');
    if (!scene || !selectedScene) return;

    // Update all objects
    selectedScene.objects.forEach(obj => {
      const sprite = scene.children.getByName(obj.id) as Phaser.GameObjects.Sprite | undefined;
      if (sprite) {
        sprite.setPosition(obj.x, obj.y);
        sprite.setScale(obj.scaleX, obj.scaleY);
        sprite.setRotation(Phaser.Math.DegToRad(obj.rotation));
        sprite.setVisible(obj.visible);

        // Update selection visual
        const isSelected = obj.id === selectedObjectId;
        sprite.setData('selected', isSelected);
      }
    });
  }, [selectedScene?.objects, selectedObjectId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: isPlaying ? '100vh' : '300px' }}
    />
  );
}

function createScene(
  scene: Phaser.Scene,
  sceneData: Scene | undefined,
  isPlaying: boolean,
  selectObject: (id: string | null) => void,
  selectedObjectId: string | null
) {
  if (!sceneData) return;

  // Set background
  if (sceneData.background) {
    if (sceneData.background.type === 'color') {
      scene.cameras.main.setBackgroundColor(sceneData.background.value);
    }
  }

  // Create objects
  sceneData.objects.forEach((obj: GameObject) => {
    // For now, create colored rectangles as placeholders for sprites
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
    container.setData('selected', obj.id === selectedObjectId);

    // Add name label
    const label = scene.add.text(0, 40, obj.name, {
      fontSize: '12px',
      color: '#333',
      backgroundColor: '#fff',
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5, 0);
    container.add(label);

    if (!isPlaying) {
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
        // Position will be saved through the store
        const objData = container.getData('objectData');
        if (objData) {
          objData.x = container.x;
          objData.y = container.y;
        }
      });

      // Selection indicator
      const selectionRect = scene.add.rectangle(0, 0, 72, 72);
      selectionRect.setStrokeStyle(2, 0x4A90D9);
      selectionRect.setFillStyle(0x4A90D9, 0.1);
      selectionRect.setVisible(obj.id === selectedObjectId);
      selectionRect.setName('selection');
      container.add(selectionRect);
      container.sendToBack(selectionRect);
    }
  });

  // Update selection visuals
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

function updateScene(_scene: Phaser.Scene) {
  // Game loop update for play mode
  // This will be expanded with the runtime engine
}

function getObjectColor(id: string): number {
  // Generate consistent color from id
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash = hash & hash;
  }

  const hue = Math.abs(hash % 360);
  return Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.7).color;
}
